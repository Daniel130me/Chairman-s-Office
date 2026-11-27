import {sql,one,transaction,uid} from '../backend/src/db.mjs';
import {moneyCents,moneyText} from './procurement-rules.mjs';
import {EconomyError,amountString,operationKey} from './economy-rules.mjs';
const clean=(v,n=300)=>String(v??'').trim().slice(0,n);
async function account(q,userId,id){
 const row=(await q('SELECT * FROM personal_accounts WHERE id=$1 AND user_id=$2 AND status=$3 FOR UPDATE',[id,userId,'active']))[0];
 if(!row)throw new EconomyError('Personal account unavailable.',404);
 return row;
}
async function balance(q,userId,id){
 return (await q("SELECT coalesce(sum(CASE WHEN direction='credit' THEN amount ELSE -amount END),0)::text AS balance FROM personal_transactions WHERE user_id=$1 AND account_id=$2",[userId,id]))[0].balance;
}
async function post(q,userId,accountId,direction,amount,description,key,sourceType='manual',sourceId=null){
 const prior=(await q('SELECT * FROM personal_transactions WHERE user_id=$1 AND operation_key=$2',[userId,key]))[0];
 if(prior){
  if(prior.account_id!==accountId||prior.direction!==direction||prior.amount!==amount||prior.description!==description||prior.source_type!==sourceType||prior.source_id!==sourceId)throw new EconomyError('Operation reference already used.',409);
  return prior;
 }
 if(direction==='debit'&&!(await q("SELECT $1::numeric >= $2::numeric AS sufficient",[await balance(q,userId,accountId),amount]))[0].sufficient)throw new EconomyError('Insufficient personal account balance.',409);
 return (await q('INSERT INTO personal_transactions(id,user_id,account_id,direction,amount,description,operation_key,source_type,source_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[uid(),userId,accountId,direction,amount,description,key,sourceType,sourceId]))[0];
}
export async function createPersonalAccount(user,body){
 const name=clean(body.name,100),type=clean(body.type,20),opening=String(body.openingBalance??'0');
 if(!name||!['cash','bank','brokerage','other'].includes(type)||!/^\d+(?:\.\d{1,2})?$/.test(opening)||Number(opening)<0)throw new EconomyError('Enter an account name, valid type and non-negative opening balance.');
 const key='personal-account:'+operationKey(body.operationKey);
 return transaction(async q=>{
  const w=(await q('SELECT id FROM worlds WHERE user_id=$1',[user.id]))[0];if(!w)throw new EconomyError('Empire unavailable.',404);
  const prior=(await q('SELECT * FROM personal_accounts WHERE user_id=$1 AND name=$2',[user.id,name]))[0];if(prior)return prior;
  const row=(await q('INSERT INTO personal_accounts(id,user_id,world_id,name,account_type) VALUES($1,$2,$3,$4,$5) RETURNING *',[uid(),user.id,w.id,name,type]))[0];
  if(Number(opening)>0)await post(q,user.id,row.id,'credit',amountString(opening),'Opening personal balance',key+':opening','opening');
  return row;
 });
}
export async function postPersonalRefund(q,userId,accountId,amount,description,key){const a=await account(q,userId,accountId);return post(q,userId,a.id,'credit',amountString(amount),clean(description,300),key,'travel-refund');}
export async function postPersonalExpense(q,userId,accountId,amount,description,key){const a=await account(q,userId,accountId);return post(q,userId,a.id,'debit',amountString(amount),clean(description,300),key,'travel');}
export async function personalTransaction(user,body){
 const key='personal-transaction:'+operationKey(body.operationKey),amount=amountString(body.amount),description=clean(body.description,300),direction=body.direction;
 if(!description||!['credit','debit'].includes(direction))throw new EconomyError('Enter a description and transaction direction.');
 return transaction(async q=>{
  const a=await account(q,user.id,body.accountId);
  const exists=(await q('SELECT id FROM personal_transactions WHERE user_id=$1 AND operation_key=$2',[user.id,key]))[0];
  const row=await post(q,user.id,a.id,direction,amount,description,key);
  if(exists)return row;
  const w=(await q('SELECT world_id FROM personal_accounts WHERE id=$1',[a.id]))[0];
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,w.world_id,'personal-transaction',description,direction+' · USD '+amount+' · '+a.name]);
  return row;
 });
}
// Move fictional funds atomically, preserving total personal wealth.
export async function transferPersonalFunds(user,body){
 const from=body.fromAccountId,to=body.toAccountId,amount=amountString(body.amount),description=clean(body.description,180)||'Personal account transfer';
 const key='personal-transfer:'+operationKey(body.operationKey);
 if(!from||!to||from===to)throw new EconomyError('Select two different personal accounts.');
 return transaction(async q=>{
  // Consistent account lock order prevents deadlocks on opposing transfers.
  const accounts=await q("SELECT * FROM personal_accounts WHERE user_id=$1 AND id=ANY($2::uuid[]) AND status='active' ORDER BY id FOR UPDATE",[user.id,[from,to]]);
  if(accounts.length!==2)throw new EconomyError('Both personal accounts must be available.',404);
  const source=accounts.find(a=>a.id===from),destination=accounts.find(a=>a.id===to);
  if(!source||!destination||source.world_id!==destination.world_id||source.currency!==destination.currency)throw new EconomyError('Accounts must belong to the same world and currency.',409);
  const existing=await q('SELECT * FROM personal_transactions WHERE user_id=$1 AND operation_key=ANY($2::text[])',[user.id,[key+':debit',key+':credit']]);
  const debitDescription=description+' · to '+destination.name,creditDescription=description+' · from '+source.name;
  if(existing.length){
   const debit=existing.find(t=>t.operation_key===key+':debit'),credit=existing.find(t=>t.operation_key===key+':credit');
   if(!debit||!credit||debit.account_id!==from||credit.account_id!==to||debit.amount!==amount||credit.amount!==amount||debit.direction!=='debit'||credit.direction!=='credit'||debit.description!==debitDescription||credit.description!==creditDescription||debit.source_type!=='transfer'||credit.source_type!=='transfer'||!debit.source_id||debit.source_id!==credit.source_id)throw new EconomyError('Operation reference already used.',409);
   return {id:debit.source_id,debit,credit};
  }
  const id=uid();
  const debit=await post(q,user.id,from,'debit',amount,debitDescription,key+':debit','transfer',id);
  const credit=await post(q,user.id,to,'credit',amount,creditDescription,key+':credit','transfer',id);
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,source.world_id,'personal-transfer','Personal funds transferred',source.name+' → '+destination.name+' · USD '+amount+' · '+description]);
  return {id,debit,credit};
 });
}
export async function acquirePersonalAsset(user,body){
 const key='personal-asset:'+operationKey(body.operationKey),name=clean(body.name,120),category=clean(body.category,60),notes=clean(body.notes,1000),cost=amountString(body.purchaseCost),value=body.estimatedValue===undefined?cost:amountString(body.estimatedValue);
 if(!name||!category)throw new EconomyError('Enter an asset name and category.');
 return transaction(async q=>{
  const a=await account(q,user.id,body.accountId);
  const prior=(await q('SELECT * FROM personal_assets WHERE user_id=$1 AND operation_key=$2',[user.id,key]))[0];if(prior)return prior;
  const id=uid();await post(q,user.id,a.id,'debit',cost,'Purchase of personal asset: '+name,key+':purchase','asset',id);
  return (await q('INSERT INTO personal_assets(id,user_id,account_id,name,category,purchase_cost,estimated_value,notes,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[id,user.id,a.id,name,category,cost,value,notes,key]))[0];
 });
}
export async function acquirePersonalInvestment(user,body){
 const key='personal-investment:'+operationKey(body.operationKey),name=clean(body.name,120),assetClass=clean(body.assetClass,60),quantity=String(body.quantity??''),cost=amountString(body.costBasis),value=body.currentValue===undefined?cost:amountString(body.currentValue),risk=body.riskLevel||'unrated';
 if(!name||!assetClass||!/^[0-9]+(?:\.[0-9]{1,8})?$/.test(quantity)||Number(quantity)<=0||!['low','moderate','high','speculative','unrated'].includes(risk))throw new EconomyError('Investment details are invalid.');
 return transaction(async q=>{
  const a=await account(q,user.id,body.accountId);
  const prior=(await q('SELECT * FROM personal_investments WHERE user_id=$1 AND operation_key=$2',[user.id,key]))[0];if(prior)return prior;
  const id=uid();await post(q,user.id,a.id,'debit',cost,'Investment purchase: '+name,key+':purchase','investment',id);
  return (await q('INSERT INTO personal_investments(id,user_id,account_id,name,asset_class,quantity,cost_basis,current_value,risk_level,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[id,user.id,a.id,name,assetClass,quantity,cost,value,risk,key]))[0];
 });
}
export async function updatePersonalValuation(user,type,id,body){
 const value=amountString(body.value);
 if(!['asset','investment'].includes(type))throw new EconomyError('Invalid asset type.');
 return transaction(async q=>{
  const table=type==='asset'?'personal_assets':'personal_investments';
  const valueColumn=type==='asset'?'estimated_value':'current_value';
  const status=type==='asset'?'owned':'active';
  const row=(await q('UPDATE '+table+' SET '+valueColumn+'=$1'+(type==='asset'?'':',updated_at=now()')+' WHERE id=$2 AND user_id=$3 AND status=$4 RETURNING *',[value,id,user.id,status]))[0];
  if(!row)throw new EconomyError('Owned asset or active investment not found.',404);
  return row;
 });
}
export async function sellPersonalHolding(user,type,id,body){
 const proceeds=amountString(body.proceeds),description=clean(body.description,250)||'Sale proceeds';
 if(!['asset','investment'].includes(type))throw new EconomyError('Invalid holding type.');
 return transaction(async q=>{
  const table=type==='asset'?'personal_assets':'personal_investments',status=type==='asset'?'owned':'active';
  const row=(await q('SELECT * FROM '+table+' WHERE id=$1 AND user_id=$2 AND status=$3 FOR UPDATE',[id,user.id,status]))[0];
  if(!row)throw new EconomyError('Holding is not available for sale.',404);
  await post(q,user.id,row.account_id,'credit',proceeds,description,'sale:'+type+':'+id,'sale',id);
  const valueColumn=type==='asset'?'estimated_value':'current_value';
  const updated=(await q('UPDATE '+table+' SET status=$1,'+valueColumn+'=$2'+(type==='asset'?',sold_at=now()':',updated_at=now()')+' WHERE id=$3 AND user_id=$4 RETURNING *',['sold',proceeds,id,user.id]))[0];
  return updated;
 });
}
export async function createPersonalDebt(user,body){
 const lender=clean(body.lender,140),purpose=clean(body.purpose,500),principal=amountString(body.principal),key='personal-debt:'+operationKey(body.operationKey);
 if(!lender||!purpose)throw new EconomyError('Record a lender and loan purpose.');
 return transaction(async q=>{
  const a=await account(q,user.id,body.accountId);
  const [prior]=await q('SELECT * FROM personal_debts WHERE user_id=$1 AND operation_key=$2',[user.id,key]);
  if(prior){if(prior.account_id!==a.id||prior.principal!==principal||prior.lender!==lender||prior.purpose!==purpose)throw new EconomyError('Operation reference already used.',409);return prior;}
  const id=uid();
  await post(q,user.id,a.id,'credit',principal,'Personal loan proceeds · '+lender,key+':draw','personal-debt',id);
  const [row]=await q('INSERT INTO personal_debts(id,user_id,account_id,lender,purpose,principal,outstanding,operation_key) VALUES($1,$2,$3,$4,$5,$6,$6,$7) RETURNING *',[id,user.id,a.id,lender,purpose,principal,key]);
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,a.world_id,'personal-debt-created','Personal borrowing · '+lender,'USD '+principal+' · '+purpose+' · Equal liability created.']);
  return row;
 });
}
function nonnegative(value){const n=String(value??'0');if(!/^\d{1,12}(?:\.\d{1,2})?$/.test(n))throw new EconomyError('Enter a valid non-negative amount.');return moneyText(moneyCents(n));}
export async function repayPersonalDebt(user,id,body){
 const principal=nonnegative(body.principal),interest=nonnegative(body.interest),key='personal-debt-payment:'+operationKey(body.operationKey);
 if(moneyCents(principal)+moneyCents(interest)===0n)throw new EconomyError('Enter a positive payment.');
 return transaction(async q=>{
  const [initial]=await q('SELECT account_id FROM personal_debts WHERE id=$1 AND user_id=$2',[id,user.id]);if(!initial)throw new EconomyError('Debt unavailable.',404);
  const a=await account(q,user.id,initial.account_id);
  const [prior]=await q('SELECT * FROM personal_debt_payments WHERE user_id=$1 AND operation_key=$2',[user.id,key]);
  if(prior){if(prior.debt_id!==id||prior.principal!==principal||prior.interest!==interest)throw new EconomyError('Operation reference already used.',409);return prior;}
  const [d]=await q("SELECT * FROM personal_debts WHERE id=$1 AND user_id=$2 AND status='active' FOR UPDATE",[id,user.id]);if(!d)throw new EconomyError('Active debt unavailable.',409);
  if(moneyCents(principal)>moneyCents(d.outstanding))throw new EconomyError('Principal payment exceeds debt.',409);
  if(moneyCents(principal)>0n)await post(q,user.id,a.id,'debit',principal,'Personal debt principal · '+d.lender,key+':principal','personal-debt',id);
  if(moneyCents(interest)>0n)await post(q,user.id,a.id,'debit',interest,'Personal interest payment · '+d.lender,key+':interest','personal-debt',id);
  const remaining=moneyCents(d.outstanding)-moneyCents(principal);
  await q('UPDATE personal_debts SET outstanding=$1,status=$2 WHERE id=$3 AND user_id=$4',[moneyText(remaining),remaining===0n?'paid':'active',id,user.id]);
  const [row]=await q('INSERT INTO personal_debt_payments(id,user_id,debt_id,principal,interest,operation_key) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[uid(),user.id,id,principal,interest,key]);
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,a.world_id,'personal-debt-payment','Personal debt payment · '+d.lender,'Principal USD '+principal+' · Interest USD '+interest+' · Remaining USD '+moneyText(remaining)]);
  return row;
 });
}
export async function configureAssetUpkeep(user,id,body){
 const amount=nonnegative(body.amount);
 return transaction(async q=>{
  const [a]=await q("SELECT * FROM personal_assets WHERE id=$1 AND user_id=$2 AND status='owned' FOR UPDATE",[id,user.id]);if(!a)throw new EconomyError('Owned asset unavailable.',404);
  const [row]=await q("UPDATE personal_assets SET monthly_upkeep=$1,next_upkeep_on=CASE WHEN $1::numeric=0 THEN NULL ELSE coalesce(next_upkeep_on,(date_trunc('month',now() AT TIME ZONE 'UTC')+interval '1 month')::date) END WHERE id=$2 AND user_id=$3 RETURNING *",[amount,id,user.id]);
  return row;
 });
}
export async function processPersonalUpkeep(userId){
 const due=await sql("SELECT id FROM personal_assets WHERE user_id=$1 AND status='owned' AND monthly_upkeep>0 AND next_upkeep_on<=(now() AT TIME ZONE 'UTC')::date ORDER BY next_upkeep_on LIMIT 10",[userId]);
 for(const item of due)await transaction(async q=>{
  const [a]=await q("SELECT * FROM personal_assets WHERE id=$1 AND user_id=$2 AND status='owned' AND monthly_upkeep>0 AND next_upkeep_on<=(now() AT TIME ZONE 'UTC')::date FOR UPDATE",[item.id,userId]);if(!a)return;
  await q("INSERT INTO personal_upkeep_runs(id,user_id,asset_id,due_on,amount,status) VALUES($1,$2,$3,$4,$5,'unpaid') ON CONFLICT(asset_id,due_on) DO NOTHING",[uid(),userId,a.id,a.next_upkeep_on,a.monthly_upkeep]);
  await q("UPDATE personal_assets SET next_upkeep_on=(next_upkeep_on+interval '1 month')::date WHERE id=$1 AND user_id=$2",[a.id,userId]);
 });
 const unpaid=await sql("SELECT r.id,a.account_id FROM personal_upkeep_runs r JOIN personal_assets a ON a.id=r.asset_id AND a.user_id=r.user_id WHERE r.user_id=$1 AND r.status='unpaid' ORDER BY r.due_on LIMIT 10",[userId]);
 for(const item of unpaid)await transaction(async q=>{
  const a=await account(q,userId,item.account_id);
  const [r]=await q("SELECT r.*,x.name FROM personal_upkeep_runs r JOIN personal_assets x ON x.id=r.asset_id AND x.user_id=r.user_id WHERE r.id=$1 AND r.user_id=$2 AND r.status='unpaid' FOR UPDATE OF r",[item.id,userId]);if(!r)return;
  const [ok]=await q('SELECT $1::numeric>=$2::numeric AS sufficient',[await balance(q,userId,a.id),r.amount]);if(!ok.sufficient)return;
  await post(q,userId,a.id,'debit',r.amount,'Asset upkeep · '+r.name,'asset-upkeep:'+r.id,'asset-upkeep',r.asset_id);
  await q("UPDATE personal_upkeep_runs SET status='paid',paid_at=now() WHERE id=$1 AND user_id=$2",[r.id,userId]);
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),userId,a.world_id,'personal-upkeep','Asset upkeep paid · '+r.name,'USD '+r.amount+' · Configured recurring expense.']);
 });
}
export async function personalWealthSnapshot(userId){
 const [accounts,assets,investments,transactions,debts,debtPayments,upkeep]=await Promise.all([
  sql("SELECT a.*,coalesce(sum(CASE WHEN t.direction='credit' THEN t.amount ELSE -t.amount END),0)::text balance FROM personal_accounts a LEFT JOIN personal_transactions t ON t.account_id=a.id AND t.user_id=a.user_id WHERE a.user_id=$1 GROUP BY a.id ORDER BY a.created_at",[userId]),
  sql("SELECT * FROM personal_assets WHERE user_id=$1 ORDER BY acquired_at DESC",[userId]),
  sql("SELECT * FROM personal_investments WHERE user_id=$1 ORDER BY purchased_at DESC",[userId]),
  sql("SELECT t.*,a.name AS account_name FROM personal_transactions t JOIN personal_accounts a ON a.id=t.account_id AND a.user_id=t.user_id WHERE t.user_id=$1 ORDER BY t.created_at DESC LIMIT 100",[userId]),
  sql('SELECT * FROM personal_debts WHERE user_id=$1 ORDER BY created_at DESC',[userId]),
  sql('SELECT * FROM personal_debt_payments WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[userId]),
  sql('SELECT r.*,a.name AS asset_name,r.due_on::text AS due_on FROM personal_upkeep_runs r JOIN personal_assets a ON a.id=r.asset_id AND a.user_id=r.user_id WHERE r.user_id=$1 ORDER BY r.due_on DESC LIMIT 100',[userId])
 ]);
 const signed=v=>String(v).startsWith('-')?-moneyCents(String(v).slice(1)):moneyCents(v);
 const format=v=>v<0n?'-'+moneyText(-v):moneyText(v);
 const cash=accounts.reduce((n,a)=>n+signed(a.balance),0n);
 const assetValue=assets.filter(a=>a.status==='owned').reduce((n,a)=>n+moneyCents(a.estimated_value),0n);
 const investmentValue=investments.filter(i=>i.status==='active').reduce((n,i)=>n+moneyCents(i.current_value),0n);
 const debtValue=debts.reduce((n,d)=>n+moneyCents(d.outstanding),0n);
 // Unpaid upkeep liabilities include the full history, not the display cap.
 const [outstanding]=await sql("SELECT coalesce(sum(amount),0)::text total FROM personal_upkeep_runs WHERE user_id=$1 AND status='unpaid'",[userId]);
 const upkeepValue=moneyCents(outstanding.total),liabilities=debtValue+upkeepValue;
 return {personalAccounts:accounts,personalAssets:assets,personalInvestments:investments,personalTransactions:transactions,personalDebts:debts,personalDebtPayments:debtPayments,personalUpkeep:upkeep,personalLiabilities:format(liabilities),personalNetWorth:format(cash+assetValue+investmentValue-liabilities),personalCash:format(cash),personalAssetValue:format(assetValue),personalInvestmentValue:format(investmentValue)};
}
