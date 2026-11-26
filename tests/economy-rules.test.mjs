import test from 'node:test';
import assert from 'node:assert/strict';
import {amountString,accounts,operationKey} from '../lib/economy-rules.mjs';
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
