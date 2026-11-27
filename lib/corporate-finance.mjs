import {sql,transaction,uid} from '../backend/src/db.mjs';
import {EconomyError,amountString,operationKey} from './economy-rules.mjs';
import {economySnapshot,recordSystemLoanDraw,recordSystemLoanPayment,recordSystemAccruedInterestPayment,recordSystemInvestmentSale,recordSystemInvestmentImpairment,recordSystemInvestmentGain} from './economy.mjs';
import {initializeLoanSchedule,accrueLoan,applyScheduledPayment} from './loan-schedule.mjs';
import {cents,money,evaluateCovenant,consolidateGroup,validateDiligence} from './corporate-finance-rules.mjs';
const clean=(v,n=500)=>typeof v==='string'?v.trim().slice(0,n):'';
const need=(v,msg)=>{if(!v)throw new EconomyError(msg);return v;};
const event=async(q,userId,worldId,kind,title,body)=>q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),userId,worldId,kind,title,body]);
async function loanLock(q,userId,id){
 const [l]=await q('SELECT * FROM company_loans WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,userId]);if(!l)throw new EconomyError('Loan unavailable.',404);return l;
}
async function balances(q,userId,companyId){
 const [r]=await q(`SELECT coalesce(sum(CASE WHEN debit='cash' THEN amount WHEN credit='cash' THEN -amount ELSE 0 END),0)::text cash,
 coalesce(sum(CASE WHEN credit='loans_payable' THEN amount WHEN debit='loans_payable' THEN -amount ELSE 0 END),0)::text debt,
 coalesce(sum(CASE WHEN debit='fixed_assets' THEN amount WHEN credit='fixed_assets' THEN -amount ELSE 0 END),0)::text fixed_assets FROM economy_journal WHERE user_id=$1 AND company_id=$2`,[userId,companyId]);return r;
}
export async function saveDiligence(user,id,body){
 const area=body.area,status=body.status,evidence=clean(body.evidence,1800);
 if(!['financial','legal','commercial','operational'].includes(area)||!['pending','cleared','blocked'].includes(status)||evidence.length<10)throw new EconomyError('Record a valid diligence area, status and supporting evidence.');
 return transaction(async q=>{
  const [deal]=await q("SELECT * FROM company_acquisitions WHERE id=$1 AND user_id=$2 FOR UPDATE",[id,user.id]);
  if(!deal||!['draft','approved'].includes(deal.status))throw new EconomyError('Open acquisition unavailable.',409);
  const [row]=await q(`INSERT INTO acquisition_diligence(id,user_id,acquisition_id,area,status,evidence) VALUES($1,$2,$3,$4,$5,$6)
  ON CONFLICT(user_id,acquisition_id,area) DO UPDATE SET status=excluded.status,evidence=excluded.evidence,updated_at=now() RETURNING *`,[uid(),user.id,id,area,status,evidence]);
  await event(q,user.id,deal.world_id,'acquisition-diligence',deal.target_name+' · '+area,status+' · '+evidence);return row;
 });
}
export async function requireDiligence(q,deal){
 if(!deal.diligence_required)return;
 const rows=await q('SELECT area,status,evidence FROM acquisition_diligence WHERE acquisition_id=$1 AND user_id=$2',[deal.id,deal.user_id]);
 if(!validateDiligence(rows))throw new EconomyError('Clear all four due diligence areas before approval or completion.',409);
}
export async function setLoanTerms(user,id,body){
 const kind=body.kind,description=clean(body.description),threshold=String(body.threshold??'');
 return transaction(async q=>{
  const l=await loanLock(q,user.id,id);
  if(!['draft','approved'].includes(l.status))throw new EconomyError('Terms can only be set before disbursement.',409);
  await q('SELECT id FROM companies WHERE id=$1 AND user_id=$2 FOR UPDATE',[l.company_id,user.id]);
  if(kind==='collateral'){
   const pledged=amountString(body.amount);need(description,'Describe the fixed asset pool securing this loan.');
   const b=await balances(q,user.id,l.company_id);
   const [p]=await q(`SELECT coalesce(sum(c.pledged_amount),0)::text amount FROM loan_collateral c JOIN company_loans l ON l.id=c.loan_id AND l.user_id=c.user_id WHERE l.user_id=$1 AND l.company_id=$2 AND l.id<>$3 AND l.status IN ('draft','approved','disbursed')`,[user.id,l.company_id,id]);
   if(cents(pledged)+cents(p.amount)>cents(b.fixed_assets))throw new EconomyError('Pledge exceeds uncommitted recorded fixed assets.',409);
   const [row]=await q(`INSERT INTO loan_collateral(id,user_id,loan_id,pledged_amount,description) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,loan_id) DO UPDATE SET pledged_amount=excluded.pledged_amount,description=excluded.description RETURNING *`,[uid(),user.id,id,pledged,description]);
   await event(q,user.id,l.world_id,'loan-collateral','Collateral pledged · '+l.lender_name,description+' · USD '+pledged);return row;
  }
  if(!['minimum-cash','maximum-debt'].includes(kind)||!/^\d{1,12}(?:\.\d{1,2})?$/.test(threshold))throw new EconomyError('Select a covenant and valid threshold.');
  const [row]=await q(`INSERT INTO loan_covenants(id,user_id,loan_id,kind,threshold) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,loan_id,kind) DO UPDATE SET threshold=excluded.threshold,last_status=NULL,last_actual=NULL,checked_at=NULL RETURNING *`,[uid(),user.id,id,kind,threshold]);
  await event(q,user.id,l.world_id,'loan-covenant','Loan covenant · '+l.lender_name,kind+' · USD '+threshold);return row;
 });
}
export async function checkCollateral(q,l){
 const [p]=await q(`SELECT coalesce(sum(c.pledged_amount),0)::text amount FROM loan_collateral c JOIN company_loans l ON l.id=c.loan_id AND l.user_id=c.user_id WHERE l.user_id=$1 AND l.company_id=$2 AND l.status IN ('draft','approved','disbursed')`,[l.user_id,l.company_id]);
 if(cents(p.amount)>cents((await balances(q,l.user_id,l.company_id)).fixed_assets))throw new EconomyError('Collateral coverage is insufficient.',409);
}
export async function processCovenants(userId){
 const rows=await sql(`SELECT c.id FROM loan_covenants c JOIN company_loans l ON l.id=c.loan_id AND l.user_id=c.user_id WHERE c.user_id=$1 AND l.status='disbursed' AND (c.checked_at IS NULL OR c.checked_at<now()-interval '1 hour') ORDER BY c.checked_at NULLS FIRST LIMIT 20`,[userId]);
 for(const {id} of rows)await transaction(async q=>{
  const [c]=await q('SELECT * FROM loan_covenants WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,userId]);if(!c)return;
  if(c.checked_at&&Date.now()-new Date(c.checked_at).getTime()<3600000)return;
  const l=await loanLock(q,userId,c.loan_id);if(l.status!=='disbursed')return;
  const r=evaluateCovenant(c.kind,c.threshold,await balances(q,userId,l.company_id)),status=r.breached?'breached':'compliant';
  await q('UPDATE loan_covenants SET last_actual=$1,last_status=$2,checked_at=now() WHERE id=$3 AND user_id=$4',[r.actual,status,id,userId]);
  if(status!==c.last_status&&(status==='breached'||c.last_status==='breached'))await event(q,userId,l.world_id,'loan-covenant-'+status,'Loan covenant '+status+' · '+l.lender_name,c.kind+' · actual USD '+r.actual+' · threshold USD '+c.threshold);
 });
}
export async function refinanceLoan(user,id,body){
 const key='refinance:'+operationKey(body.operationKey),lender=need(clean(body.lender,140),'Enter replacement lender.'),reason=need(clean(body.reason),'Enter refinancing rationale.'),principal=amountString(body.principal),rate=String(body.annualInterestRate??''),term=Number(body.termMonths);
 if(!/^\d{1,3}(?:\.\d{1,4})?$/.test(rate)||Number(rate)>100||!Number.isInteger(term)||term<1||term>360)throw new EconomyError('Invalid refinancing rate or term.');
 return transaction(async q=>{
  const l=await loanLock(q,user.id,id);
  const [prior]=await q('SELECT r.*,n.lender_name,n.principal,n.annual_interest_rate,n.term_months FROM loan_refinancings r JOIN company_loans n ON n.id=r.new_loan_id AND n.user_id=r.user_id WHERE r.user_id=$1 AND r.operation_key=$2',[user.id,key]);
  if(prior){if(prior.old_loan_id!==id||prior.lender_name!==lender||prior.principal!==principal||Number(prior.annual_interest_rate)!==Number(rate)||prior.term_months!==term||prior.reason!==reason)throw new EconomyError('Operation reference already used.',409);return prior;}
  if(l.status!=='disbursed'||l.schedule_version!==1||cents(l.outstanding_principal)<=0n)throw new EconomyError('Only an outstanding scheduled loan can be refinanced.',409);
  const [c]=await q('SELECT * FROM companies WHERE id=$1 AND user_id=$2 FOR UPDATE',[l.company_id,user.id]);
  await accrueLoan(q,l);
  const [i]=await q('SELECT coalesce(sum(interest_due-interest_paid),0)::text interest FROM company_loan_installments WHERE user_id=$1 AND loan_id=$2',[user.id,id]);
  const interest=money(cents(i.interest)),payoff=money(cents(l.outstanding_principal)+cents(interest));
  if(cents(principal)+cents((await balances(q,user.id,c.id)).cash)<cents(payoff))throw new EconomyError('Replacement funds plus available cash do not cover payoff.',409);
  const newId=uid();
  const [replacement]=await q(`INSERT INTO company_loans(id,user_id,world_id,company_id,lender_name,principal,outstanding_principal,annual_interest_rate,term_months,purpose,operation_key,status,approved_at,disbursed_at)
  VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,'disbursed',now(),now()) RETURNING *`,[newId,user.id,l.world_id,c.id,lender,principal,rate,term,'Refinancing: '+reason,key]);
  await recordSystemLoanDraw(q,c,key+':draw',principal,'Replacement financing from '+lender,'Chairman');
  await applyScheduledPayment(q,l,l.outstanding_principal,interest);
  await recordSystemLoanPayment(q,c,key+':principal',l.outstanding_principal,'Refinancing payoff to '+l.lender_name,'Chairman');
  if(cents(interest)>0n)await recordSystemAccruedInterestPayment(q,c,key+':interest',interest,'Refinancing interest payoff to '+l.lender_name,'Chairman');
  await q("UPDATE company_loans SET status='closed',outstanding_principal=0 WHERE id=$1 AND user_id=$2",[id,user.id]);
  await q('INSERT INTO company_loan_payments(id,user_id,loan_id,principal_paid,interest_paid,total_paid,reason,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[uid(),user.id,id,l.outstanding_principal,interest,payoff,reason,key]);
  await initializeLoanSchedule(q,replacement);
  const [r]=await q('INSERT INTO loan_refinancings(id,user_id,old_loan_id,new_loan_id,principal_paid,interest_paid,reason,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[uid(),user.id,id,newId,l.outstanding_principal,interest,reason,key]);
  await event(q,user.id,l.world_id,'loan-refinanced','Refinanced · '+l.lender_name,'Replacement '+lender+' USD '+principal+' · old payoff USD '+payoff+' · '+reason);return r;
 });
}
export async function adjustInvestment(user,id,body){
 const kind=body.kind,key='investment-adjustment:'+operationKey(body.operationKey),reason=need(clean(body.reason,1200),'Record the evidence and rationale.');
 if(!['impairment','disposal'].includes(kind))throw new EconomyError('Unsupported adjustment.');
 return transaction(async q=>{
  const [h]=await q('SELECT * FROM company_investments WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]);if(!h)throw new EconomyError('Holding unavailable.',404);
  const [prior]=await q('SELECT * FROM investment_adjustments WHERE user_id=$1 AND operation_key=$2',[user.id,key]);if(prior){if(prior.investment_id!==id||prior.kind!==kind||prior.reason!==reason)throw new EconomyError('Operation reference already used.',409);return prior;}
  if(h.status!=='active')throw new EconomyError('Holding already exited.',409);
  const [c]=await q('SELECT * FROM companies WHERE id=$1 AND user_id=$2 FOR UPDATE',[h.investor_company_id,user.id]);
  const carrying=cents(h.carrying_amount??h.cost_basis);let amount=0n,proceeds=null,stake=null;
  if(kind==='impairment'){
   amount=cents(amountString(body.amount));if(amount>carrying)throw new EconomyError('Impairment exceeds carrying amount.',409);
   await recordSystemInvestmentImpairment(q,c,key,money(amount),'Impairment: '+h.target_name,'Chairman');
   await q('UPDATE company_investments SET carrying_amount=$1,current_value=least(current_value,$1::numeric) WHERE id=$2 AND user_id=$3',[money(carrying-amount),id,user.id]);
  }else{
   if(h.target_company_id)throw new EconomyError('Controlled subsidiaries require a separate deconsolidation transaction; not available yet.',409);
   const raw=String(body.stakeSold??'');if(!/^\d{1,3}(?:\.\d{1,2})?$/.test(raw))throw new EconomyError('Enter stake percentage points sold.');
   const sold=cents(raw),owned=cents(h.ownership_percentage);if(sold<=0n||sold>owned)throw new EconomyError('Stake sold exceeds ownership.');
   const gross=cents(amountString(body.proceeds));stake=money(sold);proceeds=money(gross);amount=carrying*sold/owned;
   const recovery=gross<amount?gross:amount;
   if(recovery>0n)await recordSystemInvestmentSale(q,c,key+':basis',money(recovery),'Disposal: '+h.target_name,'Chairman');
   if(amount>gross)await recordSystemInvestmentImpairment(q,c,key+':loss',money(amount-gross),'Disposal loss: '+h.target_name,'Chairman');
   if(gross>amount)await recordSystemInvestmentGain(q,c,key+':gain',money(gross-amount),'Disposal gain: '+h.target_name,'Chairman');
   await q("UPDATE company_investments SET carrying_amount=$1,current_value=round(current_value*$2::numeric/$3::numeric,2),ownership_percentage=CASE WHEN $2::numeric=0 THEN ownership_percentage ELSE $2::numeric END,status=CASE WHEN $2::numeric=0 THEN 'exited' ELSE 'active' END WHERE id=$4 AND user_id=$5",[money(carrying-amount),money(owned-sold),money(owned),id,user.id]);
  }
  const [row]=await q('INSERT INTO investment_adjustments(id,user_id,investment_id,kind,amount,proceeds,stake_sold,reason,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[uid(),user.id,id,kind,money(amount),proceeds,stake,reason,key]);
  await event(q,user.id,h.world_id,'investment-'+kind,h.target_name+' · '+kind,'Carrying amount affected USD '+money(amount)+' · '+reason);return row;
 });
}
export async function corporateFinanceSnapshot(userId){
 const ledger=await economySnapshot(userId);
 const [companies,holdings,diligence,collateral,covenants,refinancings,adjustments]=await Promise.all([
 sql('SELECT id,name,parent_company_id,ownership_percentage FROM companies WHERE user_id=$1',[userId]),
 sql('SELECT * FROM company_investments WHERE user_id=$1',[userId]),
 sql('SELECT * FROM acquisition_diligence WHERE user_id=$1 ORDER BY updated_at DESC',[userId]),
 sql('SELECT * FROM loan_collateral WHERE user_id=$1',[userId]),
 sql('SELECT * FROM loan_covenants WHERE user_id=$1',[userId]),
 sql('SELECT * FROM loan_refinancings WHERE user_id=$1 ORDER BY created_at DESC',[userId]),
 sql('SELECT * FROM investment_adjustments WHERE user_id=$1 ORDER BY created_at DESC',[userId])
 ]);
 return {group:consolidateGroup(companies,ledger.financialStatements,holdings),diligence,collateral,covenants,refinancings,adjustments,holdings};
}
