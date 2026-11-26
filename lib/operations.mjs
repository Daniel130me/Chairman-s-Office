import {sql,one,transaction,uid} from '../backend/src/db.mjs';
import {EconomyError,amountString,operationKey} from './economy-rules.mjs';
import {recordSystemExpense,recordSystemSale} from './economy.mjs';
import {canTransitionContract,validPayrollMonth} from './operations-rules.mjs';
function clean(value,max=240){return String(value??'').trim().slice(0,max);}
async function worldCompany(q,userId,companyId){
 const c=(await q('SELECT c.*,w.id AS world_id FROM companies c JOIN worlds w ON w.id=c.world_id AND w.user_id=c.user_id WHERE c.id=$1 AND c.user_id=$2 FOR UPDATE',[companyId,userId]))[0];
 if(!c)throw new EconomyError('Company unavailable.',404);
 return c;
}
async function audit(q,userId,worldId,actorName,action,entityType,entityId,beforeState,afterState,reason){
 await q('INSERT INTO world_audit_log(id,user_id,world_id,actor_type,actor_name,action,entity_type,entity_id,before_state,after_state,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[uid(),userId,worldId,'chairman',actorName,action,entityType,entityId,beforeState?JSON.stringify(beforeState):null,afterState?JSON.stringify(afterState):null,reason||null]);
}
export async function createInvoice(user,body){
 const key='invoice:'+operationKey(body.operationKey),customer=clean(body.customer,120),description=clean(body.description,500),amount=amountString(body.amount);
 if(!customer||!description)throw new EconomyError('Enter the customer and invoice description.');
 const due=body.dueAt?new Date(body.dueAt):new Date(Date.now()+30*86400000);
 if(!Number.isFinite(due.getTime())||due.getTime()<Date.now()-86400000)throw new EconomyError('Choose a valid invoice due date.');
 return transaction(async q=>{
  const c=await worldCompany(q,user.id,body.companyId);
  const prior=(await q('SELECT * FROM business_invoices WHERE user_id=$1 AND operation_key=$2',[user.id,key]))[0];
  if(prior){if(prior.company_id!==c.id||prior.customer_name!==customer||prior.description!==description||prior.amount!==amount)throw new EconomyError('Operation reference already used.',409);return prior;}
  const count=(await q('SELECT count(*)::int n FROM business_invoices WHERE user_id=$1 AND company_id=$2',[user.id,c.id]))[0].n+1;
  const number='INV-'+new Date().getUTCFullYear()+'-'+String(count).padStart(5,'0');
  const row=(await q('INSERT INTO business_invoices(id,user_id,world_id,company_id,invoice_number,customer_name,description,amount,due_at,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[uid(),user.id,c.world_id,c.id,number,customer,description,amount,due.toISOString(),key]))[0];
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,c.world_id,'invoice-issued',number+' issued',customer+' · USD '+amount+' · '+description]);
  await audit(q,user.id,c.world_id,'Chairman','invoice.issued','invoice',row.id,null,row,'Invoice issued; no payment has been received.');
  return row;
 });
}
export async function payInvoice(user,id){
 return transaction(async q=>{
  const row=(await q('SELECT * FROM business_invoices WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]))[0];
  if(!row)throw new EconomyError('Invoice unavailable.',404);
  if(row.status==='paid')return row;
  if(row.status!=='issued')throw new EconomyError('Only issued invoices can be paid.',409);
  const c=await worldCompany(q,user.id,row.company_id);
  await recordSystemSale(q,c,'invoice:'+row.id+':payment',row.amount,'Payment received for '+row.invoice_number+' from '+row.customer_name,'Accounts receivable');
  const paid=(await q("UPDATE business_invoices SET status='paid',paid_at=now() WHERE id=$1 AND user_id=$2 RETURNING *",[id,user.id]))[0];
  await audit(q,user.id,row.world_id,'Accounts Receivable','invoice.paid','invoice',row.id,row,paid,'Fictional payment recorded in company ledger.');
  return paid;
 });
}
export async function createContract(user,body){
 const key='contract:'+operationKey(body.operationKey),title=clean(body.title,160),counterparty=clean(body.counterparty,140),type=clean(body.type,60)||'commercial',terms=clean(body.terms,4000),value=amountString(body.value);
 if(!title||!counterparty||!terms)throw new EconomyError('Enter a title, counterparty and terms.');
 return transaction(async q=>{
  const c=await worldCompany(q,user.id,body.companyId);
  const prior=(await q('SELECT * FROM business_contracts WHERE user_id=$1 AND operation_key=$2',[user.id,key]))[0];
  if(prior){if(prior.company_id!==c.id||prior.title!==title||prior.counterparty!==counterparty||prior.terms!==terms||prior.value!==value)throw new EconomyError('Operation reference already used.',409);return prior;}
  const row=(await q('INSERT INTO business_contracts(id,user_id,world_id,company_id,title,counterparty,contract_type,value,terms,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[uid(),user.id,c.world_id,c.id,title,counterparty,type,value,terms,key]))[0];
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,c.world_id,'contract-drafted',title,counterparty+' · USD '+value+' · Awaiting review and approval.']);
  await audit(q,user.id,c.world_id,'Chairman','contract.drafted','contract',row.id,null,row,'Draft only; no obligation or payment has been created.');
  return row;
 });
}
export async function transitionContract(user,id,body){
 const status=clean(body.status,20),reason=clean(body.reason,500);
 return transaction(async q=>{
  const old=(await q('SELECT * FROM business_contracts WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]))[0];
  if(!old)throw new EconomyError('Contract unavailable.',404);
  if(old.status===status)return old;
  if(!canTransitionContract(old.status,status))throw new EconomyError('That contract transition is not permitted.',409);
  if(!reason)throw new EconomyError('Record the reason for this contract decision.');
  const row=(await q('UPDATE business_contracts SET status=$1,updated_at=now() WHERE id=$2 AND user_id=$3 RETURNING *',[status,id,user.id]))[0];
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,old.world_id,'contract-'+status,old.title,status+' with '+old.counterparty+'. '+reason]);
  await audit(q,user.id,old.world_id,'Chairman','contract.'+status,'contract',id,old,row,reason);
  return row;
 });
}
export async function runPayroll(user,body){
 const period=clean(body.periodMonth,7);
 if(!validPayrollMonth(period))throw new EconomyError('Choose a valid payroll month.');
 return transaction(async q=>{
  const c=await worldCompany(q,user.id,body.companyId);
  const prior=(await q('SELECT * FROM payroll_runs WHERE user_id=$1 AND company_id=$2 AND period_month=$3 FOR UPDATE',[user.id,c.id,period]))[0];
  if(prior)return prior;
  const staff=await q("SELECT e.id,e.annual_salary,p.name,e.job_title FROM employment_records e JOIN contacts p ON p.id=e.contact_id AND p.user_id=e.user_id WHERE e.user_id=$1 AND e.company_id=$2 AND e.status='active' ORDER BY p.name",[user.id,c.id]);
  if(!staff.length)throw new EconomyError('There are no active employment records for this company.',409);
  const total=(await q("SELECT sum(round(annual_salary/12,2))::numeric(20,2)::text total FROM employment_records WHERE user_id=$1 AND company_id=$2 AND status='active'",[user.id,c.id]))[0].total;
  const amount=amountString(total);
  await recordSystemExpense(q,c,'payroll:'+c.id+':'+period,amount,'Monthly payroll for '+period+' ('+staff.length+' employees)','Payroll');
  const run=(await q("INSERT INTO payroll_runs(id,user_id,world_id,company_id,period_month,total,employee_count,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",[uid(),user.id,c.world_id,c.id,period,amount,staff.length,'payroll:'+c.id+':'+period]))[0];
  for(const person of staff)await q('INSERT INTO payroll_items(id,user_id,payroll_run_id,employment_id,employee_name,job_title,gross_pay) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),user.id,run.id,person.id,person.name,person.job_title,(Math.round(Number(person.annual_salary)/12*100)/100).toFixed(2)]);
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,c.world_id,'payroll-paid','Payroll completed · '+period,staff.length+' employees · USD '+amount]);
  await audit(q,user.id,c.world_id,'Chairman','payroll.paid','payroll',run.id,null,run,'Fictional salary payment recorded in company ledger.');
  return run;
 });
}
export async function operationsSnapshot(userId){
 const [invoices,contracts,payroll,auditLog]=await Promise.all([
  sql('SELECT i.*,c.name AS company_name FROM business_invoices i JOIN companies c ON c.id=i.company_id AND c.user_id=i.user_id WHERE i.user_id=$1 ORDER BY i.issued_at DESC LIMIT 100',[userId]),
  sql('SELECT k.*,c.name AS company_name FROM business_contracts k JOIN companies c ON c.id=k.company_id AND c.user_id=k.user_id WHERE k.user_id=$1 ORDER BY k.created_at DESC LIMIT 100',[userId]),
  sql('SELECT p.*,c.name AS company_name FROM payroll_runs p JOIN companies c ON c.id=p.company_id AND c.user_id=p.user_id WHERE p.user_id=$1 ORDER BY p.paid_at DESC LIMIT 50',[userId]),
  sql('SELECT * FROM world_audit_log WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[userId])
 ]);
 return {invoices,contracts,payroll,auditLog};
}
