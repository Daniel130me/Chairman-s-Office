import test from 'node:test';
import assert from 'node:assert/strict';
import {cents,money,evaluateCovenant,consolidateGroup,validateDiligence,acquisitionAllocation} from '../lib/corporate-finance-rules.mjs';
import {accounts} from '../lib/economy-rules.mjs';
test('money and covenant limits are exact, including equality',()=>{
 assert.equal(money(cents('999999999999.99')),'999999999999.99');
 assert.equal(evaluateCovenant('minimum-cash','100.00',{cash:'99.99',debt:'0'}).breached,true);
 assert.equal(evaluateCovenant('minimum-cash','100.00',{cash:'100.00',debt:'0'}).breached,false);
 assert.equal(evaluateCovenant('maximum-debt','500.00',{cash:'0',debt:'500.01'}).breached,true);
});
test('group accounts retain cash, eliminate controlled stake and disclose minority share',()=>{
 const result=consolidateGroup([{id:'p',name:'Parent'},{id:'s',name:'Subsidiary',parent_company_id:'p',ownership_percentage:75}],[
 {companyId:'p',assets:'1000',cash:'400',liabilities:'200',equity:'800',revenue:'50',expenses:'10',netIncome:'40'},
 {companyId:'s',assets:'400',cash:'300',liabilities:'100',equity:'300',revenue:'200',expenses:'100',netIncome:'100'}
 ],[{investor_company_id:'p',target_company_id:'s',status:'active',cost_basis:'300',carrying_amount:'250'}]);
 assert.equal(result.cash,'700.00');assert.equal(result.balanceCheck,'0.00');assert.equal(result.investmentEliminated,'250.00');assert.equal(result.goodwill,'250.00');assert.equal(result.nonControllingInterest,'75.00');assert.equal(result.nonControllingIncome,'25.00');
});
test('nested subsidiary interests propagate through the ownership chain',()=>{
 const result=consolidateGroup([{id:'a',name:'A'},{id:'b',name:'B',parent_company_id:'a',ownership_percentage:80},{id:'c',name:'C',parent_company_id:'b',ownership_percentage:75}],['a','b','c'].map(id=>({companyId:id,assets:'100',cash:'100',liabilities:'0',equity:'100',revenue:'100',expenses:'0',netIncome:'100'})),[{investor_company_id:'a',target_company_id:'b',status:'active',cost_basis:'10'},{investor_company_id:'b',target_company_id:'c',status:'active',cost_basis:'10'}]);
 assert.equal(result.nonControllingInterest,'60.00');assert.equal(result.parentNetIncome,'240.00');
});
test('due diligence requires all four cleared and evidenced areas',()=>{
 const rows=['financial','legal','commercial','operational'].map(area=>({area,status:'cleared',evidence:'Recorded diligence evidence'}));
 assert.equal(validateDiligence(rows),true);assert.equal(validateDiligence(rows.slice(1)),false);assert.equal(validateDiligence(rows.map((r,i)=>i===0?{...r,status:'blocked'}:r)),false);
});
test('investment postings preserve double-entry direction',()=>{
 assert.deepEqual(accounts('investment-impairment'),['expense','investments']);
 assert.deepEqual(accounts('investment-gain'),['cash','revenue']);
});

test('matched intercompany financing eliminates both sides without changing cash or equity',()=>{
 const result=consolidateGroup([{id:'a',name:'A'},{id:'b',name:'B'}],[{companyId:'a',assets:'100',cash:'50',liabilities:'0',equity:'100',revenue:'0',expenses:'0'},{companyId:'b',assets:'50',cash:'50',liabilities:'50',equity:'0',revenue:'0',expenses:'0'}],[],[{lender_company_id:'a',borrower_company_id:'b',outstanding:'50'}]);
 assert.equal(result.assets,'100.00');assert.equal(result.liabilities,'0.00');assert.equal(result.cash,'100.00');assert.equal(result.balanceCheck,'0.00');
 assert.deepEqual(accounts('intercompany-advance'),['accounts_receivable','cash']);assert.deepEqual(accounts('intercompany-receipt'),['cash','loans_payable']);
});

test('acquisition allocation avoids double counting opening assets and equity',()=>{
 assert.deepEqual(acquisitionAllocation('300','75','100','200'),{netAssets:'300.00',parentShare:'225.00',goodwill:'75.00',openingNci:'75.00'});
 assert.throws(()=>acquisitionAllocation('100','75','100','200'),/Bargain/);
 const result=consolidateGroup([{id:'p',name:'Parent'},{id:'s',name:'Acquired',parent_company_id:'p',ownership_percentage:'75.00'}],[{companyId:'p',assets:'1000',cash:'700',liabilities:'0',equity:'1000',revenue:'0',expenses:'0',netIncome:'0'},{companyId:'s',assets:'300',cash:'100',liabilities:'0',equity:'300',revenue:'0',expenses:'0',netIncome:'0'}],[{investor_company_id:'p',target_company_id:'s',status:'active',cost_basis:'300',acquired_cash:'100',acquired_fixed_assets:'200'}]);
 assert.equal(result.assets,'1075.00');assert.equal(result.equity,'1075.00');assert.equal(result.parentEquity,'1000.00');assert.equal(result.nonControllingInterest,'75.00');assert.equal(result.goodwill,'75.00');assert.equal(result.balanceCheck,'0.00');
});
