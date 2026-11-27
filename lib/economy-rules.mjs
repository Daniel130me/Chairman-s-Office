export class EconomyError extends Error { constructor(message,status=400){super(message);this.status=status;} }
export function amountString(input){
 const value=String(input??'');
 if(!/^\d{1,12}(?:\.\d{1,2})?$/.test(value)||Number(value)<=0)throw new EconomyError('Enter a positive amount with at most two decimal places.');
 const [whole,fraction='']=value.split('.');
 return BigInt(whole).toString()+'.'+fraction.padEnd(2,'0');
}
export const chartOfAccounts=Object.freeze([
 ['1000','Cash','asset','debit'],['1100','Accounts receivable','asset','debit'],['1200','Inventory','asset','debit'],['1500','Fixed assets','asset','debit'],['1600','Intangible assets','asset','debit'],['2050','Acquired trade payables','liability','credit'],
 ['2000','Accounts payable','liability','credit'],['2100','Tax payable','liability','credit'],['2200','Loans payable','liability','credit'],['2300','Interest payable','liability','credit'],
 ['3000','Owner equity','equity','credit'],['3100','Retained earnings','equity','credit'],
 ['4000','Sales revenue','revenue','credit'],['5000','Operating expense','expense','debit'],['5100','Payroll expense','expense','debit'],['5200','Cost of goods sold','expense','debit'],['5300','Tax expense','expense','debit'],['5400','Depreciation expense','expense','debit'],['5500','Interest expense','expense','debit'],['1300','Investments','asset','debit']
]);
export function accounts(kind){
 const map={sale:['cash','revenue'],expense:['expense','cash'],'expense-refund':['cash','expense'],capital:['cash','equity'],opening:['cash','equity'],invoice:['accounts_receivable','revenue'],'invoice-payment':['cash','accounts_receivable'],purchase:['inventory','accounts_payable'],'supplier-payment':['accounts_payable','cash'],payroll:['payroll_expense','cash'],'asset-purchase':['fixed_assets','cash'],'loan-draw':['cash','loans_payable'],'loan-payment':['loans_payable','cash'],'tax-accrual':['tax_expense','tax_payable'],'tax-payment':['tax_payable','cash'],cogs:['cost_of_goods_sold','inventory'],dividend:['retained_earnings','cash'],depreciation:['depreciation_expense','fixed_assets'],'interest-payment':['interest_expense','cash'],'interest-accrual':['interest_expense','interest_payable'],'accrued-interest-payment':['interest_payable','cash'],'investment-purchase':['investments','cash'],'investment-sale':['cash','investments'],'investment-impairment':['expense','investments'],'investment-gain':['cash','revenue'],'retained-interest-gain':['investments','revenue'],'intercompany-advance':['accounts_receivable','cash'],'intercompany-receipt':['cash','loans_payable'],'intercompany-repayment':['loans_payable','cash'],'intercompany-collection':['cash','accounts_receivable'],'stock-count-loss':['expense','inventory'],'stock-count-gain':['inventory','revenue'],'customer-refund':['revenue','cash'],'customer-return-cost':['inventory','cost_of_goods_sold'],'supplier-refund':['cash','inventory'],'supplier-return-gain':['cash','revenue'],'supplier-return-loss':['expense','inventory'],'invoice-credit':['revenue','accounts_receivable'],'supplier-credit':['accounts_payable','inventory'],'supplier-credit-gain':['accounts_payable','revenue'],'acquired-fixed-assets':['fixed_assets','equity'],'acquired-intangibles':['intangible_assets','equity'],'acquired-payable':['equity','acquired_payables'],'acquired-payable-payment':['acquired_payables','cash']};
 if(map[kind])return map[kind];throw new EconomyError('Unknown transaction type.');
}
export function operationKey(key){
 if(typeof key!=='string'||!/^[a-zA-Z0-9:_-]{8,120}$/.test(key))throw new EconomyError('Invalid operation reference.');
 return key;
}

function cents(value){
 const s=String(value??'0');
 if(!/^-?[0-9]{1,18}(?:[.][0-9]{1,2})?$/.test(s))throw new EconomyError('Invalid stored financial amount.');
 const negative=s.startsWith('-'),parts=(negative?s.slice(1):s).split('.');
 const n=BigInt(parts[0])*100n+BigInt((parts[1]||'').padEnd(2,'0'));
 return negative?-n:n;
}
function money(value){
 const sign=value<0n?'-':'';
 const absolute=value<0n?-value:value;
 return sign+(absolute/100n).toString()+'.'+(absolute%100n).toString().padStart(2,'0');
}
export function deriveFinancialStatement(c){
 const sum=keys=>keys.reduce((total,key)=>total+cents(c[key]),0n);
 const assets=sum(['cash','receivables','inventory','fixed_assets','investments','intangible_assets']);
 const liabilities=sum(['payables','tax_payable','loans_payable','interest_payable','acquired_payables']);
 const revenue=cents(c.revenue),expenses=cents(c.expenses),netIncome=revenue-expenses;
 const equity=cents(c.contributed_equity)+netIncome;
 return {
  companyId:c.id,companyName:c.name,assets:money(assets),cash:money(cents(c.cash)),
  receivables:money(cents(c.receivables)),inventory:money(cents(c.inventory)),fixedAssets:money(cents(c.fixed_assets)),investments:money(cents(c.investments)),
  intangibleAssets:money(cents(c.intangible_assets)),acquiredPayables:money(cents(c.acquired_payables)),liabilities:money(liabilities),payables:money(cents(c.payables)),taxPayable:money(cents(c.tax_payable)),
  loansPayable:money(cents(c.loans_payable)),interestPayable:money(cents(c.interest_payable)),contributedEquity:money(cents(c.contributed_equity)),
  netIncome:money(netIncome),equity:money(equity),balanceCheck:money(assets-liabilities-equity),
  revenue:money(revenue),expenses:money(expenses)
 };
}
