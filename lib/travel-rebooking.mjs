import {sql,transaction,uid} from '../backend/src/db.mjs';
import {EconomyError,amountString,operationKey} from './economy-rules.mjs';
import {cents,money} from './corporate-finance-rules.mjs';
import {recordSystemExpense} from './economy.mjs';
import {postPersonalExpense} from './personal-wealth.mjs';
import {ask} from '../backend/src/ai.mjs';
const clean=(v,n=500)=>typeof v==='string'?v.trim().slice(0,n):'';
const event=(q,t,kind,title,body)=>q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),t.user_id,t.world_id,kind,title,body]);
export function validateRebooking(body){
 const provider=clean(body.provider,140),description=clean(body.description),amount=amountString(body.amount),fee=money(cents(body.fee||'0')),reason=clean(body.reason);
 if(!provider||!description||reason.length<10||cents(fee)<0n)throw new EconomyError('Record a replacement provider, itinerary, cost, fee and reason.');
 return {provider,description,amount,fee,reason};
}
export async function proposeRebooking(user,id,body){
 const v=validateRebooking(body),key='rebooking:'+operationKey(body.operationKey);
 return transaction(async q=>{
  const [d]=await q('SELECT * FROM travel_disruptions WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]);if(!d||!d.booking_id)throw new EconomyError('A booking-specific disruption is required.',404);
  const [prior]=await q('SELECT * FROM travel_rebookings WHERE user_id=$1 AND operation_key=$2',[user.id,key]);if(prior){if(prior.disruption_id!==id||Object.entries(v).some(([k,val])=>prior[k]!==val))throw new EconomyError('Operation reference already used.',409);return prior;}
  if(d.status!=='open')throw new EconomyError('Disruption already resolved.',409);
  const [b]=await q("SELECT * FROM travel_bookings WHERE id=$1 AND user_id=$2 AND trip_id=$3 AND status IN ('booked','cancelled')",[d.booking_id,user.id,d.trip_id]);if(!b||!b.booked_at)throw new EconomyError('An originally confirmed booking is required.',409);
  const [p]=await q('INSERT INTO travel_rebookings(id,user_id,disruption_id,old_booking_id,provider,description,amount,fee,reason,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[uid(),user.id,id,b.id,v.provider,v.description,v.amount,v.fee,v.reason,key]);
  await event(q,d,'travel-rebooking-proposed','Replacement booking proposed',v.provider+' · USD '+v.amount+' · fee USD '+v.fee+' · awaits approval.');return p;
 });
}
export async function decideRebooking(user,id,body){
 const decision=body.decision,reason=clean(body.reason);if(!['approved','declined'].includes(decision)||reason.length<5)throw new EconomyError('Record your decision and reason.');
 return transaction(async q=>{
  const [initial]=await q('SELECT d.trip_id,r.disruption_id FROM travel_rebookings r JOIN travel_disruptions d ON d.id=r.disruption_id AND d.user_id=r.user_id WHERE r.id=$1 AND r.user_id=$2',[id,user.id]);if(!initial)throw new EconomyError('Replacement proposal unavailable.',404);
  const [t]=await q('SELECT * FROM travel_trips WHERE id=$1 AND user_id=$2 FOR UPDATE',[initial.trip_id,user.id]);
  const [d]=await q('SELECT * FROM travel_disruptions WHERE id=$1 AND user_id=$2 FOR UPDATE',[initial.disruption_id,user.id]);
  const [p]=await q('SELECT * FROM travel_rebookings WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]);if(p.status===decision)return p;
  if(p.status!=='proposed'||d.status!=='open'||!['planning','booked'].includes(t.status))throw new EconomyError('Replacement proposal is no longer actionable.',409);
  let newId=null;
  if(decision==='approved'){
   const [old]=await q('SELECT * FROM travel_bookings WHERE id=$1 AND user_id=$2 AND trip_id=$3 FOR UPDATE',[p.old_booking_id,user.id,t.id]);if(!old||!old.booked_at||!['booked','cancelled'].includes(old.status))throw new EconomyError('Original booking no longer eligible.',409);
   if((await q("SELECT id FROM travel_rebookings WHERE user_id=$1 AND old_booking_id=$2 AND status='approved'",[user.id,old.id])).length)throw new EconomyError('Original booking already replaced.',409);
   const debit=async (amount,key,description)=>{
    if(cents(amount)===0n)return;
    if(old.payment_source==='personal')return postPersonalExpense(q,user.id,old.personal_account_id,amount,description,key);
    const [c]=await q('SELECT * FROM companies WHERE id=$1 AND user_id=$2 FOR UPDATE',[old.company_id,user.id]);if(!c)throw new EconomyError('Funding company unavailable.',404);
    return recordSystemExpense(q,c,key,amount,description,'Travel office');
   };
   newId=uid();
   await debit(p.amount,'rebook:'+p.id+':cost','Replacement travel booking · '+p.description);
   await debit(p.fee,'rebook:'+p.id+':fee','Confirmed fictional rebooking fee · '+p.provider);
   await q("UPDATE travel_bookings SET status='cancelled' WHERE id=$1 AND user_id=$2",[old.id,user.id]);
   await q("INSERT INTO travel_bookings(id,user_id,trip_id,booking_type,provider,description,amount,payment_source,personal_account_id,company_id,operation_key,status,booked_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'booked',now())",[newId,user.id,t.id,old.booking_type,p.provider,p.description,p.amount,old.payment_source,old.personal_account_id,old.company_id,'replacement:'+p.id]);
   await q("UPDATE travel_trips SET status='booked' WHERE id=$1 AND user_id=$2",[t.id,user.id]);
   await q("UPDATE travel_disruptions SET status='resolved',reason=$1,resolved_at=now() WHERE id=$2 AND user_id=$3",[reason,d.id,user.id]);
  }
  const [r]=await q('UPDATE travel_rebookings SET status=$1,new_booking_id=$2,decided_at=now() WHERE id=$3 AND user_id=$4 RETURNING *',[decision,newId,id,user.id]);
  await event(q,t,'travel-rebooking-'+decision,'Replacement booking '+decision,reason+(newId?' · Original cancelled; any refund is separately recorded.':' · No funds moved.'));return r;
 });
}
export async function processProviderDisruptions(userId){
 // A simulated provider development, not an external travel feed. At most one review per booking.
 const [b]=await sql(`SELECT b.*,t.world_id,t.title,t.depart_at FROM travel_bookings b JOIN travel_trips t ON t.id=b.trip_id AND t.user_id=b.user_id
 WHERE b.user_id=$1 AND b.status='booked' AND t.status='booked' AND t.depart_at BETWEEN now() AND now()+interval '2 days' AND b.booking_type IN ('flight','ground','private-aviation')
 AND NOT EXISTS(SELECT 1 FROM travel_disruptions d WHERE d.user_id=b.user_id AND d.booking_id=b.id)
 AND NOT EXISTS(SELECT 1 FROM travel_provider_reviews r WHERE r.booking_id=b.id AND r.user_id=b.user_id)
 ORDER BY t.depart_at LIMIT 1`,[userId]);if(!b)return;
 const raw=await ask('Act as the fictional recorded travel provider. Model a plausible update, normally no change, occasionally a fictional delay, cancellation or provider change. Do not claim real travel availability or create a paid booking. Return JSON {kind:"none|delay|cancellation|provider-change",description:"...",action:"..."}',JSON.stringify({provider:b.provider,booking:b.description,trip:b.title,departure:b.depart_at}),{json:true,fallback:null});
 if(!raw||!['none','delay','cancellation','provider-change'].includes(raw.kind))return;
 const description=clean(raw.description),action=clean(raw.action);if(raw.kind!=='none'&&(!description||!action))return;
 await transaction(async q=>{
  const [t]=await q("SELECT * FROM travel_trips WHERE id=$1 AND user_id=$2 AND status='booked' FOR UPDATE",[b.trip_id,userId]);if(!t)return;
  const [live]=await q("SELECT id FROM travel_bookings WHERE id=$1 AND user_id=$2 AND status='booked' FOR UPDATE",[b.id,userId]);if(!live)return;
  const [review]=await q('INSERT INTO travel_provider_reviews(user_id,booking_id,outcome) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING booking_id',[userId,b.id,raw.kind]);if(!review||raw.kind==='none')return;
  await q("INSERT INTO travel_disruptions(id,user_id,world_id,trip_id,booking_id,kind,origin,description,proposed_action,operation_key) VALUES($1,$2,$3,$4,$5,$6,'simulated',$7,$8,$9)",[uid(),userId,t.world_id,t.id,b.id,raw.kind,description,action,'provider-review:'+b.id]);
  await event(q,t,'travel-disruption',t.title+' · fictional provider update',b.provider+' · '+description+' · '+action+' · No automatic spending.');
 });
}
