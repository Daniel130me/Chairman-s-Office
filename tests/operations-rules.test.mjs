import test from 'node:test';
import assert from 'node:assert/strict';
import {validPayrollMonth,canTransitionContract} from '../lib/operations-rules.mjs';
test('payroll month accepts only real YYYY-MM month values',()=>{
 for(const value of ['2026-01','2026-12','2030-09'])assert.equal(validPayrollMonth(value),true);
 for(const value of ['2026-00','2026-13','26-01','2026-1','2026-01-01','2026/01',null])assert.equal(validPayrollMonth(value),false);
});
test('contract transitions are explicit and terminal states stay terminal',()=>{
 assert.equal(canTransitionContract('draft','active'),true);
 assert.equal(canTransitionContract('active','disputed'),true);
 assert.equal(canTransitionContract('disputed','active'),true);
 assert.equal(canTransitionContract('completed','active'),false);
 assert.equal(canTransitionContract('terminated','active'),false);
 assert.equal(canTransitionContract('draft','completed'),false);
});
