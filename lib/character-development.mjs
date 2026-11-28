import {sql,transaction,uid} from '../backend/src/db.mjs';
import {EconomyError} from './economy-rules.mjs';
import {scoreObservations,roleGroup,classifyTask,reviewImpacts,developmentProjection,relationshipProjection,employmentRecommendation,activeObservations} from './character-development-rules.mjs';
const clean=(s,n=1000)=>typeof s==='string'?s.trim().slice(0,n):'';
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const bounded=n=>Math.max(0,Math.min(100,n));
async function insert(q,r){
 const [row]=await q(`INSERT INTO character_consequences(id,user_id,world_id,contact_id,company_id,decision_id,parent_id,observer_id,source_key,source_type,source_id,stage,outcome,role_at_event,reason,evidence,attribution,confidence,impacts,relationship_delta,supersedes_id,occurred_at)
 SELECT $1,c.user_id,c.world_id,c.id,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22
 FROM contacts c WHERE c.id=$4 AND c.user_id=$2 AND c.world_id=$3
 ON CONFLICT(user_id,source_key) DO NOTHING RETURNING *`,[uid(),r.userId,r.worldId,r.contactId,r.companyId||null,r.decisionId||null,r.parentId||null,r.observerId||null,r.key,r.type,r.sourceId,r.stage,r.outcome,r.role,r.reason,JSON.stringify(r.evidence||{}),r.attribution||'none',r.confidence??1,JSON.stringify(r.impacts||{}),JSON.stringify(r.relationshipDelta||{}),r.supersedesId||null,r.occurredAt||new Date()]);
 if(row)return row;
 return (await q('SELECT * FROM character_consequences WHERE user_id=$1 AND world_id=$2 AND source_key=$3',[r.userId,r.worldId,r.key]))[0]||null;
}
async function notify(q,row,title,body){
 // The unique consequence row is the causal ledger; events are emitted only
 // by callers that just created a new observation under the world lock.
 await q('INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),row.user_id,row.world_id,row.contact_id,'character-consequence',title,body]);
}
async function person(q,u,w,id){return (await q('SELECT id,name,title,kind FROM contacts WHERE id=$1 AND user_id=$2 AND world_id=$3',[id,u,w]))[0];}
async function roleAt(q,u,w,id,at,fallback){
 const [r]=await q(`SELECT t.job_title FROM employment_terms t JOIN employment_records e ON e.id=t.employment_id AND e.user_id=t.user_id WHERE e.user_id=$1 AND e.world_id=$2 AND e.contact_id=$3 AND e.hired_at<=$4 AND t.effective_on<=($4::timestamptz AT TIME ZONE 'UTC')::date ORDER BY t.effective_on DESC LIMIT 1`,[u,w,id,at]);
 return r?.job_title||fallback;
}
async function decisionConsequences(q,u,w){
 const rows=await q(`SELECT d.*,c.title actor_title FROM character_decision_records d JOIN contacts c ON c.id=d.contact_id AND c.user_id=d.user_id AND c.world_id=d.world_id
 WHERE d.user_id=$1 AND d.world_id=$2 AND d.status IN ('executed','decided','blocked','failed','awaiting-approval','awaiting-review')
 AND NOT EXISTS(SELECT 1 FROM character_consequences x WHERE x.user_id=d.user_id AND x.source_key='decision:'||d.id||':'||d.status) ORDER BY d.created_at LIMIT 25`,[u,w]);
 for(const d of rows){
  const action=d.decision?.actionType,choice=d.decision?.choice,at=d.completed_at||d.created_at;
  let outcome=d.status,reason='Recorded decision lifecycle state; no performance judgment is inferred.',evidence={decisionId:d.id,choice,action,status:d.status,approvalId:d.approval_id},task=null;
  if(d.status==='executed'){
   if(action==='assign-task'){
    const id=d.result?.taskId||d.result?.execution?.id;
    if(uuid(id))task=(await q('SELECT id,assignee_id,status,company_id,operation_key FROM business_tasks WHERE id=$1 AND user_id=$2 AND world_id=$3',[id,u,w]))[0];
    if(task&&task.assignee_id===d.decision?.payload?.assigneeId&&task.company_id===(d.company_id||null)&&(task.operation_key==='agency:'+d.id||d.approval_id&&task.operation_key==='task:approved:'+d.approval_id)){
     outcome='task-assigned';reason='Verified task assignment created a real operational obligation; completion is tracked separately.';evidence.taskId=task.id;evidence.assigneeId=task.assignee_id;
    }else{task=null;outcome='execution-unverified';reason='Task record could not be reconciled; no achievement inferred.';}
   }else if(action==='expense'){
    const [j]=await q("SELECT id,amount,company_id,debit,credit FROM economy_journal WHERE user_id=$1 AND company_id=$2 AND kind='expense' AND operation_key=ANY($3::text[])",[u,d.company_id,['agency:'+d.id,'manual:approved:'+d.approval_id,'approved:'+d.approval_id,'expense:approved:'+d.approval_id]]);
    if(j){outcome='expense-posted';reason='Verified fictional ledger posting changed company cash and expenses; value or prudence is not inferred.';evidence.journal=j;}
    else{outcome='execution-unverified';reason='Ledger entry could not be reconciled.';}
   }else if(action==='communicate'){
    const id=d.result?.messageId;
    const [m]=uuid(id)?await q("SELECT id FROM messages WHERE id=$1 AND user_id=$2 AND world_id=$3 AND contact_id=$4 UNION ALL SELECT id FROM world_conversation_messages WHERE id=$1 AND user_id=$2 AND world_id=$3 AND sender_contact_id=$4",[id,u,w,d.contact_id]):[];
    outcome=m?'message-delivered-in-app':'execution-unverified';reason=m?'In-app communication is recorded; agreement or commercial success is not inferred.':'Message record could not be reconciled.';if(m)evidence.messageId=m.id;
   }else if(['hire','fire','activate-contract'].includes(action)){
    const [a]=await q("SELECT id,action_type,result,payload FROM action_requests WHERE id=$1 AND user_id=$2 AND world_id=$3 AND status='executed'",[d.approval_id,u,w]);
    let verified=null;
    if(a&&action==='hire'&&uuid(a.result?.id))verified=(await q('SELECT id,contact_id,status FROM employment_records WHERE id=$1 AND user_id=$2 AND world_id=$3 AND company_id=$4 AND operation_key=$5',[a.result.id,u,w,d.company_id,'hire:approved:'+a.id]))[0];
    if(a&&action==='fire'&&uuid(a.payload?.employmentId))verified=(await q("SELECT id,contact_id,status FROM employment_records WHERE id=$1 AND user_id=$2 AND world_id=$3 AND company_id=$4 AND status='terminated'",[a.payload.employmentId,u,w,d.company_id]))[0];
    if(a&&action==='activate-contract'&&uuid(a.payload?.contractId))verified=(await q("SELECT id,status FROM business_contracts WHERE id=$1 AND user_id=$2 AND world_id=$3 AND company_id=$4 AND status<>'draft'",[a.payload.contractId,u,w,d.company_id]))[0];
    outcome=verified?'reserved-action-executed':'execution-unverified';reason=verified?'Verified approved business record changed. Approval and outcome are distinct from the executive’s individual judgment.':'Approved action could not be reconciled to its business record.';if(verified)evidence.businessRecord=verified;
   }
  }else if(d.status==='decided'){outcome=choice||'decided';reason='Independent choice recorded without execution. Dissent, refusal and inaction alone neither improve nor damage loyalty.';}
  const row=await insert(q,{userId:u,worldId:w,contactId:d.contact_id,companyId:d.company_id,decisionId:d.id,key:'decision:'+d.id+':'+d.status,type:'decision',sourceId:d.id,stage:'immediate',outcome,role:await roleAt(q,u,w,d.contact_id,at,d.actor_title),reason,evidence,occurredAt:at});
  if(row&&task)await q('INSERT INTO character_outcome_watches(id,user_id,world_id,decision_id,task_id,parent_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,decision_id,task_id) DO NOTHING',[uid(),u,w,d.id,task.id,row.id]);
 }
}
async function taskConsequences(q,u,w){
 // Independently recorded tasks (including Chairman-assigned tasks) count once,
 // whether or not a decision initiated them. No invented deadline is applied.
 const tasks=await q(`SELECT t.*,p.title role,EXISTS(SELECT 1 FROM documents d WHERE d.id=t.outcome_document_id AND d.user_id=t.user_id AND d.world_id=t.world_id AND d.contact_id=t.assignee_id) document_verified
 FROM business_tasks t JOIN contacts p ON p.id=t.assignee_id AND p.user_id=t.user_id AND p.world_id=t.world_id
 WHERE t.user_id=$1 AND t.world_id=$2 AND t.status IN ('completed','cancelled') AND t.completed_at IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM character_consequences c WHERE c.user_id=t.user_id AND c.source_key='task:'||t.id||':'||t.status)
 ORDER BY t.completed_at LIMIT 30`,[u,w]);
 for(const t of tasks){
  const result=classifyTask(t);if(!result)continue;
  const [watch]=await q('SELECT * FROM character_outcome_watches WHERE user_id=$1 AND world_id=$2 AND task_id=$3 ORDER BY id LIMIT 1',[u,w,t.id]);
  const observer=t.assigned_by_contact_id&&t.assigned_by_contact_id!==t.assignee_id?await person(q,u,w,t.assigned_by_contact_id):null;
  const row=await insert(q,{userId:u,worldId:w,contactId:t.assignee_id,companyId:t.company_id,decisionId:watch?.decision_id,parentId:watch?.parent_id,observerId:observer?.id,key:'task:'+t.id+':'+t.status,type:'business-task',sourceId:t.id,stage:'delayed',role:await roleAt(q,u,w,t.assignee_id,t.completed_at,t.role),evidence:{taskId:t.id,documentId:t.outcome_document_id,taskStatus:t.status,taskType:t.task_type,createdAt:t.created_at,completedAt:t.completed_at},occurredAt:t.completed_at,...result,relationshipDelta:observer&&result.outcome==='report-delivered'?{trust:1,respect:1,familiarity:1}:{}});
  if(observer&&row){
   await insert(q,{userId:u,worldId:w,contactId:observer.id,companyId:t.company_id,decisionId:watch?.decision_id,parentId:row.id,key:'task:'+t.id+':manager:'+t.status,type:'delegation-outcome',sourceId:t.id,stage:'indirect',outcome:'delegated-work-'+t.status,role:await roleAt(q,u,w,observer.id,t.completed_at,observer.title),reason:'A delegated task reached a recorded outcome. Individual management quality is not inferred.',evidence:{taskId:t.id,assigneeId:t.assignee_id,documentId:t.outcome_document_id},occurredAt:t.completed_at});
  }
  if(row&&result.outcome==='report-delivered')await notify(q,row,'Recorded performance outcome',t.title+' — report delivered. Reliability evidence recorded; quality not yet assessed.');
 }
 // Resolve even if task completion was already observed before the decision
 // was reconciled. Link via watch without creating another performance score.
 await q(`UPDATE character_outcome_watches w SET status='resolved',resolved_at=now() FROM business_tasks t WHERE w.user_id=$1 AND w.world_id=$2 AND w.status='pending' AND t.id=w.task_id AND t.user_id=w.user_id AND t.world_id=w.world_id AND t.status IN ('completed','cancelled') AND EXISTS(SELECT 1 FROM character_consequences c WHERE c.user_id=w.user_id AND c.source_key='task:'||t.id||':'||t.status)`,[u,w]);
 await q("UPDATE character_outcome_watches SET next_check_at=now()+interval '30 minutes' WHERE user_id=$1 AND world_id=$2 AND status='pending' AND next_check_at<=now()",[u,w]);
}
async function careerConsequences(q,u,w){
 const rows=await q(`SELECT e.*,p.title contact_title FROM employment_records e JOIN contacts p ON p.id=e.contact_id AND p.user_id=e.user_id AND p.world_id=e.world_id WHERE e.user_id=$1 AND e.world_id=$2 AND (NOT EXISTS(SELECT 1 FROM character_consequences c WHERE c.user_id=e.user_id AND c.source_key='employment:'||e.id||':hire') OR (e.status='terminated' AND NOT EXISTS(SELECT 1 FROM character_consequences c WHERE c.user_id=e.user_id AND c.source_key='employment:'||e.id||':separation'))) ORDER BY e.hired_at LIMIT 25`,[u,w]);
 for(const e of rows){
  const [term]=await q('SELECT job_title FROM employment_terms WHERE user_id=$1 AND employment_id=$2 ORDER BY effective_on LIMIT 1',[u,e.id]);
  await insert(q,{userId:u,worldId:w,contactId:e.contact_id,companyId:e.company_id,key:'employment:'+e.id+':hire',type:'employment',sourceId:e.id,stage:'career',outcome:'appointed',role:term?.job_title||e.job_title,reason:'Employment record established; no competence score is assigned at hiring.',evidence:{employmentId:e.id,salaryBasis:e.salary_basis},occurredAt:e.hired_at});
  if(e.status==='terminated'&&e.terminated_at)await insert(q,{userId:u,worldId:w,contactId:e.contact_id,companyId:e.company_id,key:'employment:'+e.id+':separation',type:'employment',sourceId:e.id,stage:'career',outcome:e.separation_type==='resignation'?'resigned':'employment-ended',role:e.job_title,reason:'Employment ended; character identity and evidence history are retained. Separation alone is not misconduct.',evidence:{employmentId:e.id,separationType:e.separation_type},occurredAt:e.terminated_at});
 }
 const terms=await q(`SELECT t.*,e.contact_id,e.company_id FROM employment_terms t JOIN employment_records e ON e.id=t.employment_id AND e.user_id=t.user_id WHERE t.user_id=$1 AND e.world_id=$2 AND t.effective_on<=(now() AT TIME ZONE 'UTC')::date AND EXISTS(SELECT 1 FROM employment_terms b WHERE b.employment_id=t.employment_id AND b.user_id=t.user_id AND b.effective_on<t.effective_on) AND NOT EXISTS(SELECT 1 FROM character_consequences c WHERE c.user_id=t.user_id AND c.source_key='employment-term:'||t.id) ORDER BY t.effective_on LIMIT 25`,[u,w]);
 for(const t of terms)await insert(q,{userId:u,worldId:w,contactId:t.contact_id,companyId:t.company_id,key:'employment-term:'+t.id,type:'employment-term',sourceId:t.id,stage:'career',outcome:'role-or-terms-changed',role:t.job_title,reason:'Approved employment terms became effective; historical assessments retain their original role.',evidence:{employmentId:t.employment_id,termId:t.id,effectiveOn:t.effective_on},occurredAt:new Date(t.effective_on)});
}
export async function processCharacterConsequences(userId){
 return transaction(async q=>{
  const [world]=await q('SELECT id FROM worlds WHERE user_id=$1 FOR UPDATE',[userId]);if(!world)return;
  await decisionConsequences(q,userId,world.id);await taskConsequences(q,userId,world.id);await careerConsequences(q,userId,world.id);
 });
}
export async function recordCharacterAssessment(user,contactId,body){
 const kind=body.kind,finding=body.finding,attribution=body.attribution,reason=clean(body.reason,1800),sourceId=body.sourceId,confidence=Number(body.confidence);
 const allowed={judgment:['sound','unsound','uncertain'],conduct:['substantiated','unsubstantiated','exemplary','uncertain'],performance:['strong','deficient','uncertain']};
 if(!allowed[kind]?.includes(finding)||!['direct','shared','external','uncertain'].includes(attribution)||!uuid(contactId)||!uuid(sourceId)||!reason||!Number.isFinite(confidence)||confidence<0||confidence>1)throw new EconomyError('Select a supported assessment, evidence, attribution and confidence; explain the finding.');
 if(body.observerId)throw new EconomyError('Chairman assessments cannot impersonate another observer.');
 return transaction(async q=>{
  const [w]=await q('SELECT id FROM worlds WHERE user_id=$1 FOR UPDATE',[user.id]);if(!w)throw new EconomyError('World unavailable.',404);
  const actor=await person(q,user.id,w.id,contactId);if(!actor)throw new EconomyError('Character unavailable.',404);
  let evidence,companyId=null,decisionId=null,at=new Date(),parentId=null;
  if(kind==='judgment'){
   const [d]=await q("SELECT id,company_id,contact_id,evidence,decision,decision_context,status,created_at FROM character_decision_records WHERE id=$1 AND user_id=$2 AND world_id=$3 AND contact_id=$4 AND decision IS NOT NULL",[sourceId,user.id,w.id,contactId]);
   if(!d||!d.decision_context||!clean(body.knownAtDecision,1800))throw new EconomyError('Review requires a recorded decision context and an explanation of what was reasonably knowable then.');
   evidence={decisionId:d.id,knownAtDecision:clean(body.knownAtDecision,1800),recordedContext:d.decision_context,originalEvidence:d.evidence,originalDecision:d.decision};companyId=d.company_id;decisionId=d.id;at=d.created_at;
  }else if(kind==='performance'||finding==='exemplary'){
   const [s]=await q("SELECT * FROM character_consequences WHERE id=$1 AND user_id=$2 AND world_id=$3 AND contact_id=$4 AND stage IN ('immediate','delayed','indirect')",[sourceId,user.id,w.id,contactId]);
   if(!s||['execution-unverified','completion-unverified','pending','failed','blocked','awaiting-approval','awaiting-review'].includes(s.outcome))throw new EconomyError('Select a verified outcome and document the conduct or quality actually observed.');
   evidence={consequenceId:s.id,source:s.evidence,reviewedOutcome:s.outcome};companyId=s.company_id;decisionId=s.decision_id;parentId=s.id;at=s.occurred_at;
  }else{
   const [c]=await q("SELECT * FROM investigation_cases WHERE id=$1 AND user_id=$2 AND world_id=$3 AND status IN ('substantiated','unsubstantiated','closed')",[sourceId,user.id,w.id]);
   if(!c||!c.finding||finding==='substantiated'&&c.status!=='substantiated'||finding==='unsubstantiated'&&c.status!=='unsubstantiated')throw new EconomyError('Conduct review requires a resolved investigation matching the finding.');
   const refs=Array.isArray(body.evidenceIds)?[...new Set(body.evidenceIds)]:[];
   if(!refs.length||refs.length>20||refs.some(x=>!uuid(x)))throw new EconomyError('Select supporting investigation evidence.');
   const rows=await q('SELECT id,description,source_reference,confidence FROM investigation_evidence WHERE user_id=$1 AND case_id=$2 AND id=ANY($3::uuid[])',[user.id,c.id,refs]);
   if(rows.length!==refs.length||!clean(body.subjectLink,1800))throw new EconomyError('Explain how the evidence establishes the selected character’s responsibility.');
   if(finding==='substantiated'&&!rows.some(r=>Number(r.confidence)>=.7&&r.source_reference))throw new EconomyError('Substantiated conduct requires referenced evidence with at least 0.7 recorded confidence.');
   evidence={investigationId:c.id,status:c.status,finding:c.finding,evidence:rows,subjectLink:clean(body.subjectLink,1800)};companyId=c.company_id;at=c.updated_at;
  }
  // One assessment per subject, source and category; amendments must use an
  // append-only correction so a repeated click cannot inflate performance.
  const baseKey='assessment:'+contactId+':'+kind+':'+sourceId;
  const [old]=await q("SELECT id FROM character_consequences WHERE user_id=$1 AND source_key=$2",[user.id,baseKey]);if(old)throw new EconomyError('This source has already been assessed. Use a correction.',409);
  const row=await insert(q,{userId:user.id,worldId:w.id,contactId,companyId,decisionId,parentId,key:baseKey,type:'chairman-assessment',sourceId,stage:'review',outcome:kind+':'+finding,role:await roleAt(q,user.id,w.id,contactId,at,actor.title),reason,evidence:{...evidence,reviewer:'Chairman',category:kind,finding},attribution,confidence,impacts:reviewImpacts(kind,finding,attribution),occurredAt:at});
  await notify(q,row,'Character assessment recorded',actor.name+' · '+kind+' review. '+reason);
  return row;
 });
}
export async function withdrawCharacterAssessment(user,id,body){
 const reason=clean(body.reason,1800);if(!uuid(id)||!reason)throw new EconomyError('Provide the reason for the correction.');
 return transaction(async q=>{
  const [w]=await q('SELECT id FROM worlds WHERE user_id=$1 FOR UPDATE',[user.id]);if(!w)throw new EconomyError('World unavailable.',404);
  const [old]=await q("SELECT * FROM character_consequences WHERE id=$1 AND user_id=$2 AND world_id=$3 AND source_type='chairman-assessment' AND outcome<>'withdrawn' FOR UPDATE",[id,user.id,w.id]);
  if(!old)throw new EconomyError('Assessment unavailable.',404);
  const row=await insert(q,{userId:user.id,worldId:w.id,contactId:old.contact_id,companyId:old.company_id,decisionId:old.decision_id,parentId:old.id,key:'withdraw:'+id,type:'assessment-correction',sourceId:id,stage:'review',outcome:'withdrawn',role:old.role_at_event,reason,evidence:{withdrawnAssessmentId:id},supersedesId:id,occurredAt:new Date()});
  return row;
 });
}
export async function ownDevelopment(userId,contactId,q=sql){
 const rows=await q("SELECT * FROM character_consequences WHERE user_id=$1 AND contact_id=$2 AND (stage='delayed' OR source_type='chairman-assessment' OR source_type='assessment-correction') ORDER BY occurred_at DESC,id DESC",[userId,contactId]);
 return developmentProjection(rows);
}
export async function evolvedRelationships(userId,observerId,relationships,q=sql){
 const rows=await q('SELECT * FROM character_consequences WHERE user_id=$1 AND observer_id=$2 ORDER BY occurred_at DESC,id DESC',[userId,observerId]);
 const result=relationships.map(r=>({...r}));
 const ids=[...new Set(rows.map(r=>r.contact_id))];
 for(const id of ids){
  const delta=relationshipProjection(rows.filter(r=>r.contact_id===id),observerId);if(!Object.keys(delta).length)continue;
  let r=result.find(r=>r.contact_id===id);
  if(!r){const [p]=await q('SELECT id contact_id,name,title,company FROM contacts WHERE user_id=$1 AND id=$2',[userId,id]);if(!p)continue;r={...p,relationship_label:'professional',trust:50,respect:50,loyalty:45,tension:10,familiarity:5};result.push(r);}
  for(const [k,v] of Object.entries(delta))r[k]=bounded((r[k]??50)+v);
  r.outcomeInfluence=delta;
 }
 return result.slice(0,20);
}
export async function characterDevelopmentSnapshot(userId){
 const [people,rows,relationships]=await Promise.all([sql('SELECT id,name,title,kind FROM contacts WHERE user_id=$1 ORDER BY name',[userId]),sql('SELECT * FROM character_consequences WHERE user_id=$1 ORDER BY occurred_at DESC,id DESC',[userId]),sql('SELECT from_contact_id,to_contact_id,trust,respect,loyalty,tension FROM character_relationships WHERE user_id=$1',[userId])]);
 const now=Date.now(),scores=people.map(p=>{
  const observations=rows.filter(r=>r.contact_id===p.id),active=activeObservations(observations);
  // Current-role ranking excludes observations belonging to a different role family;
  // the full career record is retained separately.
  const current=observations.filter(r=>roleGroup(r.role_at_event)===roleGroup(p.title)||r.supersedes_id);
  const score=scoreObservations(current,p.title,{now});
  const previous=scoreObservations(current.filter(r=>Date.parse(r.created_at)<=now-30*86400000),p.title,{now:now-30*86400000});
  const audiences=relationships.filter(r=>r.to_contact_id===p.id).map(r=>{const observer=people.find(x=>x.id===r.from_contact_id);const d=relationshipProjection(observations,r.from_contact_id);return {observerId:r.from_contact_id,observerName:observer?.name||'Character',audience:observer?.kind==='internal'?'internal':'external',trust:bounded(r.trust+(d.trust||0)),respect:bounded(r.respect+(d.respect||0)),loyalty:bounded(r.loyalty+(d.loyalty||0)),tension:bounded(r.tension+(d.tension||0)),evidenceCount:active.filter(x=>x.observer_id===r.from_contact_id).length};});
  for(const id of [...new Set(active.map(x=>x.observer_id).filter(Boolean))])if(!audiences.some(a=>a.observerId===id)){const observer=people.find(x=>x.id===id),d=relationshipProjection(observations,id);audiences.push({observerId:id,observerName:observer?.name||'Character',audience:observer?.kind==='internal'?'internal':'external',trust:bounded(50+(d.trust||0)),respect:bounded(50+(d.respect||0)),loyalty:bounded(45+(d.loyalty||0)),tension:bounded(10+(d.tension||0)),evidenceCount:active.filter(x=>x.observer_id===id).length});}
  return {...p,...score,previousScore:previous.score,rank:null,recommendation:p.kind==='former-employee'?{action:'former-employee',reason:'Historical record retained; not eligible for active staff ranking.'}:employmentRecommendation(score),audiences,development:developmentProjection(observations),recentEvidence:active.slice(0,12).map(r=>({id:r.id,stage:r.stage,outcome:r.outcome,reason:r.reason,sourceType:r.source_type,sourceId:r.source_id,confidence:r.confidence,attribution:r.attribution,occurredAt:r.occurred_at,impacts:r.impacts}))};
 });
 for(const group of new Set(scores.map(s=>s.roleGroup))){
  const peers=scores.filter(s=>s.kind==='internal'&&s.rankEligible&&s.roleGroup===group).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));peers.forEach((p,i)=>{p.rank=i&&p.score===peers[i-1].score?peers[i-1].rank:i+1;});
 }
 return {characterPerformance:scores,characterConsequences:rows.slice(0,200).map(({evidence,...r})=>({...r,evidenceReference:{sourceType:r.source_type,sourceId:r.source_id,parentId:r.parent_id,decisionId:r.decision_id}}))};
}
