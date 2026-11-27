import {sql,transaction,uid} from '../backend/src/db.mjs';
import {EconomyError,operationKey,amountString} from './economy-rules.mjs';
import {moneyCents,moneyText} from './procurement-rules.mjs';
import {recordSystemInvoicePayment,recordOperationsEntry} from './economy.mjs';
const clean=v=>typeof v==='string'?v.trim().slice(0,2000):'';
const fail=(m,s=409)=>{throw new EconomyError(m,s);};
const event=(q,c,kind,title,body)=>q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),c.user_id,c.world_id,kind,title,body]);
export function normalizeInstallments(items,min=2){
 if(!Array.isArray(items)||items.length<min||items.length>24)fail('Provide '+min+' to twenty-four installments.',400);
 let prev=0,total=0n;
 const schedule=items.map((i,index)=>{
  const amount=amountString(i?.amount),due=new Date(i?.dueAt);
  if(!Number.isFinite(due.getTime())||due.getTime()<=prev)fail('Installment dates must be valid and strictly increasing.',400);
  prev=due.getTime();total+=moneyCents(amount);return {number:index+1,amount,dueAt:due.toISOString()};
 });
 return {schedule,total:moneyText(total)};
}
async function lockDispute(q,userId,id){
 const [initial]=await q('SELECT contract_id FROM commercial_disputes WHERE user_id=$1 AND id=$2',[userId,id]);if(!initial)fail('Dispute unavailable.',404);
 const [m]=await q('SELECT * FROM commercial_milestones WHERE user_id=$1 AND contract_id=$2 FOR UPDATE',[userId,initial.contract_id]);
 const [d]=await q('SELECT * FROM commercial_disputes WHERE user_id=$1 AND id=$2 FOR UPDATE',[userId,id]);
 const [invoice]=d.invoice_id?await q('SELECT * FROM business_invoices WHERE user_id=$1 AND id=$2 FOR UPDATE',[userId,d.invoice_id]):[];
 const [c]=await q('SELECT * FROM business_contracts WHERE user_id=$1 AND id=$2 FOR UPDATE',[userId,d.contract_id]);
 return {m,d,invoice,c};
}
export async function createDisputePlan(user,id,body){
 const key='dispute-plan:'+operationKey(body.operationKey),agreement=clean(body.agreement),normalized=normalizeInstallments(body.installments);
 if(agreement.length<10)fail('Record the agreed fictional settlement terms.',400);
 return transaction(async q=>{
  const {d,invoice,c}=await lockDispute(q,user.id,id);
  const [prior]=await q('SELECT * FROM dispute_payment_plans WHERE user_id=$1 AND operation_key=$2',[user.id,key]);
  if(prior){const revision=prior.revision? (await q('SELECT prior_agreement FROM dispute_plan_revisions WHERE user_id=$1 AND plan_id=$2 AND revision=1',[user.id,prior.id]))[0]:null;const rows=revision?revision.prior_agreement.installments:await q('SELECT installment_number,amount,due_at FROM dispute_payment_installments WHERE user_id=$1 AND plan_id=$2 ORDER BY installment_number',[user.id,prior.id]);if(prior.dispute_id!==id||(revision?.prior_agreement.agreement??prior.agreement)!==agreement||JSON.stringify(rows.map(r=>({number:r.installment_number,amount:r.amount,dueAt:new Date(r.due_at).toISOString()})))!==JSON.stringify(normalized.schedule))fail('Operation reference already used.');return prior;}
  if(d.status!=='open'||c?.status!=='disputed'||invoice?.status!=='issued')fail('An open disputed invoice is required.');
  if((await q("SELECT id FROM contract_obligations WHERE user_id=$1 AND cure_dispute_id=$2 AND status IN ('pending','breached')",[user.id,id])).length)fail('Complete or waive the corrective plan before agreeing installments.');
  if((await q('SELECT id FROM dispute_payment_plans WHERE user_id=$1 AND dispute_id=$2 AND status=$3',[user.id,id,'active'])).length)fail('A payment plan already exists.');
  if(!(await q('SELECT id FROM commercial_dispute_evidence WHERE user_id=$1 AND dispute_id=$2 LIMIT 1',[user.id,id])).length)fail('Record supporting dispute evidence first.');
  if(moneyCents(normalized.total)>moneyCents(invoice.amount))fail('Settlement exceeds original invoice.');
  if(new Date(normalized.schedule[0].dueAt).getTime()<=Date.now())fail('First installment must be in the future.',400);
  const credit=moneyText(moneyCents(invoice.amount)-moneyCents(normalized.total));
  const [p]=await q('INSERT INTO dispute_payment_plans(id,user_id,dispute_id,invoice_id,agreed_amount,agreed_credit,agreement,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[uid(),user.id,id,invoice.id,normalized.total,credit,agreement,key]);
  for(const i of normalized.schedule)await q('INSERT INTO dispute_payment_installments(id,user_id,plan_id,installment_number,amount,due_at) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,p.id,i.number,i.amount,i.dueAt]);
  await event(q,c,'dispute-plan-created',invoice.invoice_number+' · installment agreement','USD '+p.agreed_amount+' over '+normalized.schedule.length+' installments · conditional credit USD '+credit+' · no cash received yet.');
  return p;
 });
}
export async function reviseDisputePlan(user,id,body){
 const agreement=clean(body.agreement),key='dispute-revision:'+operationKey(body.operationKey),normalized=normalizeInstallments(body.installments,1);
 if(agreement.length<10||!Number.isInteger(body.expectedRevision)||body.expectedRevision<0)fail('Record the agreed amendment and current revision.',400);
 return transaction(async q=>{
  const [initial]=await q('SELECT dispute_id FROM dispute_payment_plans WHERE user_id=$1 AND id=$2',[user.id,id]);if(!initial)fail('Payment plan unavailable.',404);
  const {d,invoice,c}=await lockDispute(q,user.id,initial.dispute_id);
  const [p]=await q('SELECT * FROM dispute_payment_plans WHERE user_id=$1 AND id=$2 FOR UPDATE',[user.id,id]);
  const [prior]=await q('SELECT * FROM dispute_plan_revisions WHERE user_id=$1 AND operation_key=$2',[user.id,key]);
  const canonical=s=>JSON.stringify(s.map(x=>[x.number,x.amount,x.dueAt]));
  if(prior){if(prior.plan_id!==id||prior.revision!==body.expectedRevision+1||prior.agreement!==agreement||canonical(prior.new_schedule)!==canonical(normalized.schedule))fail('Operation reference already used.');return prior;}
  if(p.status!=='active'||d.status!=='open'||invoice?.status!=='issued'||c?.status!=='disputed')fail('Payment plan no longer active.');
  if(p.revision!==body.expectedRevision)fail('Agreement changed; refresh before renegotiating.');
  const rows=await q('SELECT * FROM dispute_payment_installments WHERE user_id=$1 AND plan_id=$2 ORDER BY installment_number FOR UPDATE',[user.id,id]);
  const paid=rows.filter(i=>i.paid_at),received=paid.reduce((n,i)=>n+moneyCents(i.amount),0n),total=received+moneyCents(normalized.total);
  if(!paid.length)fail('Cancel an unpaid plan and record a replacement agreement instead.');
  if(paid.length+normalized.schedule.length>24)fail('Total installment count cannot exceed twenty-four.',400);
  if(total>moneyCents(invoice.amount))fail('Amended settlement exceeds original invoice.');
  if(Date.parse(normalized.schedule[0].dueAt)<=Date.now())fail('New installment dates must be in the future.',400);
  const credit=moneyText(moneyCents(invoice.amount)-total);
  const snapshot={agreement:p.agreement,agreed_amount:p.agreed_amount,agreed_credit:p.agreed_credit,installments:rows};
  const [r]=await q('INSERT INTO dispute_plan_revisions(id,user_id,plan_id,revision,prior_agreement,new_schedule,confirmed_paid,agreement,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[uid(),user.id,id,p.revision+1,JSON.stringify(snapshot),JSON.stringify(normalized.schedule),moneyText(received),agreement,key]);
  await q('DELETE FROM dispute_payment_installments WHERE user_id=$1 AND plan_id=$2 AND paid_at IS NULL',[user.id,id]);
  for(const i of normalized.schedule)await q('INSERT INTO dispute_payment_installments(id,user_id,plan_id,installment_number,amount,due_at) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,id,paid.length+i.number,i.amount,i.dueAt]);
  await q('UPDATE dispute_payment_plans SET revision=revision+1,agreed_amount=$1,agreed_credit=$2,agreement=$3 WHERE user_id=$4 AND id=$5',[moneyText(total),credit,agreement,user.id,id]);
  await event(q,c,'dispute-plan-revised',invoice.invoice_number+' · settlement renegotiated','Previously received USD '+moneyText(received)+' preserved; new remaining receipts USD '+normalized.total+' · conditional credit USD '+credit+'. No funds moved.');
  return r;
 });
}
export async function payDisputeInstallment(user,id,body){
 const evidence=clean(body.evidence);if(evidence.length<10)fail('Record evidence of the confirmed fictional payment.',400);
 return transaction(async q=>{
  const [initial]=await q('SELECT p.dispute_id FROM dispute_payment_installments i JOIN dispute_payment_plans p ON p.id=i.plan_id AND p.user_id=i.user_id WHERE i.id=$1 AND i.user_id=$2',[id,user.id]);if(!initial)fail('Installment unavailable.',404);
  const {m,d,invoice,c}=await lockDispute(q,user.id,initial.dispute_id);
  const [i]=await q('SELECT * FROM dispute_payment_installments WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]);
  const [p]=await q('SELECT * FROM dispute_payment_plans WHERE id=$1 AND user_id=$2 FOR UPDATE',[i.plan_id,user.id]);
  if(i.paid_at){if(i.payment_evidence!==evidence)fail('Installment already recorded with different evidence.');return i;}
  if(p.status!=='active'||d.status!=='open'||invoice?.status!=='issued'||c?.status!=='disputed')fail('Payment plan no longer active.');
  if((await q('SELECT id FROM dispute_payment_installments WHERE plan_id=$1 AND user_id=$2 AND installment_number<$3 AND paid_at IS NULL LIMIT 1',[p.id,user.id,i.installment_number])).length)fail('Record earlier installments first.');
  const [company]=await q('SELECT * FROM companies WHERE id=$1 AND user_id=$2 FOR UPDATE',[c.company_id,user.id]);if(!company)fail('Company unavailable.',404);
  await recordSystemInvoicePayment(q,company,'dispute-installment:'+i.id,i.amount,'Confirmed installment '+i.installment_number+' · '+invoice.invoice_number,'Commercial operations');
  const [paid]=await q('UPDATE dispute_payment_installments SET paid_at=now(),payment_evidence=$1 WHERE id=$2 AND user_id=$3 RETURNING *',[evidence,id,user.id]);
  await event(q,c,'dispute-installment-paid',invoice.invoice_number+' · installment received','USD '+i.amount+' · '+evidence);
  const [remaining]=await q('SELECT count(*)::int n FROM dispute_payment_installments WHERE plan_id=$1 AND user_id=$2 AND paid_at IS NULL',[p.id,user.id]);
  if(!remaining.n){
   if(moneyCents(p.agreed_credit)>0n)await recordOperationsEntry(q,company,'dispute-plan-credit:'+p.id,'invoice-credit',p.agreed_credit,'Final agreed credit · '+invoice.invoice_number);
   await q("UPDATE business_invoices SET status='paid',settlement_paid=$1,settlement_credit=$2,paid_at=now() WHERE id=$3 AND user_id=$4",[p.agreed_amount,p.agreed_credit,invoice.id,user.id]);
   const [outstanding]=await q("SELECT count(*)::int n FROM contract_obligations WHERE user_id=$1 AND contract_id=$2 AND status IN ('pending','breached')",[user.id,c.id]);
   await q('UPDATE business_contracts SET status=$1,updated_at=now() WHERE id=$2 AND user_id=$3',[outstanding.n?'active':'completed',c.id,user.id]);
   if(m)await q("UPDATE commercial_milestones SET status='paid',payment_attempt_at=NULL,updated_at=now() WHERE id=$1 AND user_id=$2",[m.id,user.id]);
   await q("UPDATE commercial_disputes SET status='resolved',resolution='settle',resolution_reason=$1,settled_amount=$2,credited_amount=$3,resolved_at=now() WHERE id=$4 AND user_id=$5",[p.agreement,p.agreed_amount,p.agreed_credit,d.id,user.id]);
   await q("UPDATE dispute_payment_plans SET status='completed',completed_at=now() WHERE id=$1 AND user_id=$2",[p.id,user.id]);
   await event(q,c,'commercial-dispute-resolved',c.title+' · installment settlement complete','Total received USD '+p.agreed_amount+' · final credit USD '+p.agreed_credit);
  }
  return paid;
 });
}
export async function cancelDisputePlan(user,id,body){
 const reason=clean(body.reason);if(reason.length<5)fail('Record cancellation reason.',400);
 return transaction(async q=>{
  const [initial]=await q('SELECT dispute_id FROM dispute_payment_plans WHERE id=$1 AND user_id=$2',[id,user.id]);if(!initial)fail('Payment plan unavailable.',404);
  const {c,d}=await lockDispute(q,user.id,initial.dispute_id);
  const [p]=await q('SELECT * FROM dispute_payment_plans WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]);
  if(p.status==='cancelled')return p;
  if(p.status!=='active'||d.status!=='open')fail('Payment plan no longer active.');
  if((await q('SELECT id FROM dispute_payment_installments WHERE plan_id=$1 AND user_id=$2 AND paid_at IS NOT NULL LIMIT 1',[id,user.id])).length)fail('A partially paid agreement requires a separate renegotiation of remaining balance.');
  const [r]=await q("UPDATE dispute_payment_plans SET status='cancelled' WHERE id=$1 AND user_id=$2 RETURNING *",[id,user.id]);
  await event(q,c,'dispute-plan-cancelled',c.title+' · installment plan cancelled',reason+' · original dispute remains open.');return r;
 });
}
export async function processDisputeDeadlines(userId){
 const rows=await sql("SELECT i.id,p.dispute_id FROM dispute_payment_installments i JOIN dispute_payment_plans p ON p.id=i.plan_id AND p.user_id=i.user_id WHERE i.user_id=$1 AND p.status='active' AND i.paid_at IS NULL AND i.overdue_reported_at IS NULL AND i.due_at<now() ORDER BY i.due_at LIMIT 20",[userId]);
 for(const x of rows)await transaction(async q=>{
  const {c,d}=await lockDispute(q,userId,x.dispute_id);if(d.status!=='open'||!c)return;
  const [i]=await q("UPDATE dispute_payment_installments i SET overdue_reported_at=now() FROM dispute_payment_plans p WHERE i.id=$1 AND i.user_id=$2 AND p.id=i.plan_id AND p.user_id=i.user_id AND p.status='active' AND i.paid_at IS NULL AND i.overdue_reported_at IS NULL AND i.due_at<now() RETURNING i.*",[x.id,userId]);if(i)await event(q,c,'dispute-installment-overdue',c.title+' · settlement installment overdue','USD '+i.amount+' · no payment evidence recorded.');
 });
}
export async function disputePlanSnapshot(userId){
 const [plans,installments,revisions]=await Promise.all([sql('SELECT * FROM dispute_payment_plans WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[userId]),sql('SELECT i.* FROM dispute_payment_installments i JOIN dispute_payment_plans p ON p.id=i.plan_id AND p.user_id=i.user_id WHERE i.user_id=$1 ORDER BY p.created_at DESC,i.installment_number LIMIT 2400',[userId]),sql('SELECT * FROM dispute_plan_revisions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[userId])]);return {plans,installments,revisions};
}
