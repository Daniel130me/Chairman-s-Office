import {sql,transaction,uid} from '../backend/src/db.mjs';
import {EconomyError,amountString,operationKey} from './economy-rules.mjs';
import {recordAcquisitionEntry,economySnapshot,recordIntercompanyEntry,recordSystemLoanDraw,recordSystemLoanPayment,recordSystemAccruedInterestPayment,recordSystemInvestmentSale,recordSystemInvestmentImpairment,recordSystemInvestmentGain} from './economy.mjs';
import {subsidiaryDisposalSnapshot} from './subsidiary-disposal.mjs';
import {initializeLoanSchedule,accrueLoan,applyScheduledPayment} from './loan-schedule.mjs';
import {cents,money,evaluateCovenant,consolidateGroup,validateDiligence,acquisitionAllocation,retainingControlSale} from './corporate-finance-rules.mjs';
const clean=(v,n=500)=>typeof v==='string'?v.trim().slice(0,n):'';
const need=(v,msg)=>{if(!v)throw new EconomyError(msg);return v;};
const event=async(q,userId,worldId,kind,title,body)=>q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),userId,worldId,kind,title,body]);
async function loanLock(q,userId,id){
 const [seed]=await q('SELECT company_id FROM company_loans WHERE id=$1 AND user_id=$2',[id,userId]);if(!seed)throw new EconomyError('Loan unavailable.',404);
 const [company]=await q('SELECT id FROM companies WHERE id=$1 AND user_id=$2 AND disposed_at IS NULL FOR UPDATE',[seed.company_id,userId]);if(!company)throw new EconomyError('Company unavailable or disposed.',404);
 const [l]=await q('SELECT * FROM company_loans WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,userId]);if(!l||l.company_id!==seed.company_id)throw new EconomyError('Loan unavailable.',404);return l;
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
function parsePayableCreditors(body,total,evidence){
 const totalCents=cents(total),raw=Array.isArray(body.payableCreditors)?body.payableCreditors:null;
 if(totalCents===0n){if((typeof body.payableSchedule==='string'&&body.payableSchedule.trim())||(raw&&raw.length))throw new EconomyError('A creditor schedule requires a positive total payable.');return [];}
 let rows=[];
 if(raw)rows=raw;
 else if(typeof body.payableSchedule==='string'&&body.payableSchedule.trim()){
  rows=body.payableSchedule.split(/\r?\n/).map(line=>{const parts=line.split('|').map(x=>x.trim());if(parts.length!==3)throw new EconomyError('Each payable schedule line must be: creditor | amount | evidence.');return {creditor:parts[0],amount:parts[1],evidence:parts[2]};});
 }else{
  rows=[{creditor:body.payableCreditor,amount:total,evidence:body.payableEvidence||evidence}];
 }
 const parsed=rows.map(row=>{
  const creditor=clean(row.creditor,200),amount=money(cents(row.amount)),proof=clean(row.evidence,1800);
  if(!creditor||cents(amount)<=0n||proof.length<10)throw new EconomyError('Every payable creditor needs a name, positive amount and specific evidence.');
  return {creditor,amount,evidence:proof};
 });
 const sum=parsed.reduce((n,row)=>n+cents(row.amount),0n);
 if(sum!==totalCents)throw new EconomyError('Creditor schedule amounts must add up exactly to the total acquired payable.');
 return parsed;
}
export async function saveAcquisitionAllocation(user,id,body){
 const cash=money(cents(body.cash)),fixed=money(cents(body.fixedAssets)),intangibles=money(cents(body.intangibles)),payables=money(cents(body.payables)),evidence=clean(body.evidence,1800),intangibleEvidence=clean(body.intangibleEvidence,1800);
 if(evidence.length<10||[cash,fixed,intangibles,payables].some(v=>cents(v)<0n)||!(body.allOpeningLiabilitiesRecorded===true||(body.zeroOpeningLiabilities===true&&cents(payables)===0n)))throw new EconomyError('Document acquired assets and confirm all opening liabilities are recorded.');
 if(cents(intangibles)>0n&&intangibleEvidence.length<10)throw new EconomyError('Document the identifiable intangible assets and their valuation.');
 const creditors=parsePayableCreditors(body,payables,evidence);
 const creditorLabel=creditors.length===0?null:creditors.length===1?creditors[0].creditor:'Multiple creditors ('+creditors.length+')';
 return transaction(async q=>{
  const [d]=await q("SELECT * FROM company_acquisitions WHERE id=$1 AND user_id=$2 FOR UPDATE",[id,user.id]);if(!d||d.status!=='draft')throw new EconomyError('Allocation can only be recorded before approval.',409);
  const calc=acquisitionAllocation(d.purchase_price,d.ownership_percentage,cash,fixed,intangibles,payables);
  const [r]=await q(`INSERT INTO acquisition_allocations(id,user_id,acquisition_id,acquired_cash,acquired_fixed_assets,evidence,acquired_intangibles,acquired_payables,intangible_evidence,payable_creditor) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(user_id,acquisition_id) DO UPDATE SET acquired_cash=excluded.acquired_cash,acquired_fixed_assets=excluded.acquired_fixed_assets,evidence=excluded.evidence,acquired_intangibles=excluded.acquired_intangibles,acquired_payables=excluded.acquired_payables,intangible_evidence=excluded.intangible_evidence,payable_creditor=excluded.payable_creditor,updated_at=now() RETURNING *`,[uid(),user.id,id,cash,fixed,evidence,intangibles,payables,intangibleEvidence||null,creditorLabel]);
  await q('DELETE FROM acquisition_payable_creditors WHERE user_id=$1 AND allocation_id=$2',[user.id,r.id]);
  for(const creditor of creditors)await q('INSERT INTO acquisition_payable_creditors(id,user_id,allocation_id,creditor,amount,evidence) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,r.id,creditor.creditor,creditor.amount,creditor.evidence]);
  const creditorSummary=creditors.map(x=>x.creditor+' USD '+x.amount).join('; ');
  await event(q,user.id,d.world_id,'acquisition-allocation',d.target_name+' · opening assets','Identified cash USD '+cash+' · fixed assets USD '+fixed+' · intangibles USD '+intangibles+' · assumed payables USD '+payables+(creditorSummary?' · creditors: '+creditorSummary:'')+' · modeled goodwill USD '+calc.goodwill);
  return {...r,...calc,payableCreditors:creditors};
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
  const [preview]=await q('SELECT transferred_at FROM company_loans WHERE id=$1 AND user_id=$2',[id,user.id]);if(preview?.transferred_at)throw new EconomyError('Loan transferred to the buyer; seller-side terms are locked.',409);
  const l=await loanLock(q,user.id,id);
  if(l.transferred_at)throw new EconomyError('Loan transferred to the buyer; seller-side terms are locked.',409);
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
 const rows=await sql(`SELECT c.id FROM loan_covenants c JOIN company_loans l ON l.id=c.loan_id AND l.user_id=c.user_id WHERE c.user_id=$1 AND l.status='disbursed' AND l.transferred_at IS NULL AND EXISTS(SELECT 1 FROM companies co WHERE co.id=l.company_id AND co.user_id=l.user_id AND co.disposed_at IS NULL) AND (c.checked_at IS NULL OR c.checked_at<now()-interval '1 hour') ORDER BY c.checked_at NULLS FIRST LIMIT 20`,[userId]);
 for(const {id} of rows)await transaction(async q=>{
  const [c]=await q('SELECT * FROM loan_covenants WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,userId]);if(!c)return;
  if(c.checked_at&&Date.now()-new Date(c.checked_at).getTime()<3600000)return;
  const l=await loanLock(q,userId,c.loan_id);if(l.transferred_at||l.status!=='disbursed')return;
  const r=evaluateCovenant(c.kind,c.threshold,await balances(q,userId,l.company_id)),status=r.breached?'breached':'compliant';
  await q('UPDATE loan_covenants SET last_actual=$1,last_status=$2,checked_at=now() WHERE id=$3 AND user_id=$4',[r.actual,status,id,userId]);
  if(status!==c.last_status&&(status==='breached'||c.last_status==='breached'))await event(q,userId,l.world_id,'loan-covenant-'+status,'Loan covenant '+status+' · '+l.lender_name,c.kind+' · actual USD '+r.actual+' · threshold USD '+c.threshold);
 });
}
export async function refinanceLoan(user,id,body){
 const key='refinance:'+operationKey(body.operationKey),lender=need(clean(body.lender,140),'Enter replacement lender.'),reason=need(clean(body.reason),'Enter refinancing rationale.'),principal=amountString(body.principal),rate=String(body.annualInterestRate??''),term=Number(body.termMonths);
 if(!/^\d{1,3}(?:\.\d{1,4})?$/.test(rate)||Number(rate)>100||!Number.isInteger(term)||term<1||term>360)throw new EconomyError('Invalid refinancing rate or term.');
 const pledged=body.collateralAmount?amountString(body.collateralAmount):null,description=clean(body.collateralDescription,500);
 if(pledged&&!description)throw new EconomyError('Describe replacement collateral.');
 const terms={pledged,description:pledged?description:null,covenants:[]};
 for(const [kind,input] of [['minimum-cash',body.minimumCash],['maximum-debt',body.maximumDebt]])if(input!==undefined&&input!==''){
  if(!/^\d{1,12}(?:\.\d{1,2})?$/.test(String(input)))throw new EconomyError('Invalid replacement covenant.');
  terms.covenants.push({kind,threshold:money(cents(input))});
 }
 return transaction(async q=>{
  const [prior]=await q('SELECT r.*,n.lender_name,n.principal,n.annual_interest_rate,n.term_months FROM loan_refinancings r JOIN company_loans n ON n.id=r.new_loan_id AND n.user_id=r.user_id WHERE r.user_id=$1 AND r.operation_key=$2',[user.id,key]);
  if(prior){if(prior.old_loan_id!==id||prior.lender_name!==lender||prior.principal!==principal||Number(prior.annual_interest_rate)!==Number(rate)||prior.term_months!==term||prior.reason!==reason||(Object.keys(prior.replacement_terms||{}).length?JSON.stringify((prior.replacement_terms.covenants||[]).map(v=>[v.kind,v.threshold]))!==JSON.stringify(terms.covenants.map(v=>[v.kind,v.threshold]))||prior.replacement_terms.pledged!==terms.pledged||prior.replacement_terms.description!==terms.description:!!pledged||terms.covenants.length>0))throw new EconomyError('Operation reference already used.',409);return prior;}
  const [preview]=await q('SELECT transferred_at FROM company_loans WHERE id=$1 AND user_id=$2',[id,user.id]);if(preview?.transferred_at)throw new EconomyError('Loan transferred to the buyer; seller-side refinancing is unavailable.',409);
  const l=await loanLock(q,user.id,id);
  const [retryPrior]=await q('SELECT r.*,n.lender_name,n.principal,n.annual_interest_rate,n.term_months FROM loan_refinancings r JOIN company_loans n ON n.id=r.new_loan_id AND n.user_id=r.user_id WHERE r.user_id=$1 AND r.operation_key=$2',[user.id,key]);
  if(retryPrior){if(retryPrior.old_loan_id!==id||retryPrior.lender_name!==lender||retryPrior.principal!==principal||Number(retryPrior.annual_interest_rate)!==Number(rate)||retryPrior.term_months!==term||retryPrior.reason!==reason||(Object.keys(retryPrior.replacement_terms||{}).length?JSON.stringify((retryPrior.replacement_terms.covenants||[]).map(v=>[v.kind,v.threshold]))!==JSON.stringify(terms.covenants.map(v=>[v.kind,v.threshold]))||retryPrior.replacement_terms.pledged!==terms.pledged||retryPrior.replacement_terms.description!==terms.description:!!pledged||terms.covenants.length>0))throw new EconomyError('Operation reference already used.',409);return retryPrior;}
  if(l.transferred_at)throw new EconomyError('Loan transferred to the buyer; seller-side refinancing is unavailable.',409);
  if(l.status!=='disbursed'||l.schedule_version!==1||cents(l.outstanding_principal)<=0n)throw new EconomyError('Only an outstanding scheduled loan can be refinanced.',409);
  const [c]=await q('SELECT * FROM companies WHERE id=$1 AND user_id=$2 FOR UPDATE',[l.company_id,user.id]);
  if(pledged){
   const [p]=await q("SELECT coalesce(sum(x.pledged_amount),0)::text amount FROM loan_collateral x JOIN company_loans l ON l.id=x.loan_id AND l.user_id=x.user_id WHERE l.user_id=$1 AND l.company_id=$2 AND l.id<>$3 AND l.status IN ('draft','approved','disbursed')",[user.id,c.id,id]);
   if(cents(pledged)+cents(p.amount)>cents((await balances(q,user.id,c.id)).fixed_assets))throw new EconomyError('Replacement security exceeds uncommitted assets after release of old loan.',409);
  }
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
  if(pledged)await q('INSERT INTO loan_collateral(id,user_id,loan_id,pledged_amount,description) VALUES($1,$2,$3,$4,$5)',[uid(),user.id,newId,pledged,description]);
  for(const covenant of terms.covenants)await q('INSERT INTO loan_covenants(id,user_id,loan_id,kind,threshold) VALUES($1,$2,$3,$4,$5)',[uid(),user.id,newId,covenant.kind,covenant.threshold]);
  await initializeLoanSchedule(q,replacement);
  const [r]=await q('INSERT INTO loan_refinancings(id,user_id,old_loan_id,new_loan_id,principal_paid,interest_paid,reason,operation_key,replacement_terms) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[uid(),user.id,id,newId,l.outstanding_principal,interest,reason,key,JSON.stringify(terms)]);
  await event(q,user.id,l.world_id,'loan-refinanced','Refinanced · '+l.lender_name,'Replacement '+lender+' USD '+principal+' · old payoff USD '+payoff+' · '+reason);return r;
 });
}
export async function adjustInvestment(user,id,body){
 const kind=body.kind,key='investment-adjustment:'+operationKey(body.operationKey),reason=need(clean(body.reason,1200),'Record the evidence and rationale.');
 if(!['impairment','disposal'].includes(kind))throw new EconomyError('Unsupported adjustment.');
 return transaction(async q=>{
  const [h]=await q('SELECT * FROM company_investments WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]);if(!h)throw new EconomyError('Holding unavailable.',404);
  const [prior]=await q('SELECT * FROM investment_adjustments WHERE user_id=$1 AND operation_key=$2',[user.id,key]);if(prior){const sameAmount=kind==='impairment'?prior.amount===amountString(body.amount):prior.proceeds===amountString(body.proceeds)&&Number(prior.stake_sold)===Number(body.stakeSold);if(prior.investment_id!==id||prior.kind!==kind||prior.reason!==reason||!sameAmount)throw new EconomyError('Operation reference already used.',409);return prior;}
  if(h.status!=='active')throw new EconomyError('Holding already exited.',409);
  const [c]=await q('SELECT * FROM companies WHERE id=$1 AND user_id=$2 FOR UPDATE',[h.investor_company_id,user.id]);
  const carrying=cents(h.carrying_amount??h.cost_basis);let amount=0n,proceeds=null,stake=null,controlSale=null;
  if(kind==='impairment'){
   amount=cents(amountString(body.amount));if(amount>carrying)throw new EconomyError('Impairment exceeds carrying amount.',409);
   const [allocation]=await q('SELECT acquired_cash,acquired_fixed_assets,acquired_intangibles,acquired_payables FROM acquisition_allocations WHERE user_id=$1 AND acquisition_id=$2',[user.id,h.acquisition_id]);
   if(allocation&&h.target_company_id){const floor=((cents(allocation.acquired_cash)+cents(allocation.acquired_fixed_assets)+cents(allocation.acquired_intangibles)-cents(allocation.acquired_payables))*cents(h.original_ownership_percentage??h.ownership_percentage)+5000n)/10000n;const [sold]=await q('SELECT coalesce(sum(s.carrying_basis),0)::text basis FROM control_retaining_sales s JOIN investment_adjustments a ON a.id=s.adjustment_id AND a.user_id=s.user_id WHERE a.investment_id=$1 AND a.user_id=$2',[id,user.id]);if(carrying+cents(sold.basis)-amount<floor)throw new EconomyError('Impairment below the allocated net asset share requires a separate asset impairment review.',409);}
   await recordSystemInvestmentImpairment(q,c,key,money(amount),'Impairment: '+h.target_name,'Chairman');
   await q('UPDATE company_investments SET carrying_amount=$1,current_value=least(current_value,$1::numeric) WHERE id=$2 AND user_id=$3',[money(carrying-amount),id,user.id]);
  }else{
   const raw=String(body.stakeSold??'');if(!/^\d{1,3}(?:\.\d{1,2})?$/.test(raw))throw new EconomyError('Enter stake percentage points sold.');
   const sold=cents(raw),owned=cents(h.ownership_percentage);if(sold<=0n||sold>owned)throw new EconomyError('Stake sold exceeds ownership.');
   const gross=cents(amountString(body.proceeds));stake=money(sold);proceeds=money(gross);amount=carrying*sold/owned;
   if(h.target_company_id){
    const [sub]=await q('SELECT * FROM companies WHERE id=$1 AND user_id=$2 FOR UPDATE',[h.target_company_id,user.id]);
    if(!sub||sub.parent_company_id!==c.id||cents(sub.ownership_percentage)!==owned)throw new EconomyError('Subsidiary ownership needs reconciliation.',409);
    controlSale=retainingControlSale(h.ownership_percentage,stake,money(carrying),proceeds);
    await q('UPDATE companies SET ownership_percentage=$1 WHERE id=$2 AND user_id=$3',[controlSale.remainingStake,sub.id,user.id]);
    await q('UPDATE company_investments SET original_ownership_percentage=coalesce(original_ownership_percentage,ownership_percentage) WHERE id=$1 AND user_id=$2',[id,user.id]);
   }
   const recovery=gross<amount?gross:amount;
   if(recovery>0n)await recordSystemInvestmentSale(q,c,key+':basis',money(recovery),'Disposal: '+h.target_name,'Chairman');
   if(amount>gross)await recordSystemInvestmentImpairment(q,c,key+':loss',money(amount-gross),'Disposal loss: '+h.target_name,'Chairman');
   if(gross>amount)await recordSystemInvestmentGain(q,c,key+':gain',money(gross-amount),'Disposal gain: '+h.target_name,'Chairman');
   await q("UPDATE company_investments SET carrying_amount=$1,current_value=round(current_value*$2::numeric/$3::numeric,2),ownership_percentage=CASE WHEN $2::numeric=0 THEN ownership_percentage ELSE $2::numeric END,status=CASE WHEN $2::numeric=0 THEN 'exited' ELSE 'active' END WHERE id=$4 AND user_id=$5",[money(carrying-amount),money(owned-sold),money(owned),id,user.id]);
  }
  const [row]=await q('INSERT INTO investment_adjustments(id,user_id,investment_id,kind,amount,proceeds,stake_sold,reason,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[uid(),user.id,id,kind,money(amount),proceeds,stake,reason,key]);
  if(controlSale)await q('INSERT INTO control_retaining_sales(adjustment_id,user_id,subsidiary_id,previous_ownership,remaining_ownership,carrying_basis,gain) VALUES($1,$2,$3,$4,$5,$6,$7)',[row.id,user.id,h.target_company_id,h.ownership_percentage,controlSale.remainingStake,controlSale.basis,controlSale.gain]);
  await event(q,user.id,h.world_id,'investment-'+kind,h.target_name+' · '+kind,'Carrying amount affected USD '+money(amount)+' · '+reason);return row;
 });
}
async function lockPair(q,userId,a,b){
 if(a===b)throw new EconomyError('Choose two different companies.');
 const rows=await q('SELECT * FROM companies WHERE user_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE',[userId,[a,b]]);
 if(rows.length!==2||rows[0].world_id!==rows[1].world_id)throw new EconomyError('Company pair unavailable.',404);
 return [rows.find(c=>c.id===a),rows.find(c=>c.id===b)];
}
export async function advanceIntercompany(user,body){
 const key='intercompany:'+operationKey(body.operationKey),amount=amountString(body.amount),purpose=need(clean(body.purpose),'Enter the business purpose.');
 return transaction(async q=>{
  const [prior]=await q('SELECT * FROM intercompany_facilities WHERE user_id=$1 AND operation_key=$2',[user.id,key]);
  if(prior){if(prior.lender_company_id!==body.lenderCompanyId||prior.borrower_company_id!==body.borrowerCompanyId||prior.principal!==amount||prior.purpose!==purpose)throw new EconomyError('Operation reference already used.',409);return prior;}
  const [l,b]=await lockPair(q,user.id,body.lenderCompanyId,body.borrowerCompanyId);
  const [retryPrior]=await q('SELECT * FROM intercompany_facilities WHERE user_id=$1 AND operation_key=$2',[user.id,key]);
  if(retryPrior){if(retryPrior.lender_company_id!==l.id||retryPrior.borrower_company_id!==b.id||retryPrior.principal!==amount||retryPrior.purpose!==purpose)throw new EconomyError('Operation reference already used.',409);return retryPrior;}
  if(l.disposed_at||b.disposed_at)throw new EconomyError('Cannot fund a disposed company.',409);
  await recordIntercompanyEntry(q,l,key+':advance','intercompany-advance',amount,'Internal funding to '+b.name);
  await recordIntercompanyEntry(q,b,key+':receipt','intercompany-receipt',amount,'Internal funding from '+l.name);
  const [row]=await q('INSERT INTO intercompany_facilities(id,user_id,world_id,lender_company_id,borrower_company_id,principal,outstanding,purpose,operation_key) VALUES($1,$2,$3,$4,$5,$6,$6,$7,$8) RETURNING *',[uid(),user.id,l.world_id,l.id,b.id,amount,purpose,key]);
  await event(q,user.id,l.world_id,'intercompany-advance',l.name+' → '+b.name,'Internal loan USD '+amount+' · '+purpose);return row;
 });
}
export async function repayIntercompany(user,id,body){
 const key='intercompany-repay:'+operationKey(body.operationKey),amount=amountString(body.amount),reason=need(clean(body.reason),'Record repayment reason.');
 return transaction(async q=>{
  const [preview]=await q('SELECT * FROM intercompany_facilities WHERE id=$1 AND user_id=$2',[id,user.id]);if(!preview)throw new EconomyError('Facility unavailable.',404);
  const validate=prior=>{if(prior&&(prior.facility_id!==id||prior.amount!==amount||prior.reason!==reason))throw new EconomyError('Operation reference already used.',409);return prior;};
  let prior=validate((await q('SELECT * FROM intercompany_repayments WHERE user_id=$1 AND operation_key=$2',[user.id,key]))[0]);if(prior)return prior;
  if(preview.transferred_at)throw new EconomyError('This facility transferred with the disposed subsidiary; the buyer now administers it.',409);
  // Company rows are always locked before facility rows, matching disposal and
  // new-advance operations so a close cannot deadlock with a repayment.
  const [l,b]=await lockPair(q,user.id,preview.lender_company_id,preview.borrower_company_id);
  const [f]=await q('SELECT * FROM intercompany_facilities WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]);if(!f)throw new EconomyError('Facility unavailable.',404);
  prior=validate((await q('SELECT * FROM intercompany_repayments WHERE user_id=$1 AND operation_key=$2',[user.id,key]))[0]);if(prior)return prior;
  if(f.transferred_at)throw new EconomyError('This facility transferred with the disposed subsidiary; the buyer now administers it.',409);
  if(l.disposed_at||b.disposed_at)throw new EconomyError('Company pair unavailable or disposed.',409);
  if(cents(amount)>cents(f.outstanding))throw new EconomyError('Payment exceeds internal debt.',409);
  await recordIntercompanyEntry(q,b,key+':payment','intercompany-repayment',amount,'Internal repayment to '+l.name);
  await recordIntercompanyEntry(q,l,key+':collection','intercompany-collection',amount,'Internal repayment from '+b.name);
  await q('UPDATE intercompany_facilities SET outstanding=outstanding-$1::numeric WHERE id=$2 AND user_id=$3',[amount,id,user.id]);
  const [row]=await q('INSERT INTO intercompany_repayments(id,user_id,facility_id,amount,reason,operation_key) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[uid(),user.id,id,amount,reason,key]);
  await event(q,user.id,f.world_id,'intercompany-repayment',b.name+' → '+l.name,'Internal repayment USD '+amount+' · '+reason);return row;
 });
}
export async function payAcquisitionPayable(user,id,body){
 const amount=amountString(body.amount),evidence=clean(body.evidence,1800),requestedCreditor=clean(body.creditorId,36)||null,key='acquisition-payable:'+operationKey(body.operationKey);
 if(evidence.length<10)throw new EconomyError('Record confirmed payment evidence.');
 return transaction(async q=>{
  const [allocation]=await q('SELECT * FROM acquisition_allocations WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]);if(!allocation)throw new EconomyError('Allocation unavailable.',404);
  const [prior]=await q('SELECT * FROM acquisition_payable_payments WHERE user_id=$1 AND operation_key=$2',[user.id,key]);
  if(prior){if(prior.allocation_id!==id||prior.amount!==amount||prior.evidence!==evidence||(requestedCreditor&&prior.creditor_id!==requestedCreditor))throw new EconomyError('Operation reference already used.',409);return prior;}
  const creditors=await q('SELECT * FROM acquisition_payable_creditors WHERE user_id=$1 AND allocation_id=$2 ORDER BY creditor,id FOR UPDATE',[user.id,id]);
  if(!creditors.length)throw new EconomyError('No creditor-level payable schedule is recorded for this acquisition.',409);
  const creditor=requestedCreditor?creditors.find(x=>x.id===requestedCreditor):creditors.length===1?creditors[0]:null;
  if(!creditor)throw new EconomyError('Select the specific creditor being paid.',409);
  const [deal]=await q("SELECT * FROM company_acquisitions WHERE id=$1 AND user_id=$2 AND status='completed'",[allocation.acquisition_id,user.id]);if(!deal?.target_company_id)throw new EconomyError('Completed controlled acquisition required.',409);
  const [company]=await q('SELECT * FROM companies WHERE id=$1 AND user_id=$2 FOR UPDATE',[deal.target_company_id,user.id]);if(!company||company.disposed_at)throw new EconomyError('Subsidiary unavailable or disposed.',404);
  const [paid]=await q('SELECT coalesce(sum(amount),0)::text amount FROM acquisition_payable_payments WHERE user_id=$1 AND creditor_id=$2',[user.id,creditor.id]);
  if(cents(amount)>cents(creditor.amount)-cents(paid.amount))throw new EconomyError('Payment exceeds the outstanding balance for '+creditor.creditor+'.',409);
  await recordAcquisitionEntry(q,company,key,'acquired-payable-payment',amount,'Acquired payable payment · '+creditor.creditor);
  const [row]=await q('INSERT INTO acquisition_payable_payments(id,user_id,allocation_id,creditor_id,amount,evidence,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[uid(),user.id,id,creditor.id,amount,evidence,key]);
  await event(q,user.id,deal.world_id,'acquisition-payable-paid',deal.target_name+' · '+creditor.creditor+' paid','Confirmed USD '+amount+' · '+evidence);return row;
 });
}
export async function corporateFinanceSnapshot(userId){
 const ledger=await economySnapshot(userId);
 const [companies,holdings,diligence,collateral,covenants,refinancings,adjustments,facilities,allocations,disposals]=await Promise.all([
 sql('SELECT id,name,parent_company_id,ownership_percentage FROM companies WHERE user_id=$1 AND disposed_at IS NULL',[userId]),
 sql('SELECT h.*,a.acquired_cash,a.acquired_fixed_assets,a.acquired_intangibles,a.acquired_payables,s.control_sale_basis,s.control_sale_gains,s.control_sale_losses FROM company_investments h LEFT JOIN acquisition_allocations a ON a.acquisition_id=h.acquisition_id AND a.user_id=h.user_id LEFT JOIN LATERAL (SELECT coalesce(sum(x.carrying_basis),0)::text control_sale_basis,coalesce(sum(greatest(x.gain,0)),0)::text control_sale_gains,coalesce(sum(greatest(-x.gain,0)),0)::text control_sale_losses FROM control_retaining_sales x JOIN investment_adjustments j ON j.id=x.adjustment_id AND j.user_id=x.user_id WHERE j.investment_id=h.id AND j.user_id=h.user_id) s ON true WHERE h.user_id=$1',[userId]),
 sql('SELECT * FROM acquisition_diligence WHERE user_id=$1 ORDER BY updated_at DESC',[userId]),
 sql('SELECT * FROM loan_collateral WHERE user_id=$1',[userId]),
 sql('SELECT * FROM loan_covenants WHERE user_id=$1',[userId]),
 sql('SELECT * FROM loan_refinancings WHERE user_id=$1 ORDER BY created_at DESC',[userId]),
 sql('SELECT * FROM investment_adjustments WHERE user_id=$1 ORDER BY created_at DESC',[userId]),
 sql('SELECT * FROM intercompany_facilities WHERE user_id=$1 ORDER BY created_at DESC',[userId]),
 sql('SELECT a.*,c.disposed_at,coalesce(p.paid,0)::text paid_payables,(a.acquired_payables-coalesce(p.paid,0))::text outstanding_payables FROM acquisition_allocations a JOIN company_acquisitions d ON d.id=a.acquisition_id AND d.user_id=a.user_id LEFT JOIN companies c ON c.id=d.target_company_id AND c.user_id=a.user_id LEFT JOIN LATERAL (SELECT sum(amount) paid FROM acquisition_payable_payments WHERE user_id=a.user_id AND allocation_id=a.id) p ON true WHERE a.user_id=$1',[userId]),subsidiaryDisposalSnapshot(userId)
 ]);
 const group=consolidateGroup(companies,ledger.financialStatements,holdings,facilities);
 group.scope+=' Current ownership perimeter only; disposed entities are excluded from the current group. Each disposal record preserves the consolidated closing position and cumulative revenue/net income through disposal, with company-level closing statements; this is not a period-by-period historical consolidated income statement.';
 return {group,facilities,diligence,collateral,covenants,refinancings,adjustments,holdings,allocations,disposals};
}
