import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {accounts,deriveFinancialStatement} from '../lib/economy-rules.mjs';
import {economySchema} from '../lib/economy-schema.mjs';

const operations=await readFile(new URL('../lib/operations.mjs',import.meta.url),'utf8');
const personal=await readFile(new URL('../lib/personal-wealth.mjs',import.meta.url),'utf8');
const routes=await readFile(new URL('../lib/routes.mjs',import.meta.url),'utf8');
const app=await readFile(new URL('../frontend/src/App.jsx',import.meta.url),'utf8');
const kinds=['opening','sale','expense','capital','invoice','invoice-payment','purchase','supplier-payment','payroll','asset-purchase','loan-draw','loan-payment','tax-accrual','tax-payment','cogs','dividend','depreciation','interest-payment','investment-purchase','investment-sale','interest-accrual','accrued-interest-payment'];
const fields={cash:'cash',accounts_receivable:'receivables',inventory:'inventory',fixed_assets:'fixed_assets',investments:'investments',accounts_payable:'payables',tax_payable:'tax_payable',loans_payable:'loans_payable',interest_payable:'interest_payable',equity:'contributed_equity',retained_earnings:'contributed_equity',revenue:'revenue',expense:'expenses',payroll_expense:'expenses',cost_of_goods_sold:'expenses',tax_expense:'expenses',depreciation_expense:'expenses',interest_expense:'expenses'};
const creditNormal=new Set(['accounts_payable','tax_payable','loans_payable','interest_payable','equity','retained_earnings','revenue']);
function constraint(name){const match=economySchema.match(new RegExp("ADD CONSTRAINT economy_journal_"+name+"_check CHECK\\("+name+" IN \\(([^)]+)\\)\\)"));assert.ok(match);return new Set([...match[1].matchAll(/'([^']+)'/g)].map(m=>m[1]));}
test('every supported journal posting is accepted by both account constraints and balances independently',()=>{
 const debits=constraint('debit'),credits=constraint('credit'),types=constraint('kind');
 for(const kind of kinds){
  const [debit,credit]=accounts(kind);
  assert.ok(types.has(kind),kind);assert.ok(debits.has(debit),kind+' debit');assert.ok(credits.has(credit),kind+' credit');
  const snapshot=Object.fromEntries(Object.values(fields).map(f=>[f,0]));
  snapshot[fields[debit]]+=creditNormal.has(debit)?-100:100;
  snapshot[fields[credit]]+=creditNormal.has(credit)?100:-100;
  assert.equal(deriveFinancialStatement(snapshot).balanceCheck,'0.00',kind);
 }
});
test('cancellation does not leave a dangling comma in UPDATE expressions',()=>{
 for(const table of ['purchase_orders','company_loans','company_acquisitions']){
  const statement=operations.split('\n').find(l=>l.includes('UPDATE '+table+' SET status=$1'));
  assert.ok(statement,table);
  assert.doesNotMatch(statement,/,'\+\(target/);
  assert.match(statement,/'\+\(target==='approved'\?',approved_at=now\(\)'/);
 }
});
test('closed loan retry is checked before the current loan status',()=>{
 const repayment=operations.split('export async function repayCompanyLoan')[1].split('export async function createAcquisition')[0];
 assert.ok(repayment.indexOf('if(prior)')<repayment.indexOf("if(loan.status!=='disbursed')"));
 assert.match(repayment,/prior\.loan_id!==id/);
 assert.match(repayment,/moneyFromCents\(cents\(loan.outstanding_principal\)-cents\(principal\)\)/);
});
test('personal transfers are connected to the authenticated API and UI with paired ledger records',()=>{
 const transfer=personal.split('export async function transferPersonalFunds')[1].split('export async function acquirePersonalAsset')[0];
 assert.match(transfer,/return transaction\(async q=>/);
 assert.match(transfer,/WHERE user_id=\$1 AND id=ANY\(\$2::uuid\[\]\).*ORDER BY id FOR UPDATE/);
 assert.match(transfer,/from,'debit',amount/);assert.match(transfer,/to,'credit',amount/);
 assert.match(transfer,/debit.source_id!==credit.source_id/);
 assert.match(routes,/route==='personal\/transfers'/);
 assert.match(app,/api\('\/personal\/transfers'/);
});
