import test from 'node:test';
import assert from 'node:assert/strict';
import {buildLoanSchedule,monthlyInterest,loanCents,loanMoney,allocateLoanPayment,dueDate} from '../lib/loan-rules.mjs';
import {deriveFinancialStatement} from '../lib/economy-rules.mjs';
import {notificationForEvent} from '../lib/event-notifications.mjs';

test('month-end schedules retain original anchor across leap years',()=>{
 assert.equal(dueDate('2028-01-31T00:00:00Z',1),'2028-02-29');
 assert.equal(dueDate('2028-01-31T00:00:00Z',2),'2028-03-31');
 assert.equal(dueDate('2028-12-31T00:00:00Z',2),'2029-02-28');
});
test('equal principal repayment is exact and estimates interest on reducing balance',()=>{
 const rows=buildLoanSchedule('1000.00','12.0000',3,'2026-01-31');
 assert.deepEqual(rows.map(r=>r.principal_due),['333.34','333.33','333.33']);
 assert.deepEqual(rows.map(r=>r.estimated_interest),['10.00','6.67','3.33']);
 assert.equal(rows.reduce((n,r)=>n+loanCents(r.principal_due),0n),100000n);
 assert.equal(monthlyInterest(100000n,'0'),0n);
 assert.equal(loanMoney(100000000000000001n),'1000000000000000.01');
});
test('principal prepayment and interest-only payments allocate correctly without paying future interest',()=>{
 const rows=[{id:'a',principal_due:'100.00',principal_paid:'50.00',interest_due:'10.00',interest_paid:'2.00',accrued_at:'2026-01-31'}, {id:'b',principal_due:'100.00',principal_paid:'0.00',interest_due:'0.00',interest_paid:'0.00',accrued_at:null}];
 assert.deepEqual(allocateLoanPayment(rows,'75.00','8.00'),[{id:'a',principal:'50.00',interest:'8.00'},{id:'b',principal:'25.00',interest:'0.00'}]);
 assert.deepEqual(allocateLoanPayment(rows,'0.00','4.00'),[{id:'a',principal:'0.00',interest:'4.00'}]);
 assert.throws(()=>allocateLoanPayment(rows,'0.00','8.01'));
 assert.throws(()=>allocateLoanPayment(rows,'150.01','0.00'));
});
test('accrued interest adds a liability, not a second expense when paid',()=>{
 const accrued=deriveFinancialStatement({cash:'1100.00',contributed_equity:'100.00',loans_payable:'1000.00',interest_payable:'10.00',expenses:'10.00'});
 assert.equal(accrued.balanceCheck,'0.00');assert.equal(accrued.interestPayable,'10.00');
 const paid=deriveFinancialStatement({cash:'1090.00',contributed_equity:'100.00',loans_payable:'1000.00',interest_payable:'0.00',expenses:'10.00'});
 assert.equal(paid.balanceCheck,'0.00');assert.equal(paid.netIncome,'-10.00');
});
test('overdue notifications open company financing',()=>assert.equal(notificationForEvent('loan-overdue').target,'loans'));
