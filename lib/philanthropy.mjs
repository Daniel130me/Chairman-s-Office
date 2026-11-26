import {sql,transaction,uid} from '../backend/src/db.mjs';
import {EconomyError,amountString,operationKey} from './economy-rules.mjs';
import {recordSystemExpense} from './economy.mjs';
import {postPersonalExpense} from './personal-wealth.mjs';
import {worldCompany} from './operations.mjs';
const clean=(v,n=500)=>String(v??'').trim().slice(0,n);
export async function createGrant(user,body){
 const key='grant:'+operationKey(body.operationKey),source=body.fundingSource,recipient=clean(body.recipient,160),program=clean(body.program,160),purpose=clean(body.purpose,1000),amount=amountString(body.amount);
 if(!['personal','company'].includes(source)||!recipient||!program||!purpose)throw new EconomyError('Enter a valid funding source, recipient, program and purpose.');
 return transaction(async q=>{
  const w=(await q('SELECT id FROM worlds WHERE user_id=$1',[user.id]))[0];if(!w)throw new EconomyError('Empire unavailable.',404);
  if(source==='personal'){const a=(await q("SELECT id FROM personal_accounts WHERE id=$1 AND user_id=$2 AND status='active'",[body.personalAccountId,user.id]))[0];if(!a)throw new EconomyError('Personal funding account unavailable.',404);}
  else await worldCompany(q,user.id,body.companyId);
  const prior=(await q('SELECT * FROM charitable_grants WHERE user_id=$1 AND operation_key=$2',[user.id,key]))[0];if(prior)return prior;
  const row=(await q('INSERT INTO charitable_grants(id,user_id,world_id,funding_source,personal_account_id,company_id,recipient,program,purpose,amount,operation_key,verification_required) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true) RETURNING *',[uid(),user.id,w.id,source,source==='personal'?body.personalAccountId:null,source==='company'?body.companyId:null,recipient,program,purpose,amount,key]))[0];
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,w.id,'grant-proposed','Philanthropic grant proposed · '+recipient,program+' · USD '+amount+' · '+purpose]);
  return row;
 });
}
export async function transitionGrant(user,id,body){
 const status=body.status,reason=clean(body.reason,500);if(!['approved','paid','cancelled'].includes(status)||!reason)throw new EconomyError('Choose a grant action and record a reason.');
 return transaction(async q=>{
  const g=(await q('SELECT * FROM charitable_grants WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]))[0];if(!g)throw new EconomyError('Grant unavailable.',404);
  if(g.status===status)return g;
  const allowed={proposed:['approved','cancelled'],approved:['paid','cancelled'],paid:[],cancelled:[]};
  if(!(allowed[g.status]||[]).includes(status))throw new EconomyError('That grant transition is not permitted.',409);
  if(['approved','paid'].includes(status)&&g.verification_required&&g.verification_status!=='verified')throw new EconomyError('Verify the fictional recipient before approval or disbursement.',409);
  if(status==='paid'){
   if(g.funding_source==='personal')await postPersonalExpense(q,user.id,g.personal_account_id,g.amount,'Philanthropic grant · '+g.recipient,'grant:'+g.id);
   else{const c=await worldCompany(q,user.id,g.company_id);await recordSystemExpense(q,c,'grant:'+g.id,g.amount,'Corporate philanthropic grant · '+g.recipient,'Foundation office');}
  }
  const row=(await q('UPDATE charitable_grants SET status=$1'+(status==='approved'?',approved_at=now()':status==='paid'?',paid_at=now()':'')+' WHERE id=$2 AND user_id=$3 RETURNING *',[status,id,user.id]))[0];
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,g.world_id,'grant-'+status,'Grant '+status+' · '+g.recipient,'USD '+g.amount+' · '+reason]);
  return row;
 });
}
export async function verifyGrant(user,id,body){
 const status=body.status,evidence=clean(body.evidence,1500);
 if(!['verified','rejected'].includes(status)||!evidence)throw new EconomyError('Record a verification result and supporting evidence.');
 return transaction(async q=>{
  const [g]=await q("SELECT * FROM charitable_grants WHERE id=$1 AND user_id=$2 AND status IN ('proposed','approved','paid') FOR UPDATE",[id,user.id]);if(!g)throw new EconomyError('Open grant unavailable.',404);
  const [row]=await q('UPDATE charitable_grants SET verification_status=$1,verification_evidence=$2,verified_at=now(),recurring_monthly=CASE WHEN $1='rejected' THEN false ELSE recurring_monthly END,next_grant_on=CASE WHEN $1='rejected' THEN NULL ELSE next_grant_on END WHERE id=$3 AND user_id=$4 RETURNING *',[status,evidence,id,user.id]);
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,g.world_id,'grant-verification','Grant recipient '+status+' · '+g.recipient,evidence]);
  return row;
 });
}
export async function scheduleGrant(user,id,body){
 if(typeof body.enabled!=='boolean')throw new EconomyError('Choose whether to generate monthly grant proposals.');
 return transaction(async q=>{
  const [g]=await q("SELECT * FROM charitable_grants WHERE id=$1 AND user_id=$2 AND status='paid' AND parent_grant_id IS NULL FOR UPDATE",[id,user.id]);
  if(!g||body.enabled&&g.verification_status!=='verified')throw new EconomyError('A paid, verified original grant is required.',409);
  const [row]=await q("UPDATE charitable_grants SET recurring_monthly=$1,next_grant_on=CASE WHEN $1 THEN coalesce(next_grant_on,(date_trunc('month',now() AT TIME ZONE 'UTC')+interval '1 month')::date) ELSE NULL END WHERE id=$2 AND user_id=$3 RETURNING *",[body.enabled,id,user.id]);
  return row;
 });
}
export async function reportGrantImpact(user,id,body){
 const metric=clean(body.metric,120),unit=clean(body.unit,80),evidence=clean(body.evidence,2000),value=String(body.value??''),key='grant-impact:'+operationKey(body.operationKey);
 if(!metric||!unit||!evidence||!/^\d{1,16}(?:\.\d{1,4})?$/.test(value))throw new EconomyError('Record a measured value, unit and source of evidence.');
 return transaction(async q=>{
  const [g]=await q("SELECT * FROM charitable_grants WHERE id=$1 AND user_id=$2 AND status='paid' FOR UPDATE",[id,user.id]);if(!g)throw new EconomyError('Disbursed grant unavailable.',404);
  const [prior]=await q('SELECT *,value=$3::numeric AS same FROM grant_impact_reports WHERE user_id=$1 AND operation_key=$2',[user.id,key,value]);
  if(prior){if(prior.grant_id!==id||prior.metric!==metric||prior.unit!==unit||prior.evidence!==evidence||!prior.same)throw new EconomyError('Operation reference already used.',409);return prior;}
  const [row]=await q('INSERT INTO grant_impact_reports(id,user_id,grant_id,metric,value,unit,evidence,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[uid(),user.id,id,metric,value,unit,evidence,key]);
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,g.world_id,'grant-impact-reported','Impact report · '+g.recipient,metric+': '+value+' '+unit+' · Reported evidence: '+evidence]);
  return row;
 });
}
export async function processRecurringGrants(userId){
 const due=await sql("SELECT id FROM charitable_grants WHERE user_id=$1 AND recurring_monthly AND status='paid' AND verification_status='verified' AND next_grant_on<=(now() AT TIME ZONE 'UTC')::date ORDER BY next_grant_on LIMIT 5",[userId]);
 for(const item of due)await transaction(async q=>{
  const [g]=await q("SELECT * FROM charitable_grants WHERE id=$1 AND user_id=$2 AND recurring_monthly AND status='paid' AND verification_status='verified' AND next_grant_on<=(now() AT TIME ZONE 'UTC')::date FOR UPDATE",[item.id,userId]);if(!g)return;
  const key='grant:recurring:'+g.id+':'+new Date(g.next_grant_on).toISOString().slice(0,10);
  const [row]=await q("INSERT INTO charitable_grants(id,user_id,world_id,funding_source,personal_account_id,company_id,recipient,program,purpose,amount,operation_key,verification_required,parent_grant_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,$12) ON CONFLICT(user_id,operation_key) DO NOTHING RETURNING id",[uid(),userId,g.world_id,g.funding_source,g.personal_account_id,g.company_id,g.recipient,g.program,g.purpose,g.amount,key,g.id]);
  await q("UPDATE charitable_grants SET next_grant_on=(next_grant_on+interval '1 month')::date WHERE id=$1 AND user_id=$2",[g.id,userId]);
  if(row)await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),userId,g.world_id,'grant-proposed','Recurring grant proposal · '+g.recipient,'USD '+g.amount+' · Verification and new approval required. No funds moved.']);
 });
}
export async function grantsSnapshot(userId){return sql('SELECT * FROM charitable_grants WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[userId]);}
export async function grantImpactSnapshot(userId){return sql('SELECT * FROM grant_impact_reports WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[userId]);}
