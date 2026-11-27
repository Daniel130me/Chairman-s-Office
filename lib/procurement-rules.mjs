import {EconomyError,amountString,operationKey} from './economy-rules.mjs';
export function quantityUnits(value,allowZero=false){
 const s=String(value??'');
 if(!/^\d{1,10}(?:\.\d{1,4})?$/.test(s))throw new EconomyError('Enter a valid quantity with up to four decimal places.');
 const [w,f='']=s.split('.'),n=BigInt(w)*10000n+BigInt(f.padEnd(4,'0'));
 if(n===0n&&!allowZero)throw new EconomyError('Quantity must be positive.');
 return n;
}
export const quantityText=n=>(n/10000n)+'.'+String(n%10000n).padStart(4,'0');
export function moneyCents(value){const s=String(value??'0');if(!/^\d{1,18}(?:\.\d{1,2})?$/.test(s))throw new EconomyError('Invalid monetary amount.');const [w,f='']=s.split('.');return BigInt(w)*100n+BigInt(f.padEnd(2,'0'));}
export const moneyText=n=>(n/100n)+'.'+String(n%100n).padStart(2,'0');
export const roundRatio=(n,d)=>(n+d/2n)/d;
export function receiptValue(line,quantity){
 const total=quantityUnits(line.quantity),received=quantityUnits(line.received_quantity,true),increment=quantityUnits(quantity);
 if(received+increment>total)throw new EconomyError('Receipt exceeds the remaining order quantity.',409);
 const unitCost=moneyCents(line.unit_cost);
 return roundRatio((received+increment)*unitCost,10000n)-roundRatio(received*unitCost,10000n);
}
export function saleCost(item,quantity){
 const stock=quantityUnits(item.quantity,true),sold=quantityUnits(quantity);
 if(sold>stock)throw new EconomyError('Insufficient inventory.',409);
 const value=moneyCents(item.stock_value);
 return roundRatio(value*sold,stock);
}
export function procurementStatus(received,paid,total,allReceived){
 if(paid>received||received>total)throw new EconomyError('Invalid procurement balance.',409);
 return allReceived?(paid===total?'paid':'received'):'approved';
}
