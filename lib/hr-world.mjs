import {sql,transaction,uid} from '../backend/src/db.mjs';
import {ask} from '../backend/src/ai.mjs';
import {hireEmployee} from './employment.mjs';
import {performanceForContact,ownDevelopment} from './character-development.mjs';
import {EconomyError} from './economy-rules.mjs';
import {moneyCents,moneyText} from './procurement-rules.mjs';
const clean=(v,n=500)=>typeof v==='string'?v.trim().slice(0,n):'';
const leadership=new Set(['Chief of Staff','Group CFO','Chief Operating Officer','General Counsel','Group Strategy Director','Group Human Resources Director','Chief Security Officer','Internal Audit Director','Chief Commercial Officer','Board Chair']);
export function validateHRProposal(kind,raw,evidence){
 if(!raw||typeof raw!=='object')return null;
 const reason=clean(raw.reason,1000);
 if(!reason)return null;
 if(kind==='recruitment'){
  const name=clean(raw.name,100),profile=clean(raw.profile,800);
  if(!name||!profile)return null;
  return {name,profile,reason,title:evidence.job_title,salary:evidence.annual_salary};
 }
 if(kind==='review'){
  const development=clean(raw.development,800);
  if(!development||!['retain','develop','promotion-review'].includes(raw.recommendation))return null;
  const recommendation=raw.recommendation==='promotion-review'&&(!evidence.promotionEligible||leadership.has(evidence.job_title))?'develop':raw.recommendation;
  return {reason,development,recommendation};
 }
 if(kind==='resignation'){
  if(!['stay','notice'].includes(raw.decision))return null;
  return {decision:raw.decision,reason};
 }
 return null;
}
async function event(q,h,kind,title,body,contact=h.actor_id){
 await q('INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),h.user_id,h.world_id,contact||null,kind,title,body]);
}
async function reserve(userId){
 return transaction(async q=>{
  const [w]=await q('SELECT id FROM worlds WHERE user_id=$1 FOR UPDATE',[userId]);if(!w)return;
  const [hr]=await q("SELECT id FROM contacts WHERE user_id=$1 AND world_id=$2 AND kind='internal' AND title='Group Human Resources Director' LIMIT 1",[userId,w.id]);
  const candidates=await q(`SELECT e.*,p.name,p.agenda,p.temperament,c.name company_name,
    (SELECT count(*)::int FROM business_tasks t WHERE t.user_id=e.user_id AND t.assignee_id=e.contact_id AND t.status='completed' AND t.completed_at>=now()-interval '30 days') completed_tasks,
    (SELECT count(*)::int FROM business_tasks t WHERE t.user_id=e.user_id AND t.assignee_id=e.contact_id AND t.status='assigned' AND t.created_at<now()-interval '7 days') aging_tasks
    FROM employment_records e JOIN contacts p ON p.id=e.contact_id AND p.user_id=e.user_id
    JOIN companies c ON c.id=e.company_id AND c.user_id=e.user_id WHERE e.user_id=$1 AND e.world_id=$2 AND c.disposed_at IS NULL
    ORDER BY CASE WHEN e.status='terminated' THEN 0 ELSE 1 END,e.hired_at,e.id LIMIT 100`,[userId,w.id]);
  const month=new Date().toISOString().slice(0,7);
  for(const e of candidates){
   let kind,actor,key,title;
   if(e.status==='terminated'){
    if(!hr||e.job_title==='Group Human Resources Director')continue;
    const [replacement]=await q("SELECT id FROM employment_records WHERE user_id=$1 AND company_id=$2 AND job_title=$3 AND status='active' AND hired_at>=$4 LIMIT 1",[userId,e.company_id,e.job_title,e.terminated_at]);if(replacement)continue;
    kind='recruitment';actor=hr.id;key='vacancy:'+e.id;title='Replacement candidate · '+e.job_title;
   }else if(e.aging_tasks>=5&&!leadership.has(e.job_title)){
    const [notice]=await q("SELECT id FROM hr_cases WHERE user_id=$1 AND employment_id=$2 AND kind='resignation' AND status IN ('pending','ready') LIMIT 1",[userId,e.id]);if(notice)continue;
    kind='resignation';actor=e.contact_id;key='workload:'+e.id+':'+month;title='Career decision · '+e.name;
   }else if(hr&&e.completed_tasks>0){
    kind='review';actor=hr.id;key='review:'+e.id+':'+month;title='Performance review · '+e.name;
   }else continue;
   const performance=kind==='review'?await performanceForContact(userId,e.contact_id,e.job_title,q):null;
   const development=kind==='resignation'?await ownDevelopment(userId,e.contact_id,q):null;
   const evidence={performance,development,employee_name:e.name,job_title:e.job_title,annual_salary:e.annual_salary,company_name:e.company_name,completed_tasks:e.completed_tasks,aging_tasks:e.aging_tasks,agenda:e.agenda,temperament:e.temperament,promotionEligible:performance?.recommendation.action==='promotion-review'&&e.completed_tasks>=3&&e.aging_tasks===0&&!leadership.has(e.job_title)&&!e.job_title.startsWith('Senior ')};
   const rows=await q('INSERT INTO hr_cases(id,user_id,world_id,company_id,employment_id,actor_id,kind,title,evidence,source_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(user_id,source_key) DO NOTHING RETURNING id',[uid(),userId,w.id,e.company_id,e.id,actor,kind,title,JSON.stringify(evidence),key]);
   if(rows.length)return;
  }
 });
}
export async function decideHRCase(user,id,body){
 const decision=body.decision,reason=clean(body.reason);
 if(!['approved','rejected'].includes(decision)||!reason)throw new EconomyError('Provide a decision and reason.');
 return transaction(async q=>{
  const [h]=await q('SELECT * FROM hr_cases WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]);
  if(!h||!['recruitment','promotion'].includes(h.kind))throw new EconomyError('HR proposal unavailable.',404);
  if(h.status===decision||decision==='approved'&&h.status==='executed')return h;
  if(h.status!=='ready')throw new EconomyError('Proposal no longer awaiting a decision.',409);
  const [row]=await q('UPDATE hr_cases SET status=$1,decision_reason=$2,updated_at=now() WHERE id=$3 AND user_id=$4 RETURNING *',[decision,reason,id,user.id]);
  await event(q,h,'hr-decision',h.title+' · '+decision,reason);
  return row;
 });
}
async function executeApproved(h){
 if(h.kind==='recruitment'){
  // Hire is independently idempotent. A crash after hire can safely retry.
  const p=h.proposal;
  const employee=await hireEmployee({id:h.user_id},{companyId:h.company_id,name:p.name,title:p.title,salary:p.salary,operationKey:'hr:'+h.id});
  await transaction(async q=>{
   const [locked]=await q("SELECT id FROM hr_cases WHERE id=$1 AND user_id=$2 AND status='approved' FOR UPDATE",[h.id,h.user_id]);if(!locked)return;
   await q("UPDATE hr_cases SET status='executed',proposal=proposal||jsonb_build_object('hired_employee_id',$3::text),updated_at=now() WHERE id=$1 AND user_id=$2",[h.id,h.user_id,employee.id]);
   await event(q,h,'hr-recruitment-completed',h.title,p.name+' was appointed on approved terms.');
  });return;
 }
 if(h.kind!=='promotion')return;
 await transaction(async q=>{
  await q('SELECT id FROM companies WHERE id=$1 AND user_id=$2 FOR UPDATE',[h.company_id,h.user_id]);
  const [locked]=await q("SELECT * FROM hr_cases WHERE id=$1 AND user_id=$2 AND status='approved' FOR UPDATE",[h.id,h.user_id]);if(!locked)return;
  const [e]=await q("SELECT * FROM employment_records WHERE id=$1 AND user_id=$2 AND company_id=$3 AND status='active' FOR UPDATE",[h.employment_id,h.user_id,h.company_id]);
  const p=locked.proposal;
  if(!e||e.job_title!==locked.evidence.job_title||e.annual_salary!==locked.evidence.annual_salary||leadership.has(e.job_title)){
   await q("UPDATE hr_cases SET status='deferred',decision_reason='Employment terms changed before execution; review again.',updated_at=now() WHERE id=$1 AND user_id=$2",[h.id,h.user_id]);return;
  }
  // Promotions take effect on the first day of the next month. Existing payroll
  // periods are not changed. Until that date the current role and salary stay active.
  await q("UPDATE hr_cases SET effective_on=coalesce(effective_on,(date_trunc('month',now() AT TIME ZONE 'UTC')+interval '1 month')::date),updated_at=now() WHERE id=$1 AND user_id=$2",[h.id,h.user_id]);
 });
}
async function applyDue(h){
 await transaction(async q=>{
  await q('SELECT id FROM companies WHERE id=$1 AND user_id=$2 FOR UPDATE',[h.company_id,h.user_id]);
  const [job]=await q("SELECT * FROM hr_cases WHERE id=$1 AND user_id=$2 AND effective_on<=(now() AT TIME ZONE 'UTC')::date AND ((kind='promotion' AND status='approved') OR (kind='resignation' AND status='ready')) FOR UPDATE",[h.id,h.user_id]);if(!job)return;
  const [e]=await q("SELECT * FROM employment_records WHERE id=$1 AND user_id=$2 AND company_id=$3 AND status='active' FOR UPDATE",[h.employment_id,h.user_id,h.company_id]);
  if(!e||job.kind==='promotion'&&(e.job_title!==job.evidence.job_title||e.annual_salary!==job.evidence.annual_salary)){
   await q("UPDATE hr_cases SET status='deferred',decision_reason='Employment changed before effective date.',updated_at=now() WHERE id=$1 AND user_id=$2",[h.id,h.user_id]);return;
  }
  if(job.kind==='promotion'){
   const p=job.proposal;
   await q('INSERT INTO employment_terms(id,user_id,employment_id,effective_on,job_title,annual_salary,reason) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),h.user_id,e.id,job.effective_on,p.title,p.salary,job.decision_reason]);
   await q('UPDATE employment_records SET job_title=$1,annual_salary=$2,salary_basis=$3 WHERE id=$4 AND user_id=$5',[p.title,p.salary,'approved-promotion',e.id,h.user_id]);
   await q('UPDATE contacts SET title=$1 WHERE id=$2 AND user_id=$3',[p.title,e.contact_id,h.user_id]);
   await event(q,h,'employee-promoted',job.title,'New role: '+p.title+' · annual salary USD '+p.salary,e.contact_id);
  }else{
   await q("UPDATE employment_records SET status='terminated',terminated_at=$1::date::timestamp AT TIME ZONE 'UTC',termination_reason=$2,separation_type='resignation' WHERE id=$3 AND user_id=$4",[job.effective_on,job.proposal.reason,e.id,h.user_id]);
   await q("UPDATE contacts SET kind='former-employee',relationship='former employee',title='Former '||$3 WHERE id=$1 AND user_id=$2",[e.contact_id,h.user_id,e.job_title]);
   await q("UPDATE business_tasks SET status='cancelled',completed_at=now(),outcome='Employee resigned; requires reassignment' WHERE user_id=$1 AND assignee_id=$2 AND status='assigned'",[h.user_id,e.contact_id]);
   await event(q,h,'employee-resigned',job.evidence.employee_name+' left the company',job.proposal.reason,e.contact_id);
  }
  await q("UPDATE hr_cases SET status='executed',updated_at=now() WHERE id=$1 AND user_id=$2",[h.id,h.user_id]);
 });
}
export async function processHR(userId){
 const due=await sql("SELECT * FROM hr_cases WHERE user_id=$1 AND effective_on<=(now() AT TIME ZONE 'UTC')::date AND ((kind='promotion' AND status='approved') OR (kind='resignation' AND status='ready')) ORDER BY effective_on LIMIT 10",[userId]);
 for(const h of due)await applyDue(h);
 const approved=await sql("SELECT * FROM hr_cases WHERE user_id=$1 AND status='approved' AND effective_on IS NULL AND kind IN ('recruitment','promotion') ORDER BY updated_at LIMIT 4",[userId]);
 for(const h of approved)await executeApproved(h);
 await reserve(userId);
 const [job]=await sql(`WITH due AS (SELECT id FROM hr_cases WHERE user_id=$1 AND status='pending' AND (attempted_at IS NULL OR attempted_at<now()-interval '30 minutes') ORDER BY attempted_at NULLS FIRST,created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
 UPDATE hr_cases h SET attempts=attempts+1,attempted_at=now() FROM due WHERE h.id=due.id RETURNING h.*`,[userId]);
 if(!job)return;
 const instruction=job.kind==='recruitment'?'Act as HR. Generate one explicitly fictional candidate for the recorded vacancy, with name, profile and reason. No claim of completed interview, background check or actual work. Return JSON {name,profile,reason}.':job.kind==='review'?'Act as HR. Assess recorded task counts, workload and the evidence-based performance profile. Unknown dimensions are unassessed. Do not infer task quality, attendance or misconduct from task counts. Promotion requires the explicit promotionEligible gate. Return JSON {recommendation:"retain"|"develop"|"promotion-review",reason,development}. A promotion is only a proposal.':'Act as the fictional employee named in evidence. Independently choose whether to stay or give voluntary notice given the recorded workload, personal agenda and own evidence-backed development. Do not invent outside job offers. Return JSON {decision:"stay"|"notice",reason}.';
 const proposal=await ask(instruction,JSON.stringify(job.evidence),{json:true,fallback:null,validate:raw=>validateHRProposal(job.kind,raw,job.evidence)});
 if(!proposal){const error=Error('HR decision unavailable');error.code='AI_HR_UNAVAILABLE';throw error;}
 await transaction(async q=>{
  const [h]=await q("SELECT * FROM hr_cases WHERE id=$1 AND user_id=$2 AND status='pending' AND attempts=$3 FOR UPDATE",[job.id,userId,job.attempts]);if(!h)return;
  const [employment]=await q('SELECT status,job_title,annual_salary FROM employment_records WHERE id=$1 AND user_id=$2',[h.employment_id,userId]);
  if(!employment||employment.job_title!==h.evidence.job_title||employment.annual_salary!==h.evidence.annual_salary||(h.kind==='recruitment'?employment.status!=='terminated':employment.status!=='active')){
   await q("UPDATE hr_cases SET status='deferred',decision_reason='Source employment record changed before assessment.',updated_at=now() WHERE id=$1 AND user_id=$2",[h.id,userId]);return;
  }
  const [actor]=await q("SELECT id FROM contacts WHERE id=$1 AND user_id=$2 AND world_id=$3 AND kind='internal'",[h.actor_id,userId,h.world_id]);if(!actor){await q("UPDATE hr_cases SET status='deferred',decision_reason='Original actor is no longer available.' WHERE id=$1 AND user_id=$2",[h.id,userId]);return;}
  if(h.kind==='resignation'){
   const notice=proposal.decision==='notice';
   await q("UPDATE hr_cases SET status=$1,proposal=$2,effective_on=CASE WHEN $3 THEN (now() AT TIME ZONE 'UTC')::date+30 ELSE NULL END,updated_at=now() WHERE id=$4 AND user_id=$5",[notice?'ready':'deferred',JSON.stringify(proposal),notice,h.id,userId]);
   if(notice){
    await event(q,h,'employee-resignation-notice',h.evidence.employee_name+' gave 30 days notice',proposal.reason);
    await q('INSERT INTO messages(id,user_id,world_id,contact_id,direction,channel,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),userId,h.world_id,h.actor_id,'incoming','chat','Chairman, I am giving 30 days notice of my resignation. '+proposal.reason]);
   }
  }else if(h.kind==='recruitment'){
   await q("UPDATE hr_cases SET status='ready',proposal=$1,updated_at=now() WHERE id=$2 AND user_id=$3",[JSON.stringify(proposal),h.id,userId]);
   await event(q,h,'hr-proposal',h.title,'Fictional candidate '+proposal.name+' proposed. Interview and appointment are not yet completed.');
  }else{
   await q("UPDATE hr_cases SET status='executed',proposal=$1,updated_at=now() WHERE id=$2 AND user_id=$3",[JSON.stringify(proposal),h.id,userId]);
   await q('INSERT INTO documents(id,user_id,world_id,contact_id,title,kind,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),userId,h.world_id,h.actor_id,h.title,'employee-review',JSON.stringify({evidence:h.evidence,review:proposal})]);
   await event(q,h,'hr-review-completed',h.title,proposal.reason+' · '+proposal.development);
   if(proposal.recommendation==='promotion-review'){
    const salary=moneyText((moneyCents(h.evidence.annual_salary)*110n+50n)/100n);
    const title=('Senior '+h.evidence.job_title).slice(0,100);
    await q("INSERT INTO hr_cases(id,user_id,world_id,company_id,employment_id,actor_id,kind,status,title,evidence,proposal,source_key) VALUES($1,$2,$3,$4,$5,$6,'promotion','ready',$7,$8,$9,$10) ON CONFLICT(user_id,source_key) DO NOTHING",[uid(),userId,h.world_id,h.company_id,h.employment_id,h.actor_id,'Promotion proposal · '+h.evidence.employee_name,JSON.stringify(h.evidence),JSON.stringify({title,salary,reason:proposal.reason,review_id:h.id}),'promotion:'+h.id]);
    await event(q,h,'hr-proposal','Promotion proposal · '+h.evidence.employee_name,'Proposed role '+title+' · 10% salary increase. Awaiting Chairman approval.');
   }
  }
 });
}
export async function hrSnapshot(userId){
 return sql('SELECT h.*,c.name company_name,p.name actor_name,h.effective_on::text effective_on FROM hr_cases h JOIN companies c ON c.id=h.company_id AND c.user_id=h.user_id LEFT JOIN contacts p ON p.id=h.actor_id AND p.user_id=h.user_id WHERE h.user_id=$1 ORDER BY h.created_at DESC LIMIT 150',[userId]);
}
