import {sql,transaction} from '../backend/src/db.mjs';
import {companyStatementRows} from './economy.mjs';
import {deriveFinancialStatement,EconomyError} from './economy-rules.mjs';
import {consolidateGroup} from './corporate-finance-rules.mjs';

// An observed financial position, not a backdated close or an invented historical ledger.
// Immutable first successful daily observation, with a consistent database snapshot.
export async function captureGroupAccountHistory(userId){
 const [due]=await sql(`SELECT w.id FROM worlds w WHERE w.user_id=$1 AND NOT EXISTS(
  SELECT 1 FROM group_account_history h WHERE h.world_id=w.id AND h.user_id=w.user_id
  AND h.observed_day=(now() AT TIME ZONE 'UTC')::date)`,[userId]);
 if(!due)return false;
 return transaction(async q=>{
  await q('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  const [w]=await q("SELECT id,transaction_timestamp() observed_at,(transaction_timestamp() AT TIME ZONE 'UTC')::date::text observed_day FROM worlds WHERE id=$1 AND user_id=$2",[due.id,userId]);
  if(!w)return false;
  const [existing]=await q('SELECT 1 FROM group_account_history WHERE world_id=$1 AND observed_day=$2::date',[w.id,w.observed_day]);
  if(existing)return false;
  const companies=await q('SELECT id,name,parent_company_id,ownership_percentage FROM companies WHERE user_id=$1 AND world_id=$2 AND disposed_at IS NULL ORDER BY id',[userId,w.id]);
  if(!companies.length)return false;
  // The economy processes a bounded number of missed days per tick.
  // Wait until all active companies are caught up before freezing a daily observation.
  const [backlog]=await q(`SELECT 1 FROM company_economy e JOIN companies c ON c.id=e.company_id AND c.user_id=e.user_id
   WHERE c.user_id=$1 AND c.world_id=$2 AND c.disposed_at IS NULL AND e.next_day<=$3::date LIMIT 1`,[userId,w.id,w.observed_day]);
  if(backlog)return false;
  const rows=await companyStatementRows(q,userId);
  const holdings=await q('SELECT h.*,a.acquired_cash,a.acquired_fixed_assets,a.acquired_intangibles,a.acquired_payables,a.bargain_gain,s.control_sale_basis,s.control_sale_gains,s.control_sale_losses FROM company_investments h LEFT JOIN acquisition_allocations a ON a.acquisition_id=h.acquisition_id AND a.user_id=h.user_id LEFT JOIN LATERAL (SELECT coalesce(sum(x.carrying_basis),0)::text control_sale_basis,coalesce(sum(greatest(x.gain,0)),0)::text control_sale_gains,coalesce(sum(greatest(-x.gain,0)),0)::text control_sale_losses FROM control_retaining_sales x JOIN investment_adjustments j ON j.id=x.adjustment_id AND j.user_id=x.user_id WHERE j.investment_id=h.id AND j.user_id=h.user_id) s ON true WHERE h.user_id=$1',[userId]);
  const facilities=await q('SELECT * FROM intercompany_facilities WHERE user_id=$1 AND transferred_at IS NULL',[userId]);
  const statement=consolidateGroup(companies,rows.map(deriveFinancialStatement),holdings,facilities);
  if(statement.warnings.length||statement.balanceCheck!=='0.00')throw new EconomyError('Group history capture requires a reconciled ledger and ownership perimeter.',409);
  const perimeter=companies.map(c=>({companyId:c.id,name:c.name,parentCompanyId:c.parent_company_id,ownershipPercentage:c.ownership_percentage}));
  const inserted=await q('INSERT INTO group_account_history(world_id,user_id,observed_day,observed_at,statement,perimeter) VALUES($1,$2,$3::date,$4,$5::jsonb,$6::jsonb) ON CONFLICT(world_id,observed_day) DO NOTHING RETURNING observed_day',[w.id,userId,w.observed_day,w.observed_at,JSON.stringify(statement),JSON.stringify(perimeter)]);
  return inserted.length>0;
 });
}
export async function listGroupAccountHistory(userId){
 return sql(`SELECT h.observed_day::text,h.observed_at,h.statement,h.perimeter FROM group_account_history h
 JOIN worlds w ON w.id=h.world_id AND w.user_id=h.user_id
 WHERE h.user_id=$1 ORDER BY h.observed_day DESC LIMIT 90`,[userId]);
}
