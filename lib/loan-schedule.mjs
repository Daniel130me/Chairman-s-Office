import {sql,transaction,uid} from '../backend/src/db.mjs';
import {recordSystemInterestAccrual} from './economy.mjs';
import {buildLoanSchedule,loanMoney,loanCents,monthlyInterest,allocateLoanPayment} from './loan-rules.mjs';

export async function initializeLoanSchedule(q,loan){
 const rows=buildLoanSchedule(loan.principal,loan.annual_interest_rate,loan.term_months,loan.disbursed_at);
 await q(`INSERT INTO company_loan_installments(id,user_id,loan_id,installment,due_date,principal_due,estimated_interest)
 SELECT x.id,$1,$2,x.installment,x.due_date,x.principal_due,x.estimated_interest
 FROM jsonb_to_recordset($3::jsonb) AS x(id uuid,installment integer,due_date date,principal_due numeric,estimated_interest numeric)
 ON CONFLICT(loan_id,installment) DO NOTHING`,[loan.user_id,loan.id,JSON.stringify(rows.map(r=>({...r,id:uid()})))]);
 await q('UPDATE company_loans SET schedule_version=1 WHERE id=$1 AND user_id=$2',[loan.id,loan.user_id]);
}
// Caller holds the loan row lock. Accrual precedes any payment, so a delayed
// engine tick cannot erase interest owed before that payment.
export async function accrueLoan(q,loan){
 if(loan.transferred_at||loan.schedule_version!==1||loan.status!=='disbursed')return;
 const rows=await q(`SELECT * FROM company_loan_installments
 WHERE loan_id=$1 AND user_id=$2 AND due_date<=(now() AT TIME ZONE 'UTC')::date
 ORDER BY installment FOR UPDATE`,[loan.id,loan.user_id]);
 const company=(await q('SELECT * FROM companies WHERE id=$1 AND user_id=$2 FOR UPDATE',[loan.company_id,loan.user_id]))[0];
 if(!company)throw Error('Loan company unavailable');
 const balance=loanCents(loan.outstanding_principal);
 for(const row of rows){
  const interest=row.accrued_at?loanCents(row.interest_due):monthlyInterest(balance,loan.annual_interest_rate);
  if(!row.accrued_at){
   if(interest>0n)await recordSystemInterestAccrual(q,company,'loan:'+loan.id+':interest:'+row.installment,loanMoney(interest),'Monthly interest due to '+loan.lender_name+' · installment '+row.installment,'Financing');
   await q('UPDATE company_loan_installments SET interest_due=$1,accrued_at=now() WHERE id=$2 AND user_id=$3',[loanMoney(interest),row.id,loan.user_id]);
  }
  const overdue=loanCents(row.principal_due)-loanCents(row.principal_paid)+interest-loanCents(row.interest_paid);
  if(overdue>0n&&!row.overdue_notified_at){
   const late=(await q("SELECT $1::date<(now() AT TIME ZONE 'UTC')::date AS late",[row.due_date]))[0].late;
   if(late){
    await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),loan.user_id,loan.world_id,'loan-overdue','Overdue loan installment · '+loan.lender_name,company.name+' · Installment '+row.installment+' · USD '+loanMoney(overdue)+' unpaid.']);
    await q('UPDATE company_loan_installments SET overdue_notified_at=now() WHERE id=$1 AND user_id=$2',[row.id,loan.user_id]);
   }
  }
 }
}
export async function applyScheduledPayment(q,loan,principal,interest){
 await accrueLoan(q,loan);
 const rows=await q('SELECT * FROM company_loan_installments WHERE loan_id=$1 AND user_id=$2 ORDER BY installment FOR UPDATE',[loan.id,loan.user_id]);
 if(!rows.length)throw Error('Loan schedule missing');
 const allocations=allocateLoanPayment(rows,principal,interest);
 for(const row of allocations)await q('UPDATE company_loan_installments SET principal_paid=principal_paid+$1::numeric,interest_paid=interest_paid+$2::numeric WHERE id=$3 AND user_id=$4',[row.principal,row.interest,row.id,loan.user_id]);
 const remaining=rows.reduce((sum,r)=>sum+loanCents(r.interest_due)-loanCents(r.interest_paid),0n)-loanCents(interest);
 return remaining;
}
export async function processLoanObligations(userId){
 const loans=await sql(`SELECT l.id FROM company_loans l WHERE l.user_id=$1 AND l.status='disbursed' AND l.transferred_at IS NULL AND l.schedule_version=1
 AND EXISTS(SELECT 1 FROM company_loan_installments i WHERE i.user_id=l.user_id AND i.loan_id=l.id AND i.due_date<=(now() AT TIME ZONE 'UTC')::date
 AND (i.accrued_at IS NULL OR (i.due_date<(now() AT TIME ZONE 'UTC')::date AND i.overdue_notified_at IS NULL AND (i.principal_due>i.principal_paid OR i.interest_due>i.interest_paid))))
 ORDER BY l.disbursed_at,l.id LIMIT 10`,[userId]);
 for(const {id} of loans)await transaction(async q=>{
  const [seed]=await q("SELECT company_id FROM company_loans WHERE id=$1 AND user_id=$2 AND status='disbursed' AND transferred_at IS NULL",[id,userId]);if(!seed)return;
  const [company]=await q('SELECT id FROM companies WHERE id=$1 AND user_id=$2 AND disposed_at IS NULL FOR UPDATE',[seed.company_id,userId]);if(!company)return;
  const [loan]=await q("SELECT * FROM company_loans WHERE id=$1 AND user_id=$2 AND status='disbursed' AND transferred_at IS NULL FOR UPDATE",[id,userId]);
  if(loan&&!loan.transferred_at)await accrueLoan(q,loan);
 });
}
