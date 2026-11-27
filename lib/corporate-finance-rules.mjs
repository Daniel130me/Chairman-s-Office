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
 // documented identifiable intangibles and assumed trade payables. No external valuation claim.
export function ownershipShare(net,stake){const product=net*stake;return product<0n?-((-product+5000n)/10000n):(product+5000n)/10000n;}
export function acquisitionAllocation(price,ownership,cash,fixedAssets,intangibles='0',payables='0',negativeNetAssetsReviewed=false){
 const paid=cents(price),p=cents(ownership),a=cents(cash),f=cents(fixedAssets),i=cents(intangibles),l=cents(payables);
 if(p<=5000n||p>10000n||a<0n||f<0n||i<0n||l<0n||paid<=0n)throw new EconomyError('Allocation requires a controlling purchase and non-negative acquired assets.');
 const net=a+f+i-l;if(net<0n&&negativeNetAssetsReviewed!==true)throw new EconomyError('Negative acquired net assets require a separate valuation review.');const share=ownershipShare(net,p);
 if(share>paid)throw new EconomyError('Bargain-purchase accounting requires further review and is not supported.');
 return {netAssets:money(net),parentShare:money(share),goodwill:money(paid-share),openingNci:money(net-share)};
}
export function retainingControlSale(owned,sold,carrying,proceeds){
 const p=cents(owned),s=cents(sold),value=cents(carrying),gross=cents(proceeds);
 if(p<=5000n||s<=0n||p-s<=5000n||gross<=0n||value<0n)throw new EconomyError('This transaction must retain more than 50% ownership.',409);
 const basis=value*s/p;
 return {remainingStake:money(p-s),basis:money(basis),remainingCarrying:money(value-basis),gain:money(gross-basis)};
}
export function consolidateGroup(companies,statements,investments,facilities=[]){
 const byId=new Map(companies.map(c=>[c.id,c]));
 const ss=new Map(statements.map(s=>[s.companyId,s]));
 const warnings=[];
 const controlled=companies.filter(c=>c.parent_company_id&&Number(c.ownership_percentage)>50&&byId.has(c.parent_company_id));
 const edges=new Map(controlled.map(c=>[c.id,c.parent_company_id]));
 for(const c of controlled){let x=c.id,seen=new Set();while(edges.has(x)){if(seen.has(x))throw new EconomyError('Invalid cyclic company ownership.',409);seen.add(x);x=edges.get(x);}}
 let assets=0n,liabilities=0n,equity=0n,cash=0n,revenue=0n,expenses=0n,investmentEliminated=0n,goodwill=0n,nci=0n,nciIncome=0n,openingEliminated=0n,controlSaleGains=0n,controlSaleLosses=0n,nciControlIncomeAdjustment=0n;
 for(const c of companies){const s=ss.get(c.id);if(!s){warnings.push('Missing ledger: '+c.name);continue;}
  assets+=cents(s.assets);liabilities+=cents(s.liabilities);equity+=cents(s.equity);cash+=cents(s.cash);revenue+=cents(s.revenue);expenses+=cents(s.expenses);
 }
 for(const c of controlled){
  const holdings=investments.filter(i=>i.status==='active'&&i.target_company_id===c.id&&i.investor_company_id===c.parent_company_id);
  if(holdings.length!==1){warnings.push('Unreconciled ownership: '+c.name);continue;}
  const h=holdings[0],s=ss.get(c.id);if(!s)continue;
  const carrying=cents(h.carrying_amount??h.cost_basis);
  const opening=cents(h.acquired_cash)+cents(h.acquired_fixed_assets)+cents(h.acquired_intangibles)-cents(h.acquired_payables),stake=cents(h.original_ownership_percentage??c.ownership_percentage),soldBasis=cents(h.control_sale_basis);
  const share=ownershipShare(opening,stake);
  if(carrying+soldBasis<share)throw new EconomyError('Allocated holding carrying value is below supported goodwill floor.',409);
  const openingAdjustment=share-soldBasis;
  investmentEliminated+=carrying;goodwill+=carrying+soldBasis-share;openingEliminated+=openingAdjustment;
  const gain=cents(h.control_sale_gains),loss=cents(h.control_sale_losses);controlSaleGains+=gain;controlSaleLosses+=loss;
  // Effective outside ownership includes intermediate minority interests.
  let x=c.id,owned=100000000n;
  while(edges.has(x)){const p=BigInt(Math.round(Number(byId.get(x).ownership_percentage)*100));owned=owned*p/10000n;x=edges.get(x);}
  nci+=cents(s.equity)*(100000000n-owned)/100000000n;
  let parent=c.parent_company_id,parentOwned=100000000n;while(edges.has(parent)){const p=cents(byId.get(parent).ownership_percentage);parentOwned=parentOwned*p/10000n;parent=edges.get(parent);}
  nci-=openingAdjustment*(100000000n-parentOwned)/100000000n;
  nciControlIncomeAdjustment+=(gain-loss)*(100000000n-parentOwned)/100000000n;
  nciIncome+=cents(s.netIncome)*(100000000n-owned)/100000000n;
 }
 revenue-=controlSaleGains;expenses-=controlSaleLosses;nciIncome-=nciControlIncomeAdjustment;
 const internalDebt=facilities.filter(f=>byId.has(f.lender_company_id)&&byId.has(f.borrower_company_id)).reduce((n,f)=>n+cents(f.outstanding),0n);
 return {intercompanyEliminated:money(internalDebt),companyCount:companies.length,subsidiaryCount:controlled.length,cash:money(cash),assets:money(assets-investmentEliminated+goodwill-internalDebt),liabilities:money(liabilities-internalDebt),equity:money(equity-openingEliminated),parentEquity:money(equity-openingEliminated-nci),nonControllingInterest:money(nci),revenue:money(revenue),expenses:money(expenses),netIncome:money(revenue-expenses),parentNetIncome:money(revenue-expenses-nciIncome),nonControllingIncome:money(nciIncome),investmentEliminated:money(investmentEliminated),goodwill:money(goodwill),controlSaleGainsReclassified:money(controlSaleGains),controlSaleLossesReclassified:money(controlSaleLosses),openingEquityEliminated:money(openingEliminated),balanceCheck:money((assets-investmentEliminated+goodwill-internalDebt)-(liabilities-internalDebt)-(equity-openingEliminated)),warnings,scope:'Limited acquisition allocation: recorded cash, fixed assets, identifiable intangibles and assumed trade payables, proportionate NCI; legacy acquisitions assume zero opening assets. Control-retaining sales are equity transactions in the group snapshot. No full IFRS valuation, bargain purchase or unrecorded intercompany eliminations.'};
}
export function validateDiligence(rows){
 const required=['financial','legal','commercial','operational'];
 return required.every(kind=>rows.some(r=>r.area===kind&&r.status==='cleared'&&String(r.evidence||'').trim().length>=10))&&!rows.some(r=>r.status==='blocked');
}
