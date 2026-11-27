import {sql,one,transaction,uid} from '../backend/src/db.mjs';
import {ask} from '../backend/src/ai.mjs';
import {EconomyError,operationKey} from './economy-rules.mjs';
import {normalizeTranscript,mergeTranscript,parseConcierge,meetingConflict,speechChunks} from './executive-experience-rules.mjs';
import {synthesizeVoicemail} from './voice-notes.mjs';
import {progressiveSpeech} from './progressive-meeting-audio.mjs';
import {enqueueCharacterMemory} from './character-intelligence.mjs';
const clean=(s,n=1000)=>typeof s==='string'?s.trim().slice(0,n):'';
async function event(q,row,kind,title,body){await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),row.user_id,row.world_id,kind,title,body]);}
export async function checkpointCall(user,id,body){
 return transaction(async q=>{
  const [c]=await q('SELECT * FROM calls WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]);if(!c)throw new EconomyError('Call unavailable.',404);
  if(c.status!=='active')return {status:c.status,saved:normalizeTranscript(c.transcript).length};
  let transcript;
  if(body.offset!==undefined){const saved=normalizeTranscript(c.transcript),offset=body.offset;if(!Number.isInteger(offset)||offset<0||offset>saved.length)throw new EconomyError('Call checkpoint offset is out of sequence.',409);transcript=mergeTranscript(saved,[...saved.slice(0,offset),...normalizeTranscript(body.transcript)]);}else transcript=mergeTranscript(c.transcript,body.transcript);
  await q('UPDATE calls SET transcript=$1,transcript_checkpoint_at=now(),last_heartbeat_at=now() WHERE id=$2 AND user_id=$3',[JSON.stringify(transcript),id,user.id]);
  return {status:'active',saved:transcript.length};
 });
}
export async function recoverAbandonedCalls(userId){
 const rows=await sql("SELECT id FROM calls WHERE user_id=$1 AND status='active' AND coalesce(last_heartbeat_at,started_at)<now()-interval '10 minutes' ORDER BY started_at LIMIT 10",[userId]);
 for(const r of rows)await transaction(async q=>{
  const [c]=await q("SELECT * FROM calls WHERE id=$1 AND user_id=$2 AND status='active' AND coalesce(last_heartbeat_at,started_at)<now()-interval '10 minutes' FOR UPDATE",[r.id,userId]);if(!c)return;
  const turns=normalizeTranscript(c.transcript),summary=turns.length?'Connection interrupted; saved transcript: '+turns.map(t=>t.role+': '+t.text).join(' ').slice(0,3000):'Connection interrupted; no transcript was saved.';
  await q("UPDATE calls SET status='failed',ended_at=now(),summary=$1 WHERE id=$2 AND user_id=$3",[summary,c.id,userId]);
  if(turns.length)await enqueueCharacterMemory(q,{userId,worldId:c.world_id,contactId:c.contact_id,sourceType:'voice-call',sourceId:c.id,context:{transcript:turns.slice(-40),summary,status:'failed'}});
  await event(q,c,'call-recovered','Interrupted executive call',summary);
 });
}
export async function meetingVoiceSegment(user,turnId,index,{progressive=false,signal}={}){
 const t=await one('SELECT t.message,c.id,c.voice_id FROM meeting_turns t JOIN contacts c ON c.id=t.contact_id AND c.user_id=t.user_id WHERE t.id=$1 AND t.user_id=$2',[turnId,user.id]);
 if(!t)throw new EconomyError('Executive response unavailable.',404);
 const chunks=speechChunks(t.message);
 if(!Number.isInteger(index)||index<0||index>=chunks.length)throw new EconomyError('Invalid speech segment.');
 if(progressive)return progressiveSpeech(chunks[index],t,signal);
 const audio=await synthesizeVoicemail(chunks[index],t);
 if(!audio)throw new EconomyError('Executive voice provider unavailable.',503);
 return new Response(audio,{headers:{'Content-Type':'audio/wav','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
export async function requestConcierge(user,tripId,body){
 const key='concierge:'+operationKey(body.operationKey);
 return transaction(async q=>{
  const [t]=await q('SELECT * FROM travel_trips WHERE id=$1 AND user_id=$2 FOR UPDATE',[tripId,user.id]);if(!t||!['planning','booked'].includes(t.status))throw new EconomyError('Open trip unavailable.',404);
  const [prior]=await q('SELECT * FROM travel_concierge_jobs WHERE user_id=$1 AND operation_key=$2',[user.id,key]);if(prior){if(prior.trip_id!==tripId)throw new EconomyError('Operation reference already used.',409);return prior;}
  const [open]=await q("SELECT * FROM travel_concierge_jobs WHERE trip_id=$1 AND user_id=$2 AND status='pending' ORDER BY created_at DESC LIMIT 1",[tripId,user.id]);if(open)return open;
  return (await q('INSERT INTO travel_concierge_jobs(id,user_id,trip_id,operation_key) VALUES($1,$2,$3,$4) RETURNING *',[uid(),user.id,tripId,key]))[0];
 });
}
export async function processConcierge(userId){
 const [job]=await sql(`WITH due AS (SELECT id FROM travel_concierge_jobs WHERE user_id=$1 AND status='pending' AND attempts<4 AND (attempted_at IS NULL OR attempted_at<now()-interval '10 minutes') ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
 UPDATE travel_concierge_jobs j SET attempts=attempts+1,attempted_at=now() FROM due WHERE j.id=due.id RETURNING j.*`,[userId]);if(!job)return;
 const trip=await one("SELECT * FROM travel_trips WHERE id=$1 AND user_id=$2 AND status IN ('planning','booked')",[job.trip_id,userId]);
 const bookings=trip?await sql('SELECT id,booking_type,provider,description,amount,status FROM travel_bookings WHERE user_id=$1 AND trip_id=$2',[userId,trip.id]):[];
 const disruptions=trip?await sql("SELECT kind,description,proposed_action FROM travel_disruptions WHERE user_id=$1 AND trip_id=$2 AND status='open'",[userId,trip.id]):[];
 const meetings=trip?await sql("SELECT title,start_at,duration_minutes FROM meetings WHERE user_id=$1 AND status='scheduled' AND start_at BETWEEN $2::timestamptz-interval '2 hours' AND $2::timestamptz+interval '2 hours'",[userId,trip.depart_at]):[];
 const plan=trip?await ask('You are a fictional executive travel concierge. Review only the recorded itinerary, bookings and calendar. Identify practical options and missing information. Do not claim real availability, actual disruption, booking, provider contact or cost not recorded. Never authorize spending. Return JSON {summary:"...",actions:[{type:"review|contact-provider|plan-alternative|review-meeting|confirm-booking",detail:"...",bookingId:null}]}',JSON.stringify({trip,bookings,disruptions,meetings}),{json:true,fallback:null,validate:r=>parseConcierge(r,bookings.map(b=>b.id))}):null;
 if(!plan){if(!trip||job.attempts>=4)await sql("UPDATE travel_concierge_jobs SET status='failed' WHERE id=$1 AND user_id=$2 AND attempts=$3",[job.id,userId,job.attempts]);return;}
 await transaction(async q=>{
  const [lock]=await q("SELECT id FROM travel_concierge_jobs WHERE id=$1 AND user_id=$2 AND status='pending' AND attempts=$3 FOR UPDATE",[job.id,userId,job.attempts]);if(!lock)return;
  const [live]=await q("SELECT id FROM travel_trips WHERE id=$1 AND user_id=$2 AND status IN ('planning','booked') FOR UPDATE",[trip.id,userId]);if(!live){await q("UPDATE travel_concierge_jobs SET status='failed' WHERE id=$1",[job.id]);return;}
  await q('INSERT INTO travel_concierge_briefs(id,user_id,trip_id,job_id,body) VALUES($1,$2,$3,$4,$5) ON CONFLICT(job_id) DO NOTHING',[uid(),userId,trip.id,job.id,JSON.stringify(plan)]);
  await q("UPDATE travel_concierge_jobs SET status='done' WHERE id=$1 AND user_id=$2",[job.id,userId]);
  await event(q,trip,'travel-concierge-ready',trip.title+' · concierge brief',plan.summary);
 });
}
async function insertDisruption(q,t,{kind,bookingId=null,description,action,key,origin='recorded'}){
 const [row]=await q('INSERT INTO travel_disruptions(id,user_id,world_id,trip_id,booking_id,kind,origin,description,proposed_action,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(user_id,operation_key) DO NOTHING RETURNING *',[uid(),t.user_id,t.world_id,t.id,bookingId,kind,origin,description,action,key]);
 if(row)await event(q,t,'travel-disruption',t.title+' · '+kind,description+' · '+action);
 return row;
}
export async function reportDisruption(user,tripId,body){
 const key='disruption:'+operationKey(body.operationKey),kind=body.kind,description=clean(body.description),action=clean(body.proposedAction);
 if(!['delay','cancellation','provider-change'].includes(kind)||description.length<10||action.length<5)throw new EconomyError('Record the fictional disruption and proposed action.');
 return transaction(async q=>{
  const [t]=await q("SELECT * FROM travel_trips WHERE id=$1 AND user_id=$2 AND status IN ('planning','booked') FOR UPDATE",[tripId,user.id]);if(!t)throw new EconomyError('Open trip unavailable.',404);
  if(body.bookingId){const [b]=await q('SELECT id FROM travel_bookings WHERE id=$1 AND user_id=$2 AND trip_id=$3',[body.bookingId,user.id,t.id]);if(!b)throw new EconomyError('Booking unavailable.',404);}
  const [prior]=await q('SELECT * FROM travel_disruptions WHERE user_id=$1 AND operation_key=$2',[user.id,key]);if(prior){if(prior.trip_id!==tripId||prior.kind!==kind||prior.description!==description||prior.proposed_action!==action||prior.booking_id!==(body.bookingId||null))throw new EconomyError('Operation reference already used.',409);return prior;}
  return insertDisruption(q,t,{kind,bookingId:body.bookingId||null,description,action,key});
 });
}
export async function resolveDisruption(user,id,body){
 const reason=clean(body.reason);if(reason.length<10)throw new EconomyError('Record the confirmed resolution.');
 return transaction(async q=>{
  const [d]=await q('SELECT * FROM travel_disruptions WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]);if(!d)throw new EconomyError('Disruption unavailable.',404);
  if(d.status==='resolved'){if(d.reason===reason)return d;throw new EconomyError('Disruption already resolved.',409);}
  const [r]=await q("UPDATE travel_disruptions SET status='resolved',reason=$1,resolved_at=now() WHERE id=$2 AND user_id=$3 RETURNING *",[reason,id,user.id]);
  await event(q,d,'travel-disruption-resolved','Travel disruption resolved',reason+' · No automatic booking or financial change.');return r;
 });
}
export async function monitorTravel(userId){
 const trips=await sql("SELECT id FROM travel_trips WHERE user_id=$1 AND status IN ('planning','booked') AND depart_at BETWEEN now()-interval '1 day' AND now()+interval '2 days' ORDER BY depart_at LIMIT 20",[userId]);
 for(const {id} of trips)await transaction(async q=>{
  const [t]=await q("SELECT * FROM travel_trips WHERE id=$1 AND user_id=$2 AND status IN ('planning','booked') FOR UPDATE",[id,userId]);if(!t)return;
  const bookings=await q("SELECT id,booking_type,status FROM travel_bookings WHERE user_id=$1 AND trip_id=$2",[userId,id]);
  if(!bookings.some(b=>b.status==='booked'&&['flight','ground','private-aviation'].includes(b.booking_type)))await insertDisruption(q,t,{kind:'missing-booking',description:'No confirmed transport booking is recorded for the approaching trip.',action:'Review transport requirements with the concierge.',key:'missing-transport:'+id});
  const meetings=await q("SELECT id,title,start_at,duration_minutes FROM meetings WHERE user_id=$1 AND status='scheduled' AND start_at BETWEEN $2::timestamptz-interval '4 hours' AND $2::timestamptz+interval '2 hours'",[userId,t.depart_at]);
  for(const m of meetings.filter(m=>meetingConflict(t,m)))await insertDisruption(q,t,{kind:'schedule-conflict',description:'Departure overlaps the travel buffer for '+m.title+'.',action:'Review the meeting and itinerary before approving a change.',key:'travel-conflict:'+id+':'+m.id});
 });
}
export async function executiveTravelSnapshot(userId){
 const [disruptions,jobs,briefs,rebookings]=await Promise.all([sql('SELECT * FROM travel_disruptions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[userId]),sql('SELECT id,trip_id,status,attempts,created_at FROM travel_concierge_jobs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[userId]),sql('SELECT * FROM travel_concierge_briefs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[userId]),sql('SELECT * FROM travel_rebookings WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[userId])]);return {disruptions,jobs,briefs,rebookings};
}
