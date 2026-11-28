import {one,sql,transaction,uid} from '../backend/src/db.mjs';
import {normaliseCalendarTimezone} from './calendar-intents.mjs';
export class CalendarConflictError extends Error{
 constructor(title){super('That time conflicts with '+String(title||'an existing commitment')+'.');this.name='CalendarConflictError';this.conflictTitle=String(title||'an existing commitment');}
}
function eventDateTime(event){
 const start=new Date(event.starts_at);
 const date=new Intl.DateTimeFormat('en-GB',{timeZone:event.timezone,weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(start);
 const time=new Intl.DateTimeFormat('en-GB',{timeZone:event.timezone,hour:'numeric',minute:'2-digit',hour12:true}).format(start);
 return date+' at '+time+' '+String(event.timezone_label||'').trim();
}
export function describeCalendarEvent(event){return eventDateTime(event);}
export async function createCalendarEvent({
 userId,worldId,attendeeIds,title,agenda,startsAt,durationMinutes=30,timezone='UTC',timezoneLabel='',
 status='confirmed',source='conversation',sourceContactId=null,sourceMessageId=null,
 coordinatorContactId=null,idempotencyKey=null
}){
 if(!userId||!worldId)throw new Error('The Chairman’s Office calendar is unavailable.');
 const start=new Date(startsAt),duration=Number(durationMinutes);
 if(!Number.isFinite(start.getTime())||start.getTime()<=Date.now())throw new Error('Choose a future date and time.');
 if(!Number.isInteger(duration)||duration<10||duration>120)throw new Error('Meeting duration must be between 10 and 120 minutes.');
 if(!['confirmed','tentative'].includes(status))throw new Error('Invalid calendar status.');
 if(!['conversation','assistant','voice','manual','colleague-call'].includes(source))throw new Error('Invalid calendar source.');
 const zone=normaliseCalendarTimezone(timezone,'UTC');if(zone.invalid)throw new Error('Choose a valid meeting timezone.');
 const ids=[...new Set((Array.isArray(attendeeIds)?attendeeIds:[]).filter(Boolean))].slice(0,8);
 if(!ids.length)throw new Error('Select at least one meeting participant.');
 const verified=await sql('SELECT id,name FROM contacts WHERE user_id=$1 AND id=ANY($2::uuid[])',[userId,ids]);
 if(verified.length!==ids.length)throw new Error('One or more meeting participants are unavailable.');
 const coordinator=coordinatorContactId?await one('SELECT id,name FROM contacts WHERE id=$1 AND user_id=$2',[coordinatorContactId,userId]):await one("SELECT id,name FROM contacts WHERE user_id=$1 AND title='Chief of Staff' ORDER BY created_at LIMIT 1",[userId]);
 if(coordinatorContactId&&!coordinator)throw new Error('The coordinating executive is unavailable.');
 const end=new Date(start.getTime()+duration*60000),key=String(idempotencyKey||('calendar:'+uid())).slice(0,240);
 const cleanTitle=String(title||('Meeting with '+verified.map(p=>p.name).join(' and '))).trim().slice(0,140),cleanAgenda=String(agenda||'').trim().slice(0,1500);
 const insertSql=\`INSERT INTO calendar_events(
 id,user_id,world_id,title,agenda,starts_at,ends_at,timezone,timezone_label,attendees,
 coordinator_contact_id,source_contact_id,source_message_id,status,source,idempotency_key
 ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16)
 ON CONFLICT(user_id,idempotency_key) DO NOTHING RETURNING *\`;
 return transaction(async q=>{
  await q('SELECT pg_advisory_xact_lock(hashtext($1))',[userId]);
  const [existing]=await q('SELECT * FROM calendar_events WHERE user_id=$1 AND idempotency_key=$2',[userId,key]);
  if(existing)return {event:existing,coordinator,alreadyExists:true};
  const [eventConflict]=await q("SELECT title FROM calendar_events WHERE user_id=$1 AND status IN ('confirmed','tentative') AND starts_at<$3 AND ends_at>$2 ORDER BY starts_at LIMIT 1",[userId,start.toISOString(),end.toISOString()]);
  const [boardConflict]=await q("SELECT title FROM meetings WHERE user_id=$1 AND status NOT IN ('cancelled','concluded') AND start_at<$3 AND start_at+(duration_minutes*interval '1 minute')>$2 ORDER BY start_at LIMIT 1",[userId,start.toISOString(),end.toISOString()]);
  if(eventConflict)throw new CalendarConflictError(eventConflict.title);
  if(boardConflict)throw new CalendarConflictError(boardConflict.title);
  const [event]=await q(insertSql,[uid(),userId,worldId,cleanTitle,cleanAgenda,start.toISOString(),end.toISOString(),zone.timezone,String(timezoneLabel||zone.timezoneLabel||'UTC').slice(0,32),JSON.stringify(ids),coordinator?.id||null,sourceContactId||ids[0],sourceMessageId,status,source,key]);
  if(!event){const [prior]=await q('SELECT * FROM calendar_events WHERE user_id=$1 AND idempotency_key=$2',[userId,key]);if(!prior)throw new Error('The calendar entry could not be saved.');return {event:prior,coordinator,alreadyExists:true};}
  const kind=status==='confirmed'?'calendar-invitation-created':'calendar-hold-created';
  const summary=(status==='confirmed'?'Confirmed calendar invitation: ':'Tentative calendar hold: ')+cleanTitle+' · '+eventDateTime(event);
  await q('INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),userId,worldId,sourceContactId||ids[0],kind,cleanTitle,summary+(cleanAgenda?' · Agenda: '+cleanAgenda:'')]);
  return {event,coordinator,alreadyExists:false};
 });
}
