import {transaction,uid,sql} from '../backend/src/db.mjs';
import {createHash} from 'node:crypto';
import {allocateHistoricalIncome} from './historical-ownership.mjs';
import {EconomyError,operationKey} from './economy-rules.mjs';
import {cents,money} from './corporate-finance-rules.mjs';
export function periodBounds(start,end,now=new Date()){
 const parse=v=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v))throw new EconomyError('Enter valid UTC dates.');const d=new Date(v+'T00:00:00Z');if(!Number.isFinite(+d)||d.toISOString().slice(0,10)!==v)throw new EconomyError('Enter valid UTC dates.');return d;};
 const a=parse(start),b=parse(end),today=now.toISOString().slice(0,10);
 if(a>b||end>today||(+b-+a)/86400000>365)throw new EconomyError('Select up to 366 days, ending today or earlier.');
 return {start,end,until:new Date(+b+86400000).toISOString()};
}
export function periodTotals(rows,controlSales,disposals,bargains){
 let revenue=0n,expenses=0n;
 for(const row of rows){revenue+=cents(row.revenue);expenses+=cents(row.expenses);}
 const rawRevenue=revenue,rawExpenses=expenses;
 let equityGains=0n,equityLosses=0n,disposalAdjustment=0n,bargainGain=0n;
 for(const row of controlSales){const gain=cents(row.gain);if(gain>=0n)equityGains+=gain;else equityLosses-=gain;}
 for(const row of disposals)disposalAdjustment+=cents(row.group_gain)-cents(row.parent_gain);
 for(const row of bargains)bargainGain+=cents(row.bargain_gain);
 revenue-=equityGains;expenses-=equityLosses;
 // Replace legal-entity disposal P&L with modeled consolidated disposal P&L,
 // preserving negative adjustments as expenses rather than inventing revenue.
 if(disposalAdjustment>=0n)revenue+=disposalAdjustment;else expenses-=disposalAdjustment;
 revenue+=bargainGain;
 return {rawRevenue:money(rawRevenue),rawExpenses:money(rawExpenses),revenue:money(revenue),expenses:money(expenses),netIncome:money(revenue-expenses),controlSaleGains:money(equityGains),controlSaleLosses:money(equityLosses),disposalAdjustment:money(disposalAdjustment),bargainGain:money(bargainGain)};
}
async function periodReport(q,userId,start,end){
 const bounds=periodBounds(start,end);
  const values=[userId,start+'T00:00:00Z',bounds.until];
  const rows=await q(`SELECT c.id company_id,c.name,c.disposed_at,
    (coalesce(sum(j.amount) FILTER(WHERE j.credit='revenue'),0)-coalesce(sum(j.amount) FILTER(WHERE j.debit='revenue'),0))::text revenue,
    (coalesce(sum(j.amount) FILTER(WHERE j.debit IN ('expense','payroll_expense','cost_of_goods_sold','tax_expense','depreciation_expense','interest_expense')),0)-coalesce(sum(j.amount) FILTER(WHERE j.credit IN ('expense','payroll_expense','cost_of_goods_sold','tax_expense','depreciation_expense','interest_expense')),0))::text expenses
    FROM economy_journal j JOIN companies c ON c.id=j.company_id AND c.user_id=j.user_id
    WHERE j.user_id=$1 AND j.effective_at>=$2::timestamptz AND j.effective_at<$3::timestamptz AND (c.disposed_at IS NULL OR j.created_at<=c.disposed_at)
    GROUP BY c.id ORDER BY c.name,c.id`,values);
  const sales=await q(`SELECT s.gain::text,a.created_at AS at,h.investor_company_id AS company_id FROM control_retaining_sales s JOIN investment_adjustments a ON a.id=s.adjustment_id AND a.user_id=s.user_id JOIN company_investments h ON h.id=a.investment_id AND h.user_id=a.user_id WHERE s.user_id=$1 AND a.created_at>=$2::timestamptz AND a.created_at<$3::timestamptz`,values);
  const disposals=await q(`SELECT group_gain::text,parent_gain::text,created_at AS at,investor_company_id AS company_id FROM subsidiary_disposals WHERE user_id=$1 AND created_at>=$2::timestamptz AND created_at<$3::timestamptz`,values);
  const bargains=await q(`SELECT a.bargain_gain::text,d.completed_at AS at,d.buyer_company_id AS company_id FROM acquisition_allocations a JOIN company_acquisitions d ON d.id=a.acquisition_id AND d.user_id=a.user_id WHERE a.user_id=$1 AND d.status='completed' AND d.completed_at>=$2::timestamptz AND d.completed_at<$3::timestamptz AND a.bargain_gain>0`,values);
  const [backlog]=await q(`SELECT count(*)::int n FROM company_economy e JOIN companies c ON c.id=e.company_id AND c.user_id=e.user_id WHERE e.user_id=$1 AND c.disposed_at IS NULL AND e.next_day<=$2::date`,[userId,end]);
  const totals=periodTotals(rows,sales,disposals,bargains);
  const companies=await q('SELECT id,name,created_at,parent_company_id,ownership_percentage,disposed_at FROM companies WHERE user_id=$1 ORDER BY id',[userId]);
  const acquisitions=await q("SELECT target_company_id,buyer_company_id,ownership_percentage,completed_at FROM company_acquisitions WHERE user_id=$1 AND status='completed' AND target_company_id IS NOT NULL ORDER BY completed_at,id",[userId]);
  const history=await q('SELECT subsidiary_id,previous_ownership,remaining_ownership,created_at FROM control_retaining_sales WHERE user_id=$1 ORDER BY created_at,adjustment_id',[userId]);
  const earnings=await q(`SELECT j.company_id,greatest(j.effective_at,c.created_at) AS at,
   (sum(CASE WHEN j.credit='revenue' OR j.credit IN ('expense','payroll_expense','cost_of_goods_sold','tax_expense','depreciation_expense','interest_expense') THEN j.amount ELSE 0 END)
   -sum(CASE WHEN j.debit='revenue' OR j.debit IN ('expense','payroll_expense','cost_of_goods_sold','tax_expense','depreciation_expense','interest_expense') THEN j.amount ELSE 0 END))::text net
   FROM economy_journal j JOIN companies c ON c.id=j.company_id AND c.user_id=j.user_id
   WHERE j.user_id=$1 AND j.effective_at>=$2::timestamptz AND j.effective_at<$3::timestamptz AND (c.disposed_at IS NULL OR j.created_at<=c.disposed_at)
   AND (j.debit IN ('revenue','expense','payroll_expense','cost_of_goods_sold','tax_expense','depreciation_expense','interest_expense') OR j.credit IN ('revenue','expense','payroll_expense','cost_of_goods_sold','tax_expense','depreciation_expense','interest_expense'))
   GROUP BY j.company_id,greatest(j.effective_at,c.created_at) ORDER BY at,j.company_id LIMIT 100001`,values);
  if(earnings.length>100000)throw new EconomyError('Select a shorter period for historical ownership allocation.',409);
  const adjustments=[...sales.map(r=>({...r,net:money(-cents(r.gain))})),...disposals.map(r=>({...r,net:money(cents(r.group_gain)-cents(r.parent_gain))})),...bargains.map(r=>({...r,net:r.bargain_gain}))];
  const ownership=allocateHistoricalIncome(companies,acquisitions,history,earnings,adjustments,totals.netIncome);
  const report={...bounds,...totals,...ownership,companies:rows.map(r=>({...r,netIncome:money(cents(r.revenue)-cents(r.expenses))})),pendingEconomicCatchup:backlog.n,scope:'Modeled effective-date journal income, acquisition and control-sale ownership history, nested minority interests and group adjustments. Acquisition-day earnings before creation time use the opening stake. No unrecorded intercompany trading eliminations or certified IFRS accounts. Reviewed closes preserve snapshots; late postings can revise a live report.'};
  return {...report,digest:createHash('sha256').update(JSON.stringify(report)).digest('hex')};
}
export async function groupPeriodReport(userId,start,end){
 return transaction(async q=>{await q('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');return periodReport(q,userId,start,end);});
}
export async function groupPeriodCloses(userId,start,end){
 periodBounds(start,end);
 return sql('SELECT id,revision,report_digest,report,reason,created_at FROM group_period_closes WHERE user_id=$1 AND period_start=$2::date AND period_end=$3::date ORDER BY revision DESC LIMIT 20',[userId,start,end]);
}
export async function closeGroupPeriod(user,body){
 const {start,end,digest}=body,reason=typeof body.reason==='string'?body.reason.trim().slice(0,1500):'',key='group-close:'+operationKey(body.operationKey);
 periodBounds(start,end);
 if(body.confirm!==true||reason.length<10||typeof digest!=='string'||!/^[a-f0-9]{64}$/.test(digest))throw new EconomyError('Review the report, enter closing evidence and explicitly confirm.',400);
 if(end>=new Date().toISOString().slice(0,10))throw new EconomyError('Only completed UTC days can be closed.',409);
 return transaction(async q=>{
  await q('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  const [prior]=await q('SELECT * FROM group_period_closes WHERE user_id=$1 AND operation_key=$2',[user.id,key]);
  if(prior){if(prior.period_start_text!==start||prior.period_end_text!==end||prior.report_digest!==digest||prior.reason!==reason)throw new EconomyError('Operation reference already used.',409);return prior;}
  const report=await periodReport(q,user.id,start,end);
  if(report.digest!==digest)throw new EconomyError('Period changed since review. Recalculate and confirm the new figures.',409);
  if(report.pendingEconomicCatchup||report.ownershipWarnings.length)throw new EconomyError('Complete economic catch-up and resolve ownership warnings before closing.',409);
  const [latest]=await q('SELECT * FROM group_period_closes WHERE user_id=$1 AND period_start=$2::date AND period_end=$3::date ORDER BY revision DESC LIMIT 1',[user.id,start,end]);
  if(latest?.report_digest===digest)return latest;
  if(latest&&body.confirmRevision!==true)throw new EconomyError('Late records changed a previously closed period. Explicitly confirm a revised close.',409);
  const [row]=await q(`INSERT INTO group_period_closes(id,user_id,period_start,period_end,period_start_text,period_end_text,revision,report_digest,report,reason,operation_key)
   VALUES($1,$2,$3::text::date,$4::text::date,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[uid(),user.id,start,end,(latest?.revision||0)+1,digest,JSON.stringify(report),reason,key]);
  return row;
 });
}
