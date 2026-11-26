import {sql,transaction,uid} from '../backend/src/db.mjs';
import {ask} from '../backend/src/ai.mjs';

const clamp=n=>Math.max(0,Math.min(100,n));
const clean=(v,n=900)=>typeof v==='string'?v.trim().slice(0,n):'';
const memoryTypes=new Set(['interaction','commitment','preference','observation','belief','rumor','lesson','relationship','agenda']);
const epistemic=new Set(['confirmed','reported','belief','rumor','forecast']);
const sensitivities=new Set(['public','internal','confidential','restricted']);
const goalTypes=new Set(['business','career','relationship','personal','risk','leadership']);
const priorities=new Set(['low','normal','high']);
const finite=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
export function parseMemoryExtraction(raw){
 if(!raw||!Array.isArray(raw.memories))return null;
 const memories=raw.memories.slice(0,3).map(m=>{
  const content=clean(m.content,700),memoryType=m.memoryType,epistemicStatus=m.epistemicStatus,sensitivity=m.sensitivity||'internal';
  if(content.length<12||!memoryTypes.has(memoryType)||!epistemic.has(epistemicStatus)||!sensitivities.has(sensitivity)||!finite(m.confidence,0,1)||!Number.isInteger(m.importance)||m.importance<1||m.importance>5)return null;
  return {content,memoryType,epistemicStatus,sensitivity,confidence:m.confidence,importance:m.importance};
 });
 if(memories.some(x=>!x))return null;
 return {memories};
}
export function parseAgendaDecision(raw,allowed){
 if(!raw||!['create','update','complete','pause','maintain','defer'].includes(raw.decision))return null;
 const rationale=clean(raw.rationale,600);if(!rationale)return null;
 if(raw.decision==='create'){
  const title=clean(raw.title,150),description=clean(raw.description,900);
  if(!title||!description||!goalTypes.has(raw.goalType)||!priorities.has(raw.priority))return null;
  const targetContactId=raw.targetContactId&&allowed.contactIds.includes(raw.targetContactId)?raw.targetContactId:null;
  const targetCompanyId=raw.targetCompanyId&&allowed.companyIds.includes(raw.targetCompanyId)?raw.targetCompanyId:null;
  return {decision:'create',title,description,goalType:raw.goalType,priority:raw.priority,targetContactId,targetCompanyId,rationale};
 }
 if(['pause','update','complete'].includes(raw.decision)&&!allowed.goalIds.includes(raw.goalId))return null;
 if(['update','complete'].includes(raw.decision)){
  const evidence=clean(raw.evidence,700),evidenceTaskId=raw.evidenceTaskId||null,evidenceThreadId=raw.evidenceThreadId||null,progressDelta=raw.progressDelta,current=allowed.goalProgress[raw.goalId];
  const taskValid=!!evidenceTaskId&&allowed.taskIds.includes(evidenceTaskId),threadValid=!!evidenceThreadId&&allowed.threadIds.includes(evidenceThreadId);
  if(!evidence||taskValid===threadValid||!Number.isInteger(progressDelta)||progressDelta<1||progressDelta>50)return null;
  if(raw.decision==='complete'&&current+progressDelta<100)return null;
  return {decision:raw.decision,goalId:raw.goalId,evidenceTaskId:taskValid?evidenceTaskId:null,evidenceThreadId:threadValid?evidenceThreadId:null,progressDelta,evidence,rationale};
 }
 return {decision:raw.decision,goalId:raw.goalId||null,rationale};
}
export function parseRelationshipReview(raw){
 if(!raw||!['apply','no-change'].includes(raw.decision))return null;
 const reason=clean(raw.reason,600);if(!reason)return null;
 if(raw.decision==='no-change')return {decision:'no-change',reason};
 const read=side=>{
  if(!side||!['first-to-second','second-to-first'].includes(side.direction))return null;
  const values=['trustDelta','respectDelta','loyaltyDelta','tensionDelta'];
  if(values.some(k=>!Number.isInteger(side[k])||side[k]<-3||side[k]>3)||!Number.isInteger(side.familiarityDelta)||side.familiarityDelta<0||side.familiarityDelta>3)return null;
  return {direction:side.direction,trustDelta:side.trustDelta,respectDelta:side.respectDelta,loyaltyDelta:side.loyaltyDelta,tensionDelta:side.tensionDelta,familiarityDelta:Math.max(0,side.familiarityDelta)};
 };
 const changes=Array.isArray(raw.changes)?raw.changes.map(read):[];
 if(changes.length!==2||changes.some(x=>!x)||new Set(changes.map(x=>x.direction)).size!==2)return null;
 return {decision:'apply',reason,changes};
}
export async function enqueueCharacterMemory(q,{userId,worldId,contactId,sourceType,sourceId,context}){
 if(!contactId||!sourceId||!context)return null;
 const [contact]=await q('SELECT id FROM contacts WHERE id=$1 AND user_id=$2 AND world_id=$3',[contactId,userId,worldId]);
 if(!contact)return null;
 const key='memory:'+sourceType+':'+String(sourceId)+':'+contactId;
 const [row]=await q(`INSERT INTO character_memory_jobs(id,user_id,world_id,contact_id,source_type,source_id,source_context,operation_key)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(user_id,operation_key) DO NOTHING RETURNING id`,[uid(),userId,worldId,contactId,sourceType,String(sourceId),JSON.stringify(context),key]);
 return row?.id||null;
}
export async function queueCharacterMemory({userId,worldId,contactId,sourceType,sourceId,context}){
 return transaction(q=>enqueueCharacterMemory(q,{userId,worldId,contactId,sourceType,sourceId,context}));
}
async function reserveMemory(userId){
 return sql(`WITH due AS (
 SELECT id FROM character_memory_jobs WHERE user_id=$1 AND status IN ('pending','processing')
 AND next_attempt_at<=now() AND (attempted_at IS NULL OR attempted_at<now()-interval '20 minutes')
 AND attempts<5 ORDER BY next_attempt_at,created_at LIMIT 1 FOR UPDATE SKIP LOCKED
 ) UPDATE character_memory_jobs j SET status='processing',attempts=attempts+1,attempted_at=now()
 FROM due WHERE j.id=due.id RETURNING j.*`,[userId]).then(rows=>rows[0]||null);
}
export async function processCharacterMemory(userId){
 const job=await reserveMemory(userId);if(!job)return false;
 try{
  const [person]=await sql('SELECT id,name,title,company,temperament,agenda FROM contacts WHERE id=$1 AND user_id=$2 AND world_id=$3',[job.contact_id,userId,job.world_id]);
  if(!person)throw Error('Character unavailable');
  const prior=await sql('SELECT memory_type,epistemic_status,content FROM character_memories WHERE user_id=$1 AND contact_id=$2 ORDER BY importance DESC,occurred_at DESC LIMIT 12',[userId,person.id]);
  const result=await ask(
   'Extract only durable memories this named fictional character could personally retain from the supplied interaction. Do not infer facts, motives, promises or events not explicitly present. Separate confirmed statements from claims, beliefs, rumors and forecasts. Do not store passwords, credentials, payment secrets or highly sensitive personal information. Prefer specific commitments, preferences, relationship context, decisions and unresolved matters. If nothing durable was learned, return {"memories":[]}. Return JSON {memories:[{memoryType:"interaction|commitment|preference|observation|belief|rumor|lesson|relationship|agenda",epistemicStatus:"confirmed|reported|belief|rumor|forecast",sensitivity:"public|internal|confidential|restricted",content:"...",confidence:0.0,importance:1}]}. Maximum three memories.',
   JSON.stringify({character:person,interaction:job.source_context,existingMemories:prior}),
   {json:true,fallback:null,validate:parseMemoryExtraction}
  );
  if(!result)throw Object.assign(Error('Memory extraction unavailable'),{code:'AI_MEMORY_UNAVAILABLE'});
  await transaction(async q=>{
   const [locked]=await q("SELECT id FROM character_memory_jobs WHERE id=$1 AND user_id=$2 AND status='processing' AND attempts=$3 FOR UPDATE",[job.id,userId,job.attempts]);if(!locked)return;
   for(let i=0;i<result.memories.length;i++){
    const m=result.memories[i];
    await q(`INSERT INTO character_memories(id,user_id,world_id,contact_id,memory_type,epistemic_status,sensitivity,content,source_type,source_id,confidence,importance,operation_key)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(user_id,operation_key) DO NOTHING`,
     [uid(),userId,job.world_id,person.id,m.memoryType,m.epistemicStatus,m.sensitivity,m.content,job.source_type,job.source_id,m.confidence,m.importance,'memory-entry:'+job.id+':'+i]);
   }
   await q("UPDATE character_memory_jobs SET status='completed',completed_at=now(),last_error_code=NULL WHERE id=$1 AND user_id=$2",[job.id,userId]);
  });
  return true;
 }catch(error){
  const code=String(error.code||error.name||'Error').slice(0,80);
  await sql(`UPDATE character_memory_jobs SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,
   next_attempt_at=now()+CASE WHEN attempts<=1 THEN interval '5 minutes' WHEN attempts=2 THEN interval '15 minutes' ELSE interval '45 minutes' END,
   last_error_code=$3 WHERE id=$1 AND user_id=$2 AND status='processing'`,[job.id,userId,code]);
  throw error;
 }
}
async function reserveAgenda(userId){
 return transaction(async q=>{
  const [world]=await q('SELECT id FROM worlds WHERE user_id=$1 FOR UPDATE',[userId]);if(!world)return null;
  const [due]=await q(`SELECT id FROM contacts WHERE user_id=$1 AND world_id=$2
   AND (next_agenda_at IS NULL OR next_agenda_at<=now())
   ORDER BY next_agenda_at NULLS FIRST,last_development_at NULLS FIRST,id
   LIMIT 1 FOR UPDATE SKIP LOCKED`,[userId,world.id]);if(!due)return null;
  const [person]=await q('UPDATE contacts SET next_agenda_at=now()+interval \'6 hours\',last_development_at=now() WHERE id=$1 AND user_id=$2 RETURNING id',[due.id,userId]);
  const cycle=Math.floor(Date.now()/21600000);
  const key='agenda:'+person.id+':'+cycle;
  const [job]=await q(`INSERT INTO character_agenda_jobs(id,user_id,world_id,contact_id,operation_key)
   VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,operation_key) DO NOTHING RETURNING *`,[uid(),userId,world.id,person.id,key]);
  if(job)return job;
  return null;
 });
}
export async function processCharacterAgenda(userId){
 await reserveAgenda(userId);
 const [job]=await sql(`WITH due AS (SELECT id FROM character_agenda_jobs WHERE user_id=$1 AND status IN ('pending','processing')
  AND next_attempt_at<=now() AND (attempted_at IS NULL OR attempted_at<now()-interval '20 minutes') AND attempts<5
  ORDER BY next_attempt_at,created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
  UPDATE character_agenda_jobs j SET status='processing',attempts=attempts+1,attempted_at=now() FROM due
  WHERE j.id=due.id RETURNING j.*`,[userId]);
 if(!job)return false;
 try{
  const [person]=await sql('SELECT * FROM contacts WHERE id=$1 AND user_id=$2 AND world_id=$3',[job.contact_id,userId,job.world_id]);if(!person)throw Error('Character unavailable');
  const [goals,memories,relationships,tasks,goalThreads,companies]=await Promise.all([
   sql("SELECT id,goal_type,title,description,priority,status,target_contact_id,target_company_id,progress FROM character_goals WHERE user_id=$1 AND contact_id=$2 AND status IN ('active','paused') ORDER BY priority DESC,updated_at DESC LIMIT 6",[userId,person.id]),
   sql("SELECT memory_type,epistemic_status,content,confidence,importance,occurred_at FROM character_memories WHERE user_id=$1 AND contact_id=$2 AND sensitivity<>'restricted' ORDER BY importance DESC,occurred_at DESC LIMIT 10",[userId,person.id]),
   sql(`SELECT r.relationship_label,r.trust,r.respect,r.loyalty,r.tension,r.familiarity,c.id contact_id,c.name,c.title,c.company
    FROM character_relationships r JOIN contacts c ON c.id=r.to_contact_id AND c.user_id=r.user_id
    WHERE r.user_id=$1 AND r.from_contact_id=$2 ORDER BY r.updated_at DESC LIMIT 12`,[userId,person.id]),
   sql("SELECT id,title,detail,status,outcome,completed_at FROM business_tasks WHERE user_id=$1 AND assignee_id=$2 ORDER BY created_at DESC LIMIT 12",[userId,person.id]),
   sql("SELECT id,character_goal_id,title,summary,status,updated_at FROM threads WHERE user_id=$1 AND contact_id=$2 AND status='resolved' AND character_goal_id=ANY($3::uuid[]) ORDER BY updated_at DESC LIMIT 8",[userId,person.id,goals.map(g=>g.id)]),
   person.kind==='internal'?sql('SELECT id,name,sector FROM companies WHERE user_id=$1 AND world_id=$2 ORDER BY name',[userId,job.world_id]):Promise.resolve([])
  ]);
  const activeGoals=goals.filter(g=>g.status==='active');
  const allowed={goalIds:activeGoals.map(g=>g.id),goalProgress:Object.fromEntries(activeGoals.map(g=>[g.id,g.progress])),taskIds:tasks.filter(t=>t.status==='completed'&&t.outcome).map(t=>t.id),threadIds:goalThreads.map(t=>t.id),contactIds:relationships.map(r=>r.contact_id),companyIds:companies.map(c=>c.id)};
  const decision=await ask(
   'Act as this fictional person, pursuing an independent life and professional agenda. Based only on your role, temperament, stated agenda, own memories, direct relationships and assigned work, decide whether to create one useful current goal, update or complete an existing goal only with a completed assigned task or resolved goal conversation as evidence, pause one existing goal, maintain course or defer. Goals are intentions, not completed actions. Never invent access, knowledge, evidence, money, approvals or completed work. Do not create generic filler or goals solely to contact the Chairman. Prefer a goal with a concrete reason and plausible next step. External characters may pursue independent commercial, social or competitive interests. Return JSON {decision:"create|update|complete|pause|maintain|defer",goalId:null,evidenceTaskId:null,evidenceThreadId:null,progressDelta:0,evidence:"",goalType:"business|career|relationship|personal|risk|leadership",title:"",description:"",priority:"low|normal|high",targetContactId:null,targetCompanyId:null,rationale:"evidence-backed explanation"}. Maximum three active goals per character.',
   JSON.stringify({character:{name:person.name,title:person.title,company:person.company,kind:person.kind,temperament:person.temperament,agenda:person.agenda,ambition:person.ambition,loyalty:person.loyalty,expertise:person.expertise,personality:person.personality_profile},goals,memories,relationships,tasks,companies,activeGoalLimitReached:activeGoals.length>=3,completedGoalConversations:goalThreads}),
   {json:true,fallback:null,validate:raw=>parseAgendaDecision(raw,allowed)}
  );
  if(!decision)throw Object.assign(Error('Character agenda unavailable'),{code:'AI_AGENDA_UNAVAILABLE'});
  await transaction(async q=>{
   const [lock]=await q("SELECT id FROM character_agenda_jobs WHERE id=$1 AND user_id=$2 AND status='processing' AND attempts=$3 FOR UPDATE",[job.id,userId,job.attempts]);if(!lock)return;
   if(decision.decision==='create'&&activeGoals.length<3){
    const [goal]=await q(`INSERT INTO character_goals(id,user_id,world_id,contact_id,goal_type,title,description,priority,target_contact_id,target_company_id,rationale,source_key)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(user_id,source_key) DO NOTHING RETURNING id`,
     [uid(),userId,job.world_id,person.id,decision.goalType,decision.title,decision.description,decision.priority,decision.targetContactId,decision.targetCompanyId,decision.rationale,'agenda-goal:'+job.id]);
    if(goal){
     await q('INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),userId,job.world_id,person.id,'character-goal-created',person.name+' · '+decision.title,decision.description+' · '+decision.rationale]);
     if(decision.targetContactId){
      await q(`INSERT INTO threads(id,user_id,world_id,contact_id,title,category,summary,status,priority,character_goal_id)
       VALUES($1,$2,$3,$4,$5,'network',$6,'open',$7,$8) ON CONFLICT(user_id,character_goal_id) WHERE character_goal_id IS NOT NULL DO NOTHING`,
       [uid(),userId,job.world_id,person.id,decision.title,decision.description,decision.priority==='high'?'high':'normal',goal.id]);
      await q('INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),userId,job.world_id,person.id,'character-initiative-opened',person.name+' initiated · '+decision.title,'An independent character objective has opened a conversation with a relevant counterpart.']);
     }
    }
   }else if(decision.decision==='pause'){
    await q("UPDATE character_goals SET status='paused',rationale=$1,updated_at=now() WHERE id=$2 AND user_id=$3 AND contact_id=$4 AND status='active'",[decision.rationale,decision.goalId,userId,person.id]);
    await q("UPDATE threads SET status='resolved',updated_at=now() WHERE user_id=$1 AND character_goal_id=$2 AND status='open'",[userId,decision.goalId]);
   }else if(['update','complete'].includes(decision.decision)){
    const [goal]=await q("SELECT id,progress FROM character_goals WHERE id=$1 AND user_id=$2 AND contact_id=$3 AND status='active' FOR UPDATE",[decision.goalId,userId,person.id]);
    const [task]=decision.evidenceTaskId?await q("SELECT id,title,outcome FROM business_tasks WHERE id=$1 AND user_id=$2 AND assignee_id=$3 AND status='completed' AND outcome IS NOT NULL",[decision.evidenceTaskId,userId,person.id]):[null];
    const [goalThread]=decision.evidenceThreadId?await q("SELECT id,title,summary FROM threads WHERE id=$1 AND user_id=$2 AND contact_id=$3 AND character_goal_id=$4 AND status='resolved'",[decision.evidenceThreadId,userId,person.id,decision.goalId]):[null];
    if(goal&&(task||goalThread)){
     const progress=Math.min(100,goal.progress+decision.progressDelta),completed=decision.decision==='complete'&&progress===100;
     const evidence=JSON.stringify([task?{taskId:task.id,taskTitle:task.title,taskOutcome:task.outcome,reason:decision.evidence,recordedAt:new Date().toISOString()}:{threadId:goalThread.id,threadTitle:goalThread.title,conversationSummary:goalThread.summary,reason:decision.evidence,recordedAt:new Date().toISOString()}]);
     await q("UPDATE character_goals SET progress=$1,status=CASE WHEN $2 THEN 'completed' ELSE status END,evidence=evidence||$3::jsonb,rationale=$4,updated_at=now() WHERE id=$5 AND user_id=$6",[progress,completed,evidence,decision.rationale,goal.id,userId]);
     const evidenceTitle=task?.title||goalThread?.title||'Resolved initiative conversation';
     await q('INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),userId,job.world_id,person.id,completed?'character-goal-completed':'character-goal-progress',person.name+' · '+(goals.find(g=>g.id===goal.id)?.title||'Independent goal'),decision.evidence+' · Evidence: '+evidenceTitle]);
     if(completed)await q("UPDATE threads SET status='resolved',updated_at=now() WHERE user_id=$1 AND character_goal_id=$2 AND status='open'",[userId,goal.id]);
     else if(goalThread)await q("UPDATE threads SET status='open',summary=coalesce(summary,'')||' Follow-up: '+$1,updated_at=now() WHERE id=$2 AND user_id=$3",[decision.evidence,goalThread.id,userId]);
    }
   }
   await q("UPDATE character_agenda_jobs SET status='completed',completed_at=now(),last_error_code=NULL WHERE id=$1 AND user_id=$2",[job.id,userId]);
  });
  return true;
 }catch(error){
  const code=String(error.code||error.name||'Error').slice(0,80);
  await sql(`UPDATE character_agenda_jobs SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,
   next_attempt_at=now()+CASE WHEN attempts<=1 THEN interval '10 minutes' WHEN attempts=2 THEN interval '30 minutes' ELSE interval '2 hours' END,
   last_error_code=$3 WHERE id=$1 AND user_id=$2 AND status='processing'`,[job.id,userId,code]);
  throw error;
 }
}
async function reserveRelationshipReview(userId){
 await transaction(async q=>{
  const [world]=await q('SELECT id FROM worlds WHERE user_id=$1 FOR UPDATE',[userId]);if(!world)return;
  const [candidate]=await q(`SELECT c.id conversation_id,m.id message_id
   FROM world_conversations c JOIN LATERAL (SELECT id,created_at FROM world_conversation_messages
    WHERE user_id=c.user_id AND conversation_id=c.id ORDER BY created_at DESC LIMIT 1) m ON true
   WHERE c.user_id=$1 AND c.world_id=$2 AND c.status='open' AND c.last_message_at<=now()-interval '15 minutes'
   AND (SELECT count(*) FROM world_conversation_messages x WHERE x.user_id=c.user_id AND x.conversation_id=c.id)>=4
   AND NOT EXISTS(SELECT 1 FROM character_relationship_review_jobs j WHERE j.user_id=c.user_id AND j.conversation_id=c.id AND j.latest_message_id=m.id)
   ORDER BY c.last_message_at LIMIT 1`,[userId,world.id]);if(!candidate)return;
  await q(`INSERT INTO character_relationship_review_jobs(id,user_id,world_id,conversation_id,latest_message_id,operation_key)
   VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,operation_key) DO NOTHING`,
   [uid(),userId,world.id,candidate.conversation_id,candidate.message_id,'relationship-review:'+candidate.conversation_id+':'+candidate.message_id]);
 });
}
async function reserveMeetingRelationshipReview(userId){
 await transaction(async q=>{
  const [world]=await q('SELECT id FROM worlds WHERE user_id=$1 FOR UPDATE',[userId]);if(!world)return;
  const [meeting]=await q(`SELECT m.id,m.world_id FROM meetings m
   WHERE m.user_id=$1 AND m.world_id=$2 AND m.status='concluded'
   AND EXISTS(SELECT 1 FROM meeting_turns a JOIN meeting_turns b ON b.meeting_id=a.meeting_id AND a.contact_id<b.contact_id
    WHERE a.meeting_id=m.id AND a.contact_id IS NOT NULL AND b.contact_id IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM character_meeting_relationship_jobs j WHERE j.user_id=m.user_id AND j.meeting_id=m.id AND j.from_contact_id=a.contact_id AND j.to_contact_id=b.contact_id))
   ORDER BY m.created_at DESC LIMIT 1`,[userId,world.id]);if(!meeting)return;
  const speakers=await q('SELECT DISTINCT contact_id FROM meeting_turns WHERE user_id=$1 AND meeting_id=$2 AND contact_id IS NOT NULL ORDER BY contact_id',[userId,meeting.id]);
  for(let i=0;i<speakers.length;i++)for(let j=i+1;j<speakers.length;j++){
   const from=speakers[i].contact_id,to=speakers[j].contact_id;
   await q(`INSERT INTO character_meeting_relationship_jobs(id,user_id,world_id,meeting_id,from_contact_id,to_contact_id,operation_key)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id,operation_key) DO NOTHING`,
    [uid(),userId,meeting.world_id,meeting.id,from,to,'meeting-relationship:'+meeting.id+':'+from+':'+to]);
  }
 });
}
async function processMeetingRelationshipReview(userId){
 const [job]=await sql(`WITH due AS (SELECT id FROM character_meeting_relationship_jobs WHERE user_id=$1 AND status IN ('pending','processing')
  AND next_attempt_at<=now() AND (attempted_at IS NULL OR attempted_at<now()-interval '20 minutes') AND attempts<5
  ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
  UPDATE character_meeting_relationship_jobs j SET status='processing',attempts=attempts+1,attempted_at=now() FROM due
  WHERE j.id=due.id RETURNING j.*`,[userId]);if(!job)return false;
 try{
  const [meeting]=await sql("SELECT title FROM meetings WHERE id=$1 AND user_id=$2 AND status='concluded'",[job.meeting_id,userId]);
  const ids=[job.from_contact_id,job.to_contact_id];
  const people=await sql('SELECT id,name,title,company,kind,temperament FROM contacts WHERE user_id=$1 AND world_id=$2 AND id=ANY($3::uuid[])',[userId,job.world_id,ids]);
  const turns=await sql('SELECT speaker,message,contact_id,created_at FROM meeting_turns WHERE user_id=$1 AND meeting_id=$2 AND contact_id=ANY($3::uuid[]) ORDER BY created_at LIMIT 60',[userId,job.meeting_id,ids]);
  if(!meeting||people.length!==2||turns.length<2){
   await sql("UPDATE character_meeting_relationship_jobs SET status='completed',completed_at=now() WHERE id=$1 AND user_id=$2",[job.id,userId]);return true;
  }
  const existing=await sql('SELECT * FROM character_relationships WHERE user_id=$1 AND ((from_contact_id=$2 AND to_contact_id=$3) OR (from_contact_id=$3 AND to_contact_id=$2))',[userId,ids[0],ids[1]]);
  const result=await ask(
   'Review how these two fictional executives interacted in a completed board meeting. Consider only what each person said and did in the supplied meeting transcript. Do not reward mere speaking time, assume friendship, infer hidden motives or treat disagreement as misconduct. Constructive challenge can increase respect even when tension rises. If no meaningful shift is supported, return {"decision":"no-change","reason":"..."}. Otherwise return JSON {decision:"apply",reason:"...",changes:[{direction:"first-to-second",trustDelta:0,respectDelta:0,loyaltyDelta:0,tensionDelta:0,familiarityDelta:0},{direction:"second-to-first",trustDelta:0,respectDelta:0,loyaltyDelta:0,tensionDelta:0,familiarityDelta:0}]}. Deltas are integers -3 to 3; familiarity 0 to 3. No guilt, accusations or invented facts.',
   JSON.stringify({meeting:meeting.title,first:people.find(p=>p.id===ids[0]),second:people.find(p=>p.id===ids[1]),currentRelationships:existing,turns}),
   {json:true,fallback:null,validate:parseRelationshipReview}
  );
  if(!result)throw Object.assign(Error('Meeting relationship review unavailable'),{code:'AI_MEETING_RELATIONSHIP_UNAVAILABLE'});
  await transaction(async q=>{
   const [lock]=await q("SELECT id FROM character_meeting_relationship_jobs WHERE id=$1 AND user_id=$2 AND status='processing' AND attempts=$3 FOR UPDATE",[job.id,userId,job.attempts]);if(!lock)return;
   if(result.decision==='apply')for(const change of result.changes){
    const from=change.direction==='first-to-second'?ids[0]:ids[1],to=change.direction==='first-to-second'?ids[1]:ids[0];
    const [relationship]=await q(`INSERT INTO character_relationships(id,user_id,world_id,from_contact_id,to_contact_id,relationship_label)
     VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,from_contact_id,to_contact_id) DO UPDATE SET updated_at=now() RETURNING *`,
     [uid(),userId,job.world_id,from,to,people.every(p=>p.kind==='internal')?'colleague':people.some(p=>['rival','competitor'].includes(p.kind))?'rival':'professional-counterparty']);
    const before={trust:relationship.trust,respect:relationship.respect,loyalty:relationship.loyalty,tension:relationship.tension,familiarity:relationship.familiarity};
    const delta={trust:change.trustDelta,respect:change.respectDelta,loyalty:change.loyaltyDelta,tension:change.tensionDelta,familiarity:change.familiarityDelta};
    const after={trust:clamp(before.trust+delta.trust),respect:clamp(before.respect+delta.respect),loyalty:clamp(before.loyalty+delta.loyalty),tension:clamp(before.tension+delta.tension),familiarity:clamp(before.familiarity+delta.familiarity)};
    const sourceKey='meeting-relationship:'+job.meeting_id+':'+from;
    const [created]=await q(`INSERT INTO character_relationship_events(id,user_id,world_id,relationship_id,source_key,event_type,reason,delta,before_state,after_state)
     VALUES($1,$2,$3,$4,$5,'board-meeting-review',$6,$7,$8,$9) ON CONFLICT(user_id,source_key) DO NOTHING RETURNING id`,
     [uid(),userId,job.world_id,relationship.id,sourceKey,result.reason,JSON.stringify(delta),JSON.stringify(before),JSON.stringify(after)]);
    if(created)await q('UPDATE character_relationships SET trust=$1,respect=$2,loyalty=$3,tension=$4,familiarity=$5,updated_at=now() WHERE id=$6 AND user_id=$7',[after.trust,after.respect,after.loyalty,after.tension,after.familiarity,relationship.id,userId]);
   }
   await q("UPDATE character_meeting_relationship_jobs SET status='completed',completed_at=now(),last_error_code=NULL WHERE id=$1 AND user_id=$2",[job.id,userId]);
  });
  return true;
 }catch(error){
  const code=String(error.code||error.name||'Error').slice(0,80);
  await sql(`UPDATE character_meeting_relationship_jobs SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,
   next_attempt_at=now()+CASE WHEN attempts<=1 THEN interval '10 minutes' WHEN attempts=2 THEN interval '30 minutes' ELSE interval '2 hours' END,
   last_error_code=$3 WHERE id=$1 AND user_id=$2 AND status='processing'`,[job.id,userId,code]);
  throw error;
 }
}
export async function processCharacterRelationships(userId){
 await reserveRelationshipReview(userId);
 await reserveMeetingRelationshipReview(userId);
 const [job]=await sql(`WITH due AS (SELECT id FROM character_relationship_review_jobs WHERE user_id=$1 AND status IN ('pending','processing')
  AND next_attempt_at<=now() AND (attempted_at IS NULL OR attempted_at<now()-interval '20 minutes') AND attempts<5
  ORDER BY next_attempt_at,created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
  UPDATE character_relationship_review_jobs j SET status='processing',attempts=attempts+1,attempted_at=now() FROM due
  WHERE j.id=due.id RETURNING j.*`,[userId]);if(!job)return processMeetingRelationshipReview(userId);
 try{
  const [latest]=await sql('SELECT sender_contact_id,recipient_contact_id,sender_name,body FROM world_conversation_messages WHERE id=$1 AND user_id=$2 AND conversation_id=$3',[job.latest_message_id,userId,job.conversation_id]);
  const [conversation]=await sql('SELECT title,thread_id FROM world_conversations WHERE id=$1 AND user_id=$2',[job.conversation_id,userId]);
  if(!latest?.sender_contact_id||!latest?.recipient_contact_id){await sql("UPDATE character_relationship_review_jobs SET status='completed',completed_at=now() WHERE id=$1 AND user_id=$2",[job.id,userId]);return true;}
  const ids=[latest.sender_contact_id,latest.recipient_contact_id];
  const people=await sql('SELECT id,name,title,company,kind,temperament,agenda FROM contacts WHERE user_id=$1 AND world_id=$2 AND id=ANY($3::uuid[])',[userId,job.world_id,ids]);
  if(people.length!==2)throw Error('Relationship participants unavailable');
  const history=await sql('SELECT sender_name,body,created_at FROM world_conversation_messages WHERE user_id=$1 AND conversation_id=$2 ORDER BY created_at DESC LIMIT 16',[userId,job.conversation_id]);
  const existing=await sql('SELECT * FROM character_relationships WHERE user_id=$1 AND ((from_contact_id=$2 AND to_contact_id=$3) OR (from_contact_id=$3 AND to_contact_id=$2))',[userId,ids[0],ids[1]]);
  const result=await ask(
   'Assess only the actual interaction between these two fictional people. Do not reward mere message volume, assume friendship, infer motives or treat disagreement as misconduct. Apply small changes only when the conversation contains clear evidence of reliability, candor, cooperation, disrespect, broken commitments or tension. Relationship values are subjective and directional. If there is no meaningful change, return {"decision":"no-change","reason":"..."}. Otherwise return JSON {decision:"apply",reason:"...",changes:[{direction:"first-to-second",trustDelta:0,respectDelta:0,loyaltyDelta:0,tensionDelta:0,familiarityDelta:0},{direction:"second-to-first",trustDelta:0,respectDelta:0,loyaltyDelta:0,tensionDelta:0,familiarityDelta:0}]}. Every delta must be an integer between -3 and 3; familiarityDelta must be 0 to 3. Never infer misconduct or private knowledge.',
   JSON.stringify({conversation:conversation?.title,first:people.find(p=>p.id===ids[0]),second:people.find(p=>p.id===ids[1]),currentRelationships:existing,recentMessages:history.reverse()}),
   {json:true,fallback:null,validate:parseRelationshipReview}
  );
  if(!result)throw Object.assign(Error('Relationship review unavailable'),{code:'AI_RELATIONSHIP_UNAVAILABLE'});
  await transaction(async q=>{
   const [lock]=await q("SELECT id FROM character_relationship_review_jobs WHERE id=$1 AND user_id=$2 AND status='processing' AND attempts=$3 FOR UPDATE",[job.id,userId,job.attempts]);if(!lock)return;
   if(result.decision==='apply'){
    for(const change of result.changes){
     const from=change.direction==='first-to-second'?ids[0]:ids[1],to=change.direction==='first-to-second'?ids[1]:ids[0];
     const [relationship]=await q(`INSERT INTO character_relationships(id,user_id,world_id,from_contact_id,to_contact_id,relationship_label)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,from_contact_id,to_contact_id) DO UPDATE SET updated_at=now() RETURNING *`,[uid(),userId,job.world_id,from,to,people.every(p=>p.kind==='internal')?'colleague':people.some(p=>['rival','competitor'].includes(p.kind))?'rival':'professional-counterparty']);
     const before={trust:relationship.trust,respect:relationship.respect,loyalty:relationship.loyalty,tension:relationship.tension,familiarity:relationship.familiarity};
     const delta={trust:change.trustDelta,respect:change.respectDelta,loyalty:change.loyaltyDelta,tension:change.tensionDelta,familiarity:change.familiarityDelta};
     const after={trust:clamp(before.trust+delta.trust),respect:clamp(before.respect+delta.respect),loyalty:clamp(before.loyalty+delta.loyalty),tension:clamp(before.tension+delta.tension),familiarity:clamp(before.familiarity+delta.familiarity)};
     const sourceKey='relationship:'+job.latest_message_id+':'+from;
     const [inserted]=await q(`INSERT INTO character_relationship_events(id,user_id,world_id,relationship_id,source_key,event_type,reason,delta,before_state,after_state)
      VALUES($1,$2,$3,$4,$5,'conversation-review',$6,$7,$8,$9) ON CONFLICT(user_id,source_key) DO NOTHING RETURNING id`,
      [uid(),userId,job.world_id,relationship.id,sourceKey,result.reason,JSON.stringify(delta),JSON.stringify(before),JSON.stringify(after)]);
     if(inserted)await q('UPDATE character_relationships SET trust=$1,respect=$2,loyalty=$3,tension=$4,familiarity=$5,updated_at=now() WHERE id=$6 AND user_id=$7',[after.trust,after.respect,after.loyalty,after.tension,after.familiarity,relationship.id,userId]);
    }
   }
   await q("UPDATE character_relationship_review_jobs SET status='completed',completed_at=now(),last_error_code=NULL WHERE id=$1 AND user_id=$2",[job.id,userId]);
  });
  return true;
 }catch(error){
  const code=String(error.code||error.name||'Error').slice(0,80);
  await sql(`UPDATE character_relationship_review_jobs SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,
   next_attempt_at=now()+CASE WHEN attempts<=1 THEN interval '10 minutes' WHEN attempts=2 THEN interval '30 minutes' ELSE interval '2 hours' END,
   last_error_code=$3 WHERE id=$1 AND user_id=$2 AND status='processing'`,[job.id,userId,code]);
  throw error;
 }
}
export async function characterContext(userId,contactId){
 const [memories,goals,relationships]=await Promise.all([
  sql("SELECT memory_type,epistemic_status,sensitivity,content,confidence,importance,occurred_at FROM character_memories WHERE user_id=$1 AND contact_id=$2 ORDER BY importance DESC,occurred_at DESC LIMIT 12",[userId,contactId]),
  sql("SELECT goal_type,title,description,priority,status,target_contact_id,target_company_id,progress FROM character_goals WHERE user_id=$1 AND contact_id=$2 AND status IN ('active','paused') ORDER BY priority DESC,updated_at DESC LIMIT 5",[userId,contactId]),
  sql(`SELECT r.relationship_label,r.trust,r.respect,r.loyalty,r.tension,r.familiarity,c.id contact_id,c.name,c.title,c.company
   FROM character_relationships r JOIN contacts c ON c.id=r.to_contact_id AND c.user_id=r.user_id
   WHERE r.user_id=$1 AND r.from_contact_id=$2 ORDER BY r.updated_at DESC LIMIT 12`,[userId,contactId])
 ]);
 return {memories,goals,relationships};
}
export async function characterIntelligenceSnapshot(userId){
 const [memories,goals,relationships,relationshipEvents]=await Promise.all([
  sql(`SELECT * FROM (SELECT m.*,row_number() OVER(PARTITION BY contact_id ORDER BY importance DESC,occurred_at DESC) AS rn
   FROM character_memories m WHERE user_id=$1 AND sensitivity<>'restricted') x WHERE rn<=8 ORDER BY occurred_at DESC LIMIT 240`,[userId]),
  sql('SELECT g.*,c.name AS character_name,t.name AS target_contact_name,co.name AS target_company_name FROM character_goals g JOIN contacts c ON c.id=g.contact_id AND c.user_id=g.user_id LEFT JOIN contacts t ON t.id=g.target_contact_id AND t.user_id=g.user_id LEFT JOIN companies co ON co.id=g.target_company_id AND co.user_id=g.user_id WHERE g.user_id=$1 ORDER BY g.updated_at DESC LIMIT 150',[userId]),
  sql(`SELECT r.*,a.name AS from_name,a.title AS from_title,b.name AS to_name,b.title AS to_title
   FROM character_relationships r JOIN contacts a ON a.id=r.from_contact_id AND a.user_id=r.user_id
   JOIN contacts b ON b.id=r.to_contact_id AND b.user_id=r.user_id WHERE r.user_id=$1 ORDER BY r.updated_at DESC LIMIT 300`,[userId]),
  sql(`SELECT e.*,a.name AS from_name,b.name AS to_name FROM character_relationship_events e
   JOIN character_relationships r ON r.id=e.relationship_id AND r.user_id=e.user_id
   JOIN contacts a ON a.id=r.from_contact_id AND a.user_id=r.user_id JOIN contacts b ON b.id=r.to_contact_id AND b.user_id=r.user_id
   WHERE e.user_id=$1 ORDER BY e.created_at DESC LIMIT 150`,[userId])
 ]);
 return {characterMemories:memories,characterGoals:goals,characterRelationships:relationships,characterRelationshipEvents:relationshipEvents};
}
