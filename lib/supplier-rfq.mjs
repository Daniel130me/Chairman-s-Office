import {sql,transaction,uid} from '../backend/src/db.mjs';
import {ask} from '../backend/src/ai.mjs';
import {EconomyError,operationKey} from './economy-rules.mjs';
import {moneyCents,moneyText,quantityUnits,roundRatio} from './procurement-rules.mjs';
import {parseSupplierQuote} from './supplier-world.mjs';
const clean=v=>typeof v==='string'?v.trim().slice(0,1000):'';
const fail=(msg,status=409)=>{throw new EconomyError(msg,status);};
const event=(q,p,kind,title,body)=>q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),p.user_id,p.world_id,kind,title,body]);
export function priceQuote(lines,markup){
 if(!Number.isInteger(markup)||markup< -1000||markup>1000)fail('Invalid quote markup.',400);
 let total=0n;
 const quoted=lines.map(l=>{const cost=roundRatio(moneyCents(l.unit_cost)*BigInt(10000+markup),10000n),value=roundRatio(quantityUnits(l.quantity)*cost,10000n);if(cost<=0n||value<=0n)fail('Quote rounds to zero.',400);total+=value;return {id:l.id,unitCost:moneyText(cost),lineTotal:moneyText(value)};});
 return {quoted,total:moneyText(total)};
}
async function orderLock(q,userId,id){
 const [p]=await q('SELECT company_id FROM purchase_orders WHERE id=$1 AND user_id=$2',[id,userId]);if(!p)fail('Order unavailable.',404);
 const [active]=await q('SELECT id FROM companies WHERE id=$1 AND user_id=$2 AND disposed_at IS NULL FOR UPDATE',[p.company_id,userId]);if(!active)fail('Company is archived.',409);
 const [order]=await q('SELECT * FROM purchase_orders WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,userId]);if(!order)fail('Order unavailable.',404);return order;
}
async function lockRfq(q,userId,id){
 const [r]=await q('SELECT purchase_order_id FROM supplier_rfqs WHERE id=$1 AND user_id=$2',[id,userId]);if(!r)fail('RFQ unavailable.',404);
 const order=await orderLock(q,userId,r.purchase_order_id);
 const [rfq]=await q('SELECT * FROM supplier_rfqs WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,userId]);if(!rfq)fail('RFQ unavailable.',404);return {order,rfq};
}
export async function createRfq(user,id,body){
 const key='rfq:'+operationKey(body.operationKey),reason=clean(body.reason),ids=Array.isArray(body.supplierIds)?[...new Set(body.supplierIds)].sort():[];
 if(ids.length<2||ids.length>5||!reason)fail('Select two to five fictional supplier contacts and record your purpose.',400);
 return transaction(async q=>{
  const p=await orderLock(q,user.id,id);
  const [prior]=await q('SELECT * FROM supplier_rfqs WHERE user_id=$1 AND operation_key=$2',[user.id,key]);
  if(prior){if(prior.purchase_order_id!==id||prior.reason!==reason||JSON.stringify(prior.baseline.supplierIds)!==JSON.stringify(ids))fail('Operation reference already used.');return prior;}
  if(p.status!=='draft'||p.operation_key.startsWith('po:reorder:'))fail('Use a manually drafted order for competitive sourcing; automatic reorders retain their own supplier workflow.');
  if((await q('SELECT id FROM supplier_rfqs WHERE user_id=$1 AND purchase_order_id=$2',[user.id,id])).length)fail('Order already has a competitive request.');
  if((await q('SELECT id FROM supplier_negotiations WHERE user_id=$1 AND purchase_order_id=$2',[user.id,id])).length)fail('Existing single-supplier negotiation cannot be replaced.');
  const contacts=await q("SELECT id,company FROM contacts WHERE user_id=$1 AND world_id=$2 AND id=ANY($3::uuid[]) AND kind IN ('supplier','vendor')",[user.id,p.world_id,ids]);
  if(contacts.length!==ids.length||contacts.some(c=>!c.company?.trim())||new Set(contacts.map(c=>c.company.trim().toLowerCase())).size!==ids.length)fail('Choose distinct suppliers from your empire.',400);
  const lines=await q('SELECT id,item_name,sku,quantity,unit_cost,line_total FROM purchase_order_lines WHERE user_id=$1 AND purchase_order_id=$2 ORDER BY id',[user.id,id]);
  if(!lines.length)fail('No order lines.');
  const [rfq]=await q('INSERT INTO supplier_rfqs(id,user_id,purchase_order_id,baseline,operation_key,reason) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[uid(),user.id,id,JSON.stringify({supplierIds:ids,lines}),key,reason]);
  for(const contactId of ids)await q('INSERT INTO supplier_rfq_rounds(id,user_id,rfq_id,supplier_contact_id,round_number) VALUES($1,$2,$3,$4,1)',[uid(),user.id,rfq.id,contactId]);
  await event(q,p,'supplier-rfq-opened',p.po_number+' · competitive quotes',ids.length+' suppliers invited · no obligation or funds moved.');return rfq;
 });
}
export async function counterRfq(user,id,body){
 const markup=body.markupBasisPoints;if(!Number.isInteger(markup)||markup< -1000||markup>1000)fail('Counteroffer must be within ±10% of baseline.',400);
 return transaction(async q=>{
  const [initial]=await q('SELECT rfq_id FROM supplier_rfq_rounds WHERE user_id=$1 AND id=$2',[user.id,id]);if(!initial)fail('Quote unavailable.',404);
  const {order,rfq}=await lockRfq(q,user.id,initial.rfq_id);
  if(order.status!=='draft'||rfq.status!=='open')fail('RFQ is closed.');
  const [round]=await q('SELECT * FROM supplier_rfq_rounds WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]);
  if(round.status!=='quoted'||round.round_number>=4)fail('No further counteroffer available.');
  const [existing]=await q('SELECT * FROM supplier_rfq_rounds WHERE rfq_id=$1 AND supplier_contact_id=$2 AND round_number=$3',[rfq.id,round.supplier_contact_id,round.round_number+1]);
  if(existing){if(existing.requested_markup!==markup)fail('Counteroffer already submitted.');return existing;}
  const [next]=await q('INSERT INTO supplier_rfq_rounds(id,user_id,rfq_id,supplier_contact_id,round_number,requested_markup) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[uid(),user.id,rfq.id,round.supplier_contact_id,round.round_number+1,markup]);
  await event(q,order,'supplier-rfq-counter',order.po_number+' · counteroffer','Requested '+markup+' basis points from baseline · awaiting response.');return next;
 });
}
export async function decideRfq(user,id,body){
 const decision=body.decision,reason=clean(body.reason);if(!['awarded','cancelled'].includes(decision)||!reason)fail('Record a decision and reason.',400);
 return transaction(async q=>{
  const {order,rfq}=await lockRfq(q,user.id,id);
  if(rfq.status===decision){if(decision==='awarded'&&rfq.awarded_round_id!==body.roundId)fail('Different quote already awarded.');return rfq;}
  if(order.status!=='draft'||rfq.status!=='open')fail('RFQ is closed.');
  if(decision==='awarded'){
   const [r]=await q("SELECT r.*,c.company,c.name FROM supplier_rfq_rounds r JOIN contacts c ON c.id=r.supplier_contact_id AND c.user_id=r.user_id WHERE r.id=$1 AND r.rfq_id=$2 AND r.user_id=$3 AND r.status='quoted'",[body.roundId,id,user.id]);
   if(!r)fail('Select a recorded supplier quote.',400);
   if((await q('SELECT id FROM supplier_rfq_rounds WHERE rfq_id=$1 AND supplier_contact_id=$2 AND round_number>$3',[id,r.supplier_contact_id,r.round_number])).length)fail('Select the latest quote from this supplier.');
   const priced=priceQuote(rfq.baseline.lines,r.response.markupBasisPoints);
   for(const l of priced.quoted)await q('UPDATE purchase_order_lines SET unit_cost=$1,line_total=$2 WHERE id=$3 AND user_id=$4 AND purchase_order_id=$5',[l.unitCost,l.lineTotal,l.id,user.id,order.id]);
   await q('UPDATE purchase_orders SET vendor_name=$1,total=$2 WHERE id=$3 AND user_id=$4',[r.company,priced.total,order.id,user.id]);
   await q("INSERT INTO supplier_negotiations(id,user_id,purchase_order_id,supplier_contact_id,status,decision) VALUES($1,$2,$3,$4,'accepted',$5)",[uid(),user.id,order.id,r.supplier_contact_id,JSON.stringify({...r.response,quoted:priced.quoted,rfqId:id})]);
   await event(q,order,'supplier-rfq-awarded',order.po_number+' · quote selected',r.company+' · USD '+priced.total+' · '+reason+' · order still requires approval.');
  }else await event(q,order,'supplier-rfq-cancelled',order.po_number+' · RFQ cancelled',reason);
  return (await q('UPDATE supplier_rfqs SET status=$1,awarded_round_id=$2 WHERE id=$3 AND user_id=$4 RETURNING *',[decision,decision==='awarded'?body.roundId:null,id,user.id]))[0];
 });
}
export async function processRfqs(userId){
 const [job]=await sql(`WITH due AS (SELECT r.id FROM supplier_rfq_rounds r JOIN supplier_rfqs f ON f.id=r.rfq_id AND f.user_id=r.user_id JOIN purchase_orders p ON p.id=f.purchase_order_id AND p.user_id=f.user_id
 WHERE r.user_id=$1 AND r.status='pending' AND f.status='open' AND p.status='draft' AND r.attempts<4 AND EXISTS(SELECT 1 FROM companies co WHERE co.id=p.company_id AND co.user_id=p.user_id AND co.disposed_at IS NULL) AND (r.attempted_at IS NULL OR r.attempted_at<now()-interval '10 minutes') ORDER BY r.created_at LIMIT 1 FOR UPDATE OF r SKIP LOCKED)
 UPDATE supplier_rfq_rounds r SET attempts=attempts+1,attempted_at=now() FROM due WHERE r.id=due.id RETURNING r.*`,[userId]);if(!job)return;
 const [rfq]=await sql('SELECT * FROM supplier_rfqs WHERE id=$1 AND user_id=$2',[job.rfq_id,userId]);
 const [person]=await sql('SELECT id,name,company,title,agenda,temperament FROM contacts WHERE id=$1 AND user_id=$2',[job.supplier_contact_id,userId]);
 if(!rfq||!person)return;
 const history=await sql('SELECT round_number,requested_markup,status,response FROM supplier_rfq_rounds WHERE rfq_id=$1 AND user_id=$2 AND supplier_contact_id=$3 AND round_number<$4 ORDER BY round_number',[rfq.id,userId,person.id,job.round_number]);
 const orders=await sql('SELECT po_number,status,total,due_at,received_at FROM purchase_orders WHERE user_id=$1 AND lower(vendor_name)=lower($2) ORDER BY created_at DESC LIMIT 10',[userId,person.company]);
 const response=await ask('You are an independent fictional supplier. Review the recorded purchase request and your own quote history only. Respond to a requested counteroffer if supplied. Accept means baseline markup zero; counter means a firm fictional quote with integer markupBasisPoints between -1000 and 1000. Decline or defer when appropriate. Do not claim real stock or move money. Return JSON {decision:"accept|counter|decline|defer",markupBasisPoints:0,reason:"..."}',JSON.stringify({supplier:person,lines:rfq.baseline.lines,requestedMarkup:job.requested_markup,history,orders}),{json:true,fallback:null,validate:parseSupplierQuote});
 if(!response||response.decision==='defer'){if(job.attempts>=4)await sql("UPDATE supplier_rfq_rounds SET status='failed' WHERE id=$1 AND user_id=$2 AND attempts=$3 AND status='pending'",[job.id,userId,job.attempts]);return;}
 await transaction(async q=>{
  const {order,rfq:live}=await lockRfq(q,userId,rfq.id);if(live.status!=='open'||order.status!=='draft')return;
  const [r]=await q("SELECT id FROM supplier_rfq_rounds WHERE id=$1 AND user_id=$2 AND attempts=$3 AND status='pending' FOR UPDATE",[job.id,userId,job.attempts]);if(!r)return;
  const status=response.decision==='decline'?'declined':'quoted';let priced=null;if(status==='quoted'){try{priced=priceQuote(live.baseline.lines,response.markupBasisPoints);}catch{await q("UPDATE supplier_rfq_rounds SET status='failed' WHERE id=$1 AND user_id=$2",[job.id,userId]);return;}}
  await q('UPDATE supplier_rfq_rounds SET status=$1,response=$2 WHERE id=$3 AND user_id=$4',[status,JSON.stringify({...response,...priced}),job.id,userId]);
  const message=order.po_number+' · quote round '+job.round_number+' · '+response.reason+(priced?' · USD '+priced.total:'');
  await q("INSERT INTO messages(id,user_id,world_id,contact_id,direction,channel,body) VALUES($1,$2,$3,$4,'incoming','chat',$5)",[uid(),userId,order.world_id,person.id,message]);
  await event(q,order,'supplier-rfq-response',person.company+' · '+status,message);
 });
}
export async function rfqSnapshot(userId){const [requests,rounds]=await Promise.all([sql('SELECT * FROM supplier_rfqs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[userId]),sql('SELECT r.*,c.name,c.company FROM supplier_rfq_rounds r JOIN contacts c ON c.id=r.supplier_contact_id AND c.user_id=r.user_id WHERE r.user_id=$1 ORDER BY r.created_at DESC LIMIT 400',[userId])]);return {requests,rounds};}
