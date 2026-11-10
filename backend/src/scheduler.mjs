import { all, get, run, id, insert, now } from './db.mjs';
import { tickIfDue,enrichLatestDevelopment } from './world.mjs';

function localParts(tz){const parts=new Intl.DateTimeFormat('en-GB',{timeZone:tz,hour:'2-digit',minute:'2-digit',year:'numeric',month:'2-digit',day:'2-digit',hourCycle:'h23'}).formatToParts(new Date());const val=x=>parts.find(p=>p.type===x)?.value;return {hhmm:`${val('hour')}:${val('minute')}`,day:`${val('year')}-${val('month')}-${val('day')}`};}
const timeInt=s=>Number(s.slice(0,2))*60+Number(s.slice(3,5));
export function withinQuiet(hhmm,start,end){const n=timeInt(hhmm),s=timeInt(start),e=timeInt(end);return s>e?n>=s||n<e:n>=s&&n<e;}
function scheduled(db,w,s,parts,kind,clock){
 if(timeInt(parts.hhmm)<timeInt(clock)||timeInt(parts.hhmm)-timeInt(clock)>60||withinQuiet(parts.hhmm,s.quiet_start,s.quiet_end))return null;
 // Check creation using the user's local date rather than server UTC day.
 const invites=all(db,'SELECT created_at,kind FROM invites WHERE user_id=? ORDER BY created_at DESC LIMIT 80',w.user_id);
 if(invites.filter(x=>localPartsAt(x.created_at,w.timezone)===parts.day).length>=s.max_daily)return null;
 if(invites.some(x=>x.kind===kind&&localPartsAt(x.created_at,w.timezone)===parts.day))return null;
 const chief=get(db,"SELECT id,name FROM contacts WHERE user_id=? AND title='Chief of Staff'",w.user_id);if(!chief)return null;
 const i={id:id(),user_id:w.user_id,world_id:w.id,contact_id:chief.id,thread_id:null,kind,subject:kind==='morning'?'Your morning executive briefing':'Your evening executive briefing',preview:`${chief.name} has prepared a briefing and requests a few minutes of your time.`,due_at:now(),status:'pending',created_at:now()};insert(db,'invites',i);return i;
}
function localPartsAt(date,tz){const a=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(date));const v=x=>a.find(p=>p.type===x)?.value;return `${v('year')}-${v('month')}-${v('day')}`;}
export function scheduleForAll(db){const worlds=all(db,'SELECT * FROM worlds');let advanced=0,briefings=0;const advancedUsers=[];for(const w of worlds){try{const n=tickIfDue(db,w.user_id).processed;advanced+=n;if(n)advancedUsers.push(w.user_id);const s=get(db,'SELECT * FROM settings WHERE user_id=?',w.user_id);if(!s)continue;const p=localParts(w.timezone);for(const [k,clock] of [['morning',s.morning],['evening',s.evening]])if(scheduled(db,w,s,p,k,clock))briefings++;
 // At most one urgent call per user's local day, and only from genuinely active high-priority matters.
 const existing=all(db,"SELECT * FROM invites WHERE user_id=? AND kind='urgent' ORDER BY created_at DESC LIMIT 5",w.user_id).some(x=>localPartsAt(x.created_at,w.timezone)===p.day);
 const total=all(db,'SELECT created_at FROM invites WHERE user_id=? ORDER BY created_at DESC LIMIT 30',w.user_id).filter(x=>localPartsAt(x.created_at,w.timezone)===p.day).length;
 if(s.urgent&& !existing &&total<s.max_daily&& !withinQuiet(p.hhmm,s.quiet_start,s.quiet_end)){
  const urgent=get(db,"SELECT * FROM threads WHERE user_id=? AND priority IN ('high','urgent') AND stage>=2 AND status='open' ORDER BY updated_at DESC LIMIT 1",w.user_id);
  if(urgent){const actor=get(db,'SELECT id,name,title FROM contacts WHERE id=? AND user_id=?',urgent.contact_id,w.user_id);if(actor){insert(db,'invites',{id:id(),user_id:w.user_id,world_id:w.id,contact_id:actor.id,thread_id:urgent.id,kind:'urgent',subject:`${actor.name} requests a call`,preview:`A development regarding ${urgent.title} needs your attention.`,due_at:now(),status:'pending',created_at:now()});briefings++;}}
 }
 // External people also initiate calls with their own agendas. One such call per
 // local day at most, usually around mid-afternoon, and within the daily cap.
 const invitesToday=all(db,'SELECT created_at,kind FROM invites WHERE user_id=? ORDER BY created_at DESC LIMIT 40',w.user_id).filter(x=>localPartsAt(x.created_at,w.timezone)===p.day);
 if(timeInt(p.hhmm)>=timeInt('14:10')&&timeInt(p.hhmm)<timeInt('18:00')&&!withinQuiet(p.hhmm,s.quiet_start,s.quiet_end)
   &&invitesToday.length<s.max_daily&&!invitesToday.some(x=>x.kind==='network')){
   const contacts=all(db,"SELECT id,name,title,company FROM contacts WHERE user_id=? AND kind!='internal' ORDER BY name",w.user_id);
   if(contacts.length){const contact=contacts[(new Date().getUTCDate()+w.user_id.charCodeAt(0))%contacts.length];
    insert(db,'invites',{id:id(),user_id:w.user_id,world_id:w.id,contact_id:contact.id,thread_id:null,kind:'network',subject:`Incoming call · ${contact.name}`,preview:`${contact.name} of ${contact.company} would like to talk business.`,due_at:now(),status:'pending',created_at:now()});briefings++;}
 }
 }catch(e){console.error('Scheduler world',w.id,e.message);}}
 return {advanced,briefings,advancedUsers};}
export async function pushDue(db,webpush){const due=all(db,"SELECT * FROM invites WHERE status='pending' AND due_at<=? ORDER BY due_at ASC LIMIT 30",now());const results=[];for(const invite of due){const w=get(db,'SELECT timezone FROM worlds WHERE user_id=?',invite.user_id);const s=get(db,'SELECT quiet_start,quiet_end FROM settings WHERE user_id=?',invite.user_id);if(w&&s&&withinQuiet(localParts(w.timezone).hhmm,s.quiet_start,s.quiet_end))continue;let delivered=0;const subs=all(db,'SELECT * FROM push_subscriptions WHERE user_id=?',invite.user_id);for(const sub of subs){try{if(webpush){await webpush.sendNotification(JSON.parse(sub.subscription),JSON.stringify({title:invite.subject,body:invite.preview,inviteId:invite.id,url:`/?incoming=${invite.id}`}));delivered++;}}catch(e){if(e.statusCode===404||e.statusCode===410)run(db,'DELETE FROM push_subscriptions WHERE id=?',sub.id);else console.error('push failure',e.message);}}
 run(db,"UPDATE invites SET status='notified' WHERE id=? AND status='pending'",invite.id);results.push({invite:invite.id,delivered});}return results;}
