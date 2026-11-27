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
// Limited acquisition-date allocation: identifiable cash and fixed assets,
 // zero opening liabilities, proportionate NCI. No external valuation claim.
export function acquisitionAllocation(price,ownership,cash,fixedAssets){
 const paid=cents(price),p=cents(ownership),a=cents(cash),f=cents(fixedAssets);
 if(p<=5000n||p>10000n||a<0n||f<0n||paid<=0n)throw new EconomyError('Allocation requires a controlling purchase and non-negative acquired assets.');
 const net=a+f,share=(net*p+5000n)/10000n;
 if(share>paid)throw new EconomyError('Bargain-purchase accounting requires further review and is not supported.');
 return {netAssets:money(net),parentShare:money(share),goodwill:money(paid-share),openingNci:money(net-share)};
}
export function consolidateGroup(companies,statements,investments,facilities=[]){
 const byId=new Map(companies.map(c=>[c.id,c]));
 const ss=new Map(statements.map(s=>[s.companyId,s]));
 const warnings=[];
 const controlled=companies.filter(c=>c.parent_company_id&&Number(c.ownership_percentage)>50&&byId.has(c.parent_company_id));
 const edges=new Map(controlled.map(c=>[c.id,c.parent_company_id]));
 for(const c of controlled){let x=c.id,seen=new Set();while(edges.has(x)){if(seen.has(x))throw new EconomyError('Invalid cyclic company ownership.',409);seen.add(x);x=edges.get(x);}}
 let assets=0n,liabilities=0n,equity=0n,cash=0n,revenue=0n,expenses=0n,investmentEliminated=0n,goodwill=0n,nci=0n,nciIncome=0n,openingEliminated=0n;
 for(const c of companies){const s=ss.get(c.id);if(!s){warnings.push('Missing ledger: '+c.name);continue;}
  assets+=cents(s.assets);liabilities+=cents(s.liabilities);equity+=cents(s.equity);cash+=cents(s.cash);revenue+=cents(s.revenue);expenses+=cents(s.expenses);
 }
 for(const c of controlled){
  const holdings=investments.filter(i=>i.status==='active'&&i.target_company_id===c.id&&i.investor_company_id===c.parent_company_id);
  if(holdings.length!==1){warnings.push('Unreconciled ownership: '+c.name);continue;}
  const h=holdings[0],s=ss.get(c.id);if(!s)continue;
  const carrying=cents(h.carrying_amount??h.cost_basis);
  const opening=cents(h.acquired_cash)+cents(h.acquired_fixed_assets),stake=cents(c.ownership_percentage);
  const share=(opening*stake+5000n)/10000n;
  if(carrying<share)throw new EconomyError('Allocated holding carrying value is below supported goodwill floor.',409);
  investmentEliminated+=carrying;goodwill+=carrying-share;openingEliminated+=share;
  // Effective outside ownership includes intermediate minority interests.
  let x=c.id,owned=100000000n;
  while(edges.has(x)){const p=BigInt(Math.round(Number(byId.get(x).ownership_percentage)*100));owned=owned*p/10000n;x=edges.get(x);}
  nci+=cents(s.equity)*(100000000n-owned)/100000000n;
  if(share>0n){let parent=c.parent_company_id,parentOwned=100000000n;while(edges.has(parent)){const p=cents(byId.get(parent).ownership_percentage);parentOwned=parentOwned*p/10000n;parent=edges.get(parent);}nci-=share*(100000000n-parentOwned)/100000000n;}
  nciIncome+=cents(s.netIncome)*(100000000n-owned)/100000000n;
 }
 const internalDebt=facilities.filter(f=>byId.has(f.lender_company_id)&&byId.has(f.borrower_company_id)).reduce((n,f)=>n+cents(f.outstanding),0n);
 return {intercompanyEliminated:money(internalDebt),companyCount:companies.length,subsidiaryCount:controlled.length,cash:money(cash),assets:money(assets-investmentEliminated+goodwill-internalDebt),liabilities:money(liabilities-internalDebt),equity:money(equity-openingEliminated),parentEquity:money(equity-openingEliminated-nci),nonControllingInterest:money(nci),revenue:money(revenue),expenses:money(expenses),netIncome:money(revenue-expenses),parentNetIncome:money(revenue-expenses-nciIncome),nonControllingIncome:money(nciIncome),investmentEliminated:money(investmentEliminated),goodwill:money(goodwill),openingEquityEliminated:money(openingEliminated),balanceCheck:money((assets-investmentEliminated+goodwill-internalDebt)-(liabilities-internalDebt)-(equity-openingEliminated)),warnings,scope:'Limited acquisition allocation: recorded cash/fixed assets, zero opening liabilities, proportionate NCI; legacy acquisitions assume zero opening assets. No full IFRS valuation, bargain purchase or unrecorded intercompany eliminations.'};
}
export function validateDiligence(rows){
 const required=['financial','legal','commercial','operational'];
 return required.every(kind=>rows.some(r=>r.area===kind&&r.status==='cleared'&&String(r.evidence||'').trim().length>=10))&&!rows.some(r=>r.status==='blocked');
}
