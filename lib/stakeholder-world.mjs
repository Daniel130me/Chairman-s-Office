import {sql,transaction,uid} from '../backend/src/db.mjs';
import {ask} from '../backend/src/ai.mjs';
import {localTime,isQuiet} from './schedule.mjs';
const clean=(v,n=600)=>typeof v==='string'?v.trim().slice(0,n):'';
export function parseStakeholderDecision(raw){
 if(!raw||!['contact','defer'].includes(raw.decision))return null;
 const reason=clean(raw.reason);if(!reason)return null;
 if(raw.decision==='defer')return {decision:'defer',reason};
 const title=clean(raw.title,140),message=clean(raw.message,1400);
 if(!title||!message||!['message','call'].includes(raw.channel))return null;
 return {decision:'contact',title,message,reason,channel:raw.channel};
}
async function reserve(userId){
 await transaction(async q=>{
  const [w]=await q('SELECT id,name,region,sectors FROM worlds WHERE user_id=$1 FOR UPDATE',[userId]);if(!w)return;
  const [recent]=await q("SELECT id FROM stakeholder_engagements WHERE user_id=$1 AND created_at>=now()-interval '2 hours' LIMIT 1",[userId]);if(recent)return;
  const [pending]=await q("SELECT count(*)::int n FROM stakeholder_engagements WHERE user_id=$1 AND status='pending'",[userId]);if(pending.n>=4)return;
  const [person]=await q(`SELECT c.id,c.name,c.title,c.company,c.kind,c.agenda,c.temperament,c.trust,c.respect,c.tension
   FROM contacts c WHERE c.user_id=$1 AND c.world_id=$2 AND c.kind IN ('investor','banker','regulator','journalist','friend','adviser','partner','supplier','vendor','client','competitor','rival','former-employee')
   AND NOT EXISTS(SELECT 1 FROM stakeholder_engagements e WHERE e.user_id=c.user_id AND e.contact_id=c.id AND e.created_at>=now()-interval '24 hours')
   ORDER BY (SELECT max(e.created_at) FROM stakeholder_engagements e WHERE e.user_id=c.user_id AND e.contact_id=c.id) NULLS FIRST,c.id LIMIT 1`,[userId,w.id]);if(!person)return;
  // Outsiders see only public setup facts and their own interactions, not private
  // balances, other contacts' messages, HR cases or unrelated internal documents.
  const history=await q('SELECT direction,channel,body,created_at FROM messages WHERE user_id=$1 AND contact_id=$2 ORDER BY created_at DESC LIMIT 8',[userId,person.id]);
  const matters=await q('SELECT title,category,summary,status FROM threads WHERE user_id=$1 AND contact_id=$2 ORDER BY updated_at DESC LIMIT 4',[userId,person.id]);
  const contracts=await q("SELECT title,contract_type,value,status,terms FROM business_contracts WHERE user_id=$1 AND counterparty=$2 ORDER BY updated_at DESC LIMIT 4",[userId,person.company]);
  const moves=await q('SELECT title,description,impact,created_at FROM market_moves WHERE user_id=$1 AND contact_id=$2 ORDER BY created_at DESC LIMIT 3',[userId,person.id]);
  // Own matters may contain internal notes. Supply titles and category only.
  const context={world:{name:w.name,region:w.region,sectors:w.sectors},person,history:history.reverse(),matters:matters.map(({title,category,status})=>({title,category,status})),contracts:contracts.map(({title,contract_type,value,status})=>({title,contract_type,value,status})),moves};
  await q('INSERT INTO stakeholder_engagements(id,user_id,world_id,contact_id,context,operation_key) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,operation_key) DO NOTHING',[uid(),userId,w.id,person.id,JSON.stringify(context),'stakeholder:'+person.id+':'+new Date().toISOString().slice(0,10)]);
 });
}
export async function processStakeholders(userId){
 await reserve(userId);
 const [job]=await sql(`WITH due AS (SELECT id FROM stakeholder_engagements WHERE user_id=$1 AND status='pending' AND (attempted_at IS NULL OR attempted_at<now()-interval '30 minutes') ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
 UPDATE stakeholder_engagements e SET attempts=attempts+1,attempted_at=now() FROM due WHERE e.id=due.id RETURNING e.*`,[userId]);if(!job)return;
 const decision=await ask('Act independently as the named fictional stakeholder, not as the Chairman or an employee. Pursue your own interests, with the supplied relationship history and facts. An unsolicited nonbinding invitation, question, offer, concern or request is allowed; do not fabricate real-world facts, financial commitments, private knowledge, signed agreements or completed actions. Do not invent a crisis to force a response. Choose defer if nothing meaningful. Return JSON {decision:"contact"|"defer",reason,title,message,channel:"message"|"call"}. If calling, the message is a short reason for the call, not a claim that the Chairman answered.',JSON.stringify(job.context),{json:true,fallback:null,validate:parseStakeholderDecision});
 if(!decision){
  if(job.attempts>=5)await sql("UPDATE stakeholder_engagements SET status='failed',completed_at=now() WHERE id=$1 AND user_id=$2 AND status='pending' AND attempts=$3",[job.id,userId,job.attempts]);
  const e=Error('Stakeholder AI unavailable');e.code='AI_STAKEHOLDER_UNAVAILABLE';throw e;
 }
 await transaction(async q=>{
  const [w]=await q('SELECT id,timezone FROM worlds WHERE id=$1 AND user_id=$2 FOR UPDATE',[job.world_id,userId]);if(!w)return;
  const [h]=await q("SELECT * FROM stakeholder_engagements WHERE id=$1 AND user_id=$2 AND status='pending' AND attempts=$3 FOR UPDATE",[job.id,userId,job.attempts]);if(!h)return;
  const [p]=await q('SELECT id,name,kind FROM contacts WHERE id=$1 AND user_id=$2 AND world_id=$3',[h.contact_id,userId,w.id]);if(!p)return;
  if(decision.decision==='defer'){await q("UPDATE stakeholder_engagements SET status='deferred',decision=$1,completed_at=now() WHERE id=$2",[JSON.stringify(decision),h.id]);return;}
  const tid=uid();
  await q("INSERT INTO threads(id,user_id,world_id,contact_id,title,category,summary,priority) VALUES($1,$2,$3,$4,$5,'network',$6,'normal')",[tid,userId,w.id,p.id,decision.title,decision.message]);
  const [settings]=await q('SELECT * FROM settings WHERE user_id=$1',[userId]);
  const now=localTime(w.timezone),quiet=settings?.quiet_enabled&&isQuiet(now.minute,settings.quiet_start,settings.quiet_end);
  const [count]=await q("SELECT count(*)::int n FROM invites WHERE user_id=$1 AND created_at>=now()-interval '24 hours'",[userId]);
  const call=decision.channel==='call'&&!quiet&&settings&&count.n<settings.max_daily;
  // Calls and messages are explicit alternative deliveries. Missed calls use the
  // existing persisted callback/voicemail path; never mark a call as answered.
  if(call)await q('INSERT INTO invites(id,user_id,world_id,contact_id,thread_id,kind,subject,preview,due_at,schedule_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now(),$9)',[uid(),userId,w.id,p.id,tid,'network','Incoming call · '+p.name,decision.message.slice(0,500),h.operation_key+':call']);
  else await q("INSERT INTO messages(id,user_id,world_id,contact_id,direction,channel,body) VALUES($1,$2,$3,$4,'incoming','chat',$5)",[uid(),userId,w.id,p.id,decision.message]);
  await q("UPDATE stakeholder_engagements SET status='sent',thread_id=$1,decision=$2,completed_at=now() WHERE id=$3",[tid,JSON.stringify({...decision,deliveredVia:call?'call-invitation':'message'}),h.id]);
  await q('INSERT INTO events(id,user_id,world_id,thread_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[uid(),userId,w.id,tid,p.id,'stakeholder-contact',decision.title,p.name+': '+decision.message]);
  await q('UPDATE contacts SET last_contact_at=now() WHERE id=$1 AND user_id=$2',[p.id,userId]);
 });
}
export async function stakeholderSnapshot(userId){
 return sql("SELECT e.id,e.contact_id,e.thread_id,e.status,e.decision,e.created_at,e.completed_at,c.name AS contact_name,c.company,c.kind FROM stakeholder_engagements e JOIN contacts c ON c.id=e.contact_id AND c.user_id=e.user_id WHERE e.user_id=$1 AND e.status='sent' ORDER BY e.completed_at DESC LIMIT 100",[userId]);
}
