import {cents,money} from './corporate-finance-rules.mjs';
const SCALE=1000000000000n;
const time=x=>x==null?Infinity:new Date(x).getTime();
const rounded=n=>n<0n?-((-n+SCALE/2n)/SCALE):(n+SCALE/2n)/SCALE;
// Reconstruct only documented control edges. Never apply today's stake to old earnings.
export function historicalOwnership(companies,acquisitions,sales){
 const entities=new Map(companies.map(c=>[c.id,c])),edges=new Map(),warnings=new Set();
 for(const a of acquisitions){
  if(!a.target_company_id||!entities.has(a.target_company_id))continue;
  if(edges.has(a.target_company_id)){warnings.add('Multiple acquisition histories for '+a.target_company_id);continue;}
  edges.set(a.target_company_id,{parent:a.buyer_company_id,initial:cents(a.ownership_percentage),at:time(a.completed_at),changes:[]});
 }
 for(const s of sales){
  const edge=edges.get(s.subsidiary_id);
  if(!edge){warnings.add('Missing acquisition ownership history for '+s.subsidiary_id);continue;}
  edge.changes.push({at:time(s.created_at),before:cents(s.previous_ownership),after:cents(s.remaining_ownership)});
 }
 for(const c of companies){
  if(!edges.has(c.id)&&(c.parent_company_id||c.disposed_at||cents(c.ownership_percentage??100)!==10000n))warnings.add('Incomplete ownership history for '+c.name);
  const e=edges.get(c.id);if(!e)continue;
  e.changes.sort((a,b)=>a.at-b.at||Number(b.before-a.before));
  let stake=e.initial;
  if(!Number.isFinite(e.at)||stake<=5000n||stake>10000n)warnings.add('Invalid acquisition ownership for '+c.name);
  for(const s of e.changes){if(!Number.isFinite(s.at)||s.at<e.at||s.before!==stake||s.after>=s.before||s.after<=5000n)warnings.add('Inconsistent ownership change for '+c.name);stake=s.after;}
  if(!c.disposed_at&&(c.parent_company_id!==e.parent||cents(c.ownership_percentage)!==stake))warnings.add('Ownership history does not reconcile for '+c.name);
 }
 const cache=new Map();
 function share(id,at){
  const k=id+':'+at;if(cache.has(k))return cache.get(k);
  let x=id,owned=SCALE,visited=new Set();
  while(true){
   if(visited.has(x)){warnings.add('Cyclic historical ownership: '+id);return null;}
   visited.add(x);const c=entities.get(x);if(!c){warnings.add('Missing historical parent: '+x);return null;}
   const e=edges.get(x);
   if(!e){if(c.parent_company_id||c.disposed_at||cents(c.ownership_percentage??100)!==10000n)return null;break;}
   if(at<e.at){warnings.add('Earnings precede acquisition for '+c.name);return null;}
   if(c.disposed_at&&at>time(c.disposed_at)){warnings.add('Earnings after disposal for '+c.name);return null;}
   let stake=e.initial;for(const s of e.changes){if(s.at>at)break;stake=s.after;}
   if(stake<=5000n||stake>10000n)return null;
   owned=owned*stake/10000n;x=e.parent;
  }
  cache.set(k,owned);return owned;
 }
 return {share,warnings};
}
export function allocateHistoricalIncome(companies,acquisitions,sales,earnings,adjustments,groupNetIncome){
 const {share,warnings}=historicalOwnership(companies,acquisitions,sales);
 let nciNumerator=0n,allocated=0n;
 for(const e of [...earnings,...adjustments]){
  const amount=cents(e.net),owned=share(e.company_id,time(e.at));
  if(owned===null||!Number.isFinite(time(e.at))){warnings.add('Unallocated income: '+e.company_id);continue;}
  allocated+=amount;nciNumerator+=amount*(SCALE-owned);
 }
 const total=cents(groupNetIncome);
 if(allocated!==total)warnings.add('Historical earnings and consolidation adjustments do not reconcile.');
 if(warnings.size)return {parentNetIncome:null,nonControllingIncome:null,ownershipWarnings:[...warnings].sort()};
 const nci=rounded(nciNumerator);
 return {parentNetIncome:money(total-nci),nonControllingIncome:money(nci),ownershipWarnings:[]};
}
