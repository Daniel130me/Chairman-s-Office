import test from 'node:test';
import assert from 'node:assert/strict';
import {amountString,accounts,operationKey,deriveFinancialStatement} from '../lib/economy-rules.mjs';
test('money is canonical decimal, not floating point arithmetic',()=>{
 assert.equal(amountString('00010.1'),'10.10');
 assert.equal(amountString('0.01'),'0.01');
 for(const x of ['0','-1','1e4','1.001','NaN','Infinity','1000000000000'])assert.throws(()=>amountString(x));
});
test('each supported transaction has balanced debit and credit classifications',()=>{
 assert.deepEqual(accounts('sale'),['cash','revenue']);
 assert.deepEqual(accounts('expense'),['expense','cash']);
 assert.deepEqual(accounts('capital'),['cash','equity']);
 assert.throws(()=>accounts('transfer'));
});
test('idempotency reference is validated',()=>{
 assert.equal(operationKey('example:123'),'example:123');
 for(const x of ['',null,'a b c d e','x'.repeat(121)])assert.throws(()=>operationKey(x));
});

test('interest expense is included in the derived income and balance sheet',()=>{
 const statement=deriveFinancialStatement({id:'company',name:'Test Co',cash:'1125.00',receivables:'0.00',inventory:'50.00',fixed_assets:'0.00',payables:'0.00',tax_payable:'0.00',loans_payable:'100.00',contributed_equity:'1000.00',revenue:'100.00',expenses:'25.00'});
 assert.equal(statement.assets,'1175.00');
 assert.equal(statement.liabilities,'100.00');
 assert.equal(statement.netIncome,'75.00');
 assert.equal(statement.equity,'1075.00');
 assert.equal(statement.balanceCheck,'0.00');
});
test('financial statement arithmetic remains exact beyond JavaScript safe integer range',()=>{
 const statement=deriveFinancialStatement({id:'large',name:'Large Co',cash:'90071992547409.91',receivables:'0.09',inventory:'0.00',fixed_assets:'0.00',payables:'0.00',tax_payable:'0.00',loans_payable:'0.00',contributed_equity:'90071992547410.00',revenue:'0.00',expenses:'0.00'});
 assert.equal(statement.assets,'90071992547410.00');
 assert.equal(statement.equity,'90071992547410.00');
 assert.equal(statement.balanceCheck,'0.00');
});
