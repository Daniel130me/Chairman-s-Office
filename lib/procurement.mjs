import {sql,transaction,uid} from '../backend/src/db.mjs';
import {EconomyError,amountString,operationKey} from './economy-rules.mjs';
import {recordSystemPurchase,recordSystemSupplierPayment,recordSystemSale,recordSystemCOGS} from './economy.mjs';
import {quantityUnits,quantityText,moneyCents,moneyText,roundRatio,receiptValue,saleCost,procurementStatus} from './procurement-rules.mjs';
const clean=(v,n=300)=>String(v??'').trim().slice(0,n);
async function company(q,userId,id){
 const [row]=await q('SELECT * FROM companies WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,userId]);
 if(!row)throw new EconomyError('Company unavailable.',404);return row;
}
async function order(q,userId,id){
 const [existing]=await q('SELECT company_id FROM purchase_orders WHERE id=$1 AND user_id=$2',[id,userId]);
 if(!existing)throw new EconomyError('Purchase order unavailable.',404);
 const c=await company(q,userId,existing.company_id);
 const [po]=await q('SELECT * FROM purchase_orders WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,userId]);
 if(!po)throw new EconomyError('Purchase order unavailable.',404);
 return {c,po};
}
async function previous(q,userId,key,kind,payload){
 const [row]=await q('SELECT *,payload=$3::jsonb AS same FROM procurement_transactions WHERE user_id=$1 AND operation_key=$2',[userId,key,JSON.stringify(payload)]);
 if(row&&(!row.same||row.kind!==kind))throw new EconomyError('Operation reference already used.',409);
 return row;
}
async function save(q,userId,key,kind,po,item,amount,payload,transactionId=uid()){
 const [row]=await q('INSERT INTO procurement_transactions(id,user_id,operation_key,kind,purchase_order_id,inventory_item_id,amount,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[transactionId,userId,key,kind,po,item,amount,JSON.stringify(payload)]);return row;
}
async function event(q,c,kind,title,body){
 await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),c.user_id,c.world_id,kind,title,body]);
}
export async function receivePurchaseOrder(user,id,body){
 const full=body.full===true,reason=clean(body.reason),key='receipt:'+(full?'full:'+id:operationKey(body.operationKey));
 if(!reason)throw new EconomyError('Record a receipt reason.');
 const selections=full?null:(Array.isArray(body.lines)?body.lines.map(l=>({id:String(l.id),quantity:quantityText(quantityUnits(l.quantity))})).sort((a,b)=>a.id.localeCompare(b.id)):[]);
 if(!full&&(!selections.length||selections.length>20||new Set(selections.map(l=>l.id)).size!==selections.length))throw new EconomyError('Select valid order lines.');
 const payload={id,full,lines:selections,reason};
 return transaction(async q=>{
  const {c,po}=await order(q,user.id,id);
  if(full&&['received','paid'].includes(po.status))return po;
  if(await previous(q,user.id,key,'receipt',payload))return po;
  if(po.status!=='approved')throw new EconomyError('Only approved orders can receive goods.',409);
  const lines=await q('SELECT * FROM purchase_order_lines WHERE purchase_order_id=$1 AND user_id=$2 ORDER BY id FOR UPDATE',[id,user.id]);
  const changes=full?lines.filter(l=>quantityUnits(l.quantity)>quantityUnits(l.received_quantity,true)).map(l=>({id:l.id,quantity:quantityText(quantityUnits(l.quantity)-quantityUnits(l.received_quantity,true))})):selections;
  if(!changes.length)throw new EconomyError('No outstanding items.',409);
  const receiptId=uid();let total=0n;
  for(const change of changes){
   const line=lines.find(l=>l.id===change.id);if(!line)throw new EconomyError('Order line unavailable.',404);
   const value=receiptValue(line,change.quantity);total+=value;
   await q('UPDATE purchase_order_lines SET received_quantity=received_quantity+$1::numeric WHERE id=$2 AND user_id=$3',[change.quantity,line.id,user.id]);
   const updated=await q('UPDATE inventory_items SET quantity=quantity+$1::numeric,stock_value=stock_value+$2::numeric,average_cost=round((stock_value+$2::numeric)/(quantity+$1::numeric),2) WHERE id=$3 AND user_id=$4 AND company_id=$5 RETURNING id',[change.quantity,moneyText(value),line.inventory_item_id,user.id,c.id]);
   if(!updated.length)throw new EconomyError('Inventory item unavailable.',404);
   await q('INSERT INTO inventory_movements(id,user_id,company_id,inventory_item_id,direction,quantity,unit_cost,source_type,source_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[uid(),user.id,c.id,line.inventory_item_id,'in',change.quantity,line.unit_cost,'purchase-receipt',receiptId]);
  }
  if(total>0n)await recordSystemPurchase(q,c,key,moneyText(total),'Goods received · '+po.po_number,'Procurement');
  const received=moneyCents(po.received_total)+total,paid=moneyCents(po.paid_total);
  const [check]=await q('SELECT NOT EXISTS(SELECT 1 FROM purchase_order_lines WHERE purchase_order_id=$1 AND user_id=$2 AND received_quantity<quantity) AS complete',[id,user.id]);
  const status=procurementStatus(received-moneyCents(po.credited_total),paid,moneyCents(po.total)-moneyCents(po.credited_total),check.complete);
  const [row]=await q("UPDATE purchase_orders SET received_total=$1,status=$2,received_at=CASE WHEN $3 THEN now() ELSE received_at END,paid_at=CASE WHEN $2='paid' THEN now() ELSE paid_at END WHERE id=$4 AND user_id=$5 RETURNING *",[moneyText(received),status,check.complete,id,user.id]);
  await save(q,user.id,key,'receipt',id,null,moneyText(total),payload,receiptId);
  await event(q,c,'purchase-order-received',po.po_number+' · goods received',po.vendor_name+' · Received USD '+moneyText(total)+' · '+reason);
  return row;
 });
}
export async function payPurchaseOrder(user,id,body){
 const full=body.full===true,reason=clean(body.reason),key='supplier-payment:'+(full?'full:'+id:operationKey(body.operationKey)),amount=full?null:amountString(body.amount);
 if(!reason)throw new EconomyError('Record a payment reason.');
 const payload={id,full,amount,reason};
 return transaction(async q=>{
  const {c,po}=await order(q,user.id,id);
  if(full&&po.status==='paid')return po;
  if(await previous(q,user.id,key,'supplier-payment',payload))return po;
  if(!['approved','received'].includes(po.status)||(full&&po.status!=='received'))throw new EconomyError('Full settlement requires all goods received. Use a partial payment for delivered goods.',409);
  const received=moneyCents(po.received_total),prior=moneyCents(po.paid_total),outstanding=received-prior-moneyCents(po.credited_total),pay=full?outstanding:moneyCents(amount);
  if(pay<=0n||pay>outstanding)throw new EconomyError('Payment exceeds received, unpaid goods.',409);
  await recordSystemSupplierPayment(q,c,key,moneyText(pay),'Supplier settlement · '+po.po_number,'Accounts Payable');
  const paid=prior+pay,status=procurementStatus(received-moneyCents(po.credited_total),paid,moneyCents(po.total)-moneyCents(po.credited_total),po.status==='received');
  const [row]=await q("UPDATE purchase_orders SET paid_total=$1,status=$2,paid_at=CASE WHEN $2='paid' THEN now() ELSE paid_at END WHERE id=$3 AND user_id=$4 RETURNING *",[moneyText(paid),status,id,user.id]);
  await save(q,user.id,key,'supplier-payment',id,null,moneyText(pay),payload);
  await event(q,c,'purchase-order-paid',po.po_number+' · supplier payment',po.vendor_name+' · Paid USD '+moneyText(pay)+' · '+reason);
  return row;
 });
}
export async function sellInventory(user,id,body){
 const quantity=quantityText(quantityUnits(body.quantity)),amount=amountString(body.amount),customer=clean(body.customer,140),key='stock-sale:'+operationKey(body.operationKey);
 if(!customer)throw new EconomyError('Record the customer.');
 const payload={id,quantity,amount,customer};
 return transaction(async q=>{
  const [initial]=await q('SELECT company_id FROM inventory_items WHERE id=$1 AND user_id=$2',[id,user.id]);if(!initial)throw new EconomyError('Inventory item unavailable.',404);
  const c=await company(q,user.id,initial.company_id);
  const prior=await previous(q,user.id,key,'stock-sale',payload);if(prior)return prior;
  const [item]=await q("SELECT * FROM inventory_items WHERE id=$1 AND user_id=$2 AND status='active' FOR UPDATE",[id,user.id]);if(!item)throw new EconomyError('Inventory item unavailable.',404);
  const cost=saleCost(item,quantity);
  const row=await save(q,user.id,key,'stock-sale',null,id,amount,payload);
  await recordSystemSale(q,c,key+':revenue',amount,'Inventory sale · '+item.name+' · '+customer,'Sales');
  if(cost>0n)await recordSystemCOGS(q,c,key+':cost',moneyText(cost),'Inventory cost · '+item.name,'Sales');
  await q('UPDATE inventory_items SET quantity=quantity-$1::numeric,stock_value=stock_value-$2::numeric,average_cost=CASE WHEN quantity=$1::numeric THEN 0 ELSE round((stock_value-$2::numeric)/(quantity-$1::numeric),2) END WHERE id=$3 AND user_id=$4',[quantity,moneyText(cost),id,user.id]);
  await q('INSERT INTO inventory_movements(id,user_id,company_id,inventory_item_id,direction,quantity,unit_cost,source_type,source_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[uid(),user.id,c.id,id,'out',quantity,moneyText(roundRatio(cost*10000n,quantityUnits(quantity))),'stock-sale',row.id]);
  await event(q,c,'inventory-sale',item.name+' sold',customer+' · Quantity '+quantity+' · Revenue USD '+amount+' · Cost USD '+moneyText(cost));
  return row;
 });
}
export async function configureReorder(user,id,body){
 const level=quantityText(quantityUnits(body.reorderLevel,true)),quantity=quantityText(quantityUnits(body.reorderQuantity,true)),supplier=clean(body.supplier,140);
 if(quantityUnits(quantity,true)>0n&&!supplier)throw new EconomyError('Select a preferred supplier.');
 return transaction(async q=>{
  const [initial]=await q('SELECT company_id FROM inventory_items WHERE id=$1 AND user_id=$2',[id,user.id]);if(!initial)throw new EconomyError('Inventory item unavailable.',404);
  await company(q,user.id,initial.company_id);
  const [row]=await q('UPDATE inventory_items SET reorder_level=$1,reorder_quantity=$2,preferred_supplier=$3 WHERE id=$4 AND user_id=$5 RETURNING *',[level,quantity,supplier||null,id,user.id]);
  return row;
 });
}
// Draft only. The last received unit cost is an estimate, never a confirmed quote.
// No order, stock, cash or payable is committed without explicit approval.
export async function processProcurement(userId){
 const items=await sql("SELECT id,company_id FROM inventory_items WHERE user_id=$1 AND status='active' AND reorder_quantity>0 AND quantity<=reorder_level AND preferred_supplier IS NOT NULL ORDER BY id LIMIT 10",[userId]);
 for(const candidate of items)await transaction(async q=>{
  const c=await company(q,userId,candidate.company_id);
  const [item]=await q("SELECT * FROM inventory_items WHERE id=$1 AND user_id=$2 AND status='active' AND reorder_quantity>0 AND quantity<=reorder_level AND preferred_supplier IS NOT NULL FOR UPDATE",[candidate.id,userId]);if(!item)return;
  const [open]=await q("SELECT p.id FROM purchase_orders p JOIN purchase_order_lines l ON l.purchase_order_id=p.id AND l.user_id=p.user_id WHERE p.user_id=$1 AND p.company_id=$2 AND l.inventory_item_id=$3 AND p.status IN ('draft','approved') AND l.received_quantity<l.quantity LIMIT 1",[userId,c.id,item.id]);if(open)return;
  const [recent]=await q("SELECT p.id FROM purchase_orders p JOIN purchase_order_lines l ON l.purchase_order_id=p.id AND l.user_id=p.user_id WHERE p.user_id=$1 AND l.inventory_item_id=$2 AND p.created_at>now()-interval '24 hours' AND p.operation_key LIKE 'po:reorder:%' LIMIT 1",[userId,item.id]);if(recent)return;
  const [price]=await q("SELECT l.unit_cost FROM purchase_order_lines l JOIN purchase_orders p ON p.id=l.purchase_order_id AND p.user_id=l.user_id WHERE l.user_id=$1 AND l.inventory_item_id=$2 AND p.vendor_name=$3 AND l.received_quantity>0 ORDER BY p.created_at DESC LIMIT 1",[userId,item.id,item.preferred_supplier]);
  if(!price)return;
  const amount=roundRatio(quantityUnits(item.reorder_quantity)*moneyCents(price.unit_cost),10000n);if(amount<=0n)return;
  const id=uid(),number='PO-'+new Date().getUTCFullYear()+'-'+id;
  const description='Reorder proposal: stock '+item.quantity+' is at or below '+item.reorder_level+'. Prior received unit cost; supplier quote not confirmed.';
  await q('INSERT INTO purchase_orders(id,user_id,world_id,company_id,po_number,vendor_name,description,total,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,userId,c.world_id,c.id,number,item.preferred_supplier,description,moneyText(amount),'po:reorder:'+id]);
  await q('INSERT INTO purchase_order_lines(id,user_id,purchase_order_id,inventory_item_id,item_name,sku,quantity,unit_cost,line_total) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[uid(),userId,id,item.id,item.name,item.sku,item.reorder_quantity,price.unit_cost,moneyText(amount)]);
  await event(q,c,'purchase-order-drafted',item.name+' · reorder proposal',description+' · USD '+moneyText(amount)+' · Awaiting Chairman approval.');
 });
}
