import {sql,transaction,uid} from '../backend/src/db.mjs';
import {ask} from '../backend/src/ai.mjs';
import {EconomyError} from './economy-rules.mjs';

const clean=(v,n=1200)=>typeof v==='string'?v.trim().slice(0,n):'';
const categories=new Set(['fraud','cyber','corporate','physical','travel']);
const severities=new Set(['low','medium','high']);
const workTypes=new Set(['document_review','transaction_reconciliation','interview','control_check','legal_review','monitor']);
const assessments=new Set(['insufficient','preliminary','credible','corroborated','contradicted']);
const bounded=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
export function parseSecurityScenario(raw){
 if(!raw||!['report','defer'].includes(raw.decision))return null;
 const reason=clean(raw.reason,600);if(!reason)return null;
 if(raw.decision==='defer')return {decision:'defer',reason};
 const title=clean(raw.title,160),description=clean(raw.description,1800),trigger=clean(raw.trigger,500);
 if(!title||!description||!trigger||!categories.has(raw.category)||!severities.has(raw.severity)||!bounded(raw.confidence,0.1,0.8))return null;
 // Scenario leads never name a suspect or claim that evidence exists.
 if(raw.accusedContactId||raw.perpetrator||raw.evidenceCollected)return null;
 return {decision:'report',title,description,trigger,category:raw.category,severity:raw.severity,confidence:raw.confidence,reason};
}
export function parseSecurityReview(raw,allowedContactIds){
 if(!raw||!assessments.has(raw.assessment))return null;
 const summary=clean(raw.summary,1600),reason=clean(raw.reason,600);
 if(!summary||!reason||!bounded(raw.confidence,0,1)||!Array.isArray(raw.steps))return null;
 const steps=raw.steps.slice(0,3).map(s=>{
  const type=s?.type,title=clean(s?.title,140),instructions=clean(s?.instructions,900);
  if(!workTypes.has(type)||!title||!instructions)return null;
  const targetContactId=s.targetContactId&&allowedContactIds.includes(s.targetContactId)?s.targetContactId:null;
  if(type==='interview'&&!targetContactId)return null;
  return {type,title,instructions,targetContactId};
 });
 if(steps.some(x=>!x))return null;
 return {assessment:raw.assessment,summary,reason,confidence:raw.confidence,steps};
}
export function parseInterviewStatement(raw){
 const statement=clean(raw?.statement,1400),knowledgeBasis=raw?.knowledgeBasis,confidence=raw?.confidence;
 if(!statement||!['memory','direct-observation','not-aware','unknown'].includes(knowledgeBasis)||!bounded(confidence,0,1))return null;
 if(knowledgeBasis==='not-aware'&&confidence>0.35)return null;
 return {statement,knowledgeBasis,confidence};
}
const retryDelay=attempt=>attempt<=1?"interval '5 minutes'":attempt===2?"interval '15 minutes'":"interval '45 minutes'";
async function reserveScenario(userId){
 return transaction(async q=>{
  const [world]=await q('SELECT id,name,region,sectors FROM worlds WHERE user_id=$1 FOR UPDATE',[userId]);if(!world)return null;
  const [open]=await q("SELECT id FROM security_incidents WHERE user_id=$1 AND world_id=$2 AND origin='simulated' AND status IN ('reported','investigating') LIMIT 1",[userId,world.id]);if(open)return null;
  const [recent]=await q("SELECT id FROM security_scenario_runs WHERE user_id=$1 AND world_id=$2 AND created_at>=now()-interval '72 hours' LIMIT 1",[userId,world.id]);if(recent)return null;
  const cycle='scenario:'+world.id+':'+Math.floor(Date.now()/259200000);
  const [job]=await q(`INSERT INTO security_scenario_runs(id,user_id,world_id,cycle_key) VALUES($1,$2,$3,$4)
   ON CONFLICT(user_id,cycle_key) DO NOTHING RETURNING *`,[uid(),userId,world.id,cycle]);
  return job;
 });
}
export async function processSecurityScenario(userId){
 await reserveScenario(userId);
 const [job]=await sql(`WITH due AS (SELECT id FROM security_scenario_runs WHERE user_id=$1 AND status='pending'
  AND next_attempt_at<=now() AND (attempted_at IS NULL OR attempted_at<now()-interval '20 minutes') AND attempts<4
  ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
  UPDATE security_scenario_runs s SET status='processing',attempts=attempts+1,attempted_at=now() FROM due
  WHERE s.id=due.id RETURNING s.*`,[userId]);if(!job)return false;
 try{
  const [world]=await sql('SELECT name,region,sectors FROM worlds WHERE id=$1 AND user_id=$2',[job.world_id,userId]);
  const [companies,organizations,moves,contracts,openCases,roles]=await Promise.all([
   sql('SELECT id,name,sector FROM companies WHERE user_id=$1 AND world_id=$2 ORDER BY name',[userId,job.world_id]),
   sql("SELECT id,name,sector,organization_type,strategy,market_position FROM external_organizations WHERE user_id=$1 AND world_id=$2 AND status='active' ORDER BY name",[userId,job.world_id]),
   sql('SELECT title,description,impact,move_type,created_at FROM market_moves WHERE user_id=$1 AND world_id=$2 ORDER BY created_at DESC LIMIT 8',[userId,job.world_id]),
   sql("SELECT title,counterparty,value,status FROM business_contracts WHERE user_id=$1 AND world_id=$2 AND status IN ('draft','active','disputed') ORDER BY updated_at DESC LIMIT 8",[userId,job.world_id]),
   sql("SELECT title,category,severity,status,origin FROM security_incidents WHERE user_id=$1 AND world_id=$2 AND status IN ('reported','investigating') ORDER BY created_at DESC LIMIT 8",[userId,job.world_id]),
   sql("SELECT id,name,title,company,kind FROM contacts WHERE user_id=$1 AND world_id=$2 AND kind IN ('internal','supplier','vendor','client','competitor','rival') ORDER BY name LIMIT 30",[userId,job.world_id])
  ]);
  const scenario=await ask(
   'You are the security simulation director for a fictional business world. You may create at most one plausible, low-to-high severity unverified security lead grounded in the supplied company sectors, active counterparties, market moves or contracts. This is an explicitly fictional scenario, not a real-world allegation or a claim that an event has occurred. Never name or accuse a real person; do not provide operational instructions for fraud, hacking, violence, evasion or wrongdoing. Prefer a plausible concern such as a questionable procurement approach, attempted disclosure request, suspicious unsolicited payment instruction or governance conflict, but only if the supplied context makes it meaningful. If there is no useful scenario, defer. A report is a lead to investigate, not evidence. Return JSON {decision:"report"|"defer",title:"",description:"",category:"fraud|cyber|corporate|physical|travel",severity:"low|medium|high",trigger:"specific supplied context",confidence:0.0,reason:""}. Never select critical severity or a named accused person.',
   JSON.stringify({world,companies,externalOrganizations:organizations,recentCompetitorMoves:moves,activeContracts:contracts,openIncidents:openCases,knownContacts:roles}),
   {json:true,fallback:null,validate:parseSecurityScenario}
  );
  if(!scenario)throw Object.assign(Error('Security scenario generation unavailable'),{code:'AI_SECURITY_SCENARIO_UNAVAILABLE'});
  await transaction(async q=>{
   const [lock]=await q("SELECT id FROM security_scenario_runs WHERE id=$1 AND user_id=$2 AND status='processing' AND attempts=$3 FOR UPDATE",[job.id,userId,job.attempts]);if(!lock)return;
   if(scenario.decision==='report'){
    const [officer]=await q("SELECT id,name FROM contacts WHERE user_id=$1 AND world_id=$2 AND kind='internal' AND title='Chief Security Officer' LIMIT 1",[userId,job.world_id]);
    const caseId=uid(),incidentId=uid();
    const caseSeverity=scenario.severity==='medium'?'moderate':scenario.severity;
    const description='SIMULATED SCENARIO LEAD — UNVERIFIED. '+scenario.description+' No individual is accused. No corroborating evidence has been collected. Investigation is required before drawing conclusions.';
    await q(`INSERT INTO investigation_cases(id,user_id,world_id,title,allegation,severity,opened_by)
     VALUES($1,$2,$3,$4,$5,$6,'Security simulation')`,[caseId,userId,job.world_id,scenario.title,description,caseSeverity]);
    await q(`INSERT INTO security_incidents(id,user_id,world_id,title,category,severity,status,description,assigned_to_contact_id,source_investigation_id,origin,source_context,simulation_key)
     VALUES($1,$2,$3,$4,$5,$6,'reported',$7,$8,$9,'simulated',$10,$11)`,
     [incidentId,userId,job.world_id,scenario.title,scenario.category,scenario.severity,description,officer?.id||null,caseId,
      JSON.stringify({trigger:scenario.trigger,confidence:scenario.confidence,reason:scenario.reason,scenarioRunId:job.id,notEvidence:true}),job.cycle_key]);
    await q('INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),userId,job.world_id,officer?.id||null,'security-scenario-reported',scenario.title,'SIMULATED · UNVERIFIED · '+scenario.description+' No individual is accused and no evidence has yet been corroborated.']);
    await q("UPDATE security_scenario_runs SET status='completed',incident_id=$1,completed_at=now() WHERE id=$2 AND user_id=$3",[incidentId,job.id,userId]);
   }else{
    await q("UPDATE security_scenario_runs SET status='deferred',completed_at=now(),last_error_code=NULL WHERE id=$1 AND user_id=$2",[job.id,userId]);
   }
  });
  return true;
 }catch(error){
  const code=String(error.code||error.name||'Error').slice(0,80);
  await sql(`UPDATE security_scenario_runs SET status=CASE WHEN attempts>=4 THEN 'failed' ELSE 'pending' END,
   next_attempt_at=now()+${retryDelay(job.attempts)},last_error_code=$3 WHERE id=$1 AND user_id=$2 AND status='processing'`,[job.id,userId,code]);
  throw error;
 }
}
async function queueSecurityReview(userId){
 await transaction(async q=>{
  const [world]=await q('SELECT id FROM worlds WHERE user_id=$1 FOR UPDATE',[userId]);if(!world)return;
  const incidents=await q(`SELECT i.id,i.source_investigation_id,i.updated_at,
    (SELECT e.id FROM security_incident_evidence e WHERE e.user_id=i.user_id AND e.incident_id=i.id ORDER BY e.created_at DESC LIMIT 1) latest_evidence_id
   FROM security_incidents i WHERE i.user_id=$1 AND i.world_id=$2 AND i.status IN ('reported','investigating')
   ORDER BY i.updated_at LIMIT 8`,[userId,world.id]);
  for(const incident of incidents){
   const version=incident.latest_evidence_id||new Date(incident.updated_at).toISOString();
   const key='security-review:'+incident.id+':'+version;
   await q(`INSERT INTO security_review_jobs(id,user_id,world_id,incident_id,case_id,review_key)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,review_key) DO NOTHING`,
    [uid(),userId,world.id,incident.id,incident.source_investigation_id,key]);
  }
 });
}
export async function processSecurityReviews(userId){
 await queueSecurityReview(userId);
 const [job]=await sql(`WITH due AS (SELECT id FROM security_review_jobs WHERE user_id=$1 AND status IN ('pending','processing')
  AND next_attempt_at<=now() AND (attempted_at IS NULL OR attempted_at<now()-interval '20 minutes') AND attempts<5
  ORDER BY next_attempt_at,created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
  UPDATE security_review_jobs j SET status='processing',attempts=attempts+1,attempted_at=now() FROM due
  WHERE j.id=due.id RETURNING j.*`,[userId]);if(!job)return false;
 try{
  const [incident]=await sql('SELECT * FROM security_incidents WHERE id=$1 AND user_id=$2 AND world_id=$3',[job.incident_id,userId,job.world_id]);
  if(!incident||['resolved','false-alarm'].includes(incident.status)){
   await sql("UPDATE security_review_jobs SET status='completed',completed_at=now() WHERE id=$1 AND user_id=$2",[job.id,userId]);return true;
  }
  const [caseRow]=job.case_id?await sql('SELECT id,title,allegation,severity,status,finding,company_id,source_invoice_id FROM investigation_cases WHERE id=$1 AND user_id=$2',[job.case_id,userId]):[null];
  const [incidentEvidence,caseEvidence,invoice,officers,contacts]=await Promise.all([
   sql('SELECT evidence_type,description,source_reference,epistemic_status,provenance,created_at FROM security_incident_evidence WHERE user_id=$1 AND incident_id=$2 ORDER BY created_at LIMIT 30',[userId,incident.id]),
   job.case_id?sql('SELECT evidence_type,description,source_reference,confidence,epistemic_status,provenance,created_at FROM investigation_evidence WHERE user_id=$1 AND case_id=$2 ORDER BY created_at LIMIT 40',[userId,job.case_id]):Promise.resolve([]),
   caseRow?.source_invoice_id?sql('SELECT id,invoice_number,customer_name,amount,due_at,status,risk_level,risk_reason FROM business_invoices WHERE id=$1 AND user_id=$2',[caseRow.source_invoice_id,userId]).then(x=>x[0]||null):Promise.resolve(null),
   sql("SELECT id,name,title FROM contacts WHERE user_id=$1 AND world_id=$2 AND kind='internal' AND title IN ('Chief Security Officer','Internal Audit Director','General Counsel') ORDER BY CASE title WHEN 'Chief Security Officer' THEN 0 WHEN 'Internal Audit Director' THEN 1 ELSE 2 END",[userId,job.world_id]),
   sql('SELECT id,name,title,company,kind,agenda FROM contacts WHERE user_id=$1 AND world_id=$2 ORDER BY name LIMIT 40',[userId,job.world_id])
  ]);
  const reviewer=officers.find(x=>x.title==='Internal Audit Director')||officers.find(x=>x.title==='Chief Security Officer')||officers[0]||null;
  const allowedContactIds=contacts.map(c=>c.id);
  const result=await ask(
   'You are an independent fictional internal-audit and security reviewer. Review only the supplied incident report and records. Separate allegations, simulated leads, witness statements, corroborated records and missing evidence. Never infer guilt from job title, relationship or rumor. A simulated scenario is not evidence. A witness statement is reported, not automatically corroborated. Choose assessment: insufficient, preliminary, credible, corroborated or contradicted. "Corroborated" requires at least two independent consistent sources or an objective record that directly supports the material claim. Recommend up to three proportionate next steps. Interview questions must be neutral, non-accusatory and directed only to a relevant supplied contact. Do not recommend punishment, termination, public accusation or irreversible action. Return JSON {assessment:"insufficient|preliminary|credible|corroborated|contradicted",confidence:0.0,summary:"...",reason:"...",steps:[{type:"document_review|transaction_reconciliation|interview|control_check|legal_review|monitor",title:"...",instructions:"...",targetContactId:null}]}. If evidence is weak, request verification rather than concluding.',
   JSON.stringify({incident:{id:incident.id,title:incident.title,category:incident.category,severity:incident.severity,status:incident.status,description:incident.description,origin:incident.origin,sourceContext:incident.source_context,location:incident.location},investigation:caseRow,evidence:incidentEvidence,investigationEvidence:caseEvidence,invoice,reviewer,possibleInterviewees:contacts}),
   {json:true,fallback:null,validate:raw=>parseSecurityReview(raw,allowedContactIds)}
  );
  if(!result)throw Object.assign(Error('Security review unavailable'),{code:'AI_SECURITY_REVIEW_UNAVAILABLE'});
  await transaction(async q=>{
   const [lock]=await q("SELECT id FROM security_review_jobs WHERE id=$1 AND user_id=$2 AND status='processing' AND attempts=$3 FOR UPDATE",[job.id,userId,job.attempts]);if(!lock)return;
   const [review]=await q(`INSERT INTO security_case_reviews(id,user_id,world_id,incident_id,case_id,reviewer_contact_id,assessment,confidence,summary,recommended_steps,source_context,review_key)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(user_id,review_key) DO NOTHING RETURNING *`,
    [uid(),userId,job.world_id,incident.id,job.case_id,reviewer?.id||null,result.assessment,result.confidence,result.summary,JSON.stringify(result.steps),JSON.stringify({reviewJobId:job.id,reviewReason:result.reason}),job.review_key]);
   if(review){
    for(let i=0;i<result.steps.length;i++){
     const step=result.steps[i],workId=uid(),sourceKey='security-work:'+review.id+':'+i;
     const [work]=await q(`INSERT INTO security_work_items(id,user_id,world_id,incident_id,case_id,review_id,assigned_to_contact_id,target_contact_id,work_type,title,instructions,source_key,due_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now()+interval '2 days') ON CONFLICT(user_id,source_key) DO NOTHING RETURNING *`,
      [workId,userId,job.world_id,incident.id,job.case_id,review.id,reviewer?.id||null,step.targetContactId,step.type,step.title,step.instructions,sourceKey]);
     if(work&&step.type==='interview'&&step.targetContactId){
      await q(`INSERT INTO security_interviews(id,user_id,world_id,incident_id,case_id,work_item_id,interviewer_contact_id,interviewee_contact_id,question)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(work_item_id) DO NOTHING`,
       [uid(),userId,job.world_id,incident.id,job.case_id,work.id,reviewer?.id||null,step.targetContactId,step.instructions]);
     }
    }
    await q('INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),userId,job.world_id,reviewer?.id||null,'security-review-ready','Security review · '+incident.title,result.assessment.toUpperCase()+' · '+result.summary+' · Recommendations are investigative steps, not findings.']);
   }
   await q("UPDATE security_review_jobs SET status='completed',completed_at=now(),last_error_code=NULL WHERE id=$1 AND user_id=$2",[job.id,userId]);
  });
  return true;
 }catch(error){
  const code=String(error.code||error.name||'Error').slice(0,80);
  await sql(`UPDATE security_review_jobs SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,
   next_attempt_at=now()+${retryDelay(job.attempts)},last_error_code=$3 WHERE id=$1 AND user_id=$2 AND status='processing'`,[job.id,userId,code]);
  throw error;
 }
}
export async function processSecurityInterviews(userId){
 const [job]=await sql(`WITH due AS (
  SELECT i.id FROM security_interviews i JOIN security_incidents s ON s.id=i.incident_id AND s.user_id=i.user_id
  WHERE i.user_id=$1 AND i.status IN ('pending','processing') AND i.attempts<4
  AND (i.attempted_at IS NULL OR i.attempted_at<now()-interval '20 minutes')
  AND s.status IN ('reported','investigating')
  ORDER BY i.created_at LIMIT 1 FOR UPDATE OF i SKIP LOCKED
 ) UPDATE security_interviews i SET status='processing',attempts=attempts+1,attempted_at=now()
 FROM due WHERE i.id=due.id RETURNING i.*`,[userId]);
 if(!job)return false;
 const [person]=await sql('SELECT id,name,title,company,temperament,agenda FROM contacts WHERE id=$1 AND user_id=$2 AND world_id=$3',[job.interviewee_contact_id,userId,job.world_id]);
 if(!person){await sql("UPDATE security_interviews SET status='unavailable',last_error_code='CONTACT_UNAVAILABLE' WHERE id=$1 AND user_id=$2 AND status='processing'",[job.id,userId]);return false;}
 const memories=await sql("SELECT memory_type,epistemic_status,content,confidence,occurred_at FROM character_memories WHERE user_id=$1 AND contact_id=$2 AND sensitivity<>'restricted' ORDER BY importance DESC,occurred_at DESC LIMIT 12",[userId,person.id]);
 const statement=await ask(
  'You are '+person.name+', '+person.title+', responding to a neutral internal interview in a fictional company. Answer only from your own supplied memories and direct knowledge. Do not assume the allegation is true, speculate about guilt, invent events or claim to have seen evidence that is not in your memories. It is acceptable to say you do not know or do not recall. Distinguish your recollection from hearsay. Return JSON {statement:"...",knowledgeBasis:"memory|direct-observation|not-aware|unknown",confidence:0.0}.',
  JSON.stringify({interviewee:{name:person.name,title:person.title,company:person.company,temperament:person.temperament},neutralQuestion:job.question,ownMemories:memories}),
  {json:true,fallback:null,validate:parseInterviewStatement}
 );
 if(!statement){
  await sql("UPDATE security_interviews SET status=CASE WHEN attempts>=4 THEN 'unavailable' ELSE 'pending' END,last_error_code='AI_INTERVIEW_UNAVAILABLE' WHERE id=$1 AND user_id=$2 AND status='processing' AND attempts=$3",[job.id,userId,job.attempts]);
  return false;
 }
 await transaction(async q=>{
  const [interview]=await q("SELECT * FROM security_interviews WHERE id=$1 AND user_id=$2 AND status='processing' AND attempts=$3 FOR UPDATE",[job.id,userId,job.attempts]);if(!interview)return;
  const [incident]=await q('SELECT title,source_investigation_id FROM security_incidents WHERE id=$1 AND user_id=$2',[job.incident_id,userId]);if(!incident)return;
  const description='Unverified interview statement from '+person.name+': '+statement.statement;
  const provenance={interviewId:job.id,knowledgeBasis:statement.knowledgeBasis,confidence:statement.confidence,epistemicStatus:'reported',notAnEstablishedFact:true};
  await q(`INSERT INTO security_incident_evidence(id,user_id,incident_id,evidence_type,description,source_reference,epistemic_status,provenance)
   VALUES($1,$2,$3,'witness',$4,$5,'reported',$6)`,[uid(),userId,job.incident_id,description,'security-interview:'+job.id,JSON.stringify(provenance)]);
  if(job.case_id)await q(`INSERT INTO investigation_evidence(id,user_id,case_id,evidence_type,description,source_reference,confidence,collected_by,epistemic_status,provenance)
   VALUES($1,$2,$3,'witness-statement',$4,$5,$6,$7,'reported',$8)`,
   [uid(),userId,job.case_id,description,'security-interview:'+job.id,statement.confidence,job.interviewer_contact_id||'Security Office',JSON.stringify(provenance)]);
  await q("UPDATE security_interviews SET status='answered',response=$1,confidence=$2,knowledge_basis=$3,answered_at=now(),last_error_code=NULL WHERE id=$4 AND user_id=$5",[statement.statement,statement.confidence,statement.knowledgeBasis,job.id,userId]);
  await q("UPDATE security_work_items SET status='completed',result=$1,completed_at=now() WHERE id=$2 AND user_id=$3 AND status='pending'",['Interview recorded as an unverified witness statement. '+statement.knowledgeBasis+': '+statement.statement,job.work_item_id,userId]);
  await q('INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),userId,job.world_id,person.id,'security-interview-completed','Interview recorded · '+person.name,description+' · This is a reported statement, not a verified finding.']);
 });
 return true;
}
export async function completeSecurityWorkItem(user,id,body){
 const result=clean(body.result,1800);if(!result)throw new EconomyError('Record the work performed and its result.');
 return transaction(async q=>{
  const [item]=await q("SELECT * FROM security_work_items WHERE id=$1 AND user_id=$2 AND status IN ('pending','blocked') AND work_type<>'interview' FOR UPDATE",[id,user.id]);
  if(!item)throw new EconomyError('Open security work item unavailable.',404);
  const [incident]=await q("SELECT id,status FROM security_incidents WHERE id=$1 AND user_id=$2 FOR UPDATE",[item.incident_id,user.id]);
  if(!incident||['resolved','false-alarm'].includes(incident.status))throw new EconomyError('Incident is no longer open.',409);
  const [evidence]=await q(`INSERT INTO security_incident_evidence(id,user_id,incident_id,evidence_type,description,source_reference,epistemic_status,provenance)
   VALUES($1,$2,$3,'other',$4,$5,'unverified',$6) RETURNING id`,
   [uid(),user.id,item.incident_id,'Chairman-recorded work result: '+result,'security-work-item:'+item.id,JSON.stringify({workItemId:item.id,recordedBy:'Chairman',notIndependentlyVerified:true})]);
  if(item.case_id)await q(`INSERT INTO investigation_evidence(id,user_id,case_id,evidence_type,description,source_reference,confidence,collected_by,epistemic_status,provenance)
   VALUES($1,$2,$3,'work-result',$4,$5,NULL,'Chairman','unverified',$6)`,
   [uid(),user.id,item.case_id,'Chairman-recorded work result: '+result,'security-work-item:'+item.id,JSON.stringify({workItemId:item.id,evidenceId:evidence.id})]);
  const [row]=await q("UPDATE security_work_items SET status='completed',result=$1,completed_at=now() WHERE id=$2 AND user_id=$3 RETURNING *",[result,id,user.id]);
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,item.world_id,'security-work-completed',item.title,result+' · Recorded by Chairman; corroboration remains outstanding.']);
  return row;
 });
}
export async function securityIntelligenceSnapshot(userId){
 const [reviews,workItems,interviews,scenarioRuns]=await Promise.all([
  sql(`SELECT r.*,i.title AS incident_title,c.name AS reviewer_name FROM security_case_reviews r
   JOIN security_incidents i ON i.id=r.incident_id AND i.user_id=r.user_id LEFT JOIN contacts c ON c.id=r.reviewer_contact_id AND c.user_id=r.user_id
   WHERE r.user_id=$1 ORDER BY r.created_at DESC LIMIT 100`,[userId]),
  sql(`SELECT w.*,i.title AS incident_title,a.name AS assignee_name,t.name AS target_name
   FROM security_work_items w JOIN security_incidents i ON i.id=w.incident_id AND i.user_id=w.user_id
   LEFT JOIN contacts a ON a.id=w.assigned_to_contact_id AND a.user_id=w.user_id
   LEFT JOIN contacts t ON t.id=w.target_contact_id AND t.user_id=w.user_id
   WHERE w.user_id=$1 ORDER BY w.created_at DESC LIMIT 200`,[userId]),
  sql(`SELECT i.*,s.title AS incident_title,a.name AS interviewer_name,b.name AS interviewee_name
   FROM security_interviews i JOIN security_incidents s ON s.id=i.incident_id AND s.user_id=i.user_id
   LEFT JOIN contacts a ON a.id=i.interviewer_contact_id AND a.user_id=i.user_id
   JOIN contacts b ON b.id=i.interviewee_contact_id AND b.user_id=i.user_id
   WHERE i.user_id=$1 ORDER BY i.created_at DESC LIMIT 100`,[userId]),
  sql('SELECT * FROM security_scenario_runs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30',[userId])
 ]);
 return {securityCaseReviews:reviews,securityWorkItems:workItems,securityInterviews:interviews,securityScenarioRuns:scenarioRuns};
}
