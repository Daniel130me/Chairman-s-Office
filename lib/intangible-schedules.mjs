import {sql,transaction,uid} from '../backend/src/db.mjs';
import {EconomyError} from './economy-rules.mjs';
import {cents,money} from './corporate-finance-rules.mjs';
import {recordAcquisitionEntry} from './economy.mjs';
const clean=v=>typeof v==='string'?v.trim().slice(0,1800):'';
export function monthlyCharge(remaining,months){
 const value=cents(remaining);
 if(value<0n||!Number.isInteger(months)||months<1||months>240)throw new EconomyError('Invalid amortization balance or term.');
 return money(value/BigInt(months)+(value%BigInt(months)>0n?1n:0n));
}
async function lockAllocation(q,userId,id){
 const [a]=await q('SELECT * FROM acquisition_allocations WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,userId]);
 if(!a)throw new EconomyError('Allocation unavailable.',404);
 const [d]=await q("SELECT * FROM company_acquisitions WHERE id=$1 AND user_id=$2 AND status='completed'",[a.acquisition_id,userId]);
 if(!d?.target_company_id)throw new EconomyError('Completed controlled acquisition required.',409);
 const [c]=await q('SELECT * FROM companies WHERE id=$1 AND user_id=$2 FOR UPDATE',[d.target_company_id,userId]);
 if(!c||c.disposed_at)throw new EconomyError('Subsidiary unavailable or disposed.',404);
 const [t]=await q('SELECT coalesce(sum(amount),0)::text amount FROM acquisition_intangible_adjustments WHERE allocation_id=$1 AND user_id=$2',[id,userId]);
 const [j]=await q("SELECT coalesce(sum(CASE WHEN debit='intangible_assets' THEN amount WHEN credit='intangible_assets' THEN -amount ELSE 0 END),0)::text balance FROM economy_journal WHERE company_id=$1 AND user_id=$2",[c.id,userId]);
 const remaining=cents(a.acquired_intangibles)-cents(t.amount);
 if(remaining<0n||remaining!==cents(j.balance))throw new EconomyError('Intangible ledger requires reconciliation.',409);
 return {a,d,c,remaining};
}
export async function startIntangibleSchedule(user,id,body){
 const months=Number(body.months),evidence=clean(body.evidence);
 if(!Number.isInteger(months)||months<1||months>240||evidence.length<10)throw new EconomyError('Enter a useful life of 1–240 months and supporting evidence.');
 return transaction(async q=>{
  const {remaining}=await lockAllocation(q,user.id,id);
  if(remaining<=0n)throw new EconomyError('No remaining acquired intangible value.',409);
  const [existing]=await q("SELECT * FROM acquisition_amortization_schedules WHERE allocation_id=$1 AND user_id=$2 AND status='active'",[id,user.id]);
  if(existing){if(existing.months_total===months&&existing.evidence===evidence)return existing;throw new EconomyError('Cancel the active schedule before replacing it.',409);}
  const [row]=await q("INSERT INTO acquisition_amortization_schedules(id,user_id,allocation_id,months_total,months_remaining,next_due_day,evidence) VALUES($1,$2,$3,$4,$4,(date_trunc('month',now() AT TIME ZONE 'UTC')+interval '1 month')::date,$5) RETURNING *",[uid(),user.id,id,months,evidence]);
  return row;
 });
}
export async function cancelIntangibleSchedule(user,id,body){
 const reason=clean(body.reason);if(reason.length<10)throw new EconomyError('Record a cancellation reason.');
 return transaction(async q=>{
  const [s]=await q('SELECT * FROM acquisition_amortization_schedules WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]);if(!s)throw new EconomyError('Schedule unavailable.',404);
  if(s.status==='cancelled')return s;
  if(s.status!=='active')throw new EconomyError('Schedule already completed.',409);
  return (await q("UPDATE acquisition_amortization_schedules SET status='cancelled',cancelled_at=now(),cancellation_reason=$3 WHERE id=$1 AND user_id=$2 RETURNING *",[id,user.id,reason]))[0];
 });
}
export async function processIntangibleSchedules(userId){
 const due=await sql(`SELECT s.id,s.allocation_id FROM acquisition_amortization_schedules s
 JOIN acquisition_allocations a ON a.id=s.allocation_id AND a.user_id=s.user_id
 JOIN company_acquisitions d ON d.id=a.acquisition_id AND d.user_id=a.user_id
 JOIN companies c ON c.id=d.target_company_id AND c.user_id=d.user_id
 WHERE s.user_id=$1 AND s.status='active' AND s.next_due_day<=(now() AT TIME ZONE 'UTC')::date AND c.disposed_at IS NULL ORDER BY s.next_due_day,s.id LIMIT 10`,[userId]);
 for(const item of due)await transaction(async q=>{
  const {d,c,remaining:initial}=await lockAllocation(q,userId,item.allocation_id);
  let remaining=initial;
  // Allocation and company lock serialize manual impairments and schedule replacement.
  for(let i=0;i<3;i++){
   const [s]=await q("SELECT *,next_due_day::text due FROM acquisition_amortization_schedules WHERE id=$1 AND user_id=$2 AND status='active' AND next_due_day<=(now() AT TIME ZONE 'UTC')::date FOR UPDATE",[item.id,userId]);
   if(!s)break;
   if(remaining<=0n){await q("UPDATE acquisition_amortization_schedules SET status='completed',months_remaining=0 WHERE id=$1",[s.id]);break;}
   const amount=monthlyCharge(money(remaining),s.months_remaining),key='scheduled-amortization:'+s.id+':'+s.due;
   await recordAcquisitionEntry(q,c,key,'intangible-amortization',amount,'Scheduled acquired intangible amortization · '+s.due);
   await q("INSERT INTO acquisition_intangible_adjustments(id,user_id,allocation_id,kind,amount,evidence,operation_key) VALUES($1,$2,$3,'intangible-amortization',$4,$5,$6)",[uid(),userId,item.allocation_id,amount,'Approved schedule '+s.id+' · due '+s.due+' · '+s.evidence,key]);
   remaining-=cents(amount);
   await q("UPDATE acquisition_amortization_schedules SET months_remaining=CASE WHEN $2 THEN 0 ELSE months_remaining-1 END,status=CASE WHEN $2 OR months_remaining=1 THEN 'completed' ELSE 'active' END,next_due_day=(next_due_day+interval '1 month')::date WHERE id=$1",[s.id,remaining===0n]);
  }
 });
}
