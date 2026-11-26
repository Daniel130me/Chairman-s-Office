export class EconomyError extends Error { constructor(message,status=400){super(message);this.status=status;} }
export function amountString(input){
 const value=String(input??'');
 if(!/^\d{1,12}(?:\.\d{1,2})?$/.test(value)||Number(value)<=0)throw new EconomyError('Enter a positive amount with at most two decimal places.');
 const [whole,fraction='']=value.split('.');
 return BigInt(whole).toString()+'.'+fraction.padEnd(2,'0');
}
export const chartOfAccounts=Object.freeze([
 ['1000','Cash','asset','debit'],['1100','Accounts receivable','asset','debit'],['1200','Inventory','asset','debit'],['1500','Fixed assets','asset','debit'],
 ['2000','Accounts payable','liability','credit'],['2100','Tax payable','liability','credit'],['2200','Loans payable','liability','credit'],
 ['3000','Owner equity','equity','credit'],['3100','Retained earnings','equity','credit'],
 ['4000','Sales revenue','revenue','credit'],['5000','Operating expense','expense','debit'],['5100','Payroll expense','expense','debit'],['5200','Cost of goods sold','expense','debit'],['5300','Tax expense','expense','debit'],['5400','Depreciation expense','expense','debit']
]);
export function accounts(kind){
 const map={sale:['cash','revenue'],expense:['expense','cash'],capital:['cash','equity'],opening:['cash','equity'],invoice:['accounts_receivable','revenue'],'invoice-payment':['cash','accounts_receivable'],purchase:['inventory','accounts_payable'],'supplier-payment':['accounts_payable','cash'],payroll:['payroll_expense','cash'],'asset-purchase':['fixed_assets','cash'],'loan-draw':['cash','loans_payable'],'loan-payment':['loans_payable','cash'],'tax-accrual':['tax_expense','tax_payable'],'tax-payment':['tax_payable','cash'],cogs:['cost_of_goods_sold','inventory'],dividend:['retained_earnings','cash'],depreciation:['depreciation_expense','fixed_assets']};
 if(map[kind])return map[kind];throw new EconomyError('Unknown transaction type.');
}
export function operationKey(key){
 if(typeof key!=='string'||!/^[a-zA-Z0-9:_-]{8,120}$/.test(key))throw new EconomyError('Invalid operation reference.');
 return key;
}
