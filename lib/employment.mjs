import {transaction,sql,uid} from '../backend/src/db.mjs';
import {EconomyError,amountString,operationKey} from './economy-rules.mjs';
export async function hireEmployee(user,body){
 const key='hire:'+operationKey(body.operationKey);
 const name=String(body.name||'').trim().slice(0,100),title=String(body.title||'').trim().slice(0,100),salary=amountString(body.salary);
 if(!name||!title)throw new EconomyError('Enter a name and role.');
 return transaction(async q=>{
  const w=(await q('SELECT id FROM worlds WHERE user_id=$1 FOR UPDATE',[user.id]))[0];
  if(!w)throw new EconomyError('Empire unavailable.',404);
  const c=(await q('SELECT id,name FROM companies WHERE id=$1 AND user_id=$2 AND world_id=$3',[body.companyId,user.id,w.id]))[0];
  if(!c)throw new EconomyError('Company unavailable.',404);
  const prior=(await q('SELECT e.*,p.name FROM employment_records e JOIN contacts p ON p.id=e.contact_id AND p.user_id=e.user_id WHERE e.user_id=$1 AND e.operation_key=$2',[user.id,key]))[0];
  if(prior){
   if(prior.name!==name||prior.job_title!==title||prior.company_id!==c.id||prior.annual_salary!==salary)throw new EconomyError('Operation reference already used.',409);
   return prior;
  }
  const contact=uid();
  await q(`INSERT INTO contacts(id,user_id,world_id,name,title,company,kind,relationship,temperament,agenda)
   VALUES($1,$2,$3,$4,$5,$6,'internal','employee','Professional and developing their own approach','Deliver the responsibilities of the role and build a career')`,[contact,user.id,w.id,name,title,c.name]);
  const row=(await q('INSERT INTO employment_records(id,user_id,world_id,company_id,contact_id,job_title,annual_salary,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[uid(),user.id,w.id,c.id,contact,title,salary,key]))[0];
  await q('INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),user.id,w.id,contact,'employee-hired',name+' hired',name+' joined '+c.name+' as '+title+' at an agreed annual salary of USD '+salary+'.']);
  return row;
 });
}
export async function terminateEmployee(user,id,body){
 const reason=String(body.reason||'').trim().slice(0,500);
 if(!reason)throw new EconomyError('Enter a termination reason.');
 return transaction(async q=>{
  const e=(await q('SELECT * FROM employment_records WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]))[0];
  if(!e)throw new EconomyError('Employee unavailable.',404);
  if(e.status==='terminated')return e;
  const row=(await q("UPDATE employment_records SET status='terminated',terminated_at=now(),termination_reason=$3 WHERE id=$1 AND user_id=$2 RETURNING *",[id,user.id,reason]))[0];
  await q("UPDATE contacts SET kind='former-employee',relationship='former employee',title='Former '||$3 WHERE id=$1 AND user_id=$2",[e.contact_id,user.id,e.job_title]);
  const cancelled=await q("UPDATE business_tasks SET status='cancelled',completed_at=now(),outcome='Employment ended; requires reassignment' WHERE user_id=$1 AND assignee_id=$2 AND status='assigned' RETURNING id",[user.id,e.contact_id]);
  await q('INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),user.id,e.world_id,e.contact_id,'employee-terminated','Employment ended',e.job_title+' · '+reason+'. '+cancelled.length+' assigned tasks cancelled; contact retained.']);
  return row;
 });
}
export async function employmentSnapshot(userId){
 return sql('SELECT e.*,p.name,c.name AS company_name FROM employment_records e JOIN contacts p ON p.id=e.contact_id AND p.user_id=e.user_id JOIN companies c ON c.id=e.company_id AND c.user_id=e.user_id WHERE e.user_id=$1 ORDER BY e.hired_at DESC',[userId]);
}
