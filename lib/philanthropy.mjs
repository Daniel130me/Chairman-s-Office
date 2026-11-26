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
  const row=(await q('INSERT INTO charitable_grants(id,user_id,world_id,funding_source,personal_account_id,company_id,recipient,program,purpose,amount,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *',[uid(),user.id,w.id,source,source==='personal'?body.personalAccountId:null,source==='company'?body.companyId:null,recipient,program,purpose,amount,key]))[0];
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
  if(status==='paid'){
   if(g.funding_source==='personal')await postPersonalExpense(q,user.id,g.personal_account_id,g.amount,'Philanthropic grant · '+g.recipient,'grant:'+g.id);
   else{const c=await worldCompany(q,user.id,g.company_id);await recordSystemExpense(q,c,'grant:'+g.id,g.amount,'Corporate philanthropic grant · '+g.recipient,'Foundation office');}
  }
  const row=(await q('UPDATE charitable_grants SET status=$1,'+(status==='approved'?'approved_at=now()':status==='paid'?'paid_at=now()':'')+' WHERE id=$2 AND user_id=$3 RETURNING *',[status,id,user.id]))[0];
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,g.world_id,'grant-'+status,'Grant '+status+' · '+g.recipient,'USD '+g.amount+' · '+reason]);
  return row;
 });
}
export async function grantsSnapshot(userId){return sql('SELECT * FROM charitable_grants WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[userId]);}
