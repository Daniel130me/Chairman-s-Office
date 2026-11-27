const BASE_IMPACT=Object.freeze({
 'market-entry':{revenue:55,expense:0},
 'product-launch':{revenue:45,expense:0},
 'price-pressure':{revenue:100,expense:0},
 'talent-competition':{revenue:0,expense:55},
 'partnership':{revenue:45,expense:0},
 'public-positioning':{revenue:25,expense:0},
 'regulatory-response':{revenue:0,expense:65}
});
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const dayNumber=value=>{const day=value instanceof Date?value.toISOString().slice(0,10):String(value??'').slice(0,10);const n=Date.parse(day+'T00:00:00Z');return Number.isFinite(n)?n:null;};
export function marketMoveEffect(moveType,severity=2,direction='adverse'){
 const base=BASE_IMPACT[moveType];if(!base)return {severity:2,direction:'neutral',revenueBps:0,expenseBps:0};
 const level=Number.isFinite(Number(severity))?clamp(Math.round(Number(severity)),1,5):2;
 const side=['adverse','favourable','mixed','neutral'].includes(direction)?direction:'adverse';
 const sign=side==='adverse'?-1:side==='favourable'?1:0;
 const revenueBps=Math.round(base.revenue*level*sign);
 const expenseBps=Math.round(base.expense*level*(sign===-1?1:sign===1?-1:0));
 return {severity:level,direction:side,revenueBps:clamp(revenueBps,-500,500),expenseBps:clamp(expenseBps,-500,500)};
}
export function marketImpactForDay(impacts,day){
 const at=dayNumber(day);if(at===null)return {revenueBps:0,expenseBps:0};
 let revenue=0,expense=0;
 for(const impact of Array.isArray(impacts)?impacts:[]){
  const start=dayNumber(impact.impact_starts_on??impact.starts_on),end=dayNumber(impact.impact_expires_on??impact.expires_on);
  if(start===null||end===null||at<start||at>end)continue;
  const span=Math.max(1,(end-start)/86400000),elapsed=Math.max(0,(at-start)/86400000),factor=Math.max(0,1-elapsed/span);
  revenue+=Number(impact.revenue_impact_bps||0)*factor;
  expense+=Number(impact.expense_impact_bps||0)*factor;
 }
 return {revenueBps:clamp(Math.round(revenue),-800,800),expenseBps:clamp(Math.round(expense),-800,800)};
}
