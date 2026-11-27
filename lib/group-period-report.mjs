import {transaction} from '../backend/src/db.mjs';
import {EconomyError} from './economy-rules.mjs';
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
export async function groupPeriodReport(userId,start,end){
 const bounds=periodBounds(start,end);
 return transaction(async q=>{
  await q('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const values=[userId,start+'T00:00:00Z',bounds.until];
  const rows=await q(`SELECT c.id company_id,c.name,c.disposed_at,
    (coalesce(sum(j.amount) FILTER(WHERE j.credit='revenue'),0)-coalesce(sum(j.amount) FILTER(WHERE j.debit='revenue'),0))::text revenue,
    (coalesce(sum(j.amount) FILTER(WHERE j.debit IN ('expense','payroll_expense','cost_of_goods_sold','tax_expense','depreciation_expense','interest_expense')),0)-coalesce(sum(j.amount) FILTER(WHERE j.credit IN ('expense','payroll_expense','cost_of_goods_sold','tax_expense','depreciation_expense','interest_expense')),0))::text expenses
    FROM economy_journal j JOIN companies c ON c.id=j.company_id AND c.user_id=j.user_id
    WHERE j.user_id=$1 AND j.effective_at>=$2::timestamptz AND j.effective_at<$3::timestamptz AND (c.disposed_at IS NULL OR j.created_at<=c.disposed_at)
    GROUP BY c.id ORDER BY c.name,c.id`,values);
  const sales=await q(`SELECT s.gain::text FROM control_retaining_sales s JOIN investment_adjustments a ON a.id=s.adjustment_id AND a.user_id=s.user_id WHERE s.user_id=$1 AND a.created_at>=$2::timestamptz AND a.created_at<$3::timestamptz`,values);
  const disposals=await q(`SELECT group_gain::text,parent_gain::text FROM subsidiary_disposals WHERE user_id=$1 AND created_at>=$2::timestamptz AND created_at<$3::timestamptz`,values);
  const bargains=await q(`SELECT a.bargain_gain::text FROM acquisition_allocations a JOIN company_acquisitions d ON d.id=a.acquisition_id AND d.user_id=a.user_id WHERE a.user_id=$1 AND d.status='completed' AND d.completed_at>=$2::timestamptz AND d.completed_at<$3::timestamptz AND a.bargain_gain>0`,values);
  const [backlog]=await q(`SELECT count(*)::int n FROM company_economy e JOIN companies c ON c.id=e.company_id AND c.user_id=e.user_id WHERE e.user_id=$1 AND c.disposed_at IS NULL AND e.next_day<=$2::date`,[userId,end]);
  return {...bounds,...periodTotals(rows,sales,disposals,bargains),companies:rows.map(r=>({...r,netIncome:money(cents(r.revenue)-cents(r.expenses))})),pendingEconomicCatchup:backlog.n,scope:'Effective-date journal activity across entities, including disposed entities through disposal; group-only sale and bargain adjustments. No historical NCI allocation, unrecorded intercompany trading eliminations or certified IFRS period close. Late postings can revise a report.'};
 });
}
