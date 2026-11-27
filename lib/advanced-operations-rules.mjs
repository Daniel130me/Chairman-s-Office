import {EconomyError} from './economy-rules.mjs';
import {quantityUnits,quantityText,moneyCents,moneyText,roundRatio,saleCost} from './procurement-rules.mjs';
export function countAdjustment(item,actual,unitCost){
 const old=quantityUnits(item.quantity,true),count=quantityUnits(actual,true);
 if(old===count)return {direction:'none',quantity:'0.0000',value:'0.00'};
 if(count<old){const q=quantityText(old-count);return {direction:'out',quantity:q,value:moneyText(saleCost(item,q))};}
 const q=count-old;
 const cost=old>0n?roundRatio(moneyCents(item.stock_value)*q,old):roundRatio(moneyCents(unitCost)*q,10000n);
 if(old===0n&&cost===0n)throw new EconomyError('Record a supported positive unit cost for newly found stock.');
 return {direction:'in',quantity:quantityText(q),value:moneyText(cost)};
}
export function proratedReturn(total,originalQuantity,alreadyReturned,newQuantity){
 const q=quantityUnits(originalQuantity),prior=quantityUnits(alreadyReturned,true),next=quantityUnits(newQuantity);
 if(prior+next>q)throw new EconomyError('Return exceeds remaining original quantity.',409);
 const value=moneyCents(total);
 return moneyText(roundRatio(value*(prior+next),q)-roundRatio(value*prior,q));
}
export function disputeSettlement(amount,paid){
 const total=moneyCents(amount),payment=moneyCents(paid);
 if(payment>total)throw new EconomyError('Settlement exceeds invoice amount.',409);
 return {payment:moneyText(payment),credit:moneyText(total-payment)};
}
export function supplierPerformance(rows){
 const delivered=rows.filter(r=>r.received_at),dated=delivered.filter(r=>r.due_at);
 const onTime=dated.filter(r=>new Date(r.received_at)<=new Date(r.due_at)).length;
 const lateOpen=rows.filter(r=>r.overdue===true&&!r.received_at).length;
 return {orders:rows.length,delivered:delivered.length,onTime,datedDeliveries:dated.length,lateOpen,onTimePercent:dated.length?Math.round(onTime*100/dated.length):null};
}
