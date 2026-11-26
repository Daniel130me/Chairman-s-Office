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
const openingSalary=Object.freeze({'Chief of Staff':'220000','Group CFO':'350000','Chief Operating Officer':'300000','General Counsel':'280000','Group Strategy Director':'240000','Group Human Resources Director':'220000','Chief Security Officer':'210000','Internal Audit Director':'230000','Chief Commercial Officer':'250000'});
const openingLeaders=[
 ['Grace Okafor','Group Human Resources Director','Empathetic, observant and firm','Build a capable workforce and protect fair employment practices'],
 ['Maya Okoye','Chief Security Officer','Alert, disciplined and discreet','Protect people, information and company assets'],
 ['Rafael Chen','Internal Audit Director','Methodical, independent and evidence-led','Identify control weaknesses and investigate irregularities'],
 ['Tunde Adebayo','Chief Commercial Officer','Persuasive, commercially minded and competitive','Grow customer relationships and improve deal quality']
];
export async function employmentSnapshot(userId){
 // Add the expanded founding leadership to older worlds without duplicating existing contacts.
 // Backfill founding executives as explicit opening simulation assumptions. The Board Chair
 // is a non-employee governance role and is intentionally excluded from payroll.
 await transaction(async q=>{
  const world=(await q('SELECT id FROM worlds WHERE user_id=$1 FOR UPDATE',[userId]))[0];
  if(!world)return;
  const company=(await q('SELECT id,world_id FROM companies WHERE user_id=$1 ORDER BY created_at LIMIT 1',[userId]))[0];
  if(!company)return;
  for(const [name,title,temperament,agenda] of openingLeaders){
   const exists=(await q('SELECT id FROM contacts WHERE user_id=$1 AND world_id=$2 AND title=$3 LIMIT 1',[userId,company.world_id,title]))[0];
   if(!exists){
    const contactId=uid();
    await q("INSERT INTO contacts(id,user_id,world_id,name,title,company,kind,relationship,temperament,agenda) VALUES($1,$2,$3,$4,$5,$6,'internal','executive',$7,$8)",[contactId,userId,company.world_id,name,title,'Group Executive Office',temperament,agenda]);
    await q('INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),userId,company.world_id,contactId,'executive-appointed','Founding executive appointed',name+' joined the founding leadership roster as '+title+'.']);
   }
  }
  const staff=await q("SELECT c.id,c.title FROM contacts c WHERE c.user_id=$1 AND c.world_id=$2 AND c.kind='internal' AND c.title<>'Board Chair' AND NOT EXISTS(SELECT 1 FROM employment_records e WHERE e.user_id=c.user_id AND e.contact_id=c.id)",[userId,company.world_id]);
  for(const person of staff){
   const salary=openingSalary[person.title]||'90000';
   await q("INSERT INTO employment_records(id,user_id,world_id,company_id,contact_id,job_title,annual_salary,operation_key,salary_basis) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'opening-assumption') ON CONFLICT(user_id,operation_key) DO NOTHING",[uid(),userId,company.world_id,company.id,person.id,person.title,salary,'opening-employment:'+person.id]);
   await q('INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),userId,company.world_id,person.id,'employment-opened','Founding executive employment record',person.title+' employment was initialized with a clearly identified fictional opening salary assumption.']);
  }
 });
 return sql('SELECT e.*,p.name,c.name AS company_name FROM employment_records e JOIN contacts p ON p.id=e.contact_id AND p.user_id=e.user_id JOIN companies c ON c.id=e.company_id AND c.user_id=e.user_id WHERE e.user_id=$1 ORDER BY e.hired_at DESC',[userId]);
}
