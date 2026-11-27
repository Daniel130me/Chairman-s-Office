import {sql,transaction,uid} from '../backend/src/db.mjs';
import {EconomyError,operationKey} from './economy-rules.mjs';
import {recordOperationsEntry,recordSystemInvoicePayment} from './economy.mjs';
import {quantityUnits,quantityText,moneyCents,moneyText,roundRatio,saleCost,receiptValue} from './procurement-rules.mjs';
import {countAdjustment,proratedReturn,disputeSettlement,supplierPerformance} from './advanced-operations-rules.mjs';
const clean=(v,n=1500)=>typeof v==='string'?v.trim().slice(0,n):'';
function reason(body){const r=clean(body.reason);if(r.length<5)throw new EconomyError('Record a specific reason.');return r;}
const event=(q,c,kind,title,body)=>q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),c.user_id,c.world_id,kind,title,body]);
async function company(q,userId,id){const [c]=await q('SELECT * FROM companies WHERE id=$1 AND user_id=$2 AND disposed_at IS NULL FOR UPDATE',[id,userId]);if(!c)throw new EconomyError('Company unavailable.',404);return c;}
async function lockItem(q,userId,id){
 const [initial]=await q('SELECT company_id FROM inventory_items WHERE id=$1 AND user_id=$2',[id,userId]);if(!initial)throw new EconomyError('Inventory unavailable.',404);
 const c=await company(q,userId,initial.company_id);
 const [item]=await q("SELECT * FROM inventory_items WHERE id=$1 AND user_id=$2 AND status='active' FOR UPDATE",[id,userId]);if(!item)throw new EconomyError('Inventory unavailable.',404);
 return {c,item};
}
async function stockMovement(q,c,item,id,kind,direction,quantity,value){
 const signed=direction==='in'?1n:-1n,qty=quantityUnits(quantity),cost=moneyCents(value);
 const next=quantityUnits(item.quantity,true)+signed*qty,nextValue=moneyCents(item.stock_value)+signed*cost;
 if(next<0n||nextValue<0n||(next===0n&&nextValue!==0n))throw new EconomyError('Invalid resulting stock balance.',409);
 const average=next?roundRatio(nextValue*10000n,next):0n;
 await q('UPDATE inventory_items SET quantity=$1,stock_value=$2,average_cost=$3 WHERE id=$4 AND user_id=$5',[quantityText(next),moneyText(nextValue),moneyText(average),item.id,c.user_id]);
 await q('INSERT INTO inventory_movements(id,user_id,company_id,inventory_item_id,direction,quantity,unit_cost,source_type,source_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[uid(),c.user_id,c.id,item.id,direction,quantity,moneyText(roundRatio(cost*10000n,qty)),kind,id]);
}
async function post(q,c,key,kind,value,description){if(moneyCents(value)>0n)await recordOperationsEntry(q,c,key,kind,value,description);}
export async function recordStocktake(user,id,body){
 const actual=quantityText(quantityUnits(body.actualQuantity,true)),expected=quantityText(quantityUnits(body.expectedQuantity,true)),r=reason(body),key='stocktake:'+operationKey(body.operationKey);
 const unit=moneyText(moneyCents(body.unitCost??'0'));
 return transaction(async q=>{
  const {c,item}=await lockItem(q,user.id,id);
  const [prior]=await q('SELECT * FROM inventory_stocktakes WHERE user_id=$1 AND operation_key=$2',[user.id,key]);
  if(prior){if(prior.inventory_item_id!==id||prior.actual_quantity!==actual||prior.expected_quantity!==expected||prior.reason!==r)throw new EconomyError('Operation reference already used.',409);return prior;}
  if(item.quantity!==expected)throw new EconomyError('Stock changed since count started. Refresh and recount.',409);
  const change=countAdjustment(item,actual,unit),countId=uid();
  if(change.direction!=='none'){
   await post(q,c,key,change.direction==='in'?'stock-count-gain':'stock-count-loss',change.value,'Stocktake · '+item.name+' · '+r);
   await stockMovement(q,c,item,countId,'stocktake',change.direction,change.quantity,change.value);
  }
  const [row]=await q('INSERT INTO inventory_stocktakes(id,user_id,inventory_item_id,expected_quantity,actual_quantity,expected_value,adjustment_value,direction,reason,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[countId,user.id,id,expected,actual,item.stock_value,change.value,change.direction,r,key]);
  await event(q,c,'inventory-stocktake',item.name+' stocktake','Expected '+expected+' · counted '+actual+' · adjustment USD '+change.value+' · '+r);return row;
 });
}
export async function returnCustomerSale(user,id,body){
 const qty=quantityText(quantityUnits(body.quantity)),r=reason(body),key='customer-return:'+operationKey(body.operationKey),restockable=body.restockable!==false;
 if(body.restockable!==undefined&&typeof body.restockable!=='boolean')throw new EconomyError('Invalid return disposition.');
 return transaction(async q=>{
  const [sale]=await q("SELECT * FROM procurement_transactions WHERE id=$1 AND user_id=$2 AND kind='stock-sale'",[id,user.id]);if(!sale)throw new EconomyError('Recorded sale unavailable.',404);
  const {c,item}=await lockItem(q,user.id,sale.inventory_item_id);
  const [prior]=await q('SELECT * FROM inventory_returns WHERE user_id=$1 AND operation_key=$2',[user.id,key]);
  if(prior){if(prior.sale_id!==id||prior.quantity!==qty||prior.reason!==r||prior.restockable!==restockable)throw new EconomyError('Operation reference already used.',409);return prior;}
  const [sum]=await q('SELECT coalesce(sum(quantity),0)::text quantity FROM inventory_returns WHERE user_id=$1 AND sale_id=$2',[user.id,id]);
  const [cost]=await q("SELECT amount FROM economy_journal WHERE user_id=$1 AND company_id=$2 AND operation_key=$3 AND kind='cogs'",[user.id,c.id,sale.operation_key+':cost']);
  const refund=proratedReturn(sale.amount,sale.payload.quantity,sum.quantity,qty),value=restockable?proratedReturn(cost?.amount||'0',sale.payload.quantity,sum.quantity,qty):'0.00',returnId=uid();
  await post(q,c,key+':refund','customer-refund',refund,'Customer refund · '+item.name);
  await post(q,c,key+':restock','customer-return-cost',value,'Sale cost reversed · '+item.name);
  if(restockable)await stockMovement(q,c,item,returnId,'customer-return','in',qty,value);
  const [row]=await q("INSERT INTO inventory_returns(id,user_id,inventory_item_id,sale_id,kind,quantity,stock_value,settlement_value,reason,operation_key,restockable) VALUES($1,$2,$3,$4,'customer',$5,$6,$7,$8,$9,$10) RETURNING *",[returnId,user.id,item.id,id,qty,value,refund,r,key,restockable]);
  await event(q,c,'inventory-customer-return',item.name+' returned',(restockable?'Restocked ':'Non-restockable return ')+qty+' · cash refund USD '+refund+' · '+r);return row;
 });
}
export async function returnSupplierLine(user,id,body){
 const qty=quantityText(quantityUnits(body.quantity)),r=reason(body),key='supplier-return:'+operationKey(body.operationKey);
 return transaction(async q=>{
  const [line]=await q('SELECT * FROM purchase_order_lines WHERE id=$1 AND user_id=$2',[id,user.id]);if(!line)throw new EconomyError('Order line unavailable.',404);
  const {c,item}=await lockItem(q,user.id,line.inventory_item_id);
  const [po]=await q('SELECT * FROM purchase_orders WHERE id=$1 AND user_id=$2 AND company_id=$3 FOR UPDATE',[line.purchase_order_id,user.id,c.id]);
  if(!po||!['approved','received','paid'].includes(po.status)||moneyCents(po.received_total)<=0n)throw new EconomyError('A recorded goods receipt is required.',409);
  const [prior]=await q('SELECT * FROM inventory_returns WHERE user_id=$1 AND operation_key=$2',[user.id,key]);
  if(prior){if(prior.purchase_order_line_id!==id||prior.quantity!==qty||prior.reason!==r)throw new EconomyError('Operation reference already used.',409);return prior;}
  const [sum]=await q('SELECT coalesce(sum(quantity),0)::text quantity FROM inventory_returns WHERE user_id=$1 AND purchase_order_line_id=$2',[user.id,id]);
  if(quantityUnits(sum.quantity,true)+quantityUnits(qty)>quantityUnits(line.received_quantity,true))throw new EconomyError('Return exceeds received quantity.',409);
  const refund=moneyText(receiptValue({...line,received_quantity:sum.quantity},qty)),cost=moneyText(saleCost(item,qty)),returnId=uid();
  const a=moneyCents(refund),b=moneyCents(cost),outstanding=moneyCents(po.received_total)-moneyCents(po.paid_total)-moneyCents(po.credited_total);
  const credit=a<outstanding?a:outstanding,cash=a-credit;
  if(credit<0n||cash+moneyCents(po.returned_total)>moneyCents(po.paid_total))throw new EconomyError('Return exceeds recorded settlement exposure.',409);
  const creditBasis=credit<b?credit:b,remaining=b-creditBasis,cashBasis=cash<remaining?cash:remaining;
  await post(q,c,key+':credit','supplier-credit',moneyText(creditBasis),'Supplier credit · '+po.po_number);
  await post(q,c,key+':credit-gain','supplier-credit-gain',moneyText(credit-creditBasis),'Supplier credit above carrying value');
  await post(q,c,key+':base','supplier-refund',moneyText(cashBasis),'Supplier cash refund · '+po.po_number);
  await post(q,c,key+':gain','supplier-return-gain',moneyText(cash-cashBasis),'Supplier cash refund above carrying value');
  await post(q,c,key+':loss','supplier-return-loss',moneyText(remaining-cashBasis),'Supplier return below carrying value');
  await stockMovement(q,c,item,returnId,'supplier-return','out',qty,cost);
  await q("UPDATE purchase_orders SET returned_total=returned_total+$1::numeric,credited_total=credited_total+$2::numeric,status=CASE WHEN status='received' AND paid_total+credited_total+$2::numeric=received_total THEN 'paid' ELSE status END,paid_at=CASE WHEN status='received' AND paid_total+credited_total+$2::numeric=received_total THEN now() ELSE paid_at END WHERE id=$3 AND user_id=$4",[moneyText(cash),moneyText(credit),po.id,user.id]);
  const [row]=await q("INSERT INTO inventory_returns(id,user_id,inventory_item_id,purchase_order_line_id,kind,quantity,stock_value,settlement_value,reason,operation_key,credit_value) VALUES($1,$2,$3,$4,'supplier',$5,$6,$7,$8,$9,$10) RETURNING *",[returnId,user.id,item.id,id,qty,cost,refund,r,key,moneyText(credit)]);
  await event(q,c,'inventory-supplier-return',po.po_number+' · goods returned','Quantity '+qty+' · confirmed credit USD '+moneyText(credit)+' · confirmed cash refund USD '+moneyText(cash)+' · '+r);return row;
 });
}
export async function reviewSupplier(user,id,body){
 const quality=body.quality,evidence=clean(body.evidence);
 if(!['accepted','defective','mixed'].includes(quality)||evidence.length<10)throw new EconomyError('Record quality and supporting evidence.');
 return transaction(async q=>{
  const [po]=await q('SELECT * FROM purchase_orders WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]);if(!po||moneyCents(po.received_total)===0n)throw new EconomyError('A recorded receipt is required.',409);
  const [prior]=await q('SELECT * FROM supplier_reviews WHERE user_id=$1 AND purchase_order_id=$2',[user.id,id]);
  if(prior){if(prior.quality!==quality||prior.evidence!==evidence)throw new EconomyError('A review is already recorded.',409);return prior;}
  await company(q,user.id,po.company_id);
  const [row]=await q('INSERT INTO supplier_reviews(id,user_id,purchase_order_id,quality,evidence) VALUES($1,$2,$3,$4,$5) RETURNING *',[uid(),user.id,id,quality,evidence]);
  await event(q,po,'supplier-quality-review',po.vendor_name+' · '+quality,po.po_number+' · '+evidence);return row;
 });
}
export async function createObligation(user,id,body){
 const title=clean(body.title,160),description=clean(body.description),party=body.responsibleParty,due=new Date(body.dueAt),key='obligation:'+operationKey(body.operationKey);
 if(!title||!description||!['company','counterparty'].includes(party)||!Number.isFinite(due.getTime()))throw new EconomyError('Enter the obligation, party and due date.');
 return transaction(async q=>{
  const [c]=await q('SELECT * FROM business_contracts WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]);if(!c||!['draft','active'].includes(c.status))throw new EconomyError('Open contract unavailable.',409);
  const [prior]=await q('SELECT * FROM contract_obligations WHERE user_id=$1 AND operation_key=$2',[user.id,key]);
  if(prior){if(prior.contract_id!==id||prior.title!==title||prior.description!==description||prior.responsible_party!==party||new Date(prior.due_at).getTime()!==due.getTime())throw new EconomyError('Operation reference already used.',409);return prior;}
  const [row]=await q('INSERT INTO contract_obligations(id,user_id,contract_id,title,description,responsible_party,due_at,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[uid(),user.id,id,title,description,party,due,key]);
  await event(q,c,'contract-obligation',c.title+' · '+title,party+' · due '+due.toISOString());return row;
 });
}
export async function completeObligation(user,id,body){
 const status=body.status,evidence=clean(body.evidence);if(!['fulfilled','waived'].includes(status)||evidence.length<10)throw new EconomyError('Record evidence of fulfillment or an authorized waiver.');
 return transaction(async q=>{
  const [initial]=await q('SELECT contract_id FROM contract_obligations WHERE id=$1 AND user_id=$2',[id,user.id]);if(!initial)throw new EconomyError('Obligation unavailable.',404);
  const [c]=await q('SELECT * FROM business_contracts WHERE id=$1 AND user_id=$2 FOR UPDATE',[initial.contract_id,user.id]);
  const [o]=await q('SELECT * FROM contract_obligations WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]);
  if(!c||!o||!['active','disputed'].includes(c.status))throw new EconomyError('Contract is not open.',409);
  if(o.status===status&&o.evidence===evidence)return o;
  if(!['pending','breached'].includes(o.status))throw new EconomyError('Obligation already closed.',409);
  const [row]=await q('UPDATE contract_obligations SET status=$1,evidence=$2,updated_at=now() WHERE id=$3 AND user_id=$4 RETURNING *',[status,evidence,id,user.id]);
  await event(q,c,'contract-obligation-'+status,c.title+' · '+o.title,evidence);return row;
 });
}
export async function processSupplierDeadlines(userId){
 const due=await sql("SELECT id FROM purchase_orders WHERE user_id=$1 AND status='approved' AND due_at<now() AND overdue_reported_at IS NULL AND EXISTS(SELECT 1 FROM companies co WHERE co.id=purchase_orders.company_id AND co.user_id=purchase_orders.user_id AND co.disposed_at IS NULL) ORDER BY due_at LIMIT 20",[userId]);
 for(const x of due)await transaction(async q=>{
  const [p]=await q("UPDATE purchase_orders SET overdue_reported_at=now() WHERE id=$1 AND user_id=$2 AND status='approved' AND due_at<now() AND overdue_reported_at IS NULL RETURNING *",[x.id,userId]);if(!p)return;
  await event(q,p,'supplier-delivery-overdue',p.po_number+' · delivery overdue',p.vendor_name+' · Outstanding delivery; no additional inventory or payable recorded.');
  const [person]=await q("SELECT id,name FROM contacts WHERE user_id=$1 AND world_id=$2 AND kind IN ('supplier','vendor') AND lower(company)=lower($3) ORDER BY id LIMIT 1",[userId,p.world_id,p.vendor_name]);
  if(person)await q("INSERT INTO messages(id,user_id,world_id,contact_id,direction,channel,body) VALUES($1,$2,$3,$4,'incoming','chat',$5)",[uid(),userId,p.world_id,person.id,'Regarding '+p.po_number+': the scheduled delivery deadline has passed. The remaining goods are still outstanding.']);
 });
}
export async function processContractObligations(userId){
 const due=await sql("SELECT o.id,o.contract_id FROM contract_obligations o JOIN business_contracts c ON c.id=o.contract_id AND c.user_id=o.user_id WHERE o.user_id=$1 AND o.status='pending' AND (c.status='active' OR (c.status='disputed' AND o.cure_dispute_id IS NOT NULL)) AND o.due_at<now() AND EXISTS(SELECT 1 FROM companies co WHERE co.id=c.company_id AND co.user_id=c.user_id AND co.disposed_at IS NULL) ORDER BY o.due_at LIMIT 20",[userId]);
 for(const x of due)await transaction(async q=>{
  const [c]=await q("SELECT * FROM business_contracts WHERE id=$1 AND user_id=$2 AND status IN ('active','disputed') FOR UPDATE",[x.contract_id,userId]);if(!c)return;
  const [o]=await q("UPDATE contract_obligations SET status='breached',updated_at=now() WHERE id=$1 AND user_id=$2 AND status='pending' AND due_at<now() AND ($3='active' OR cure_dispute_id IS NOT NULL) RETURNING *",[x.id,userId,c.status]);if(!o)return;
  await event(q,c,'contract-obligation-breached',c.title+' · deadline missed',o.title+' · '+o.responsible_party+' · no fulfillment evidence recorded. Legal review recommended.');
 });
}
export async function openDispute(user,id,body){
 const r=reason(body),key='dispute:'+operationKey(body.operationKey),requestedInvoice=body.invoiceId||null;
 if(requestedInvoice&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestedInvoice))throw new EconomyError('Invalid invoice reference.');
 return transaction(async q=>{
  const [c]=await q('SELECT * FROM business_contracts WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]);if(!c)throw new EconomyError('Contract unavailable.',404);
  const [prior]=await q('SELECT * FROM commercial_disputes WHERE user_id=$1 AND operation_key=$2',[user.id,key]);if(prior){if(prior.contract_id!==id||prior.reason!==r||(requestedInvoice&&prior.invoice_id!==requestedInvoice))throw new EconomyError('Operation reference already used.',409);return prior;}
  if(!['active','disputed'].includes(c.status))throw new EconomyError('Contract is not open.',409);
  const [existing]=await q("SELECT * FROM commercial_disputes WHERE user_id=$1 AND contract_id=$2 AND status='open'",[user.id,id]);if(existing)return existing;
  const [m]=await q('SELECT invoice_id FROM commercial_milestones WHERE user_id=$1 AND contract_id=$2',[user.id,id]);
  const invoiceId=m?.invoice_id||requestedInvoice;
  if(requestedInvoice&&m?.invoice_id&&requestedInvoice!==m.invoice_id)throw new EconomyError('Use the recorded milestone invoice.');
  if(invoiceId){
   const [invoice]=await q("SELECT id FROM business_invoices WHERE id=$1 AND user_id=$2 AND company_id=$3 AND status='issued' AND lower(customer_name)=lower($4)",[invoiceId,user.id,c.company_id,c.counterparty]);
   if(!invoice)throw new EconomyError('Choose an issued invoice matching this company and counterparty.',409);
   const [other]=await q("SELECT id FROM commercial_disputes WHERE user_id=$1 AND invoice_id=$2 AND status='open'",[user.id,invoiceId]);if(other)throw new EconomyError('Invoice is already disputed.',409);
  }
  const [d]=await q('INSERT INTO commercial_disputes(id,user_id,contract_id,invoice_id,reason,operation_key) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[uid(),user.id,id,invoiceId||null,r,key]);
  await q("UPDATE business_contracts SET status='disputed',updated_at=now() WHERE id=$1 AND user_id=$2",[id,user.id]);
  await event(q,c,'commercial-dispute-opened',c.title,r+' · Settlement suspended pending review.');return d;
 });
}
export async function addDisputeEvidence(user,id,body){
 const source=clean(body.source,160),description=clean(body.description,2500),key='dispute-evidence:'+operationKey(body.operationKey);
 if(!source||description.length<10)throw new EconomyError('Record evidence source and description.');
 return transaction(async q=>{
  const [d]=await q('SELECT * FROM commercial_disputes WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]);if(!d)throw new EconomyError('Dispute unavailable.',404);
  const [prior]=await q('SELECT * FROM commercial_dispute_evidence WHERE user_id=$1 AND operation_key=$2',[user.id,key]);if(prior){if(prior.dispute_id!==id||prior.source!==source||prior.description!==description)throw new EconomyError('Operation reference already used.',409);return prior;}
  if(d.status!=='open')throw new EconomyError('Dispute already resolved.',409);
  const [row]=await q('INSERT INTO commercial_dispute_evidence(id,user_id,dispute_id,source,description,operation_key) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[uid(),user.id,id,source,description,key]);return row;
 });
}
export async function createDisputeCure(user,id,body){
 const key='dispute-cure:'+operationKey(body.operationKey),title=clean(body.title,160),description=clean(body.description,2500),party=body.responsibleParty,due=new Date(body.dueAt);
 if(!title||description.length<20||!['company','counterparty'].includes(party)||!Number.isFinite(+due)||body.confirm!==true)throw new EconomyError('Record agreed corrective work, responsible party, deadline and explicit confirmation.');
 return transaction(async q=>{
  const [initial]=await q('SELECT contract_id FROM commercial_disputes WHERE id=$1 AND user_id=$2',[id,user.id]);if(!initial)throw new EconomyError('Dispute unavailable.',404);
  await q('SELECT id FROM commercial_milestones WHERE contract_id=$1 AND user_id=$2 FOR UPDATE',[initial.contract_id,user.id]);
  const [d]=await q('SELECT * FROM commercial_disputes WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]);if(!d)throw new EconomyError('Dispute unavailable.',404);
  const [c]=await q('SELECT * FROM business_contracts WHERE id=$1 AND user_id=$2 FOR UPDATE',[d.contract_id,user.id]);
  const [prior]=await q('SELECT * FROM contract_obligations WHERE user_id=$1 AND operation_key=$2',[user.id,key]);
  if(prior){if(prior.cure_dispute_id!==id||prior.title!==title||prior.description!==description||prior.responsible_party!==party||+new Date(prior.due_at)!==+due)throw new EconomyError('Operation reference already used.',409);return prior;}
  if(!c||c.status!=='disputed'||d.status!=='open')throw new EconomyError('An open dispute is required.',409);
  if(+due<=Date.now()||+due>Date.now()+365*86400000)throw new EconomyError('Choose a future corrective deadline within one year.');
  if((await q("SELECT id FROM dispute_payment_plans WHERE user_id=$1 AND dispute_id=$2 AND status='active'",[user.id,id])).length)throw new EconomyError('Resolve the active installment plan first.',409);
  if(!(await q('SELECT id FROM commercial_dispute_evidence WHERE dispute_id=$1 AND user_id=$2 LIMIT 1',[id,user.id])).length)throw new EconomyError('Record supporting evidence before agreeing a cure.',409);
  if((await q('SELECT id FROM contract_obligations WHERE cure_dispute_id=$1 AND user_id=$2',[id,user.id])).length)throw new EconomyError('Corrective plan already recorded; review its outcome.',409);
  const [row]=await q('INSERT INTO contract_obligations(id,user_id,contract_id,cure_dispute_id,title,description,responsible_party,due_at,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[uid(),user.id,c.id,id,title,description,party,due,key]);
  await event(q,c,'dispute-cure-agreed',c.title+' · corrective action agreed',title+' · '+party+' · due '+due.toISOString()+' · collection remains suspended until dispute resolution.');
  return row;
 });
}
async function extendSuspendedDeadlines(q,userId,contractId,startedAt){
 const [elapsed]=await q('SELECT greatest(0,extract(epoch FROM now()-$1::timestamptz))::bigint seconds',[startedAt]);
 const seconds=Number(elapsed?.seconds||0);if(!seconds)return 0;
 await q("UPDATE contract_obligations SET due_at=due_at+($3::bigint*interval '1 second'),updated_at=now() WHERE user_id=$1 AND contract_id=$2 AND status='pending'",[userId,contractId,seconds]);
 await q("UPDATE commercial_milestones SET due_at=due_at+($3::bigint*interval '1 second'),payment_attempt_at=NULL,payment_decision=NULL,updated_at=now() WHERE user_id=$1 AND contract_id=$2 AND due_at IS NOT NULL AND status IN ('pending','delivered','invoiced','blocked')",[userId,contractId,seconds]);
 return seconds;
}
export async function suspendDisputedContract(user,id,body){
 const reason=clean(body.reason,1500),evidence=clean(body.evidence,2500),until=new Date(body.untilAt),key='contract-suspension:'+operationKey(body.operationKey);
 if(reason.length<10||evidence.length<20||!Number.isFinite(+until)||body.confirm!==true)throw new EconomyError('Record the agreed standstill, supporting evidence, review deadline and explicit confirmation.');
 if(+until<=Date.now()||+until>Date.now()+90*86400000)throw new EconomyError('Choose a future standstill review deadline within 90 days.');
 return transaction(async q=>{
  const [initial]=await q('SELECT contract_id FROM commercial_disputes WHERE id=$1 AND user_id=$2',[id,user.id]);if(!initial)throw new EconomyError('Dispute unavailable.',404);
  await q('SELECT id FROM commercial_milestones WHERE contract_id=$1 AND user_id=$2 FOR UPDATE',[initial.contract_id,user.id]);
  const [d]=await q('SELECT * FROM commercial_disputes WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]);if(!d)throw new EconomyError('Dispute unavailable.',404);
  const [c]=await q('SELECT * FROM business_contracts WHERE id=$1 AND user_id=$2 FOR UPDATE',[d.contract_id,user.id]);
  const [prior]=await q('SELECT * FROM contract_suspensions WHERE user_id=$1 AND operation_key=$2',[user.id,key]);
  if(prior){if(prior.dispute_id!==id||prior.reason!==reason||prior.evidence!==evidence||+new Date(prior.requested_until)!==+until)throw new EconomyError('Operation reference already used.',409);return prior;}
  if(!c||c.status!=='disputed'||d.status!=='open')throw new EconomyError('An open disputed contract is required.',409);
  if((await q("SELECT id FROM dispute_payment_plans WHERE user_id=$1 AND dispute_id=$2 AND status='active'",[user.id,id])).length)throw new EconomyError('Revise or cancel the active settlement plan before suspending performance.',409);
  if(!(await q('SELECT id FROM commercial_dispute_evidence WHERE dispute_id=$1 AND user_id=$2 LIMIT 1',[id,user.id])).length)throw new EconomyError('Record dispute evidence before agreeing a standstill.',409);
  if((await q("SELECT id FROM contract_suspensions WHERE user_id=$1 AND contract_id=$2 AND status IN ('active','expired')",[user.id,c.id])).length)throw new EconomyError('A contract standstill is already active.',409);
  const [row]=await q('INSERT INTO contract_suspensions(id,user_id,contract_id,dispute_id,reason,evidence,requested_until,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[uid(),user.id,c.id,id,reason,evidence,until,key]);
  await q("UPDATE business_contracts SET status='suspended',updated_at=now() WHERE id=$1 AND user_id=$2",[c.id,user.id]);
  await event(q,c,'contract-suspended',c.title+' · performance suspended',reason+' · Review by '+until.toISOString()+'. No automatic financial payment or termination is triggered.');
  return row;
 });
}
export async function resumeSuspendedContract(user,id,body){
 const reason=clean(body.reason,1500),evidence=clean(body.evidence,2500),key='contract-resume:'+operationKey(body.operationKey);
 if(reason.length<10||evidence.length<20||body.confirm!==true)throw new EconomyError('Record the agreed return to performance, supporting evidence and explicit confirmation.');
 return transaction(async q=>{
  const [initial]=await q('SELECT contract_id,dispute_id FROM contract_suspensions WHERE id=$1 AND user_id=$2',[id,user.id]);if(!initial)throw new EconomyError('Suspension unavailable.',404);
  await q('SELECT id FROM commercial_milestones WHERE contract_id=$1 AND user_id=$2 FOR UPDATE',[initial.contract_id,user.id]);
  const [d]=await q('SELECT * FROM commercial_disputes WHERE id=$1 AND user_id=$2 FOR UPDATE',[initial.dispute_id,user.id]);
  const [c]=await q('SELECT * FROM business_contracts WHERE id=$1 AND user_id=$2 FOR UPDATE',[initial.contract_id,user.id]);
  const [s]=await q('SELECT * FROM contract_suspensions WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]);
  const [prior]=await q('SELECT * FROM contract_suspensions WHERE user_id=$1 AND resume_operation_key=$2',[user.id,key]);
  if(prior){if(prior.id!==id||prior.end_reason!==reason||prior.resume_evidence!==evidence)throw new EconomyError('Operation reference already used.',409);return prior;}
  if(!d||d.status!=='open'||!c||c.status!=='suspended'||!['active','expired'].includes(s.status))throw new EconomyError('An open, suspended disputed contract is required.',409);
  const seconds=await extendSuspendedDeadlines(q,user.id,c.id,s.started_at);
  await q("UPDATE business_contracts SET status='disputed',updated_at=now() WHERE id=$1 AND user_id=$2",[c.id,user.id]);
  const [row]=await q("UPDATE contract_suspensions SET status='resumed',ended_at=now(),end_reason=$1,resume_evidence=$2,resume_operation_key=$3 WHERE id=$4 AND user_id=$5 RETURNING *",[reason,evidence,key,id,user.id]);
  await event(q,c,'contract-suspension-lifted',c.title+' · performance resumed',reason+' · '+seconds+' seconds of standstill added to outstanding deadlines. The underlying dispute remains open.');
  return row;
 });
}
export async function processContractSuspensions(userId){
 const due=await sql("SELECT id FROM contract_suspensions WHERE user_id=$1 AND status='active' AND requested_until<=now() ORDER BY requested_until LIMIT 20",[userId]);
 for(const item of due)await transaction(async q=>{
  const [s]=await q("SELECT s.id,s.contract_id,s.requested_until,c.user_id,c.world_id,c.title,c.counterparty FROM contract_suspensions s JOIN business_contracts c ON c.id=s.contract_id AND c.user_id=s.user_id JOIN companies co ON co.id=c.company_id AND co.user_id=c.user_id WHERE s.id=$1 AND s.user_id=$2 AND s.status='active' AND s.requested_until<=now() AND co.disposed_at IS NULL FOR UPDATE OF s,c",[item.id,userId]);
  if(!s)return;
  const [expired]=await q("UPDATE contract_suspensions SET status='expired',expired_at=now() WHERE id=$1 AND user_id=$2 AND status='active' RETURNING id",[s.id,userId]);if(!expired)return;
  await event(q,s,'contract-suspension-expired',s.title+' · standstill review overdue','The agreed review date passed. Performance remains suspended until the Chairman records a supported decision; no automatic payment or termination occurred.');
 });
}
export async function resolveDispute(user,id,body){
 const resolution=body.resolution,r=reason(body),paid=moneyText(moneyCents(body.paid??'0'));if(!['resume','settle','terminate'].includes(resolution))throw new EconomyError('Choose a resolution.');
 return transaction(async q=>{
  const [initial]=await q('SELECT d.contract_id,c.company_id FROM commercial_disputes d JOIN business_contracts c ON c.id=d.contract_id AND c.user_id=d.user_id WHERE d.id=$1 AND d.user_id=$2',[id,user.id]);if(!initial)throw new EconomyError('Dispute unavailable.',404);
  // Use the same milestone-first lock order as automated collections.
  const [m]=await q('SELECT * FROM commercial_milestones WHERE contract_id=$1 AND user_id=$2 FOR UPDATE',[initial.contract_id,user.id]);
  const [d]=await q('SELECT * FROM commercial_disputes WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]);
  if((await q("SELECT id FROM dispute_payment_plans WHERE user_id=$1 AND dispute_id=$2 AND status='active'",[user.id,id])).length)throw new EconomyError('Complete or cancel the installment plan before resolving this dispute.',409);
  if((await q("SELECT id FROM contract_obligations WHERE user_id=$1 AND cure_dispute_id=$2 AND status IN ('pending','breached')",[user.id,id])).length)throw new EconomyError('Record fulfillment or an authorized waiver of the corrective plan before resolving this dispute.',409);
  if(d.status==='resolved'){if(d.resolution===resolution&&d.resolution_reason===r&&(resolution!=='settle'||d.settled_amount===paid))return d;throw new EconomyError('Dispute already resolved.',409);}
  const [invoice]=d.invoice_id?await q('SELECT * FROM business_invoices WHERE id=$1 AND user_id=$2 FOR UPDATE',[d.invoice_id,user.id]):[];
  const [c]=await q('SELECT * FROM business_contracts WHERE id=$1 AND user_id=$2 FOR UPDATE',[d.contract_id,user.id]);
  if(!c||!['disputed','suspended'].includes(c.status))throw new EconomyError('Contract not in dispute.',409);
  const [suspension]=await q("SELECT * FROM contract_suspensions WHERE user_id=$1 AND contract_id=$2 AND status IN ('active','expired') FOR UPDATE",[user.id,c.id]);
  if(c.status==='suspended'&&!suspension)throw new EconomyError('Suspended contract has no active standstill record.',409);
  if(suspension&&resolution==='resume')await extendSuspendedDeadlines(q,user.id,c.id,suspension.started_at);
  const [e]=await q('SELECT id FROM commercial_dispute_evidence WHERE dispute_id=$1 AND user_id=$2 LIMIT 1',[id,user.id]);if(!e)throw new EconomyError('Record evidence before resolving.',409);
  let payment='0.00',credit='0.00';
  if(resolution==='resume'){if(invoice&&invoice.status!=='issued')throw new EconomyError('Invoice already settled.',409);}
  else if(invoice&&invoice.status==='issued'){
   const companyRow=await company(q,user.id,c.company_id),s=disputeSettlement(invoice.amount,resolution==='terminate'?'0':paid);payment=s.payment;credit=s.credit;
   if(moneyCents(payment)>0n)await recordSystemInvoicePayment(q,companyRow,'dispute:'+id+':payment',payment,'Agreed fictional settlement · '+invoice.invoice_number,'Commercial operations');
   await post(q,companyRow,'dispute:'+id+':credit','invoice-credit',credit,'Agreed credit · '+invoice.invoice_number);
   await q("UPDATE business_invoices SET status=$1,settlement_paid=$2,settlement_credit=$3,paid_at=CASE WHEN $2::numeric>0 THEN now() ELSE NULL END WHERE id=$4 AND user_id=$5",[moneyCents(payment)>0n?'paid':'void',payment,credit,invoice.id,user.id]);
  }else if(resolution==='settle'&&moneyCents(paid)>0n)throw new EconomyError('An issued linked invoice is required for monetary settlement.',409);
  if(suspension)await q('UPDATE contract_suspensions SET status=$1,ended_at=now(),end_reason=$2 WHERE id=$3 AND user_id=$4',[resolution==='resume'?'resumed':resolution==='terminate'?'terminated':'resolved',r,suspension.id,user.id]);
  const target=resolution==='resume'?'active':resolution==='terminate'?'terminated':'completed';
  await q('UPDATE business_contracts SET status=$1,updated_at=now() WHERE id=$2 AND user_id=$3',[target,c.id,user.id]);
  if(m)await q("UPDATE commercial_milestones SET status=$1,due_at=now()+interval '1 day',payment_attempt_at=NULL,payment_decision=NULL,updated_at=now() WHERE id=$2 AND user_id=$3",[resolution==='resume'?(m.invoice_id?'invoiced':m.delivery_journal_id?'delivered':'pending'):(moneyCents(payment)>0n?'paid':'blocked'),m.id,user.id]);
  const [row]=await q("UPDATE commercial_disputes SET status='resolved',resolution=$1,resolution_reason=$2,settled_amount=$3,credited_amount=$4,resolved_at=now() WHERE id=$5 AND user_id=$6 RETURNING *",[resolution,r,payment,credit,id,user.id]);
  await event(q,c,'commercial-dispute-resolved',c.title+' · '+resolution,'Cash USD '+payment+' · credit USD '+credit+' · '+r);return row;
 });
}
export async function syncCommercialDisputes(userId){
 // Preserve customer disputes generated while the Chairman is absent.
 const rows=await sql("SELECT m.id,m.contract_id,m.payment_decision FROM commercial_milestones m JOIN business_contracts c ON c.id=m.contract_id AND c.user_id=m.user_id WHERE m.user_id=$1 AND m.status='blocked' AND m.payment_decision->>'decision'='dispute' AND c.status='disputed' AND EXISTS(SELECT 1 FROM companies co WHERE co.id=c.company_id AND co.user_id=c.user_id AND co.disposed_at IS NULL) AND NOT EXISTS(SELECT 1 FROM commercial_disputes d WHERE d.user_id=m.user_id AND d.contract_id=m.contract_id AND d.status='open') LIMIT 10",[userId]);
 for(const m of rows)await openDispute({id:userId},m.contract_id,{reason:clean(m.payment_decision?.reason)||'Customer disputed the recorded invoice.',operationKey:'auto:'+m.id+':'+String(m.payment_decision?.reason||'').length+':'+uid()});
}
export async function advancedOperationsSnapshot(userId){
 const [counts,returns,reviews,obligations,disputes,evidence,suspensions,sales,lines,orders]=await Promise.all([
 sql('SELECT * FROM inventory_stocktakes WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[userId]),
 sql('SELECT * FROM inventory_returns WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[userId]),
 sql('SELECT * FROM supplier_reviews WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[userId]),
 sql('SELECT o.*,co.disposed_at FROM contract_obligations o JOIN business_contracts c ON c.id=o.contract_id AND c.user_id=o.user_id JOIN companies co ON co.id=c.company_id AND co.user_id=c.user_id WHERE o.user_id=$1 ORDER BY o.due_at LIMIT 200',[userId]),
 sql('SELECT d.*,co.disposed_at FROM commercial_disputes d JOIN business_contracts c ON c.id=d.contract_id AND c.user_id=d.user_id JOIN companies co ON co.id=c.company_id AND co.user_id=c.user_id WHERE d.user_id=$1 ORDER BY d.created_at DESC LIMIT 100',[userId]),
 sql('SELECT * FROM commercial_dispute_evidence WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200',[userId]),
 sql('SELECT s.*,co.disposed_at FROM contract_suspensions s JOIN business_contracts c ON c.id=s.contract_id AND c.user_id=s.user_id JOIN companies co ON co.id=c.company_id AND co.user_id=c.user_id WHERE s.user_id=$1 ORDER BY s.started_at DESC LIMIT 100',[userId]),
 sql("SELECT t.* FROM procurement_transactions t JOIN inventory_items i ON i.id=t.inventory_item_id AND i.user_id=t.user_id JOIN companies c ON c.id=i.company_id AND c.user_id=i.user_id WHERE t.user_id=$1 AND t.kind='stock-sale' AND c.disposed_at IS NULL ORDER BY t.created_at DESC LIMIT 100",[userId]),
 sql("SELECT l.*,p.po_number,p.vendor_name FROM purchase_order_lines l JOIN purchase_orders p ON p.id=l.purchase_order_id AND p.user_id=l.user_id WHERE l.user_id=$1 AND p.status IN ('approved','received','paid') AND l.received_quantity>0 AND NOT EXISTS(SELECT 1 FROM companies c WHERE c.id=p.company_id AND c.disposed_at IS NOT NULL) ORDER BY p.created_at DESC LIMIT 100",[userId]),
 sql("SELECT p.*,(p.due_at<now() AND p.status='approved') AS overdue FROM purchase_orders p WHERE p.user_id=$1 AND p.status IN ('approved','received','paid') AND EXISTS(SELECT 1 FROM companies co WHERE co.id=p.company_id AND co.user_id=p.user_id AND co.disposed_at IS NULL)",[userId])
 ]);
 const suppliers=[...new Set(orders.map(x=>x.vendor_name))].map(name=>({name,...supplierPerformance(orders.filter(x=>x.vendor_name===name)),reviews:reviews.filter(r=>orders.some(o=>o.id===r.purchase_order_id&&o.vendor_name===name))}));
 return {counts,returns,reviews,obligations,disputes,evidence,suspensions,sales,lines,suppliers};
}
