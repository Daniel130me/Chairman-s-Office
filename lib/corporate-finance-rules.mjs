import {EconomyError} from './economy-rules.mjs';
export function cents(value){
 const s=String(value??'0');
 if(!/^-?\d{1,18}(?:\.\d{1,2})?$/.test(s))throw new EconomyError('Invalid financial amount.');
 const [w,f='']=s.replace(/^-/,'').split('.');
 return (BigInt(w)*100n+BigInt(f.padEnd(2,'0')))*(s.startsWith('-')?-1n:1n);
}
export function money(n){return (n<0n?'-':'')+String((n<0n?-n:n)/100n)+'.'+String((n<0n?-n:n)%100n).padStart(2,'0');}
export function evaluateCovenant(kind,threshold,balances){
 const t=cents(threshold),cash=cents(balances.cash),debt=cents(balances.debt);
 if(t<0n)throw new EconomyError('Covenant threshold cannot be negative.');
 if(kind==='minimum-cash')return {actual:money(cash),breached:cash<t};
 if(kind==='maximum-debt')return {actual:money(debt),breached:debt>t};
 throw new EconomyError('Unsupported covenant.');
}
// Consolidation on a cost-basis simulation: subsidiaries start with zero
// opening assets; retained purchase cost is acquisition goodwill, not cash.
export function consolidateGroup(companies,statements,investments){
 const byId=new Map(companies.map(c=>[c.id,c]));
 const ss=new Map(statements.map(s=>[s.companyId,s]));
 const warnings=[];
 const controlled=companies.filter(c=>c.parent_company_id&&Number(c.ownership_percentage)>50&&byId.has(c.parent_company_id));
 const edges=new Map(controlled.map(c=>[c.id,c.parent_company_id]));
 for(const c of controlled){let x=c.id,seen=new Set();while(edges.has(x)){if(seen.has(x))throw new EconomyError('Invalid cyclic company ownership.',409);seen.add(x);x=edges.get(x);}}
 let assets=0n,liabilities=0n,equity=0n,cash=0n,revenue=0n,expenses=0n,investmentEliminated=0n,goodwill=0n,nci=0n,nciIncome=0n;
 for(const c of companies){const s=ss.get(c.id);if(!s){warnings.push('Missing ledger: '+c.name);continue;}
  assets+=cents(s.assets);liabilities+=cents(s.liabilities);equity+=cents(s.equity);cash+=cents(s.cash);revenue+=cents(s.revenue);expenses+=cents(s.expenses);
 }
 for(const c of controlled){
  const holdings=investments.filter(i=>i.status==='active'&&i.target_company_id===c.id&&i.investor_company_id===c.parent_company_id);
  if(holdings.length!==1){warnings.push('Unreconciled ownership: '+c.name);continue;}
  const h=holdings[0],s=ss.get(c.id);if(!s)continue;
  const carrying=cents(h.carrying_amount??h.cost_basis);
  investmentEliminated+=carrying;goodwill+=carrying;
  // Effective outside ownership includes intermediate minority interests.
  let x=c.id,owned=100000000n;
  while(edges.has(x)){const p=BigInt(Math.round(Number(byId.get(x).ownership_percentage)*100));owned=owned*p/10000n;x=edges.get(x);}
  nci+=cents(s.equity)*(100000000n-owned)/100000000n;
  nciIncome+=cents(s.netIncome)*(100000000n-owned)/100000000n;
 }
 return {companyCount:companies.length,subsidiaryCount:controlled.length,cash:money(cash),assets:money(assets-investmentEliminated+goodwill),liabilities:money(liabilities),equity:money(equity),parentEquity:money(equity-nci),nonControllingInterest:money(nci),revenue:money(revenue),expenses:money(expenses),netIncome:money(revenue-expenses),parentNetIncome:money(revenue-expenses-nciIncome),nonControllingIncome:money(nciIncome),investmentEliminated:money(investmentEliminated),goodwill:money(goodwill),balanceCheck:money(assets-liabilities-equity),warnings,scope:'Cost-basis simulation; zero-net-asset acquisitions. No fair-value purchase allocation or unrecorded intercompany eliminations.'};
}
export function validateDiligence(rows){
 const required=['financial','legal','commercial','operational'];
 return required.every(kind=>rows.some(r=>r.area===kind&&r.status==='cleared'&&String(r.evidence||'').trim().length>=10))&&!rows.some(r=>r.status==='blocked');
}
