import test from 'node:test';
import assert from 'node:assert/strict';
import {sql,uid,database,transaction} from '../backend/src/db.mjs';
import {recordSystemAssetPurchase} from '../lib/economy.mjs';
import {createCompanyLoan,transitionCompanyLoan,createAcquisition,transitionAcquisition} from '../lib/operations.mjs';
import {advanceIntercompany,repayIntercompany,corporateFinanceSnapshot,saveDiligence,adjustInvestment,setLoanTerms,processCovenants,refinanceLoan} from '../lib/corporate-finance.mjs';
const enabled=process.env.RUN_CORPORATE_FINANCE_DB_TESTS==='1';
test('corporate finance transaction integration on an isolated CI database',{skip:!enabled,timeout:60000},async()=>{
 // Never execute fixtures on a production database.
 assert.match(process.env.DATABASE_URL||'',/@127\.0\.0\.1:5432\/chairman_ci\?/);
 const user={id:uid(),name:'Integration Chairman'},other={id:uid()},world=uid(),a=uid(),b=uid();
 try{
  await sql('INSERT INTO users(id,name,email,pass_hash) VALUES($1,$2,$3,$4),($5,$6,$7,$4)',[user.id,user.name,user.id+'@ci.invalid','fixture',other.id,'Other',other.id+'@ci.invalid']);
  await sql("INSERT INTO worlds(id,user_id,name,region,timezone,sectors,chief) VALUES($1,$2,'CI Group','Fictional','UTC','[]','Chief')",[world,user.id]);
  await sql("INSERT INTO companies(id,user_id,world_id,name,sector,valuation,cash,revenue) VALUES($1,$2,$3,'A','Technology',10000,1000,0),($4,$2,$3,'B','Finance',10000,100,0)",[a,user.id,world,b]);
  const funding={lenderCompanyId:a,borrowerCompanyId:b,amount:'100',purpose:'Working capital',operationKey:uid()};
  const f=await advanceIntercompany(user,funding);
  assert.equal((await advanceIntercompany(user,funding)).id,f.id);
  await assert.rejects(()=>repayIntercompany(other,f.id,{amount:'10',reason:'Unauthorized',operationKey:uid()}),/unavailable/i);
  await assert.rejects(()=>repayIntercompany(user,f.id,{amount:'101',reason:'Overpayment',operationKey:uid()}),/exceeds/i);
  await repayIntercompany(user,f.id,{amount:'25',reason:'Scheduled repayment',operationKey:uid()});
  let snap=await corporateFinanceSnapshot(user.id);
  assert.equal(snap.group.cash,'1100.00');assert.equal(snap.group.intercompanyEliminated,'75.00');assert.equal(snap.group.balanceCheck,'0.00');
  await transaction(async q=>{const [c]=await q('SELECT * FROM companies WHERE id=$1 AND user_id=$2',[a,user.id]);await recordSystemAssetPurchase(q,c,'ci-asset:'+uid(),'100.00','Recorded equipment','Fixture');});
  const loan=await createCompanyLoan(user,{companyId:a,lender:'CI Bank',purpose:'Equipment funding',principal:'300',annualInterestRate:'5',termMonths:12,operationKey:uid()});
  await setLoanTerms(user,loan.id,{kind:'collateral',amount:'75',description:'Equipment asset pool'});
  await assert.rejects(()=>setLoanTerms(user,loan.id,{kind:'collateral',amount:'101',description:'Excess pledge'}),/exceeds/i);
  await setLoanTerms(user,loan.id,{kind:'minimum-cash',threshold:'9999'});
  await transitionCompanyLoan(user,loan.id,{status:'approved',reason:'Board approved'});
  await transitionCompanyLoan(user,loan.id,{status:'disbursed',reason:'Draw authorized'});
  await processCovenants(user.id);
  snap=await corporateFinanceSnapshot(user.id);
  assert.equal(snap.covenants.find(x=>x.loan_id===loan.id).last_status,'breached');
  const refi={lender:'Replacement Bank',reason:'Lower rate',principal:'300',annualInterestRate:'3',termMonths:18,operationKey:uid()};
  const r=await refinanceLoan(user,loan.id,refi);
  assert.equal((await refinanceLoan(user,loan.id,refi)).id,r.id);
  const [closed]=await sql('SELECT status,outstanding_principal FROM company_loans WHERE id=$1',[loan.id]);assert.equal(closed.status,'closed');assert.equal(closed.outstanding_principal,'0.00');
  const deal=await createAcquisition(user,{buyerCompanyId:a,targetName:'Minority target',targetSector:'Tech',sellerName:'Seller',description:'Strategic holding',purchasePrice:'200',targetValuation:'1000',ownershipPercentage:'20',operationKey:uid()});
  await assert.rejects(()=>transitionAcquisition(user,deal.id,{status:'approved',reason:'Premature'}),/diligence/i);
  for(const area of ['financial','legal','commercial','operational'])await saveDiligence(user,deal.id,{area,status:'cleared',evidence:'Recorded evidence for '+area});
  await transitionAcquisition(user,deal.id,{status:'approved',reason:'Diligence reviewed'});
  await transitionAcquisition(user,deal.id,{status:'completed',reason:'Settlement approved'});
  snap=await corporateFinanceSnapshot(user.id);
  const h=snap.holdings.find(x=>x.acquisition_id===deal.id);
  assert.equal(h.carrying_amount,'200.00');
  await adjustInvestment(user,h.id,{kind:'impairment',amount:'50',reason:'Documented write-down',operationKey:uid()});
  await adjustInvestment(user,h.id,{kind:'disposal',stakeSold:'10',proceeds:'100',reason:'Partial minority disposal',operationKey:uid()});
  snap=await corporateFinanceSnapshot(user.id);
  const adjusted=snap.holdings.find(x=>x.id===h.id);
  assert.equal(adjusted.carrying_amount,'75.00');assert.equal(adjusted.ownership_percentage,'10.00');
  assert.equal(snap.group.balanceCheck,'0.00');
 }finally{
  await sql('DELETE FROM intercompany_facilities WHERE user_id=$1',[user.id]);
  await sql('DELETE FROM users WHERE id=ANY($1::uuid[])',[[user.id,other.id]]);
  await database().end();
 }
});
