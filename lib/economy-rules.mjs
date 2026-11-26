export class EconomyError extends Error { constructor(message,status=400){super(message);this.status=status;} }
export function amountString(input){
 const value=String(input??'');
 if(!/^\d{1,12}(?:\.\d{1,2})?$/.test(value)||Number(value)<=0)throw new EconomyError('Enter a positive amount with at most two decimal places.');
 const [whole,fraction='']=value.split('.');
 return BigInt(whole).toString()+'.'+fraction.padEnd(2,'0');
}
export function accounts(kind){
 if(kind==='sale')return ['cash','revenue'];
 if(kind==='expense')return ['expense','cash'];
 if(kind==='capital'||kind==='opening')return ['cash','equity'];
 throw new EconomyError('Unknown transaction type.');
}
export function operationKey(key){
 if(typeof key!=='string'||!/^[a-zA-Z0-9:_-]{8,120}$/.test(key))throw new EconomyError('Invalid operation reference.');
 return key;
}
