// All repayment amounts are integer cents. Monthly dates are UTC, anchored
// to the disbursement day and clamped to the last day of shorter months.
import {EconomyError} from './economy-rules.mjs';
export function loanCents(value){
 const s=String(value??'0');
 if(!/^\d{1,18}(?:\.\d{1,2})?$/.test(s))throw new EconomyError('Invalid loan amount.');
 const [w,f='']=s.split('.');return BigInt(w)*100n+BigInt(f.padEnd(2,'0'));
}
export function loanMoney(n){if(n<0n)throw new EconomyError('Negative loan amount.');return (n/100n)+'.'+String(n%100n).padStart(2,'0');}
export function dueDate(anchor,month){
 const date=new Date(anchor);if(!Number.isFinite(date.getTime())||!Number.isInteger(month)||month<1)throw new EconomyError('Invalid loan schedule date.');
 const year=date.getUTCFullYear(),m=date.getUTCMonth()+month;
 const last=new Date(Date.UTC(year,m+1,0)).getUTCDate();
 return new Date(Date.UTC(year,m,Math.min(last,date.getUTCDate()))).toISOString().slice(0,10);
}
export function monthlyInterest(balance,annualRate){
 const rate=String(annualRate);
 if(!/^\d{1,3}(?:\.\d{1,4})?$/.test(rate)||Number(rate)>100)throw new EconomyError('Invalid annual interest rate.');
 const [w,f='']=rate.split('.'),scaled=BigInt(w)*10000n+BigInt(f.padEnd(4,'0'));
 const denominator=12000000n;
 return (balance*scaled+denominator/2n)/denominator;
}
export function buildLoanSchedule(principal,annualRate,term,anchor){
 const total=loanCents(principal);
 if(total<=0n||!Number.isInteger(term)||term<1||term>360)throw new EconomyError('Invalid loan terms.');
 const base=total/BigInt(term),remainder=total%BigInt(term);
 let remaining=total;
 return Array.from({length:term},(_,index)=>{
  const due=base+(BigInt(index)<remainder?1n:0n);
  const row={installment:index+1,due_date:dueDate(anchor,index+1),principal_due:loanMoney(due),estimated_interest:loanMoney(monthlyInterest(remaining,annualRate))};
  remaining-=due;return row;
 });
}
export function allocateLoanPayment(rows,principal,interest){
 let p=loanCents(principal),i=loanCents(interest);
 const result=[];
 for(const row of rows){
  const pLeft=loanCents(row.principal_due)-loanCents(row.principal_paid);
  const iLeft=row.accrued_at?loanCents(row.interest_due)-loanCents(row.interest_paid):0n;
  const pPay=p<pLeft?p:pLeft,iPay=i<iLeft?i:iLeft;
  if(pPay>0n||iPay>0n)result.push({id:row.id,principal:loanMoney(pPay),interest:loanMoney(iPay)});
  p-=pPay;i-=iPay;
 }
 if(p!==0n||i!==0n)throw new EconomyError('Repayment exceeds scheduled principal or accrued interest.',409);
 return result;
}
