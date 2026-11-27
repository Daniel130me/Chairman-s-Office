import {sql,transaction,uid} from '../backend/src/db.mjs';
import {ask} from '../backend/src/ai.mjs';
import {enqueueCharacterMemory} from './character-intelligence.mjs';
import {receivePurchaseOrder} from './procurement.mjs';
import {quantityUnits,moneyCents,moneyText,roundRatio} from './procurement-rules.mjs';
const clean=(v,n=800)=>typeof v==='string'?v.trim().slice(0,n):'';
export function parseSupplierQuote(raw){
 if(!raw||!['accept','counter','decline','defer'].includes(raw.decision))return null;
 const reason=clean(raw.reason);if(!reason)return null;
 const markup=raw.decision==='counter'?raw.markupBasisPoints:0;
 // Counteroffers are simulated quotes, not market facts; 10% max movement.
 if(!Number.isInteger(markup)||markup< -1000||markup>1000)return null;
 return {decision:raw.decision,reason,markupBasisPoints:markup};
}
async function reserve(userId){
 await sql(`INSERT INTO supplier_negotiations(id,user_id,purchase_order_id,supplier_contact_id)
 SELECT gen_random_uuid(),p.user_id,p.id,c.id FROM purchase_orders p
 JOIN LATERAL (SELECT c.id FROM contacts c WHERE c.user_id=p.user_id AND c.world_id=p.world_id AND c.kind IN ('supplier','vendor') AND lower(c.company)=lower(p.vendor_name) ORDER BY c.id LIMIT 1) c ON true
 WHERE p.user_id=$1 AND p.status='draft' AND p.operation_key LIKE 'po:reorder:%'
 AND NOT EXISTS(SELECT 1 FROM supplier_negotiations s WHERE s.user_id=p.user_id AND s.purchase_order_id=p.id)
 ORDER BY p.created_at LIMIT 5 ON CONFLICT(user_id,purchase_order_id) DO NOTHING`,[userId]);
}
export async function processSuppliers(userId){
 await reserve(userId);
 const [job]=await sql(`WITH due AS (SELECT s.id FROM supplier_negotiations s JOIN purchase_orders p ON p.id=s.purchase_order_id AND p.user_id=s.user_id
 WHERE s.user_id=$1 AND s.status IN ('pending','deferred') AND p.status='draft' AND s.attempts<5
 AND (s.attempted_at IS NULL OR s.attempted_at<now()-interval '30 minutes') ORDER BY s.created_at LIMIT 1 FOR UPDATE OF s SKIP LOCKED)
 UPDATE supplier_negotiations s SET attempted_at=now(),attempts=attempts+1 FROM due WHERE s.id=due.id RETURNING s.*`,[userId]);
 if(job){
  const [po]=await sql('SELECT * FROM purchase_orders WHERE id=$1 AND user_id=$2 AND status=$3',[job.purchase_order_id,userId,'draft']);
  const [person]=await sql('SELECT id,name,title,company,agenda,temperament FROM contacts WHERE id=$1 AND user_id=$2 AND kind IN ($3,$4)',[job.supplier_contact_id,userId,'supplier','vendor']);
  const lines=po?await sql('SELECT id,item_name,sku,quantity,unit_cost,line_total FROM purchase_order_lines WHERE purchase_order_id=$1 AND user_id=$2 ORDER BY id',[po.id,userId]):[];
  if(po&&person&&lines.length){
   const history=await sql(`SELECT p.po_number,p.status,p.due_at,p.received_at,p.overdue_reported_at,r.quality,r.evidence FROM purchase_orders p LEFT JOIN supplier_reviews r ON r.purchase_order_id=p.id AND r.user_id=p.user_id WHERE p.user_id=$1 AND p.company_id=$2 AND lower(p.vendor_name)=lower($3) AND p.id<>$4 ORDER BY p.created_at DESC LIMIT 10`,[userId,po.company_id,po.vendor_name,po.id]);
   const proposal=await ask('Act as the named fictional independent supplier. Evaluate the nonbinding reorder based on these recorded quantities and previously received prices and recorded delivery/quality history. Use this history to inform your response; do not invent missing outcomes. You may accept, decline, defer or counter using a single markup in integer basis points between -1000 and 1000. This creates a simulated offer, not a claim of available stock or actual market price. Return JSON {decision:"accept"|"counter"|"decline"|"defer",markupBasisPoints:0,reason:"..."}. No shipment or payment before Chairman approval.',JSON.stringify({supplier:person,order:{number:po.po_number,description:po.description,total:po.total,lines},history}),{json:true,fallback:null,validate:parseSupplierQuote});
   if(!proposal){
    if(job.attempts>=5)await sql("UPDATE supplier_negotiations SET status='failed',updated_at=now() WHERE id=$1 AND user_id=$2 AND attempts=$3",[job.id,userId,job.attempts]);
    const error=Error('Supplier response unavailable');error.code='AI_SUPPLIER_UNAVAILABLE';throw error;
   }
   await transaction(async q=>{
    await q('SELECT id FROM companies WHERE id=$1 AND user_id=$2 FOR UPDATE',[po.company_id,userId]);
    const [order]=await q("SELECT * FROM purchase_orders WHERE id=$1 AND user_id=$2 AND status='draft' FOR UPDATE",[po.id,userId]);
    const [neg]=await q("SELECT * FROM supplier_negotiations WHERE id=$1 AND user_id=$2 AND attempts=$3 AND status IN ('pending','deferred') FOR UPDATE",[job.id,userId,job.attempts]);
    if(!order||!neg)return;
    const status=['accept','counter'].includes(proposal.decision)?'accepted':proposal.decision==='decline'?'declined':job.attempts>=5?'failed':'deferred';
    const quoted=[];
    if(status==='accepted'){
     let total=0n;
     for(const line of lines){
      const cost=roundRatio(moneyCents(line.unit_cost)*BigInt(10000+proposal.markupBasisPoints),10000n);
      const amount=roundRatio(quantityUnits(line.quantity)*cost,10000n);
      if(cost<=0n||amount<=0n)throw Error('Supplier quote would round to zero');
      total+=amount;
      await q('UPDATE purchase_order_lines SET unit_cost=$1,line_total=$2 WHERE id=$3 AND user_id=$4',[moneyText(cost),moneyText(amount),line.id,userId]);
      quoted.push({id:line.id,previousUnitCost:line.unit_cost,quotedUnitCost:moneyText(cost),lineTotal:moneyText(amount)});
     }
     await q('UPDATE purchase_orders SET total=$1 WHERE id=$2 AND user_id=$3',[moneyText(total),order.id,userId]);
    }
    await q('UPDATE supplier_negotiations SET status=$1,decision=$2,updated_at=now() WHERE id=$3 AND user_id=$4',[status,JSON.stringify({...proposal,quoted}),job.id,userId]);
    const messageId=uid();
    const messageBody=order.po_number+' · '+proposal.decision+': '+proposal.reason+(status==='accepted'?' · Revised or confirmed quote awaits your approval.':' · No delivery has occurred.');
    await q("INSERT INTO messages(id,user_id,world_id,contact_id,direction,channel,body) VALUES($1,$2,$3,$4,'incoming','chat',$5)",[messageId,userId,order.world_id,person.id,messageBody]);
    await enqueueCharacterMemory(q,{userId,worldId:order.world_id,contactId:person.id,sourceType:'supplier-negotiation',sourceId:messageId,context:{orderNumber:order.po_number,decision:proposal.decision,reason:proposal.reason,quote:quoted,status,deliveryNotYetOccurred:true}});
    await q('INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),userId,order.world_id,person.id,'supplier-quote',order.po_number+' · '+proposal.decision,person.name+': '+proposal.reason]);
   });
  }
 }
 // Delivery is an explicitly modeled fulfillment of the recorded accepted
 // quote, at least one day after actual approval. No cash is paid here.
 await sql(`UPDATE supplier_negotiations s SET delivery_due_at=p.approved_at+interval '1 day',updated_at=now()
 FROM purchase_orders p WHERE p.id=s.purchase_order_id AND p.user_id=s.user_id AND s.user_id=$1 AND s.status='accepted' AND p.status='approved' AND s.delivery_due_at IS NULL`,[userId]);
 const due=await sql(`SELECT s.id,s.purchase_order_id,p.status FROM supplier_negotiations s JOIN purchase_orders p ON p.id=s.purchase_order_id AND p.user_id=s.user_id
 WHERE s.user_id=$1 AND s.status='accepted' AND p.status IN ('approved','received','paid') AND (s.delivery_due_at<=now() OR p.status IN ('received','paid')) ORDER BY s.created_at LIMIT 5`,[userId]);
 for(const d of due){
  if(d.status==='approved')await receivePurchaseOrder({id:userId},d.purchase_order_id,{full:true,reason:'Modeled supplier delivery of approved quote after one operating day.'});
  await sql("UPDATE supplier_negotiations SET status='delivered',updated_at=now() WHERE id=$1 AND user_id=$2 AND status='accepted'",[d.id,userId]);
 }
}
export async function supplierSnapshot(userId){
 return sql('SELECT s.*,p.po_number,c.name supplier_name FROM supplier_negotiations s JOIN purchase_orders p ON p.id=s.purchase_order_id AND p.user_id=s.user_id JOIN contacts c ON c.id=s.supplier_contact_id AND c.user_id=s.user_id WHERE s.user_id=$1 ORDER BY s.created_at DESC LIMIT 150',[userId]);
}
