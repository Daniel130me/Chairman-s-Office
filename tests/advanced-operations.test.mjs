import test from 'node:test';
import assert from 'node:assert/strict';
import {countAdjustment,proratedReturn,disputeSettlement,supplierPerformance} from '../lib/advanced-operations-rules.mjs';
import {accounts} from '../lib/economy-rules.mjs';
import {relationshipAfter} from '../lib/relationship-world.mjs';
test('stock count loss uses carrying value and zero count clears all value',()=>{
 assert.deepEqual(countAdjustment({quantity:'3',stock_value:'10'},'2'),{direction:'out',quantity:'1.0000',value:'3.33'});
 assert.deepEqual(countAdjustment({quantity:'3',stock_value:'10'},'0'),{direction:'out',quantity:'3.0000',value:'10.00'});
 assert.deepEqual(countAdjustment({quantity:'0',stock_value:'0'},'2','1.25'),{direction:'in',quantity:'2.0000',value:'2.50'});
 assert.throws(()=>countAdjustment({quantity:'0',stock_value:'0'},'2','0'),/positive unit cost/);
});
test('partial returns reconcile original exact amounts and cannot exceed quantity',()=>{
 assert.equal(proratedReturn('10','3','0','1'),'3.33');
 assert.equal(proratedReturn('10','3','1','1'),'3.34');
 assert.equal(proratedReturn('10','3','2','1'),'3.33');
 assert.throws(()=>proratedReturn('10','3','2','2'),/exceeds/);
});
test('settlements preserve original receivable and prohibit overpayment',()=>{
 assert.deepEqual(disputeSettlement('100','70'),{payment:'70.00',credit:'30.00'});
 assert.deepEqual(disputeSettlement('100','0'),{payment:'0.00',credit:'100.00'});
 assert.throws(()=>disputeSettlement('100','100.01'),/exceeds/);
});
test('supplier scorecards distinguish missing deadlines from late deliveries',()=>{
 const s=supplierPerformance([{received_at:'2026-01-01',due_at:'2026-01-02'},{received_at:'2026-01-03',due_at:'2026-01-02'},{received_at:'2026-01-01'},{overdue:true}]);
 assert.equal(s.delivered,3);assert.equal(s.datedDeliveries,2);assert.equal(s.onTimePercent,50);assert.equal(s.lateOpen,1);
 assert.equal(supplierPerformance([]).onTimePercent,null);
 assert.equal(relationshipAfter({trust:50},'supplier-quality-issue').trust,47);
});
test('refunds and credit notes reverse sales without creating false cash',()=>{
 assert.deepEqual(accounts('customer-refund'),['revenue','cash']);
 assert.deepEqual(accounts('customer-return-cost'),['inventory','cost_of_goods_sold']);
 assert.deepEqual(accounts('invoice-credit'),['revenue','accounts_receivable']);
 assert.deepEqual(accounts('stock-count-loss'),['expense','inventory']);
});
