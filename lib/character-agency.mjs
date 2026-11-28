
import {sql,transaction,uid} from '../backend/src/db.mjs';
import {ask} from '../backend/src/ai.mjs';
import {characterContext,enqueueCharacterMemory} from './character-intelligence.mjs';
import {INFLUENCE_RULES} from './character-psychology-rules.mjs';
import {realWorldDecisionContext} from './real-world-context.mjs';
import {DECISION_RULES,parseAgencyDecision,authorityFor} from './character-agency-rules.mjs';
import {EconomyError,amountString} from './economy-rules.mjs';
import {recordSystemExpense} from './economy.mjs';
import {validateActionPayload} from './action-requests.mjs';
const clean=(v,n=700)=>typeof v==='string'?v.trim().slice(0,n):'';
const validId=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const fields='id,name,title,company,kind';
const systemPrompt=DECISION_RULES+' '+INFLUENCE_RULES+' JSON shape: {choice:"act|refuse|disagree|negotiate|delegate|investigate|consult|escalate|defer|inaction",actionType:"assign-task|expense|hire|fire|activate-contract|communicate|none",title:"",reason:"",uncertainty:"",evidenceIds:[],payload:{}}. For nonbinding communication use payload {recipientId,body}; chairman is a valid recipient. For assign-task use {companyId,assigneeId,taskType,detail}. For expense use {companyId,amount,description}. For hire use {companyId,name,title,salary}; for fire {companyId,employmentId}; for contract {companyId,contractId}. Never propose spending, hiring, termination or contract activation solely from a scheduled goal; a concrete explicit instruction is required. Exception: a business-event with approvalAllowed may propose activation of the exact reviewed draft contract, requiring Chairman approval. For a business-event review use the supplied task_type and company_id (null for a permitted group-wide self-review). Do not create a second review when approvalAllowed is true. Never claim a task is completed just because you assigned it. Use inaction rather than filler.';
async function event(q,row,actor,kind,title,body){
 await q('INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),row.user_id,row.world_id,actor.id,kind,title,body]);
}
async function audit(q,row,actor,action,after,reason){
 await q('INSERT INTO world_audit_log(id,user_id,world_id,actor_type,actor_id,actor_name,action,entity_type,entity_id,after_state,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[uid(),row.user_id,row.world_id,'executive',actor.id,actor.name,action,'character-decision',row.id,JSON.stringify(after),reason]);
}
export async function setAuthorityGrant(user,contactId,body){
 if(!validId(contactId)||!validId(body.companyId)||!['assign-task','expense'].includes(body.actionType)||!['delegated','chairman','prohibited','coapproval'].includes(body.mode)||!clean(body.reason))throw new EconomyError('Invalid delegation or missing reason.');
 let per=null,daily=null,reviewer=null;
 if(body.actionType==='expense'&&['delegated','coapproval'].includes(body.mode)){
  per=amountString(body.perActionLimit);daily=amountString(body.dailyLimit);
  if(Number(daily)<Number(per))throw new EconomyError('Daily limit must cover the per-action limit.');
 }
 if(body.mode==='coapproval'){reviewer=body.reviewerId;if(!validId(reviewer)||reviewer===contactId)throw new EconomyError('Select a different independent reviewer.');}
 return transaction(async q=>{
  const [world]=await q('SELECT id FROM worlds WHERE user_id=$1 FOR UPDATE',[user.id]);if(!world)throw new EconomyError('World unavailable.',404);
  const [actor]=await q("SELECT id FROM contacts WHERE user_id=$1 AND world_id=$2 AND id=$3 AND kind='internal'",[user.id,world.id,contactId]);
  const [company]=await q('SELECT id FROM companies WHERE user_id=$1 AND world_id=$2 AND id=$3 AND disposed_at IS NULL',[user.id,world.id,body.companyId]);
  if(!actor||!company)throw new EconomyError('Actor or company unavailable.',404);
  if(reviewer){const [r]=await q("SELECT id FROM contacts WHERE user_id=$1 AND world_id=$2 AND id=$3 AND kind='internal'",[user.id,world.id,reviewer]);if(!r)throw new EconomyError('Reviewer unavailable.',404);}
  const [grant]=await q(`INSERT INTO character_authority_grants(id,user_id,world_id,contact_id,company_id,action_type,mode,reviewer_id,per_action_limit,daily_limit,reason)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(user_id,contact_id,company_id,action_type) DO UPDATE SET mode=excluded.mode,reviewer_id=excluded.reviewer_id,per_action_limit=excluded.per_action_limit,daily_limit=excluded.daily_limit,reason=excluded.reason,updated_at=now() RETURNING *`,[uid(),user.id,world.id,contactId,body.companyId,body.actionType,body.mode,reviewer,per,daily,clean(body.reason)]);
  await q('INSERT INTO world_audit_log(id,user_id,world_id,actor_type,actor_name,action,entity_type,entity_id,after_state,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[uid(),user.id,world.id,'chairman',user.name,'authority.changed','authority-grant',grant.id,JSON.stringify(grant),grant.reason]);
  return grant;
 });
}
export async function enqueueAgencyDecision(q,{userId,worldId,contactId,companyId=null,sourceType,sourceId,evidence}){
 if(!['chairman-message','goal-review','assigned-task','business-event'].includes(sourceType)||!sourceId||!evidence)return null;
 const key=sourceType+':'+sourceId+':'+contactId;
 const [row]=await q(`INSERT INTO character_decision_records(id,user_id,world_id,contact_id,company_id,source_type,source_id,operation_key,evidence)
 SELECT $1,c.user_id,c.world_id,c.id,$5,$6,$7,$8,$9 FROM contacts c JOIN worlds w ON w.id=c.world_id AND w.user_id=c.user_id WHERE c.id=$2 AND c.user_id=$3 AND c.world_id=$4 AND ($5::uuid IS NULL OR EXISTS(SELECT 1 FROM companies co WHERE co.id=$5 AND co.user_id=c.user_id AND co.world_id=c.world_id AND co.disposed_at IS NULL))
 ON CONFLICT(user_id,operation_key) DO NOTHING RETURNING *`,[uid(),contactId,userId,worldId,companyId,sourceType,String(sourceId),key,JSON.stringify(evidence)]);
 if(row)return row;
 return (await q('SELECT * FROM character_decision_records WHERE user_id=$1 AND world_id=$2 AND contact_id=$3 AND operation_key=$4',[userId,worldId,contactId,key]))[0]||null;
}
async function loadScope(row){
 const [actor]=await sql('SELECT '+fields+' FROM contacts WHERE user_id=$1 AND world_id=$2 AND id=$3',[row.user_id,row.world_id,row.contact_id]);
 if(!actor)throw new EconomyError('Actor unavailable.',404);
 const contacts=await sql('SELECT '+fields+' FROM contacts WHERE user_id=$1 AND world_id=$2 ORDER BY id LIMIT 100',[row.user_id,row.world_id]);
 const companies=actor.kind==='internal'?await sql('SELECT id,name,sector FROM companies WHERE user_id=$1 AND world_id=$2 AND disposed_at IS NULL AND ($3::uuid IS NULL OR id=$3) ORDER BY id',[row.user_id,row.world_id,row.company_id]):[];
 const companyIds=companies.map(c=>c.id);
 const employees=actor.kind==='internal'&&row.source_type==='chairman-message'?await sql("SELECT id,company_id,contact_id,job_title FROM employment_records WHERE user_id=$1 AND world_id=$2 AND status='active' AND company_id=ANY($3::uuid[]) LIMIT 100",[row.user_id,row.world_id,companyIds]):[];
 const contracts=actor.kind==='internal'&&(row.source_type==='chairman-message'||row.source_type==='business-event'&&row.evidence.approvalAllowed)?await sql("SELECT id,company_id,title,status FROM business_contracts WHERE user_id=$1 AND world_id=$2 AND status='draft' AND company_id=ANY($3::uuid[]) LIMIT 100",[row.user_id,row.world_id,companyIds]):[];
 const grants=await sql('SELECT company_id,action_type,mode,per_action_limit,daily_limit,reviewer_id FROM character_authority_grants WHERE user_id=$1 AND world_id=$2 AND contact_id=$3',[row.user_id,row.world_id,row.contact_id]);
 const evidenceIds=[row.source_id];
 return {actor,contacts,companies,employees,contracts,grants,validation:{actorId:actor.id,contactIds:contacts.map(c=>c.id),contacts,companyIds,employees,contracts,evidenceIds,requestedAction:row.evidence?.requestedAction||null,businessEvent:row.source_type==='business-event'?row.evidence:null,allowGroupReview:row.source_type==='business-event'&&!row.company_id}};
}
async function finish(q,row,actor,status,decision,authority,result,approvalId=null,reviewerId=null){
 const [updated]=await q('UPDATE character_decision_records SET status=$3,decision=$4,authority=$5,result=$6,approval_id=$7,reviewer_id=$8,last_error=NULL,completed_at=CASE WHEN $3 IN (\'awaiting-review\',\'awaiting-approval\') THEN NULL ELSE now() END WHERE id=$1 AND user_id=$2 RETURNING *',[row.id,row.user_id,status,JSON.stringify(decision),JSON.stringify(authority),JSON.stringify(result),approvalId,reviewerId]);
 await audit(q,row,actor,'agency.'+status,{decision,authority,result,approvalId},decision.reason);
 if(decision.choice!=='inaction'&&decision.choice!=='defer')await event(q,row,actor,status==='awaiting-approval'?'approval-requested':'character-decision',decision.title,actor.name+': '+decision.reason+' — '+status.replaceAll('-',' ')+'.');
 return updated;
}
async function communicate(q,row,actor,decision){
 const p=decision.payload;
 const body=decision.choice==='negotiate'?'Nonbinding proposal: '+p.body:p.body;
 if(p.recipientId==='chairman'){
  const id=uid();
  await q("INSERT INTO messages(id,user_id,world_id,contact_id,direction,channel,body) VALUES($1,$2,$3,$4,'incoming','chat',$5)",[id,row.user_id,row.world_id,actor.id,body]);
  await event(q,row,actor,'executive-message-received','Message from '+actor.name,body.slice(0,500));
  await enqueueCharacterMemory(q,{userId:row.user_id,worldId:row.world_id,contactId:actor.id,sourceType:'agency-message',sourceId:id,context:{message:body,recipient:'Chairman'}});
  return {messageId:id};
 }
 const [recipient]=await q('SELECT '+fields+' FROM contacts WHERE id=$1 AND user_id=$2 AND world_id=$3',[p.recipientId,row.user_id,row.world_id]);if(!recipient||recipient.id===actor.id)throw new EconomyError('Recipient unavailable.',404);
 const threadId=uid(),conversationId=uid(),messageId=uid();
 await q("INSERT INTO threads(id,user_id,world_id,contact_id,title,category,summary,status,priority) VALUES($1,$2,$3,$4,$5,'business',$6,'open','normal')",[threadId,row.user_id,row.world_id,actor.id,decision.title,body]);
 await q('INSERT INTO world_conversations(id,user_id,world_id,thread_id,title,last_message_at) VALUES($1,$2,$3,$4,$5,now())',[conversationId,row.user_id,row.world_id,threadId,decision.title]);
 for(const c of [actor,recipient])await q('INSERT INTO world_conversation_participants(user_id,conversation_id,contact_id) VALUES($1,$2,$3)',[row.user_id,conversationId,c.id]);
 await q("INSERT INTO world_conversation_messages(id,user_id,world_id,conversation_id,sender_contact_id,recipient_contact_id,sender_name,body,channel) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'text')",[messageId,row.user_id,row.world_id,conversationId,actor.id,recipient.id,actor.name,body]);
 for(const c of [actor,recipient])await enqueueCharacterMemory(q,{userId:row.user_id,worldId:row.world_id,contactId:c.id,sourceType:'agency-message',sourceId:messageId,context:{message:body,sender:actor.name,recipient:recipient.name,conversationId}});
 return {conversationId,messageId,threadId,nonbinding:true};
}
async function evidenceStillValid(q,row){
 if(row.source_type==='business-event'){
  const e=row.evidence,id=e.source_id,params=[id,row.user_id,row.world_id];
  if(!validId(id))return false;
  const queries={
   'overdue-invoice':"SELECT id FROM business_invoices WHERE id=$1 AND user_id=$2 AND world_id=$3 AND status='issued' AND due_at<now()",
   'overdue-loan-installment':"SELECT i.id FROM company_loan_installments i JOIN company_loans l ON l.id=i.loan_id AND l.user_id=i.user_id WHERE i.id=$1 AND i.user_id=$2 AND l.world_id=$3 AND l.status='disbursed' AND i.due_date<(now() AT TIME ZONE 'UTC')::date AND (i.principal_paid<i.principal_due OR i.interest_paid<i.interest_due)",
   'open-investigation':"SELECT id FROM investigation_cases WHERE id=$1 AND user_id=$2 AND world_id=$3 AND status IN ('open','in-review')",
   'draft-contract':"SELECT id FROM business_contracts WHERE id=$1 AND user_id=$2 AND world_id=$3 AND status='draft'",
   'reviewed-contract':"SELECT id FROM business_contracts WHERE id=$1 AND user_id=$2 AND world_id=$3 AND status='draft'",
   'periodic-financial-review':"SELECT id FROM companies WHERE id=$1 AND user_id=$2 AND world_id=$3 AND disposed_at IS NULL",
   'periodic-employee-review':"SELECT id FROM companies WHERE id=$1 AND user_id=$2 AND world_id=$3 AND disposed_at IS NULL"
  };
  return !!queries[e.source_type]&&!!(await q(queries[e.source_type],params))[0];
 }
 // Scheduled reflection records the original evidence; check the source
 // again at execution to avoid working on completed or cancelled matters.
 const id=String(row.source_id).split(':')[0];
 if(row.source_type==='assigned-task'&&validId(id))return !!(await q("SELECT id FROM business_tasks WHERE id=$1 AND user_id=$2 AND world_id=$3 AND assignee_id=$4 AND status='assigned'",[id,row.user_id,row.world_id,row.contact_id]))[0];
 if(row.source_type==='goal-review'&&row.source_id.includes(':')&&validId(id))return !!(await q("SELECT id FROM character_goals WHERE id=$1 AND user_id=$2 AND world_id=$3 AND contact_id=$4 AND status='active'",[id,row.user_id,row.world_id,row.contact_id]))[0];
 return true;
}
export async function executeAgencyDecision(q,row,decision,{reviewed=false}={}){
 // Lock ordering: world then decision then grants/company. The same transaction owns all state changes.
 const [world]=await q('SELECT id FROM worlds WHERE user_id=$1 AND id=$2 FOR UPDATE',[row.user_id,row.world_id]);if(!world)return null;
 const [current]=await q('SELECT * FROM character_decision_records WHERE user_id=$1 AND id=$2 FOR UPDATE',[row.user_id,row.id]);
 if(!current||current.status!==(reviewed?'awaiting-review':'processing')||current.attempts!==row.attempts)return current||null;
 row=current;
 const [actor]=await q('SELECT '+fields+' FROM contacts WHERE user_id=$1 AND world_id=$2 AND id=$3 FOR SHARE',[row.user_id,row.world_id,row.contact_id]);
 if(!actor)throw new EconomyError('Actor unavailable.',404);
 const p=decision.payload,a=decision.actionType;
 if(row.source_type==='chairman-message'&&!['none','communicate'].includes(a)&&(!row.evidence?.requestedAction||row.evidence.requestedAction.actionType!==a))return finish(q,row,actor,'blocked',decision,{mode:'prohibited',reason:'No matching explicit instruction'},{});
 if(a==='none')return finish(q,row,actor,'decided',decision,{mode:'none'},{});
 if(!await evidenceStillValid(q,row))return finish(q,row,actor,'blocked',decision,{mode:'prohibited',reason:'Trigger evidence is no longer actionable'},{});
 if(a==='communicate')return finish(q,row,actor,'executed',decision,{mode:'delegated'},await communicate(q,row,actor,decision));
 const groupReview=a==='assign-task'&&p.companyId==null&&row.source_type==='business-event'&&!row.company_id&&p.assigneeId===actor.id&&['investigation-review','employee-review','meeting-preparation','prepare-briefing'].includes(p.taskType);
 const [company]=groupReview?[]:await q('SELECT * FROM companies WHERE user_id=$1 AND world_id=$2 AND id=$3 AND disposed_at IS NULL FOR UPDATE',[row.user_id,row.world_id,p.companyId]);
 if(!groupReview&&(!company||row.company_id&&row.company_id!==company.id))return finish(q,row,actor,'blocked',decision,{mode:'prohibited',reason:'Company scope invalid'},{});
 if(row.source_type!=='chairman-message'&&a!=='assign-task'&&!(a==='activate-contract'&&row.source_type==='business-event'&&row.evidence.approvalAllowed))return finish(q,row,actor,'blocked',decision,{mode:'prohibited',reason:'Scheduled work cannot invent a financial or reserved commitment'},{});
 const [grant]=groupReview?[]:await q('SELECT * FROM character_authority_grants WHERE user_id=$1 AND world_id=$2 AND contact_id=$3 AND company_id=$4 AND action_type=$5 FOR UPDATE',[row.user_id,row.world_id,actor.id,company.id,a]);
 const [reviewer]=grant?.reviewer_id?await q('SELECT '+fields+' FROM contacts WHERE user_id=$1 AND world_id=$2 AND id=$3',[row.user_id,row.world_id,grant.reviewer_id]):[];
 const [spend]=await q("SELECT coalesce(sum((decision->'payload'->>'amount')::numeric),0)::text amount FROM character_decision_records WHERE user_id=$1 AND contact_id=$2 AND company_id=$3 AND status='executed' AND decision->>'actionType'='expense' AND authority->>'mode'='delegated' AND completed_at>=date_trunc('day',now(),'UTC')",[row.user_id,actor.id,company?.id||null]);
 const conflict=a==='fire'&&!!(await q('SELECT id FROM employment_records WHERE id=$1 AND user_id=$2 AND contact_id=$3',[p.employmentId,row.user_id,actor.id]))[0];
 let authority=authorityFor({actor,decision,grant,spent:spend.amount,reviewer,conflict});
 if(authority.mode==='prohibited')return finish(q,row,actor,'blocked',decision,authority,{});
 if(actor.kind!=='internal')return finish(q,row,actor,'blocked',decision,{mode:'prohibited',reason:'Internal role required'},{});
 if(row.source_type==='business-event'&&a==='activate-contract'){
  if(actor.title!=='General Counsel'||row.evidence.source_type!=='reviewed-contract'||p.contractId!==row.evidence.source_id)return finish(q,row,actor,'blocked',decision,{mode:'prohibited',reason:'Reviewed contract scope changed'},{});
  const [review]=await q("SELECT t.id FROM business_tasks t JOIN documents d ON d.id=t.outcome_document_id AND d.user_id=t.user_id WHERE t.id=$1 AND t.user_id=$2 AND t.world_id=$3 AND t.company_id=$4 AND t.status='completed' AND t.task_type='contract-review' AND t.source_evidence->>'source_id'=$5",[row.evidence.facts?.review_task_id,row.user_id,row.world_id,company.id,p.contractId]);
  const [prior]=await q("SELECT id FROM action_requests WHERE user_id=$1 AND action_type='activate-contract' AND payload->>'contractId'=$2 AND status NOT IN ('rejected','failed')",[row.user_id,p.contractId]);
  if(!review||prior)return finish(q,row,actor,'blocked',decision,{mode:'prohibited',reason:prior?'An approval already exists':'Legal review no longer available'},{});
 }
 const validated=groupReview?{...p}:await validateActionPayload(q,{id:row.user_id},a,{...p});
 if(groupReview&&authority.mode!=='delegated')return finish(q,row,actor,'blocked',decision,{mode:'prohibited',reason:'Only routine self-review permitted without company scope'},{});
 if((validated.companyId||null)!==(company?.id||null))throw new EconomyError('Action company mismatch.',403);
 if(authority.mode==='coapproval'){
  await q('UPDATE character_decision_records SET company_id=$3 WHERE id=$1 AND user_id=$2',[row.id,row.user_id,company.id]);
  if(!reviewed)return finish(q,row,actor,'awaiting-review',decision,authority,{},null,authority.reviewerId);
  if(row.reviewer_id!==authority.reviewerId||row.review?.choice!=='approve'||row.review?.reviewerId!==authority.reviewerId)return finish(q,row,actor,'blocked',decision,{mode:'prohibited',reason:'Valid independent approval missing'},{});
  authority={...authority,mode:'delegated',reason:'Independent executive approval recorded'};
 }
 if(authority.mode==='chairman'){
  await q('UPDATE character_decision_records SET company_id=$3 WHERE id=$1 AND user_id=$2',[row.id,row.user_id,company.id]);
  const id=uid();
  await q('INSERT INTO action_requests(id,user_id,world_id,requested_by_contact_id,company_id,action_type,title,reason,payload,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,row.user_id,row.world_id,actor.id,company.id,a,decision.title,decision.reason,JSON.stringify(validated),'agency:'+row.id]);
  return finish(q,row,actor,'awaiting-approval',decision,authority,{approvalId:id},id);
 }
 let result;
 if(a==='expense'){
  const entry=await recordSystemExpense(q,company,'agency:'+row.id,validated.amount,validated.description,actor.name);
  result={journalId:entry.id,amount:validated.amount};
 }else if(a==='assign-task'){
  const [task]=await q("INSERT INTO business_tasks(id,user_id,world_id,company_id,assignee_id,title,detail,operation_key,task_type,assigned_by_contact_id,source_evidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id,status",[uid(),row.user_id,row.world_id,company?.id||null,validated.assigneeId,validated.title,validated.detail,'agency:'+row.id,validated.taskType,actor.id,JSON.stringify({...row.evidence,decisionId:row.id,sourceId:row.source_id})]);
  result={taskId:task.id,taskStatus:task.status};
  await event(q,row,actor,'task-assigned',decision.title,actor.name+' assigned a task within delegated authority.');
 }else throw new EconomyError('Reserved action cannot execute directly.',403);
 // Record company for decisions originating from a direct message.
 await q('UPDATE character_decision_records SET company_id=$3 WHERE id=$1 AND user_id=$2',[row.id,row.user_id,company?.id||null]);
 return finish(q,row,actor,'executed',decision,authority,result);
}
async function reserve(userId,id=null){
 return transaction(async q=>{
  const [world]=await q('SELECT id FROM worlds WHERE user_id=$1 FOR UPDATE',[userId]);if(!world)return null;
  await q("UPDATE character_decision_records SET status='failed',last_error='Retry limit reached',completed_at=now() WHERE user_id=$1 AND status IN ('pending','processing') AND attempts>=5 AND attempted_at<now()-interval '5 minutes'",[userId]);
  const [row]=await q(`WITH due AS(SELECT id FROM character_decision_records WHERE user_id=$1 AND ($2::uuid IS NULL OR id=$2) AND attempts<5 AND next_attempt_at<=now() AND (status='pending' OR (status='processing' AND attempted_at<now()-interval '5 minutes')) ORDER BY CASE WHEN source_type='chairman-message' THEN 0 ELSE 1 END,created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
  UPDATE character_decision_records d SET status='processing',attempts=attempts+1,attempted_at=now() FROM due WHERE d.id=due.id RETURNING d.*`,[userId,id]);
  return row||null;
 });
}
export async function processAgencyJob(userId,id=null,provider=ask){
 const row=await reserve(userId,id);if(!row)return null;
 try{
  const scope=await loadScope(row),external=await realWorldDecisionContext(userId,10),intelligence=await characterContext(userId,row.contact_id,external);
  const input={actor:scope.actor,ownPsychology:intelligence.psychology,ownGoals:intelligence.goals,ownMemories:intelligence.memories,ownRelationships:intelligence.relationships,sourceType:row.source_type,sourceId:row.source_id,evidence:row.evidence,contacts:scope.contacts,companies:scope.companies,employees:scope.employees,contracts:scope.contracts,authorityGrants:scope.grants,externalContext:external};
  const decision=row.decision||await provider(systemPrompt,JSON.stringify(input),{json:true,fallback:null,validate:raw=>parseAgencyDecision(raw,scope.validation)});
  const parsed=parseAgencyDecision(decision,scope.validation);
  if(!parsed)throw Error(row.decision?'RECORDED_DECISION_NO_LONGER_VALID':'AI_DECISION_UNAVAILABLE');
  const [saved]=await sql("UPDATE character_decision_records SET decision=$3,decision_context=coalesce(decision_context,$4::jsonb) WHERE id=$1 AND user_id=$2 AND status='processing' AND attempts=$5 RETURNING id",[row.id,userId,JSON.stringify(parsed),JSON.stringify({sourceId:row.source_id,sourceType:row.source_type,constitutionVersion:intelligence.psychology?.constitution?.version||null,externalAsOf:external.asOf||null,authorityGrants:scope.grants.map(g=>({company_id:g.company_id,action_type:g.action_type,mode:g.mode}))}),row.attempts]);
  if(!saved)return null;
  return await transaction(q=>executeAgencyDecision(q,row,parsed));
 }catch(error){
  await sql("UPDATE character_decision_records SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,last_error=$3,next_attempt_at=now()+least(attempts,5)*interval '5 minutes',completed_at=CASE WHEN attempts>=5 THEN now() ELSE NULL END WHERE id=$1 AND user_id=$2 AND status='processing' AND attempts=$4",[row.id,userId,clean(error.code||error.message||'Decision failed',200),row.attempts]);
  return (await sql('SELECT * FROM character_decision_records WHERE id=$1 AND user_id=$2',[row.id,userId]))[0]||null;
 }
}
export async function processIndependentReview(userId,provider=ask){
 await sql("UPDATE character_decision_records SET status='failed',last_error='Independent review retry limit reached',completed_at=now() WHERE user_id=$1 AND status='awaiting-review' AND review_attempts>=5 AND next_attempt_at<=now()",[userId]);
 const [row]=await sql(`WITH due AS (SELECT id FROM character_decision_records WHERE user_id=$1 AND status='awaiting-review' AND review_attempts<5 AND next_attempt_at<=now() ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) UPDATE character_decision_records d SET next_attempt_at=now()+interval '5 minutes',review_attempts=review_attempts+1 FROM due WHERE d.id=due.id RETURNING d.*`,[userId]);if(!row)return false;
 const [reviewer]=await sql("SELECT "+fields+" FROM contacts WHERE id=$1 AND user_id=$2 AND world_id=$3 AND kind='internal'",[row.reviewer_id,userId,row.world_id]);
 if(!reviewer||reviewer.id===row.contact_id){await sql("UPDATE character_decision_records SET status='blocked',last_error='Independent reviewer unavailable',completed_at=now() WHERE id=$1 AND user_id=$2 AND status='awaiting-review'",[row.id,userId]);return true;}
 const intelligence=await characterContext(userId,reviewer.id);
 const external=await realWorldDecisionContext(userId,8);
 const review=await provider(DECISION_RULES+' Independently review the proposed fictional decision against evidence and professional obligations. Return JSON {choice:"approve|reject|defer",reason:"..."}. No other action is authorized.',JSON.stringify({reviewer,ownPsychology:intelligence.psychology,ownMemories:intelligence.memories,proposal:row.decision,evidence:row.evidence,externalContext:external}),{json:true,fallback:null});
 if(!review||!['approve','reject','defer'].includes(review.choice)||!clean(review.reason)){await sql("UPDATE character_decision_records SET next_attempt_at=now()+interval '15 minutes',last_error='Reviewer response unavailable' WHERE id=$1 AND user_id=$2 AND status='awaiting-review' AND review_attempts=$3",[row.id,userId,row.review_attempts]);return false;}
 return transaction(async q=>{
  await q('SELECT id FROM worlds WHERE id=$1 AND user_id=$2 FOR UPDATE',[row.world_id,userId]);
  const [locked]=await q("SELECT * FROM character_decision_records WHERE id=$1 AND user_id=$2 AND status='awaiting-review' FOR UPDATE",[row.id,userId]);if(!locked||locked.reviewer_id!==reviewer.id||locked.review_attempts!==row.review_attempts)return false;
  const safe={choice:review.choice,reason:clean(review.reason),reviewerId:reviewer.id};
  await q('UPDATE character_decision_records SET review=$3,next_attempt_at=now()+interval \'30 minutes\' WHERE id=$1 AND user_id=$2',[row.id,userId,JSON.stringify(safe)]);
  await audit(q,row,reviewer,'agency.review',safe,safe.reason);
  if(safe.choice==='defer'){await q('UPDATE character_decision_records SET review_attempts=0 WHERE id=$1 AND user_id=$2',[row.id,userId]);return true;}
  if(safe.choice==='reject'){await q("UPDATE character_decision_records SET status='blocked',completed_at=now() WHERE id=$1 AND user_id=$2",[row.id,userId]);await event(q,row,reviewer,'character-decision',row.decision.title,reviewer.name+' declined independent approval: '+safe.reason);return true;}
  return !!await executeAgencyDecision(q,row,row.decision,{reviewed:true});
 });
}
export async function enqueueScheduledAgency(userId){
 return transaction(async q=>{
  const [w]=await q('SELECT id FROM worlds WHERE user_id=$1 FOR UPDATE',[userId]);if(!w)return null;
  const [busy]=await q("SELECT count(*)::int n FROM character_decision_records WHERE user_id=$1 AND status IN ('pending','processing')",[userId]);if(busy.n>=8)return null;
  const [recent]=await q("SELECT id FROM character_decision_records WHERE user_id=$1 AND source_type<>'chairman-message' AND created_at>now()-interval '30 minutes' LIMIT 1",[userId]);if(recent)return null;
  const candidates=await q(`SELECT g.id::text source_id,g.contact_id,g.target_company_id company_id,'goal-review' source_type,jsonb_build_object('title',g.title,'description',g.description,'progress',g.progress,'status',g.status) evidence
  FROM character_goals g JOIN contacts c ON c.id=g.contact_id AND c.user_id=g.user_id AND c.world_id=g.world_id WHERE g.user_id=$1 AND g.world_id=$2 AND g.status='active'
  AND NOT EXISTS(SELECT 1 FROM character_decision_records d WHERE d.user_id=g.user_id AND d.source_type='goal-review' AND d.source_id=g.id::text||':'||to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD'))
  UNION ALL SELECT t.id::text,t.assignee_id,t.company_id,'assigned-task',jsonb_build_object('title',t.title,'detail',t.detail,'status',t.status,'taskType',t.task_type)
  FROM business_tasks t WHERE t.user_id=$1 AND t.world_id=$2 AND t.status='assigned' AND t.created_at<now()-interval '24 hours'
  AND NOT EXISTS(SELECT 1 FROM character_decision_records d WHERE d.user_id=t.user_id AND d.source_type='assigned-task' AND d.source_id=t.id::text||':'||to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD'))
  ORDER BY source_type,source_id LIMIT 10`,[userId,w.id]);
  for(const c of candidates){const date=new Date().toISOString().slice(0,10);const row=await enqueueAgencyDecision(q,{userId,worldId:w.id,contactId:c.contact_id,companyId:c.company_id,sourceType:c.source_type,sourceId:c.source_id+':'+date,evidence:c.evidence});if(row)return row;}
  return null;
 });
}
export async function reconcileAgencyApprovals(userId){
 await sql(`UPDATE character_decision_records d SET status=CASE WHEN a.status='executed' THEN 'executed' WHEN a.status='rejected' THEN 'blocked' ELSE 'failed' END,result=jsonb_build_object('approvalId',a.id,'approvalStatus',a.status,'execution',a.result),completed_at=now()
 FROM action_requests a WHERE d.user_id=$1 AND d.approval_id=a.id AND a.user_id=d.user_id AND d.status IN ('awaiting-approval','failed') AND a.status IN ('executed','rejected','failed') AND (d.status='awaiting-approval' OR a.status IN ('executed','rejected'))`,[userId]);
}
export async function processCharacterAgency(userId){
 await reconcileAgencyApprovals(userId);
 await enqueueScheduledAgency(userId);
 await processAgencyJob(userId);
 await processIndependentReview(userId);
}
export async function agencySnapshot(userId){
 const [decisions,grants]=await Promise.all([sql('SELECT d.id,d.contact_id,d.company_id,d.source_type,d.source_id,d.status,d.decision,d.authority,d.result,d.approval_id,d.reviewer_id,d.review,d.created_at,d.completed_at,d.last_error,d.decision_context,c.name AS character_name FROM character_decision_records d JOIN contacts c ON c.id=d.contact_id AND c.user_id=d.user_id AND c.world_id=d.world_id WHERE d.user_id=$1 ORDER BY d.created_at DESC LIMIT 150',[userId]),sql('SELECT * FROM character_authority_grants WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 200',[userId])]);
 return {characterDecisions:decisions,characterAuthorityGrants:grants};
}
export function agencyReply(row){
 if(!row)return 'I could not process that decision yet. No action has been completed.';
 const d=row.decision;
 if(row.status==='awaiting-approval')return 'Chairman, '+d.reason+' I have submitted “'+d.title+'” for your approval. It has not been executed.';
 if(row.status==='awaiting-review')return 'Chairman, '+d.reason+' I have requested independent executive approval. Execution is pending.';
 if(row.status==='executed')return 'Chairman, '+d.reason+' I have '+(row.result?.taskId?'assigned the task; it is not yet completed':row.result?.journalId?'recorded the authorized fictional expense':row.result?.messageId?'sent the in-app message':'completed the recorded action')+'.';
 if(row.status==='decided'||row.status==='blocked')return 'Chairman, '+(d?.choice==='refuse'?'I cannot agree to carry out this instruction. ':d?.choice==='disagree'?'I disagree with this course of action. ':'')+(d?.reason||'I cannot proceed within my authority.')+(row.authority?.reason&&row.status==='blocked'?' '+row.authority.reason:'')+' No business action was executed.';
 return 'Chairman, my decision is not yet available. The instruction is recorded; no action has been confirmed.';
}
