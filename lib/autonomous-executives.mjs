import {sql,transaction,uid} from '../backend/src/db.mjs';
import {canAssignTask} from './task-rules.mjs';
import {enqueueAgencyDecision} from './character-agency.mjs';
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
 if(raw.action==='review'&&evidence.approvalAllowed)return null;
 return {action:raw.action,reason};
}
// Backoff is persisted in the job's attempt timestamp. A sleeping job does not
// monopolize the executive queue, and transient exhaustion is recoverable.
const retryDue="(attempted_at IS NULL OR attempted_at<now()-CASE WHEN attempts<=1 THEN interval '5 minutes' WHEN attempts=2 THEN interval '10 minutes' WHEN attempts=3 THEN interval '20 minutes' ELSE interval '40 minutes' END)";
async function reserve(userId){
 return transaction(async q=>{
  const [world]=await q('SELECT id FROM worlds WHERE user_id=$1 FOR UPDATE',[userId]);if(!world)return null;
  const pending=(await q("SELECT id FROM executive_work_cycles WHERE user_id=$1 AND status='pending' AND NOT (coalesce(decision,'{}'::jsonb) ? 'agencyDecisionId') AND "+retryDue+" LIMIT 1",[userId]))[0];if(pending)return null;
  const sleeping=(await q("SELECT count(*)::int n FROM executive_work_cycles WHERE user_id=$1 AND status='pending' AND NOT (coalesce(decision,'{}'::jsonb) ? 'agencyDecisionId')",[userId]))[0];if(sleeping.n>=5)return null;
  const retry=(await q("SELECT id FROM executive_work_cycles WHERE user_id=$1 AND status='failed' AND decision->>'errorCode'='AI_EXECUTIVE_UNAVAILABLE' AND completed_at<now()-interval '6 hours' ORDER BY completed_at LIMIT 1 FOR UPDATE SKIP LOCKED",[userId]))[0];
  if(retry){await q("UPDATE executive_work_cycles SET status='pending',attempts=0,attempted_at=NULL,completed_at=NULL WHERE id=$1 AND user_id=$2",[retry.id,userId]);return retry;}
  const recent=(await q("SELECT id FROM executive_work_cycles WHERE user_id=$1 AND created_at>=now()-interval '30 minutes' LIMIT 1",[userId]))[0];if(recent)return null;
  const candidates=await q(`SELECT 'financial-review' AS task_type,i.company_id,i.id AS source_id,'overdue-invoice' AS source_type,
    'Overdue invoice '||i.invoice_number AS title,jsonb_build_object('invoice_number',i.invoice_number,'customer',i.customer_name,'amount',i.amount,'due_at',i.due_at,'status',i.status) AS facts,1 AS priority
    FROM business_invoices i WHERE i.user_id=$1 AND i.status='issued' AND i.due_at<now()
    UNION ALL
    SELECT 'financial-review',l.company_id,i.id,'overdue-loan-installment','Overdue financing · '||l.lender_name,
    jsonb_build_object('lender',l.lender_name,'loan_id',l.id,'installment',i.installment,'due_date',i.due_date,'unpaid_principal',i.principal_due-i.principal_paid,'unpaid_interest',i.interest_due-i.interest_paid),1
    FROM company_loan_installments i JOIN company_loans l ON l.id=i.loan_id AND l.user_id=i.user_id
    WHERE i.user_id=$1 AND l.status='disbursed' AND i.due_date<(now() AT TIME ZONE 'UTC')::date AND (i.principal_paid<i.principal_due OR i.interest_paid<i.interest_due)
    UNION ALL
    SELECT 'investigation-review',i.company_id,i.id,'open-investigation',i.title,
    jsonb_build_object('allegation',i.allegation,'severity',i.severity,'status',i.status),2
    FROM investigation_cases i WHERE i.user_id=$1 AND i.status IN ('open','in-review')
    UNION ALL
    SELECT 'contract-review',c.company_id,c.id,'draft-contract',c.title,
    jsonb_build_object('counterparty',c.counterparty,'value',c.value,'terms',c.terms,'status',c.status),3
    FROM business_contracts c WHERE c.user_id=$1 AND c.status='draft'
    UNION ALL
    SELECT 'contract-review',c.company_id,c.id,'reviewed-contract',c.title,
    jsonb_build_object('counterparty',c.counterparty,'value',c.value,'terms',c.terms,'status',c.status,'review_document_id',t.outcome_document_id,'review_task_id',t.id),4
    FROM business_contracts c JOIN business_tasks t ON t.user_id=c.user_id AND t.company_id=c.company_id AND t.task_type='contract-review' AND t.status='completed' AND t.outcome_document_id IS NOT NULL AND t.source_evidence->>'source_id'=c.id::text
    WHERE c.user_id=$1 AND c.status='draft' AND NOT EXISTS(SELECT 1 FROM action_requests r WHERE r.user_id=c.user_id AND r.action_type='activate-contract' AND r.payload->>'contractId'=c.id::text)
    UNION ALL
    SELECT 'financial-review',c.id,c.id,'periodic-financial-review','Financial review · '||c.name,
    jsonb_build_object('company',c.name,'sector',c.sector,'recorded_entries',(SELECT count(*) FROM economy_journal j WHERE j.user_id=$1 AND j.company_id=c.id)),5
    FROM companies c WHERE c.user_id=$1 AND c.disposed_at IS NULL AND EXISTS(SELECT 1 FROM economy_journal j WHERE j.user_id=$1 AND j.company_id=c.id)
    UNION ALL
    SELECT 'employee-review',e.company_id,e.company_id,'periodic-employee-review','Employee review · '||c.name,jsonb_build_object('company',c.name,'active_employees',count(*),'annual_salary_total',sum(e.annual_salary)),6
    FROM employment_records e JOIN companies c ON c.id=e.company_id AND c.user_id=e.user_id WHERE e.user_id=$1 AND e.status='active' GROUP BY e.company_id,c.name
    ORDER BY priority,source_id LIMIT 100`,[userId]);
  for(const candidate of candidates){
   const role=roles[candidate.task_type];if(!role)continue;
   const actor=(await q("SELECT id,name,title FROM contacts WHERE user_id=$1 AND world_id=$2 AND kind='internal' AND title=$3 ORDER BY id LIMIT 1",[userId,world.id,role]))[0];if(!actor||!canAssignTask(candidate.task_type,actor.title))continue;
   const period=candidate.source_type.startsWith('periodic-')?new Date().toISOString().slice(0,10):'once';
   const key=candidate.source_type+':'+candidate.source_id+':'+period;
   const evidence={...candidate,approvalAllowed:candidate.source_type==='reviewed-contract'};
   const rows=await q('INSERT INTO executive_work_cycles(id,user_id,world_id,actor_id,cycle_key,evidence) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,cycle_key) DO NOTHING RETURNING id',[uid(),userId,world.id,actor.id,key,JSON.stringify(evidence)]);
   if(rows.length)return rows[0];
  }
  return null;
 });
}
export async function processAutonomousExecutives(userId){
 // Existing evidence discovery stays intact. All new cycles now enter the
 // single durable agency pipeline instead of bypassing delegation policy.
 await sql(`UPDATE executive_work_cycles e SET
 status=CASE WHEN d.status IN ('executed','awaiting-approval') THEN 'executed' WHEN d.status='failed' THEN 'failed' ELSE 'deferred' END,
 task_id=CASE WHEN d.result ? 'taskId' THEN (d.result->>'taskId')::uuid ELSE e.task_id END,
 approval_id=d.approval_id,completed_at=now(),
 decision=e.decision||jsonb_build_object('agencyStatus',d.status,'decision',d.decision)
 FROM character_decision_records d
 WHERE e.user_id=$1 AND d.user_id=e.user_id AND d.world_id=e.world_id
 AND e.decision->>'agencyDecisionId'=d.id::text
 AND d.status IN ('executed','awaiting-approval','decided','blocked','failed')
 AND (e.decision->>'agencyStatus') IS DISTINCT FROM d.status`,[userId]);
 await reserve(userId);
 return transaction(async q=>{
  const [w]=await q('SELECT id FROM worlds WHERE user_id=$1 FOR UPDATE',[userId]);if(!w)return false;
  const [queued]=await q("SELECT count(*)::int n FROM character_decision_records WHERE user_id=$1 AND status IN ('pending','processing')",[userId]);if(queued.n>=8)return false;
  const [job]=await q("SELECT * FROM executive_work_cycles WHERE user_id=$1 AND world_id=$2 AND status='pending' AND NOT (coalesce(decision,'{}'::jsonb) ? 'agencyDecisionId') ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED",[userId,w.id]);
  if(!job)return false;
  const [actor]=await q("SELECT id,title FROM contacts WHERE id=$1 AND user_id=$2 AND world_id=$3 AND kind='internal'",[job.actor_id,userId,w.id]);
  if(!actor||!canAssignTask(job.evidence.task_type,actor.title)){await q("UPDATE executive_work_cycles SET status='failed',completed_at=now(),decision=$3 WHERE id=$1 AND user_id=$2",[job.id,userId,JSON.stringify({reason:'Actor mandate unavailable'})]);return false;}
  const row=await enqueueAgencyDecision(q,{userId,worldId:w.id,contactId:actor.id,companyId:job.evidence.company_id||null,sourceType:'business-event',sourceId:job.id,evidence:job.evidence});
  if(!row){await q("UPDATE executive_work_cycles SET status='failed',completed_at=now(),decision=$3 WHERE id=$1 AND user_id=$2",[job.id,userId,JSON.stringify({reason:'Evidence company unavailable'})]);return false;}
  await q("UPDATE executive_work_cycles SET decision=$3,attempted_at=now() WHERE id=$1 AND user_id=$2",[job.id,userId,JSON.stringify({agencyDecisionId:row.id,agencyStatus:row.status})]);
  return true;
 });
}
