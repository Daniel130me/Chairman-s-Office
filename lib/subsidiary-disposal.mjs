import {sql,transaction,uid} from '../backend/src/db.mjs';
import {EconomyError,amountString,operationKey} from './economy-rules.mjs';
import {cents,money,consolidateGroup} from './corporate-finance-rules.mjs';
import {closingCompanyStatement,recordSystemInvestmentSale,recordSystemInvestmentGain,recordSystemInvestmentImpairment,recordRetainedInterestGain} from './economy.mjs';
const fail=(m,s=409)=>{throw new EconomyError(m,s);};
const clean=(s,n=1800)=>typeof s==='string'?s.trim().slice(0,n):'';
export function lossOfControlCalculation({owned,sold,carrying,proceeds,retainedValue,netAssets,goodwill,minorityInterest}){
 const o=cents(owned),s=cents(sold),b=cents(carrying),p=cents(proceeds),r=cents(retainedValue),n=cents(netAssets),g=cents(goodwill);
 const minority=minorityInterest===undefined?n*(10000n-o)/10000n:cents(minorityInterest);
 if(o<=5000n||o>10000n||s<=0n||s>o||o-s>5000n||p<=0n||r<0n||b<0n||g<0n||(o===s&&r!==0n))fail('Enter a loss-of-control sale and valid retained investment valuation.');
 const soldBasis=b*s/o;
 return {remainingStake:money(o-s),soldBasis:money(soldBasis),retainedBasis:money(b-soldBasis),minority:money(minority),parentGain:money(p+r-b),groupGain:money(p+r+minority-n-g)};
}
function controlledTree(all,rootId){
 const children=new Map();
 for(const c of all){if(!c.parent_company_id||Number(c.ownership_percentage)<=50)continue;const list=children.get(c.parent_company_id)||[];list.push(c);children.set(c.parent_company_id,list);}
 const ids=[],visiting=new Set(),visited=new Set();
 function visit(id){
  if(visiting.has(id))fail('Company ownership tree contains a cycle.');
  if(visited.has(id))return;
  visiting.add(id);visited.add(id);ids.push(id);
  for(const child of children.get(id)||[])visit(child.id);
  visiting.delete(id);
 }
 visit(rootId);
 if(ids.length>50)fail('This disposal group exceeds the supported 50-company review limit.');
 return ids;
}
async function disposalBlockers(q,userId,ids){
 const checks=[
 ['outgoing active holdings','company_investments','investor_company_id',"status='active' AND target_company_id IS NOT NULL AND NOT(target_company_id=ANY($2::uuid[]))"],
 ['open acquisitions','company_acquisitions','buyer_company_id',"status IN ('draft','approved')"],
 ['open loans','company_loans','company_id',"status IN ('draft','approved','disbursed')"],
 ['active employees','employment_records','company_id',"status='active'"],
 ['open HR cases','hr_cases','company_id',"status IN ('pending','ready','approved')"],
 ['open contracts','business_contracts','company_id',"status IN ('draft','active','disputed')"],
 ['unsettled invoices','business_invoices','company_id',"status='issued'"],
 ['open purchase orders','purchase_orders','company_id',"status IN ('draft','approved','received')"],
 ['open commercial leads','commercial_opportunities','company_id',"stage IN ('lead','negotiating')"],
 ['open tasks','business_tasks','company_id',"status='assigned'"],
 ['open investigations','investigation_cases','company_id',"status IN ('open','in-review','substantiated','unsubstantiated')"],
 ['pending approvals','action_requests','company_id',"status IN ('pending','approved','executing')"],
 ['open grants','charitable_grants','company_id',"status IN ('proposed','approved')"],
 ['active travel bookings','travel_bookings','company_id',"status IN ('pending','booked') AND EXISTS(SELECT 1 FROM travel_trips t WHERE t.id=travel_bookings.trip_id AND t.user_id=travel_bookings.user_id AND t.status IN ('planning','booked'))"],
 ['pending stakeholder engagements','stakeholder_engagements','company_id',"status='pending'"]
 ];
 const blockers=[];
 for(const [label,table,col,condition] of checks){
  const [row]=await q('SELECT count(*)::int n FROM '+table+' WHERE user_id=$1 AND '+col+'=ANY($2::uuid[]) AND '+condition,[userId,ids]);if(row.n)blockers.push(label+' ('+row.n+')');
 }
 const [f]=await q('SELECT count(*)::int n FROM intercompany_facilities WHERE user_id=$1 AND outstanding>0 AND (lender_company_id=ANY($2::uuid[]) OR borrower_company_id=ANY($2::uuid[])) AND NOT(lender_company_id=ANY($2::uuid[]) AND borrower_company_id=ANY($2::uuid[]))',[userId,ids]);if(f.n)blockers.push('external intercompany facilities ('+f.n+')');
 return blockers;
}
async function subtreeAccounting(q,user,companies,ids){
 const statements=[];
 for(const id of ids)statements.push(await closingCompanyStatement(q,user.id,id));
 const [holdings,facilities]=await Promise.all([
  q(`SELECT h.*,coalesce(a.acquired_cash,0)::text acquired_cash,coalesce(a.acquired_fixed_assets,0)::text acquired_fixed_assets,
  coalesce(a.acquired_intangibles,0)::text acquired_intangibles,coalesce(a.acquired_payables,0)::text acquired_payables,
  coalesce(s.control_sale_basis,0)::text control_sale_basis,coalesce(s.control_sale_gains,0)::text control_sale_gains,coalesce(s.control_sale_losses,0)::text control_sale_losses
  FROM company_investments h
  LEFT JOIN acquisition_allocations a ON a.acquisition_id=h.acquisition_id AND a.user_id=h.user_id
  LEFT JOIN LATERAL (SELECT coalesce(sum(x.carrying_basis),0)::text control_sale_basis,
   coalesce(sum(greatest(x.gain,0)),0)::text control_sale_gains,coalesce(sum(greatest(-x.gain,0)),0)::text control_sale_losses
   FROM control_retaining_sales x JOIN investment_adjustments j ON j.id=x.adjustment_id AND j.user_id=x.user_id
   WHERE j.investment_id=h.id AND j.user_id=h.user_id) s ON true
  WHERE h.user_id=$1 AND h.status='active' AND h.investor_company_id=ANY($2::uuid[]) AND h.target_company_id=ANY($2::uuid[])`,[user.id,ids]),
  q('SELECT * FROM intercompany_facilities WHERE user_id=$1 AND lender_company_id=ANY($2::uuid[]) AND borrower_company_id=ANY($2::uuid[])',[user.id,ids])
 ]);
 const group=consolidateGroup(companies,statements,holdings,facilities);
 if(group.warnings.length)fail('Disposal group ownership cannot be reconciled: '+group.warnings.join('; '));
 if(cents(group.balanceCheck)!==0n)fail('Disposal group consolidated ledger does not reconcile.');
 return {...group,companyIds:ids,companies:statements,intercompanyFacilities:facilities.map(f=>({id:f.id,lenderCompanyId:f.lender_company_id,borrowerCompanyId:f.borrower_company_id,principal:f.principal,outstanding:f.outstanding})),asOf:new Date().toISOString()};
}
export async function disposeSubsidiary(user,id,body){
 const key='subsidiary-disposal:'+operationKey(body.operationKey),proceeds=amountString(body.proceeds),stake=money(cents(body.stakeSold)),retained=money(cents(body.retainedValue)),buyer=clean(body.buyer,160),reason=clean(body.reason),evidence=clean(body.valuationEvidence);
 if(!buyer||reason.length<10||evidence.length<10||cents(stake)<=0n||cents(retained)<0n||body.retainedValue===undefined||body.retainedValue===null||body.retainedValue===''||body.confirmTransfer!==true)fail('Record buyer, consideration, valuation evidence and confirm the transfer of control.',400);
 return transaction(async q=>{
  const [h]=await q('SELECT * FROM company_investments WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]);if(!h)fail('Holding unavailable.',404);
  const [prior]=await q('SELECT * FROM subsidiary_disposals WHERE user_id=$1 AND operation_key=$2',[user.id,key]);
  if(prior){if(prior.investment_id!==id||prior.stake_sold!==stake||prior.proceeds!==proceeds||prior.retained_value!==retained||prior.buyer!==buyer||prior.reason!==reason||prior.valuation_evidence!==evidence)fail('Operation reference already used.');return prior;}
  if(h.status!=='active'||!h.target_company_id)fail('An active controlled subsidiary is required.');
  // Lock the ownership perimeter before discovering its descendants. This prevents
  // a concurrent acquisition or ownership change from escaping the closing review.
  const all=await q('SELECT * FROM companies WHERE user_id=$1 AND disposed_at IS NULL ORDER BY id FOR UPDATE',[user.id]);
  const parent=all.find(c=>c.id===h.investor_company_id),sub=all.find(c=>c.id===h.target_company_id);
  if(!parent||!sub||parent.disposed_at||sub.disposed_at||parent.parent_company_id||sub.parent_company_id!==parent.id||sub.ownership_percentage!==h.ownership_percentage)fail('Only a direct, reconciled subsidiary of an active parent can be deconsolidated.');
  const ids=controlledTree(all,sub.id),treeSet=new Set(ids),companies=all.filter(c=>treeSet.has(c.id));
  const blockers=await disposalBlockers(q,user.id,ids);if(blockers.length)fail('Close or transfer these obligations first: '+blockers.join(', '));
  const closing=await subtreeAccounting(q,user,companies,ids);
  const [allocation]=await q('SELECT * FROM acquisition_allocations WHERE user_id=$1 AND acquisition_id=$2',[user.id,h.acquisition_id]);
  const [history]=await q('SELECT coalesce(sum(s.carrying_basis),0)::text basis,coalesce(sum(s.gain),0)::text gain FROM control_retaining_sales s JOIN investment_adjustments a ON a.id=s.adjustment_id AND a.user_id=s.user_id WHERE a.user_id=$1 AND a.investment_id=$2',[user.id,id]);
  const opening=cents(allocation?.acquired_cash)+cents(allocation?.acquired_fixed_assets)+cents(allocation?.acquired_intangibles)-cents(allocation?.acquired_payables);
  const openingShare=(opening*cents(h.original_ownership_percentage??h.ownership_percentage)+5000n)/10000n;
  const carrying=cents(h.carrying_amount??h.cost_basis),rootGoodwill=carrying+cents(history.basis)-openingShare;
  const topNci=cents(closing.parentEquity)*(10000n-cents(h.ownership_percentage))/10000n;
  const totalMinority=cents(closing.nonControllingInterest)+topNci;
  const totalGoodwill=rootGoodwill+cents(closing.goodwill);
  const result=lossOfControlCalculation({owned:h.ownership_percentage,sold:stake,carrying:money(carrying),proceeds,retainedValue:retained,netAssets:closing.equity,goodwill:money(totalGoodwill),minorityInterest:money(totalMinority)});
  const gross=cents(proceeds),basis=cents(result.soldBasis),recovery=gross<basis?gross:basis;
  if(recovery>0n)await recordSystemInvestmentSale(q,parent,key+':basis',money(recovery),'Subsidiary sale · '+sub.name,'Chairman');
  if(gross>basis)await recordSystemInvestmentGain(q,parent,key+':gain',money(gross-basis),'Subsidiary sale gain · '+sub.name,'Chairman');
  if(basis>gross)await recordSystemInvestmentImpairment(q,parent,key+':loss',money(basis-gross),'Subsidiary sale loss · '+sub.name,'Chairman');
  const change=cents(retained)-cents(result.retainedBasis);
  if(change>0n)await recordRetainedInterestGain(q,parent,key+':retained-gain',money(change),'Retained minority remeasurement · '+sub.name);
  if(change<0n)await recordSystemInvestmentImpairment(q,parent,key+':retained-loss',money(-change),'Retained minority remeasurement · '+sub.name,'Chairman');
  await q("UPDATE company_investments SET target_company_id=NULL,status='exited' WHERE user_id=$1 AND investor_company_id=ANY($2::uuid[]) AND (target_company_id IS NULL OR target_company_id=ANY($2::uuid[])) AND status='active'",[user.id,ids]);
  await q("UPDATE company_investments SET target_company_id=NULL,carrying_amount=$1,current_value=$1,ownership_percentage=CASE WHEN $2::numeric=0 THEN ownership_percentage ELSE $2::numeric END,status=CASE WHEN $2::numeric=0 THEN 'exited' ELSE 'active' END WHERE id=$3 AND user_id=$4",[retained,result.remainingStake,id,user.id]);
  await q("UPDATE intercompany_facilities SET transferred_at=now(),transferred_to=$3 WHERE user_id=$1 AND outstanding>0 AND lender_company_id=ANY($2::uuid[]) AND borrower_company_id=ANY($2::uuid[]) AND transferred_at IS NULL",[user.id,ids,buyer]);
  await q("UPDATE threads SET status='closed',updated_at=now() WHERE user_id=$1 AND company_id=ANY($2::uuid[]) AND status='open'",[user.id,ids]);
  await q("UPDATE character_goals SET status='abandoned',updated_at=now() WHERE user_id=$1 AND target_company_id=ANY($2::uuid[]) AND status IN ('active','paused')",[user.id,ids]);
  const [row]=await q(`INSERT INTO subsidiary_disposals(id,user_id,investment_id,subsidiary_id,investor_company_id,original_stake,stake_sold,retained_stake,proceeds,retained_value,previous_carrying,goodwill,net_assets,minority_interest,parent_gain,group_gain,prior_control_sale_gain,closing_statement,reason,buyer,valuation_evidence,operation_key,disposed_company_ids)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING *`,[uid(),user.id,id,sub.id,parent.id,h.ownership_percentage,stake,result.remainingStake,proceeds,retained,money(carrying),money(totalGoodwill),closing.equity,money(totalMinority),result.parentGain,result.groupGain,history.gain,JSON.stringify(closing),reason,buyer,evidence,key,ids]);
  await q('UPDATE companies SET disposed_at=now(),parent_company_id=NULL WHERE id=ANY($1::uuid[]) AND user_id=$2',[ids,user.id]);
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,sub.world_id,'subsidiary-disposed',sub.name+' · control transferred','Buyer '+buyer+' · cash proceeds USD '+proceeds+' · retained stake '+result.remainingStake+'% · disposed entities '+ids.length+' · closing group revenue USD '+closing.revenue+' · closing group net income USD '+closing.netIncome+' · modeled group disposal gain/loss USD '+result.groupGain+' · former company records archived. '+reason]);
  return row;
 });
}
export async function subsidiaryDisposalSnapshot(userId){return sql('SELECT d.*,c.name subsidiary_name FROM subsidiary_disposals d JOIN companies c ON c.id=d.subsidiary_id AND c.user_id=d.user_id WHERE d.user_id=$1 ORDER BY d.created_at DESC LIMIT 100',[userId]);}
