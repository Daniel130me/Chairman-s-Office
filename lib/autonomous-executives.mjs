import {sql,one,transaction,uid} from '../backend/src/db.mjs';
import {ask} from '../backend/src/ai.mjs';
import {canAssignTask} from './task-rules.mjs';
const clean=(x,n=500)=>typeof x==='string'?x.trim().slice(0,n):'';
// Autonomous authority is deliberately limited to evidence-backed, non-financial
// review tasks and proposals. Irreversible actions require Chairman approval.
const roles={
 'financial-review':'Group CFO',
 'contract-review':'General Counsel',
 'investigation-review':'Internal Audit Director',
 'employee-review':'Group Human Resources Director',
 'portfolio-review':'Group Strategy Director'
};
export function parseExecutiveDecision(raw,evidence){
 if(!raw||!['review','approval','defer'].includes(raw.action))return null;
 const reason=clean(raw.reason,600);
 if(!reason)return null;
 if(raw.action==='approval'&&!evidence.approvalAllowed)return null;
 return {action:raw.action,reason};
}
async function reserve(userId){
 return transaction(async q=>{
  const [world]=await q('SELECT id FROM worlds WHERE user_id=$1 FOR UPDATE',[userId]);if(!world)return null;
  const pending=(await q("SELECT id FROM executive_work_cycles WHERE user_id=$1 AND status='pending' LIMIT 1",[userId]))[0];if(pending)return null;
  const recent=(await q("SELECT id FROM executive_work_cycles WHERE user_id=$1 AND created_at>=now()-interval '30 minutes' LIMIT 1",[userId]))[0];if(recent)return null;
  const candidates=await q(`SELECT 'financial-review' AS task_type,i.company_id,i.id AS source_id,'overdue-invoice' AS source_type,
    'Overdue invoice '||i.invoice_number AS title,jsonb_build_object('invoice_number',i.invoice_number,'customer',i.customer_name,'amount',i.amount,'due_at',i.due_at,'status',i.status) AS facts,1 AS priority
    FROM business_invoices i WHERE i.user_id=$1 AND i.status='issued' AND i.due_at<now()
    UNION ALL
    SELECT 'investigation-review',i.company_id,i.id,'open-investigation',i.title,
    jsonb_build_object('allegation',i.allegation,'severity',i.severity,'status',i.status),2
    FROM investigation_cases i WHERE i.user_id=$1 AND i.status IN ('open','in-review')
    UNION ALL
    SELECT 'contract-review',c.company_id,c.id,'draft-contract',c.title,
    jsonb_build_object('counterparty',c.counterparty,'value',c.value,'terms',c.terms,'status',c.status),3
    FROM business_contracts c WHERE c.user_id=$1 AND c.status='draft'
    UNION ALL
    SELECT 'financial-review',c.id,c.id,'periodic-financial-review','Financial review · '||c.name,
    jsonb_build_object('company',c.name,'sector',c.sector,'recorded_entries',(SELECT count(*) FROM economy_journal j WHERE j.user_id=$1 AND j.company_id=c.id)),4
    FROM companies c WHERE c.user_id=$1 AND EXISTS(SELECT 1 FROM economy_journal j WHERE j.user_id=$1 AND j.company_id=c.id)
    ORDER BY priority,source_id LIMIT 100`,[userId]);
  for(const candidate of candidates){
   const role=roles[candidate.task_type];if(!role)continue;
   const actor=(await q("SELECT id,name,title FROM contacts WHERE user_id=$1 AND world_id=$2 AND kind='internal' AND title=$3 ORDER BY id LIMIT 1",[userId,world.id,role]))[0];if(!actor||!canAssignTask(candidate.task_type,actor.title))continue;
   const period=candidate.source_type==='periodic-financial-review'?new Date().toISOString().slice(0,10):'once';
   const key=candidate.source_type+':'+candidate.source_id+':'+period;
   const evidence={...candidate,approvalAllowed:false};
   const rows=await q('INSERT INTO executive_work_cycles(id,user_id,world_id,actor_id,cycle_key,evidence) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,cycle_key) DO NOTHING RETURNING id',[uid(),userId,world.id,actor.id,key,JSON.stringify(evidence)]);
   if(rows.length)return rows[0];
  }
  return null;
 });
}
export async function processAutonomousExecutives(userId){
 await reserve(userId);
 const [job]=await sql(`WITH due AS (SELECT id FROM executive_work_cycles WHERE user_id=$1 AND status='pending' AND (attempted_at IS NULL OR attempted_at<now()-interval '5 minutes') ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
 UPDATE executive_work_cycles c SET attempts=attempts+1,attempted_at=now() FROM due WHERE c.id=due.id RETURNING c.*`,[userId]);
 if(!job)return false;
 try{
  const actor=await one("SELECT id,name,title,agenda,temperament FROM contacts WHERE id=$1 AND user_id=$2 AND world_id=$3 AND kind='internal'",[job.actor_id,userId,job.world_id]);
  const evidence=job.evidence;if(!actor||!canAssignTask(evidence.task_type,actor.title))throw Error('Executive authority no longer valid');
  const raw=await ask('You are a fictional executive acting independently within a company. Given a real persisted business record, decide whether an evidence-backed review is warranted. You may only choose review or defer. Return JSON {action:"review" or "defer",reason:"specific reason grounded in the supplied facts"}. You cannot authorize money, contracts, personnel changes or make up facts. Do not claim work was completed.',JSON.stringify({actor,evidence}),{json:true,fallback:null});
  const decision=parseExecutiveDecision(raw,evidence);if(!decision){const err=Error('AI executive decision unavailable');err.code='AI_EXECUTIVE_UNAVAILABLE';throw err;}
  await transaction(async q=>{
   const [lock]=await q("SELECT id FROM executive_work_cycles WHERE id=$1 AND user_id=$2 AND status='pending' FOR UPDATE",[job.id,userId]);if(!lock)return;
   if(decision.action==='defer'){await q("UPDATE executive_work_cycles SET status='deferred',decision=$3,completed_at=now() WHERE id=$1 AND user_id=$2",[job.id,userId,JSON.stringify(decision)]);return;}
   const [person]=await q("SELECT id,name,title FROM contacts WHERE id=$1 AND user_id=$2 AND world_id=$3 AND kind='internal' FOR SHARE",[actor.id,userId,job.world_id]);
   if(!person||!canAssignTask(evidence.task_type,person.title))throw Error('Executive authority changed');
   if(evidence.company_id){const [company]=await q('SELECT id FROM companies WHERE id=$1 AND user_id=$2 AND world_id=$3',[evidence.company_id,userId,job.world_id]);if(!company)throw Error('Company unavailable');}
   const taskId=uid(),title=clean(evidence.title,140),detail='Independent review requested by '+person.name+'. '+decision.reason+' Evidence: '+JSON.stringify(evidence.facts).slice(0,1200);
   const [task]=await q('INSERT INTO business_tasks(id,user_id,world_id,company_id,assignee_id,title,detail,operation_key,task_type,assigned_by_contact_id,source_evidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id',[taskId,userId,job.world_id,evidence.company_id,person.id,title,detail,'executive:'+job.id,evidence.task_type,person.id,JSON.stringify(evidence)]);
   await q("UPDATE executive_work_cycles SET status='executed',decision=$3,task_id=$4,completed_at=now() WHERE id=$1 AND user_id=$2",[job.id,userId,JSON.stringify(decision),task.id]);
   await q('INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),userId,job.world_id,person.id,'task-assigned',title,person.name+' independently initiated an evidence-backed review. '+decision.reason]);
   await q('INSERT INTO world_audit_log(id,user_id,world_id,actor_type,actor_id,actor_name,action,entity_type,entity_id,after_state,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[uid(),userId,job.world_id,'executive',person.id,person.name,'task.assigned','business-task',task.id,JSON.stringify({evidence,decision}),decision.reason]);
  });
  return true;
 }catch(error){
  if(job.attempts>=5)await sql("UPDATE executive_work_cycles SET status='failed',completed_at=now() WHERE id=$1 AND user_id=$2 AND status='pending'",[job.id,userId]);
  throw error;
 }
}
