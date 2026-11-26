import {sql,transaction,uid} from '../backend/src/db.mjs';
import {EconomyError,amountString,operationKey} from './economy-rules.mjs';
import {recordSystemExpense} from './economy.mjs';
import {postPersonalExpense} from './personal-wealth.mjs';
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
  const b=(await q('SELECT * FROM travel_bookings WHERE id=$1 AND user_id=$2 FOR UPDATE',[bookingId,user.id]))[0];if(!b)throw new EconomyError('Booking unavailable.',404);
  if(b.status==='booked')return b;if(b.status!=='pending')throw new EconomyError('Only pending bookings can be confirmed.',409);
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
export async function travelSnapshot(userId){
 const [trips,bookings]=await Promise.all([
  sql('SELECT * FROM travel_trips WHERE user_id=$1 ORDER BY depart_at DESC LIMIT 100',[userId]),
  sql('SELECT b.*,t.title AS trip_title,t.trip_type FROM travel_bookings b JOIN travel_trips t ON t.id=b.trip_id AND t.user_id=b.user_id WHERE b.user_id=$1 ORDER BY b.created_at DESC LIMIT 200',[userId])
 ]);
 return {trips,travelBookings:bookings};
}
