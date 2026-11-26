import {sql,one,transaction,uid} from '../backend/src/db.mjs';
import {EconomyError,amountString,operationKey} from './economy-rules.mjs';
import {recordTransaction,assignTask} from './economy.mjs';
import {hireEmployee,terminateEmployee} from './employment.mjs';
import {transitionContract} from './operations.mjs';
import {validTaskType,canAssignTask} from './task-rules.mjs';
const clean=(v,n=500)=>String(v??'').trim().slice(0,n);
async function validatePayload(q,user,action,p){
 if(!p||typeof p!=='object'||Array.isArray(p))throw new EconomyError('Action details are missing.');
 if(['expense','hire','assign-task'].includes(action)){
  const company=(await q('SELECT id FROM companies WHERE id=$1 AND user_id=$2',[p.companyId,user.id]))[0];
  if(!company)throw new EconomyError('Select a company in your empire.',404);
 }
 if(action==='expense'){
  p.amount=amountString(p.amount);p.description=clean(p.description,240);
  if(!p.description)throw new EconomyError('Expense description is required.');
 }
 if(action==='hire'){
  p.name=clean(p.name,100);p.title=clean(p.title,100);p.salary=amountString(p.salary);
  if(!p.name||!p.title)throw new EconomyError('Candidate name and role are required.');
 }
 if(action==='fire'){
  const employee=(await q("SELECT id,company_id FROM employment_records WHERE id=$1 AND user_id=$2 AND status='active'",[p.employmentId,user.id]))[0];
  if(!employee)throw new EconomyError('Active employee record not found.',404);
  p.companyId=employee.company_id;p.reason=clean(p.reason,500);if(!p.reason)throw new EconomyError('Termination reason is required.');
 }
 if(action==='activate-contract'){
  const contract=(await q("SELECT id,company_id FROM business_contracts WHERE id=$1 AND user_id=$2 AND status='draft'",[p.contractId,user.id]))[0];
  if(!contract)throw new EconomyError('Draft contract not found.',404);
  p.reason=clean(p.reason,500);if(!p.reason)throw new EconomyError('Approval reason is required.');
  p.companyId=contract.company_id;
 }
 if(action==='assign-task'){
  p.title=clean(p.title,140);p.detail=clean(p.detail,2000);p.taskType=p.taskType||'general';
  if(!p.title||!p.detail||!validTaskType(p.taskType))throw new EconomyError('Task details or task type are invalid.');
  const person=(await q("SELECT id,title FROM contacts WHERE id=$1 AND user_id=$2 AND kind='internal'",[p.assigneeId,user.id]))[0];
  if(!person||!canAssignTask(p.taskType,person.title))throw new EconomyError('The selected executive is not authorized for this task.',403);
 }
 return p;
}
export async function requestAction(user,contactId,body){
 const action=clean(body.actionType,40),title=clean(body.title,160),reason=clean(body.reason,1000);
 const allowed=['expense','hire','fire','activate-contract','assign-task'];
 if(!allowed.includes(action)||!title||!reason)throw new EconomyError('Provide a supported action, title and business reason.');
 const key='action:'+operationKey(body.operationKey);
 return transaction(async q=>{
  const w=(await q('SELECT id FROM worlds WHERE user_id=$1',[user.id]))[0];if(!w)throw new EconomyError('Empire unavailable.',404);
  const actor=(await q("SELECT id,name,title FROM contacts WHERE id=$1 AND user_id=$2 AND world_id=$3 AND kind='internal'",[contactId,user.id,w.id]))[0];
  if(!actor)throw new EconomyError('Only an authorized internal executive can request an action.',403);
  const payloadInput={...(body.payload||{})};
  if(['fire','activate-contract'].includes(action)&&!payloadInput.reason)payloadInput.reason=reason;
  const payload=await validatePayload(q,user,action,payloadInput);
  const prior=(await q('SELECT * FROM action_requests WHERE user_id=$1 AND operation_key=$2',[user.id,key]))[0];
  if(prior){const comparison=(await q('SELECT payload=$2::jsonb AS same FROM action_requests WHERE id=$1',[prior.id,JSON.stringify(payload)]))[0];if(prior.action_type!==action||prior.title!==title||prior.reason!==reason||!comparison?.same)throw new EconomyError('Operation reference already used for a different request.',409);return prior;}
  const row=(await q('INSERT INTO action_requests(id,user_id,world_id,requested_by_contact_id,company_id,action_type,title,reason,payload,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[uid(),user.id,w.id,actor.id,payload.companyId||null,action,title,reason,JSON.stringify(payload),key]))[0];
  await q('INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),user.id,w.id,actor.id,'approval-requested',title,actor.name+' requested Chairman approval for '+action+': '+reason]);
  return {...row,requester_name:actor.name,requester_title:actor.title};
 });
}
async function executeRequest(id,userId){
 const claimed=await transaction(async q=>{
  const row=(await q("SELECT * FROM action_requests WHERE id=$1 AND user_id=$2 AND (status='approved' OR (status='executing' AND execution_attempt_at<now()-interval '5 minutes')) FOR UPDATE",[id,userId]))[0];
  if(!row)return null;
  await q("UPDATE action_requests SET status='executing',attempts=attempts+1,execution_attempt_at=now(),last_error=NULL WHERE id=$1",[id]);
  return row;
 });
 if(!claimed)return false;
 const user=await one('SELECT id,name FROM users WHERE id=$1',[userId]);
 if(!user)return false;
 const p=claimed.payload;
 try{
  let result;const key='approved:'+claimed.id;
  if(claimed.action_type==='expense')result=await recordTransaction(user,p.companyId,{kind:'expense',amount:p.amount,description:p.description,operationKey:key});
  else if(claimed.action_type==='hire')result=await hireEmployee(user,{companyId:p.companyId,name:p.name,title:p.title,salary:p.salary,operationKey:key});
  else if(claimed.action_type==='fire')result=await terminateEmployee(user,p.employmentId,{reason:p.reason});
  else if(claimed.action_type==='activate-contract')result=await transitionContract(user,p.contractId,{status:'active',reason:p.reason});
  else if(claimed.action_type==='assign-task')result=await assignTask(user,{companyId:p.companyId,assigneeId:p.assigneeId,title:p.title,detail:p.detail,taskType:p.taskType,operationKey:key});
  else throw new Error('Unsupported approved action.');
  await transaction(async q=>{
   const current=(await q("SELECT id FROM action_requests WHERE id=$1 AND user_id=$2 AND status='executing' FOR UPDATE",[id,userId]))[0];if(!current)return;
   await q("UPDATE action_requests SET status='executed',result=$2::jsonb,executed_at=now() WHERE id=$1",[id,JSON.stringify(result||{})]);
   await q('INSERT INTO world_audit_log(id,user_id,world_id,actor_type,actor_name,action,entity_type,entity_id,after_state,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[uid(),userId,claimed.world_id,'chairman',user.name,'approval.executed',claimed.action_type,id,JSON.stringify(result||{}),'Approved request executed: '+claimed.title]);
   await q('INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),userId,claimed.world_id,claimed.requested_by_contact_id,'approved-action-executed',claimed.title,'Chairman approved and the requested '+claimed.action_type+' action was executed.']);
  });
  return true;
 }catch(error){
  await sql("UPDATE action_requests SET status='failed',last_error=$2 WHERE id=$1 AND user_id=$3",[id,String(error?.message||'Execution failed').slice(0,500),userId]);
  return false;
 }
}
export async function decideAction(user,id,body){
 const decision=body.decision,reason=clean(body.reason,1000);
 if(!['approved','rejected'].includes(decision)||!reason)throw new EconomyError('Choose approve or reject and record a reason.');
 const row=await transaction(async q=>{
  const old=(await q("SELECT * FROM action_requests WHERE id=$1 AND user_id=$2 AND status='pending' FOR UPDATE",[id,user.id]))[0];
  if(!old)throw new EconomyError('This approval request is no longer pending.',409);
  const next=(await q('UPDATE action_requests SET status=$1,decision_reason=$2,decided_at=now() WHERE id=$3 AND user_id=$4 RETURNING *',[decision,reason,id,user.id]))[0];
  await q('INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),user.id,old.world_id,old.requested_by_contact_id,'approval-'+decision,old.title,'Chairman '+decision+' the request. '+reason]);
  await q('INSERT INTO world_audit_log(id,user_id,world_id,actor_type,actor_name,action,entity_type,entity_id,before_state,after_state,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[uid(),user.id,old.world_id,'chairman',user.name,'approval.'+decision,'action-request',id,JSON.stringify(old),JSON.stringify(next),reason]);
  return next;
 });
 if(decision==='approved')await executeRequest(id,user.id);
 return (await sql('SELECT a.*,c.name AS requester_name,c.title AS requester_title,co.name AS company_name FROM action_requests a JOIN contacts c ON c.id=a.requested_by_contact_id AND c.user_id=a.user_id LEFT JOIN companies co ON co.id=a.company_id AND co.user_id=a.user_id WHERE a.id=$1 AND a.user_id=$2',[id,user.id]))[0];
}
export async function processApprovedActions(userId){
 const rows=await sql("SELECT id FROM action_requests WHERE user_id=$1 AND (status='approved' OR (status='executing' AND execution_attempt_at<now()-interval '5 minutes')) ORDER BY created_at LIMIT 4",[userId]);
 for(const row of rows)await executeRequest(row.id,userId);
}
export async function actionRequestsSnapshot(userId){
 return sql('SELECT a.*,c.name AS requester_name,c.title AS requester_title,co.name AS company_name FROM action_requests a JOIN contacts c ON c.id=a.requested_by_contact_id AND c.user_id=a.user_id LEFT JOIN companies co ON co.id=a.company_id AND co.user_id=a.user_id WHERE a.user_id=$1 ORDER BY a.created_at DESC LIMIT 100',[userId]);
}

export async function retryAction(user,id,body){
 const reason=clean(body.reason,1000);
 if(!reason)throw new EconomyError('Record why this approved action is being retried.');
 const row=await transaction(async q=>{
  const old=(await q("SELECT * FROM action_requests WHERE id=$1 AND user_id=$2 AND status='failed' FOR UPDATE",[id,user.id]))[0];
  if(!old)throw new EconomyError('Only failed actions can be retried.',409);
  const next=(await q("UPDATE action_requests SET status='approved',decision_reason=decision_reason||' · Retry: '||$3,last_error=NULL WHERE id=$1 AND user_id=$2 RETURNING *",[id,user.id,reason]))[0];
  await q('INSERT INTO world_audit_log(id,user_id,world_id,actor_type,actor_name,action,entity_type,entity_id,before_state,after_state,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[uid(),user.id,old.world_id,'chairman',user.name,'approval.retry','action-request',id,JSON.stringify(old),JSON.stringify(next),reason]);
  return next;
 });
 await executeRequest(id,user.id);
 return (await sql('SELECT a.*,c.name AS requester_name,c.title AS requester_title,co.name AS company_name FROM action_requests a JOIN contacts c ON c.id=a.requested_by_contact_id AND c.user_id=a.user_id LEFT JOIN companies co ON co.id=a.company_id AND co.user_id=a.user_id WHERE a.id=$1 AND a.user_id=$2',[id,user.id]))[0];
}
