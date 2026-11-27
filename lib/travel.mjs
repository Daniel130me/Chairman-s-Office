import {sql,transaction,uid} from '../backend/src/db.mjs';
import {EconomyError,amountString,operationKey} from './economy-rules.mjs';
import {recordSystemExpenseRefund,recordSystemExpense} from './economy.mjs';
import {postPersonalRefund,postPersonalExpense} from './personal-wealth.mjs';
import {worldCompany} from './operations.mjs';
const clean=(v,n=300)=>String(v??'').trim().slice(0,n);
export async function createTravelTrip(user,body){
 const key='trip:'+operationKey(body.operationKey),type=body.tripType,title=clean(body.title,140),origin=clean(body.origin,140),destination=clean(body.destination,140),purpose=clean(body.purpose,500),depart=new Date(body.departAt),ret=body.returnAt?new Date(body.returnAt):null;
 if(!['personal','business'].includes(type)||!title||!origin||!destination||!purpose||!Number.isFinite(depart.getTime())||(ret&&(!Number.isFinite(ret.getTime())||ret<depart)))throw new EconomyError('Enter valid trip details and dates.');
 return transaction(async q=>{
  const w=(await q('SELECT id FROM worlds WHERE user_id=$1',[user.id]))[0];if(!w)throw new EconomyError('Empire unavailable.',404);
  const prior=(await q('SELECT * FROM travel_trips WHERE user_id=$1 AND operation_key=$2',[user.id,key]))[0];if(prior)return prior;
  const row=(await q('INSERT INTO travel_trips(id,user_id,world_id,trip_type,title,origin,destination,purpose,depart_at,return_at,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',[uid(),user.id,w.id,type,title,origin,destination,purpose,depart,ret,key]))[0];
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,w.id,'travel-planned',title,origin+' to '+destination+' · '+type+' trip · '+purpose]);
  return row;
 });
}
export async function createTravelBooking(user,tripId,body){
 const key='travel-booking:'+operationKey(body.operationKey),type=body.bookingType,provider=clean(body.provider,140),description=clean(body.description,500),amount=amountString(body.amount);
 if(!['flight','hotel','ground','experience','private-aviation','security'].includes(type)||!provider||!description)throw new EconomyError('Enter a booking type, provider and description.');
 return transaction(async q=>{
  const trip=(await q('SELECT * FROM travel_trips WHERE id=$1 AND user_id=$2 FOR UPDATE',[tripId,user.id]))[0];if(!trip||trip.status==='cancelled'||trip.status==='completed')throw new EconomyError('Trip is not available for new bookings.',404);
  const source=trip.trip_type==='personal'?'personal':'company';
  if(body.paymentSource!==source)throw new EconomyError('Personal trips use personal funds; business trips use the selected company.');
  if(source==='personal')await q("SELECT id FROM personal_accounts WHERE id=$1 AND user_id=$2 AND status='active'",[body.personalAccountId,user.id]).then(rows=>{if(!rows.length)throw new EconomyError('Personal account unavailable.',404);});
  else await worldCompany(q,user.id,body.companyId);
  const prior=(await q('SELECT * FROM travel_bookings WHERE user_id=$1 AND operation_key=$2',[user.id,key]))[0];if(prior)return prior;
  return (await q('INSERT INTO travel_bookings(id,user_id,trip_id,booking_type,provider,description,amount,payment_source,personal_account_id,company_id,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',[uid(),user.id,tripId,type,provider,description,amount,source,source==='personal'?body.personalAccountId:null,source==='company'?body.companyId:null,key]))[0];
 });
}
export async function confirmTravelBooking(user,bookingId,body){
 const reason=clean(body.reason,500);if(!reason)throw new EconomyError('Record a reason for confirming this booking.');
 return transaction(async q=>{
  const [initial]=await q('SELECT trip_id FROM travel_bookings WHERE id=$1 AND user_id=$2',[bookingId,user.id]);if(!initial)throw new EconomyError('Booking unavailable.',404);
  const [trip]=await q('SELECT status FROM travel_trips WHERE id=$1 AND user_id=$2 FOR UPDATE',[initial.trip_id,user.id]);
  const b=(await q('SELECT * FROM travel_bookings WHERE id=$1 AND user_id=$2 FOR UPDATE',[bookingId,user.id]))[0];if(!b)throw new EconomyError('Booking unavailable.',404);
  if(b.status==='booked')return b;if(!trip||!['planning','booked'].includes(trip.status))throw new EconomyError('Trip is no longer open.',409);
  if(b.status!=='pending')throw new EconomyError('Only pending bookings can be confirmed.',409);
  if(b.payment_source==='personal')await postPersonalExpense(q,user.id,b.personal_account_id,b.amount,'Travel booking · '+b.description,'travel-confirm:'+b.id);
  else{const c=await worldCompany(q,user.id,b.company_id);await recordSystemExpense(q,c,'travel-confirm:'+b.id,''+b.amount,'Travel booking · '+b.description,'Travel office');}
  const row=(await q("UPDATE travel_bookings SET status='booked',booked_at=now() WHERE id=$1 AND user_id=$2 RETURNING *",[bookingId,user.id]))[0];
  await q("UPDATE travel_trips SET status='booked' WHERE id=$1 AND user_id=$2 AND status='planning'",[b.trip_id,user.id]);
  const t=(await q('SELECT world_id FROM travel_trips WHERE id=$1',[b.trip_id]))[0];
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,t.world_id,'travel-booking-confirmed',b.booking_type+' booked',b.provider+' · USD '+b.amount+' · '+reason]);
  return row;
 });
}
export async function cancelTravelBooking(user,bookingId,body){
 const reason=clean(body.reason,500);if(!reason)throw new EconomyError('Record a cancellation reason.');
 return transaction(async q=>{
  const b=(await q('SELECT * FROM travel_bookings WHERE id=$1 AND user_id=$2 FOR UPDATE',[bookingId,user.id]))[0];if(!b)throw new EconomyError('Booking unavailable.',404);
  if(b.status==='cancelled')return b;
  const row=(await q("UPDATE travel_bookings SET status='cancelled' WHERE id=$1 AND user_id=$2 RETURNING *",[bookingId,user.id]))[0];
  const t=(await q('SELECT world_id FROM travel_trips WHERE id=$1',[b.trip_id]))[0];
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,t.world_id,'travel-booking-cancelled',b.booking_type+' cancelled',b.provider+' · '+reason+' · Any refund must be separately recorded.']);
  return row;
 });
}
export async function refundTravelBooking(user,id,body){
 const amount=amountString(body.amount),reason=clean(body.reason,500),key='travel-refund:'+operationKey(body.operationKey);
 if(!reason)throw new EconomyError('Record the confirmed fictional refund and reason.');
 return transaction(async q=>{
  const [b]=await q('SELECT * FROM travel_bookings WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]);if(!b)throw new EconomyError('Booking unavailable.',404);
  const [prior]=await q('SELECT * FROM travel_refunds WHERE user_id=$1 AND operation_key=$2',[user.id,key]);
  if(prior){if(prior.booking_id!==id||prior.amount!==amount||prior.reason!==reason)throw new EconomyError('Operation reference already used.',409);return prior;}
  if(b.status!=='cancelled'||!b.booked_at)throw new EconomyError('Only a paid, cancelled booking can receive a refund.',409);
  const [check]=await q('SELECT $1::numeric+$2::numeric<=$3::numeric AS valid',[b.refunded_total,amount,b.amount]);
  if(!check.valid)throw new EconomyError('Refund exceeds the original payment.',409);
  const description='Travel refund · '+b.description;
  if(b.payment_source==='personal')await postPersonalRefund(q,user.id,b.personal_account_id,amount,description,key);
  else{const c=await worldCompany(q,user.id,b.company_id);await recordSystemExpenseRefund(q,c,key,amount,description,'Travel office');}
  const [row]=await q('INSERT INTO travel_refunds(id,user_id,booking_id,amount,reason,operation_key) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[uid(),user.id,id,amount,reason,key]);
  await q('UPDATE travel_bookings SET refunded_total=refunded_total+$1::numeric WHERE id=$2 AND user_id=$3',[amount,id,user.id]);
  const [t]=await q('SELECT world_id FROM travel_trips WHERE id=$1 AND user_id=$2',[b.trip_id,user.id]);
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,t.world_id,'travel-refund',b.booking_type+' refund received',b.provider+' · USD '+amount+' · '+reason]);
  return row;
 });
}
export async function changeTravelTrip(user,id,body){
 const origin=clean(body.origin,140),destination=clean(body.destination,140),depart=new Date(body.departAt),ret=body.returnAt?new Date(body.returnAt):null,reason=clean(body.reason,500),key='travel-change:'+operationKey(body.operationKey);
 if(!origin||!destination||!reason||!Number.isFinite(depart.getTime())||(ret&&(!Number.isFinite(ret.getTime())||ret<depart)))throw new EconomyError('Enter valid revised itinerary and reason.');
 const revised={origin,destination,depart_at:depart.toISOString(),return_at:ret?.toISOString()||null};
 return transaction(async q=>{
  const [t]=await q('SELECT * FROM travel_trips WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]);if(!t)throw new EconomyError('Trip unavailable.',404);
  const [prior]=await q('SELECT *,after_state=$3::jsonb AS same FROM travel_changes WHERE user_id=$1 AND operation_key=$2',[user.id,key,JSON.stringify(revised)]);
  if(prior){if(prior.trip_id!==id||prior.reason!==reason||!prior.same)throw new EconomyError('Operation reference already used.',409);return t;}
  if(!['planning','booked'].includes(t.status))throw new EconomyError('Only an open trip can be changed.',409);
  const [active]=await q("SELECT id FROM travel_bookings WHERE user_id=$1 AND trip_id=$2 AND status='booked' LIMIT 1",[user.id,id]);
  if(active)throw new EconomyError('Cancel or resolve existing confirmed bookings before changing the itinerary.',409);
  const before={origin:t.origin,destination:t.destination,depart_at:new Date(t.depart_at).toISOString(),return_at:t.return_at?new Date(t.return_at).toISOString():null};
  const [row]=await q("UPDATE travel_trips SET origin=$1,destination=$2,depart_at=$3,return_at=$4,status='planning' WHERE id=$5 AND user_id=$6 RETURNING *",[origin,destination,depart,ret,id,user.id]);
  await q('INSERT INTO travel_changes(id,user_id,trip_id,before_state,after_state,reason,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),user.id,id,JSON.stringify(before),JSON.stringify(revised),reason,key]);
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,t.world_id,'travel-itinerary-changed',t.title,origin+' → '+destination+' · '+depart.toISOString()+' · '+reason]);
  return row;
 });
}
export async function processTravel(userId){
 // Complete a recorded itinerary only when the return date has elapsed and a
 // confirmed booking exists. This is calendar progression, not proof of travel.
 const trips=await sql("SELECT id FROM travel_trips WHERE user_id=$1 AND status='booked' AND return_at<=now() ORDER BY return_at LIMIT 5",[userId]);
 for(const item of trips)await transaction(async q=>{
  const [t]=await q("SELECT * FROM travel_trips WHERE id=$1 AND user_id=$2 AND status='booked' AND return_at<=now() FOR UPDATE",[item.id,userId]);if(!t)return;
  const [disruption]=await q("SELECT id FROM travel_disruptions WHERE user_id=$1 AND trip_id=$2 AND status='open' LIMIT 1",[userId,t.id]);if(disruption)return;
  const [booked]=await q("SELECT id FROM travel_bookings WHERE user_id=$1 AND trip_id=$2 AND status='booked' LIMIT 1",[userId,t.id]);if(!booked)return;
  await q("UPDATE travel_trips SET status='completed' WHERE id=$1 AND user_id=$2",[t.id,userId]);
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),userId,t.world_id,'travel-completed',t.title,'Recorded itinerary has reached its planned return date.']);
 });
}
export async function travelSnapshot(userId){
 const [trips,bookings,refunds,changes]=await Promise.all([
  sql('SELECT * FROM travel_trips WHERE user_id=$1 ORDER BY depart_at DESC LIMIT 100',[userId]),
  sql('SELECT b.*,t.title AS trip_title,t.trip_type FROM travel_bookings b JOIN travel_trips t ON t.id=b.trip_id AND t.user_id=b.user_id WHERE b.user_id=$1 ORDER BY b.created_at DESC LIMIT 200',[userId]),
  sql('SELECT * FROM travel_refunds WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[userId]),
  sql('SELECT * FROM travel_changes WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[userId])
 ]);
 return {trips,travelBookings:bookings,travelRefunds:refunds,travelChanges:changes};
}
