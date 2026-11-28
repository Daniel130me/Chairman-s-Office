const dimensions=['competence','reliability','integrity','judgment','initiative','collaboration','leadership','loyalty','riskDiscipline','accountability'];
export const PERFORMANCE_DIMENSIONS=Object.freeze(dimensions);
const clamp=(n,min=0,max=100)=>Math.min(max,Math.max(min,n));
const round=n=>Math.round(n*10)/10;
export function roleGroup(role=''){
 if(/finance|cfo|treasury|account/i.test(role))return 'finance';
 if(/legal|counsel|compliance|audit|security|risk/i.test(role))return 'assurance';
 if(/sales|commercial|marketing|business development/i.test(role))return 'commercial';
 if(/human resources|\bhr\b|people/i.test(role))return 'people';
 if(/operations|logistics|procurement|supply/i.test(role))return 'operations';
 if(/chief executive|ceo|director|chief of staff|chair/i.test(role))return 'leadership';
 return 'general';
}
const weights={finance:{judgment:2,riskDiscipline:2,integrity:2},assurance:{integrity:3,judgment:2,riskDiscipline:2},commercial:{initiative:2,collaboration:2,judgment:2},people:{integrity:2,collaboration:2,leadership:2},operations:{reliability:3,competence:2,accountability:2},leadership:{leadership:3,judgment:2,accountability:2},general:{reliability:2,competence:2}};
export function scoreObservations(rows,role,{now=Date.now()}={}){
 const group=roleGroup(role),active=activeObservations(rows),window=active.filter(r=>Date.parse(r.occurred_at)>=now-180*86400000&&Date.parse(r.occurred_at)<=now);
 const d={};let weighted=0,weight=0;
 for(const k of dimensions){
  let signal=0,n=0,confidence=0;
  for(const r of window){const value=r.impacts?.[k];if(!Number.isFinite(value)||value===0)continue;
   const c=clamp(Number(r.confidence)||0,0,1),a=r.attribution==='direct'?1:r.attribution==='shared'?.5:0;
   if(!a||!c)continue;
   const age=Math.max(0,(now-Date.parse(r.occurred_at))/86400000),decay=age<=90?1:.6;
   signal+=clamp(value,-5,5)*c*a*decay;confidence+=c*a;n++;
  }
  const score=n?round(clamp(50+signal)):null;
  const certainty=round(clamp(confidence/5,0,1)*100)/100;
  d[k]={score,evidenceCount:n,confidence:certainty,trend:signal>0?'positive':signal<0?'negative':'neutral'};
  if(n){const w=(weights[group][k]||1)*certainty;weighted+=score*w;weight+=w;}
 }
 const observed=Object.values(d).filter(x=>x.evidenceCount>0).length;
 const distinctSources=new Set(window.filter(r=>['direct','shared'].includes(r.attribution)&&Number(r.confidence)>0&&Object.values(r.impacts||{}).some(v=>Number.isFinite(v)&&v!==0)).map(r=>r.source_key)).size;
 // Never rank a new hire on a seeded personality or a single lucky result.
 const rankEligible=distinctSources>=3&&observed>=2&&weight>0;
 const score=rankEligible?round(weighted/weight):null;
 return {roleGroup:group,dimensions:d,score,rankEligible,evidenceCount:distinctSources,periodDays:180,confidence:round(clamp(distinctSources/8,0,1)*100)/100};
}
export function activeObservations(rows){
 const superseded=new Set(rows.map(r=>r.supersedes_id).filter(Boolean));
 return rows.filter(r=>!superseded.has(r.id)&&r.outcome!=='withdrawn');
}
export function classifyTask(task){
 if(task.status==='completed'&&task.outcome_document_id&&task.document_verified)return {outcome:'report-delivered',reason:'A completed task has a verified report document. Delivery is evidence of follow-through, not proof of report quality or judgment.',impacts:{reliability:2},attribution:'direct',confidence:1};
 if(task.status==='completed')return {outcome:'completion-unverified',reason:'Task is marked complete but no verified report is linked; quality and reliability remain unassessed.',impacts:{},attribution:'uncertain',confidence:1};
 if(task.status==='cancelled')return {outcome:'task-cancelled',reason:'Task cancellation is recorded; responsibility and reasons are not assumed.',impacts:{},attribution:'uncertain',confidence:1};
 return null;
}
export function reviewImpacts(kind,finding,attribution){
 if(!['direct','shared'].includes(attribution))return {};
 if(kind==='judgment')return finding==='sound'?{judgment:4,riskDiscipline:2}:finding==='unsound'?{judgment:-4,riskDiscipline:-2}:{};
 if(kind==='conduct')return finding==='substantiated'?{integrity:-5,accountability:-3,loyalty:-2}:finding==='exemplary'?{integrity:4,accountability:2,loyalty:2}:{};
 if(kind==='performance')return finding==='strong'?{competence:4,initiative:2,collaboration:2}:finding==='deficient'?{competence:-4,reliability:-2}:{};
 return {};
}
export function developmentProjection(rows){
 const active=activeObservations(rows),state={},traits={},lessons=[];
 for(const r of active){if(!['direct','shared'].includes(r.attribution)||Number(r.confidence)<.7)continue;
  if(r.outcome==='report-delivered')lessons.push({sourceId:r.id,lesson:'Verified follow-through: prepare and file evidence-backed work; completion does not prove its quality.'});
  if(r.source_type==='chairman-assessment'&&Object.keys(r.impacts||{}).length)lessons.push({sourceId:r.id,lesson:r.reason});
 }
 const count=k=>active.filter(r=>['direct','shared'].includes(r.attribution)&&Number(r.confidence)>=.7&&(r.impacts?.[k]||0)!==0).length;
 const sum=k=>active.reduce((s,r)=>s+(['direct','shared'].includes(r.attribution)&&Number(r.confidence)>=.7?(r.impacts?.[k]||0)*(r.attribution==='shared'?.5:1):0),0);
 if(count('reliability')>=3){state.confidence=clamp(Math.trunc(sum('reliability')/3),-12,12);state.motivation=clamp(Math.trunc(sum('reliability')/4),-10,10);}
 if(count('judgment')>=3){traits.caution=clamp(-Math.trunc(sum('judgment')/4),-8,8);state.confidence=clamp((state.confidence||0)+Math.trunc(sum('judgment')/4),-12,12);}
 if(count('integrity')>=3){traits.susceptibilityToPressure=clamp(-Math.trunc(sum('integrity')/5),-8,8);}
 const beliefs=lessons.slice(0,12).map(x=>({sourceId:x.sourceId,interpretation:x.lesson,epistemicStatus:'lesson',rule:'Reflect on this evidence; this is not an independently verified new fact.'}));
 return {stateOffsets:state,traitOffsets:traits,lessons:lessons.slice(0,12),beliefInputs:beliefs,evidenceCount:active.length};
}
export function relationshipProjection(rows,observerId){
 const out={};for(const r of activeObservations(rows)){if(r.observer_id!==observerId||Number(r.confidence)<.7)continue;for(const k of ['trust','respect','loyalty','tension','familiarity'])out[k]=clamp((out[k]||0)+(Number(r.relationship_delta?.[k])||0),-15,15);}
 return out;
}
export function employmentRecommendation(scorecard){
 if(!scorecard.rankEligible)return {action:'insufficient-evidence',reason:'Collect more verified, role-relevant observations before comparing or recommending employment changes.'};
 const d=scorecard.dimensions;
 if(d.integrity.evidenceCount>=2&&d.integrity.score<=42)return {action:'investigate-or-disciplinary-review',reason:'Repeated substantiated conduct concerns warrant independent review, not automatic dismissal.'};
 if(scorecard.score>=57&&d.reliability.evidenceCount>=3&&!(d.integrity.score!==null&&d.integrity.score<50))return {action:'promotion-review',reason:'Sustained evidence merits consideration; verify role fit and approvals.'};
 if(scorecard.score<45)return {action:'development-review',reason:'Recorded weaknesses warrant coaching and an opportunity to respond.'};
 return {action:'retain-and-monitor',reason:'Continue evidence-based review; no automatic employment action.'};
}
