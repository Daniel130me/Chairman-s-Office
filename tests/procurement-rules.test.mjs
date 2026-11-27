import test from 'node:test';
import assert from 'node:assert/strict';
import {receiptValue,saleCost,procurementStatus,quantityUnits,quantityText} from '../lib/procurement-rules.mjs';
test('partial receipts conserve the rounded total of the order line',()=>{
 const line={quantity:'1.0000',received_quantity:'0.0000',unit_cost:'0.05'};
 const values=[receiptValue(line,'0.3333'),receiptValue({...line,received_quantity:'0.3333'},'0.3333'),receiptValue({...line,received_quantity:'0.6666'},'0.3334')];
 assert.equal(values.reduce((a,b)=>a+b,0n),5n);
 assert.throws(()=>receiptValue({...line,received_quantity:'0.9000'},'0.2'));
});
test('partial inventory sale conserves carrying value down to the final cent',()=>{
 assert.equal(saleCost({quantity:'3.0000',stock_value:'10.00'},'1'),333n);
 assert.equal(saleCost({quantity:'2.0000',stock_value:'6.67'},'2'),667n);
 assert.throws(()=>saleCost({quantity:'1.0000',stock_value:'2.00'},'2'));
});
test('purchase order status follows physical receipt and payable balance',()=>{
 assert.equal(procurementStatus(100n,100n,200n,false),'approved');
 assert.equal(procurementStatus(200n,100n,200n,true),'received');
 assert.equal(procurementStatus(200n,200n,200n,true),'paid');
 assert.throws(()=>procurementStatus(100n,101n,200n,false));
});
test('inventory quantities support exactly four decimal places',()=>{
 assert.equal(quantityText(quantityUnits('10.12')),'10.1200');
 assert.equal(quantityText(quantityUnits('0',true)),'0.0000');
 assert.throws(()=>quantityUnits('0'));
 assert.throws(()=>quantityUnits('0.12345'));
});
