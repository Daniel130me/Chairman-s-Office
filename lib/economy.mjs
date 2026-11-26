import {sql,transaction,uid} from '../backend/src/db.mjs';
import {EconomyError,accounts,amountString,operationKey,chartOfAccounts,deriveFinancialStatement} from './economy-rules.mjs';
import {validTaskType,canAssignTask} from './task-rules.mjs';
export {EconomyError};

async function ensureChart(q,userId,companyId){
 for(const [code,name,type,normal] of chartOfAccounts)await q('INSERT INTO company_chart_accounts(id,user_id,company_id,code,name,account_type,normal_balance) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id,company_id,code) DO NOTHING',[uid(),userId,companyId,code,name,type,normal]);
}
async function initialize(q,userId,companyId){
 const c=(await q('SELECT * FROM companies WHERE user_id=$1 AND id=$2 FOR UPDATE',[userId,companyId]))[0];
 if(!c)throw new EconomyError('Company unavailable.',404);
 await ensureChart(q,userId,companyId);
 const created=await q(`INSERT INTO company_economy(company_id,user_id,annual_sales_assumption)
 VALUES($1,$2,greatest(0,coalesce($3::numeric,0))) ON CONFLICT DO NOTHING RETURNING company_id`,[companyId,userId,c.revenue]);
 if(created.length){
   await q(`INSERT INTO economy_journal(id,user_id,company_id,operation_key,kind,debit,credit,amount,description,actor)
   SELECT $1,$2,$3,$4,'opening','cash','equity',round($5::numeric,2),'Opening cash carried forward from world setup','Opening position'
   WHERE round($5::numeric,2)>0`,[uid(),userId,companyId,'opening:'+companyId,c.cash||0]);
 }
 return c;
}
async function totals(q,userId,companyId){
 return (await q(`SELECT coalesce(sum(CASE WHEN debit='cash' THEN amount WHEN credit='cash' THEN -amount ELSE 0 END),0)::text cash,
 coalesce(sum(amount) FILTER(WHERE credit='revenue'),0)::text revenue,
 coalesce(sum(amount) FILTER(WHERE debit IN ('expense','payroll_expense','cost_of_goods_sold','tax_expense','depreciation_expense','interest_expense')),0)::text expenses
 FROM economy_journal WHERE user_id=$1 AND company_id=$2`,[userId,companyId]))[0];
}
async function post(q,c,key,kind,amount,description,actor,effectiveAt=null){
 const [debit,credit]=accounts(kind);
 const prior=(await q('SELECT * FROM economy_journal WHERE user_id=$1 AND operation_key=$2',[c.user_id,key]))[0];
 if(prior){
  if(prior.company_id!==c.id||prior.kind!==kind||prior.amount!==amount||prior.description!==description)throw new EconomyError('Operation reference already used for a different transaction.',409);
  return prior;
 }
 if(credit==='cash'){
  const sufficient=(await q(`SELECT (coalesce(sum(CASE WHEN debit='cash' THEN amount WHEN credit='cash' THEN -amount ELSE 0 END),0)>=$3::numeric) AS ok
  FROM economy_journal WHERE user_id=$1 AND company_id=$2`,[c.user_id,c.id,amount]))[0];
  if(!sufficient.ok)throw new EconomyError('Insufficient company cash.',409);
 }
 const entry=(await q(`INSERT INTO economy_journal(id,user_id,company_id,operation_key,kind,debit,credit,amount,description,actor,effective_at)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,coalesce($11::timestamptz,now())) RETURNING *`,[uid(),c.user_id,c.id,key,kind,debit,credit,amount,description,actor,effectiveAt]))[0];
 await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),c.user_id,c.world_id,'financial-transaction',c.name+' · '+kind,actor+': '+description+' · USD '+amount]);
 const balance=await totals(q,c.user_id,c.id);
 await q('UPDATE companies SET cash=$1 WHERE id=$2 AND user_id=$3',[balance.cash,c.id,c.user_id]);
 return entry;
}
export async function recordSystemInvoice(q,company,key,amount,description,actor){const locked=await initialize(q,company.user_id,company.id);return post(q,locked,key,'invoice',amount,description,actor);}
export async function recordSystemInvoicePayment(q,company,key,amount,description,actor){const locked=await initialize(q,company.user_id,company.id);return post(q,locked,key,'invoice-payment',amount,description,actor);}
export async function recordSystemPayroll(q,company,key,amount,description,actor){const locked=await initialize(q,company.user_id,company.id);return post(q,locked,key,'payroll',amount,description,actor);}
export async function recordSystemPurchase(q,company,key,amount,description,actor){const locked=await initialize(q,company.user_id,company.id);return post(q,locked,key,'purchase',amount,description,actor);}
export async function recordSystemSupplierPayment(q,company,key,amount,description,actor){const locked=await initialize(q,company.user_id,company.id);return post(q,locked,key,'supplier-payment',amount,description,actor);}
export async function recordSystemAssetPurchase(q,company,key,amount,description,actor){const locked=await initialize(q,company.user_id,company.id);return post(q,locked,key,'asset-purchase',amount,description,actor);}
export async function recordSystemLoanDraw(q,company,key,amount,description,actor){const locked=await initialize(q,company.user_id,company.id);return post(q,locked,key,'loan-draw',amount,description,actor);}
export async function recordSystemInvestmentPurchase(q,company,key,amount,description,actor){const locked=await initialize(q,company.user_id,company.id);return post(q,locked,key,'investment-purchase',amount,description,actor);}
export async function recordSystemInvestmentSale(q,company,key,amount,description,actor){const locked=await initialize(q,company.user_id,company.id);return post(q,locked,key,'investment-sale',amount,description,actor);}
export async function recordSystemInterestAccrual(q,company,key,amount,description,actor){const locked=await initialize(q,company.user_id,company.id);return post(q,locked,key,'interest-accrual',amount,description,actor);}
export async function recordSystemAccruedInterestPayment(q,company,key,amount,description,actor){const locked=await initialize(q,company.user_id,company.id);return post(q,locked,key,'accrued-interest-payment',amount,description,actor);}
export async function recordSystemInterestPayment(q,company,key,amount,description,actor){const locked=await initialize(q,company.user_id,company.id);return post(q,locked,key,'interest-payment',amount,description,actor);}
export async function recordSystemLoanPayment(q,company,key,amount,description,actor){const locked=await initialize(q,company.user_id,company.id);return post(q,locked,key,'loan-payment',amount,description,actor);}
export async function recordSystemSale(q,company,key,amount,description,actor){const locked=await initialize(q,company.user_id,company.id);return post(q,locked,key,'sale',amount,description,actor);}
export async function recordSystemExpense(q,company,key,amount,description,actor){const locked=await initialize(q,company.user_id,company.id);return post(q,locked,key,'expense',amount,description,actor);}
export async function recordTransaction(user,companyId,body){
 const kind=body.kind;
 if(!['sale','expense','capital'].includes(kind))throw new EconomyError('Select a transaction type.');
 const amount=amountString(body.amount),key='chairman:'+operationKey(body.operationKey);
 const description=String(body.description||'').trim().slice(0,240);
 if(!description)throw new EconomyError('Describe the transaction.');
 return transaction(async q=>{
  const c=await initialize(q,user.id,companyId);
  return post(q,c,key,kind,amount,description,'Chairman');
 });
}
export async function economySnapshot(userId){
 const ids=await sql('SELECT id FROM companies WHERE user_id=$1 ORDER BY id',[userId]);
 for(const c of ids)await transaction(q=>initialize(q,userId,c.id));
 const companies=await sql(`SELECT c.id,c.name,c.sector,c.valuation,e.started_at,e.annual_sales_assumption,
 coalesce(sum(CASE WHEN j.debit='cash' THEN j.amount WHEN j.credit='cash' THEN -j.amount ELSE 0 END),0)::text cash,
 coalesce(sum(j.amount) FILTER(WHERE j.credit='revenue'),0)::text revenue,
 coalesce(sum(j.amount) FILTER(WHERE j.debit IN ('expense','payroll_expense','cost_of_goods_sold','tax_expense','depreciation_expense','interest_expense')),0)::text expenses,
 coalesce(sum(CASE WHEN j.debit='accounts_receivable' THEN j.amount WHEN j.credit='accounts_receivable' THEN -j.amount ELSE 0 END),0)::text receivables,
 coalesce(sum(CASE WHEN j.debit='inventory' THEN j.amount WHEN j.credit='inventory' THEN -j.amount ELSE 0 END),0)::text inventory,
 coalesce(sum(CASE WHEN j.debit='fixed_assets' THEN j.amount WHEN j.credit='fixed_assets' THEN -j.amount ELSE 0 END),0)::text fixed_assets,
 coalesce(sum(CASE WHEN j.debit='investments' THEN j.amount WHEN j.credit='investments' THEN -j.amount ELSE 0 END),0)::text investments,
 coalesce(sum(CASE WHEN j.credit='accounts_payable' THEN j.amount WHEN j.debit='accounts_payable' THEN -j.amount ELSE 0 END),0)::text payables,
 coalesce(sum(CASE WHEN j.credit='tax_payable' THEN j.amount WHEN j.debit='tax_payable' THEN -j.amount ELSE 0 END),0)::text tax_payable,
 coalesce(sum(CASE WHEN j.credit='loans_payable' THEN j.amount WHEN j.debit='loans_payable' THEN -j.amount ELSE 0 END),0)::text loans_payable,
 coalesce(sum(CASE WHEN j.credit='interest_payable' THEN j.amount WHEN j.debit='interest_payable' THEN -j.amount ELSE 0 END),0)::text interest_payable,
 coalesce(sum(CASE WHEN j.credit IN ('equity','retained_earnings') THEN j.amount WHEN j.debit IN ('equity','retained_earnings') THEN -j.amount ELSE 0 END),0)::text contributed_equity
 FROM companies c JOIN company_economy e ON e.company_id=c.id AND e.user_id=c.user_id
 LEFT JOIN economy_journal j ON j.company_id=c.id AND j.user_id=c.user_id
 WHERE c.user_id=$1 GROUP BY c.id,e.company_id ORDER BY c.name`,[userId]);
 const financialStatements=companies.map(deriveFinancialStatement);
 const journal=await sql('SELECT j.*,c.name AS company_name FROM economy_journal j JOIN companies c ON c.id=j.company_id AND c.user_id=j.user_id WHERE j.user_id=$1 ORDER BY j.effective_at DESC,j.id LIMIT 100',[userId]);
 const tasks=await sql('SELECT t.*,c.name AS assignee_name FROM business_tasks t JOIN contacts c ON c.id=t.assignee_id AND c.user_id=t.user_id WHERE t.user_id=$1 ORDER BY t.created_at DESC LIMIT 100',[userId]);
 return {companies,journal,tasks,financialStatements};
}
// Daily operating model, not an historical reconstruction. Each day is a distinct durable action.
export async function advanceEconomy(userId){
 const list=await sql('SELECT id FROM companies WHERE user_id=$1 ORDER BY id',[userId]);
 for(const item of list)await transaction(async q=>{
  const c=await initialize(q,userId,item.id);
  for(let i=0;i<3;i++){
   const e=(await q(`SELECT next_day::text AS day,round(annual_sales_assumption/365,2)::text AS sales,
   round(annual_sales_assumption/365*cost_ratio,2)::text AS costs
   FROM company_economy WHERE company_id=$1 AND next_day<=(now() AT TIME ZONE 'UTC')::date FOR UPDATE`,[c.id]))[0];
   if(!e)break;
   const key='operation:'+c.id+':'+e.day;
   if(Number(e.sales)>0)await post(q,c,key+':sale','sale',e.sales,'Daily modeled customer receipts','Operating engine',e.day+'T00:00:00Z');
   if(Number(e.costs)>0)await post(q,c,key+':cost','expense',e.costs,'Daily modeled operating costs','Operating engine',e.day+'T00:00:00Z');
   await q('UPDATE company_economy SET next_day=next_day+1 WHERE company_id=$1',[c.id]);
  }
 });
}
export async function assignTask(user,body){
 const taskType=body.taskType||'general';
 if(!validTaskType(taskType))throw new EconomyError('Invalid task type.');
 const key='task:'+operationKey(body.operationKey),title=String(body.title||'').trim().slice(0,140),detail=String(body.detail||'').trim().slice(0,2000);
 if(!title||!detail)throw new EconomyError('Provide a title and instructions.');
 return transaction(async q=>{
  const w=(await q('SELECT id FROM worlds WHERE user_id=$1 FOR UPDATE',[user.id]))[0];
  if(!w)throw new EconomyError('Empire unavailable.',404);
  const person=(await q("SELECT id,name,title FROM contacts WHERE id=$1 AND user_id=$2 AND world_id=$3 AND kind='internal'",[body.assigneeId,user.id,w.id]))[0];
  if(!person)throw new EconomyError('Select an internal executive.',404);
  const c=body.companyId?await initialize(q,user.id,body.companyId):null;
  if(!canAssignTask(taskType,person.title))throw new EconomyError('This executive is not authorized for that task type.',403);
  if(['financial-review','contract-review','portfolio-review'].includes(taskType)&&!c)throw new EconomyError('Select a company for this task.');
  const previous=(await q('SELECT * FROM business_tasks WHERE user_id=$1 AND operation_key=$2',[user.id,key]))[0];
  if(previous){
   if(previous.assignee_id!==person.id||previous.company_id!==(c?.id||null)||previous.title!==title||previous.detail!==detail||previous.task_type!==taskType)throw new EconomyError('Operation reference already used.',409);
   return previous;
  }
  const task=(await q('INSERT INTO business_tasks(id,user_id,world_id,company_id,assignee_id,title,detail,operation_key,task_type) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[uid(),user.id,w.id,c?.id||null,person.id,title,detail,key,taskType]))[0];
  await q('INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),user.id,w.id,person.id,'task-assigned',title,'Assigned by Chairman to '+person.name+': '+detail]);
  return task;
 });
}
export async function cancelTask(user,taskId){
 return transaction(async q=>{
  const t=(await q("UPDATE business_tasks SET status='cancelled',completed_at=now() WHERE id=$1 AND user_id=$2 AND status='assigned' RETURNING *",[taskId,user.id]))[0];
  if(!t)throw new EconomyError('Task is not available for cancellation.',409);
  await q('INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),user.id,t.world_id,t.assignee_id,'task-cancelled',t.title,'Cancelled by Chairman']);
  return t;
 });
}

// Execute only task types with deterministic, evidence-backed handlers.
export async function executeBusinessTasks(userId){
 const tasks=await sql("SELECT id FROM business_tasks WHERE user_id=$1 AND status='assigned' AND task_type<>'general' ORDER BY created_at LIMIT 8",[userId]);
 for(const item of tasks)await transaction(async q=>{
  const candidate=(await q("SELECT * FROM business_tasks WHERE id=$1 AND user_id=$2 AND status='assigned'",[item.id,userId]))[0];
  if(!candidate)return;
  const c=candidate.company_id?await initialize(q,userId,candidate.company_id):null;
  const t=(await q("SELECT * FROM business_tasks WHERE id=$1 AND user_id=$2 AND status='assigned' FOR UPDATE",[item.id,userId]))[0];
  if(!t)return;
  const person=(await q("SELECT name,title FROM contacts WHERE id=$1 AND user_id=$2 AND kind='internal' FOR SHARE",[t.assignee_id,userId]))[0];
  if(!person||!canAssignTask(t.task_type,person.title))return;
  let lines=['Task: '+t.title,'Instructions: '+t.detail,'Prepared by: '+person.name+' ('+person.title+')','Generated: '+new Date().toISOString(),'Evidence scope: persistent records currently available in Chairman’s Office.'];
  if(t.task_type==='financial-review'){
   const figures=await totals(q,userId,c.id);
   lines.push('Company: '+c.name,'Cash: USD '+figures.cash,'Recorded revenue: USD '+figures.revenue,'Recorded expenses: USD '+figures.expenses,'Opening capital is not revenue. This is a ledger snapshot, not an audited forecast.');
  }else if(t.task_type==='contract-review'){
   const contracts=await q('SELECT title,counterparty,value,status,terms,created_at FROM business_contracts WHERE user_id=$1 AND company_id=$2 ORDER BY created_at DESC LIMIT 50',[userId,c.id]);
   lines.push('Company: '+c.name,'Contracts reviewed: '+contracts.length,JSON.stringify(contracts));
  }else if(t.task_type==='investigation-review'){
   const cases=await q("SELECT id,title,allegation,severity,status,finding FROM investigation_cases WHERE user_id=$1 AND status IN ('open','in-review') ORDER BY opened_at",[userId]);
   const evidence=cases.length?await q('SELECT case_id,evidence_type,description,source_reference,confidence FROM investigation_evidence WHERE user_id=$1 AND case_id=ANY($2::uuid[]) ORDER BY created_at',[userId,cases.map(x=>x.id)]):[];
   lines.push('Open cases: '+cases.length,JSON.stringify(cases),'Evidence records: '+evidence.length,JSON.stringify(evidence),'Do not treat allegations as findings; this report makes no independent determination.');
  }else if(t.task_type==='employee-review'){
   const staff=await q('SELECT p.name,e.job_title,e.annual_salary,e.salary_basis,e.status,e.hired_at,e.terminated_at FROM employment_records e JOIN contacts p ON p.id=e.contact_id AND p.user_id=e.user_id WHERE e.user_id=$1 AND ($2::uuid IS NULL OR e.company_id=$2) ORDER BY e.status,p.name',[userId,c?.id||null]);
   lines.push('Employment records: '+staff.length,JSON.stringify(staff),'Salary values marked opening-assumption are fictional starting assumptions, not historical payroll proof.');
  }else if(t.task_type==='portfolio-review'){
   const companies=await q(`SELECT c.name,c.sector,c.valuation,e.annual_sales_assumption,
    coalesce(sum(CASE WHEN j.debit='cash' THEN j.amount WHEN j.credit='cash' THEN -j.amount ELSE 0 END),0)::text cash,
    coalesce(sum(j.amount) FILTER(WHERE j.credit='revenue'),0)::text revenue,
    coalesce(sum(j.amount) FILTER(WHERE j.debit='expense'),0)::text expenses
    FROM companies c JOIN company_economy e ON e.company_id=c.id
    LEFT JOIN economy_journal j ON j.company_id=c.id
    WHERE c.user_id=$1 GROUP BY c.id,e.company_id ORDER BY c.name`,[userId]);
   lines.push('Portfolio snapshot: '+JSON.stringify(companies),'Annual sales assumptions are not actual recorded revenue.');
  }else if(t.task_type==='meeting-preparation'||t.task_type==='prepare-briefing'){
   const meetings=await q("SELECT title,start_at,status FROM meetings WHERE user_id=$1 AND status<>'concluded' ORDER BY start_at LIMIT 20",[userId]);
   const threads=await q("SELECT title,summary,priority,status,updated_at FROM threads WHERE user_id=$1 AND status='open' ORDER BY CASE priority WHEN 'high' THEN 0 ELSE 1 END,updated_at DESC LIMIT 30",[userId]);
   const events=await q('SELECT title,body,created_at FROM events WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20',[userId]);
   lines.push('Upcoming and active meetings: '+JSON.stringify(meetings),'Open matters: '+JSON.stringify(threads),'Recent recorded events: '+JSON.stringify(events));
  }else return;
  const documentId=uid(),report=lines.join('\n\n');
  await q('INSERT INTO documents(id,user_id,world_id,contact_id,title,kind,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[documentId,userId,t.world_id,t.assignee_id,t.title,t.task_type,report]);
  await q("UPDATE business_tasks SET status='completed',completed_at=now(),outcome=$2,outcome_document_id=$3 WHERE id=$1",[t.id,'Evidence-backed report filed in Documents.',documentId]);
  await q('INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),userId,t.world_id,t.assignee_id,'task-completed',t.title,'An evidence-backed report was filed in Documents.']);
 });
}
