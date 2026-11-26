import {sql,transaction,uid} from '../backend/src/db.mjs';
import {ask} from '../backend/src/ai.mjs';
import {recordSystemInvoice,recordSystemInvoicePayment} from './economy.mjs';
const clean=(v,n=1000)=>typeof v==='string'?v.trim().slice(0,n):'';
export function parseCommercialProposal(raw){
 if(!raw||!['propose','defer'].includes(raw.decision))return null;
 const reason=clean(raw.reason,500);if(!reason)return null;
 if(raw.decision==='defer')return {decision:'defer',reason};
 const title=clean(raw.title,140),scope=clean(raw.scope,600);if(!title||!scope)return null;
 return {decision:'propose',reason,title,scope};
}
export function parseCustomerResponse(raw){
 if(!raw||!['accept','decline','defer'].includes(raw.decision))return null;
 const reason=clean(raw.reason,600);return reason?{decision:raw.decision,reason}:null;
}
async function event(q,w,contact,kind,title,body){
 await q('INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),w.user_id,w.world_id,contact,kind,title,body]);
}
async function audit(q,w,actorId,actorName,action,entity,id,before,after,reason){
 await q('INSERT INTO world_audit_log(id,user_id,world_id,actor_type,actor_id,actor_name,action,entity_type,entity_id,before_state,after_state,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[uid(),w.user_id,w.world_id,'executive',actorId,actorName,action,entity,id,before?JSON.stringify(before):null,JSON.stringify(after),reason]);
}
// Commercial model: explicitly incremental, one-off service opportunity, not a
// reclassification of modeled daily receipts. No liability before approval.
async function reserveLead(userId){
 return transaction(async q=>{
  const [world]=await q('SELECT id FROM worlds WHERE user_id=$1 FOR UPDATE',[userId]);if(!world)return;
  const [recent]=await q("SELECT id FROM commercial_opportunities WHERE user_id=$1 AND created_at>=now()-interval '6 hours' LIMIT 1",[userId]);if(recent)return;
  const [pending]=await q("SELECT id FROM commercial_opportunities WHERE user_id=$1 AND stage IN ('lead','negotiating') LIMIT 1",[userId]);if(pending)return;
  const [actor]=await q("SELECT id FROM contacts WHERE user_id=$1 AND world_id=$2 AND kind='internal' AND title IN ('Chief Operating Officer','Group Strategy Director','Chief of Staff') ORDER BY CASE title WHEN 'Chief Operating Officer' THEN 0 WHEN 'Group Strategy Director' THEN 1 ELSE 2 END,id LIMIT 1",[userId,world.id]);if(!actor)return;
  const candidates=await q(`SELECT c.id AS company_id,p.id AS customer_contact_id,round(least(e.annual_sales_assumption/365/4,1000000),2)::text AS proposed_value
   FROM companies c JOIN company_economy e ON e.company_id=c.id AND e.user_id=c.user_id
   JOIN contacts p ON p.user_id=c.user_id AND p.world_id=c.world_id AND p.kind='client'
   WHERE c.user_id=$1 AND c.world_id=$2 AND e.annual_sales_assumption>=1460
   ORDER BY c.id,p.id LIMIT 100`,[userId,world.id]);
  for(const c of candidates){
   const key='commercial:'+c.company_id+':'+c.customer_contact_id+':'+new Date().toISOString().slice(0,10);
   const [row]=await q('INSERT INTO commercial_opportunities(id,user_id,world_id,company_id,customer_contact_id,executive_id,operation_key,proposed_value) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(user_id,operation_key) DO NOTHING RETURNING id',[uid(),userId,world.id,c.company_id,c.customer_contact_id,actor.id,key,c.proposed_value]);
   if(row)return;
  }
 });
}
export async function processCommercialOpportunities(userId){
 await reserveLead(userId);
 const [job]=await sql(`WITH due AS (SELECT id FROM commercial_opportunities WHERE user_id=$1 AND stage IN ('lead','negotiating') AND next_action_at<=now() AND (attempted_at IS NULL OR attempted_at<now()-interval '5 minutes') ORDER BY next_action_at,id LIMIT 1 FOR UPDATE SKIP LOCKED)
 UPDATE commercial_opportunities o SET attempts=attempts+1,attempted_at=now() FROM due WHERE o.id=due.id RETURNING o.*`,[userId]);if(!job)return;
 try{
  const [ctx]=await sql(`SELECT c.name AS company,c.sector,p.name AS customer,p.company AS customer_company,p.agenda AS customer_agenda,p.temperament AS customer_temperament,x.name AS executive,x.title AS executive_title,x.agenda AS executive_agenda
   FROM commercial_opportunities o JOIN companies c ON c.id=o.company_id AND c.user_id=o.user_id AND c.world_id=o.world_id
   JOIN contacts p ON p.id=o.customer_contact_id AND p.user_id=o.user_id AND p.world_id=o.world_id AND p.kind='client'
   JOIN contacts x ON x.id=o.executive_id AND x.user_id=o.user_id AND x.world_id=o.world_id AND x.kind='internal'
   WHERE o.id=$1 AND o.user_id=$2`,[job.id,userId]);if(!ctx)throw Error('Commercial participants unavailable');
  if(job.stage==='lead'){
   const raw=await ask('You are the named fictional executive. Assess a possible incremental one-off service for the named customer, compatible with the company sector. No demand or deal has been established. Propose a plausible small service or defer if no fit. Use the supplied ceiling as the fixed offered price, never invent other figures, capacity or completed work. Return JSON {decision:"propose" or "defer",reason:"...",title:"...",scope:"..."}. This is a nonbinding simulated proposal requiring approval.',JSON.stringify({...ctx,priceUSD:job.proposed_value}),{json:true,fallback:null});
   const proposal=parseCommercialProposal(raw);if(!proposal)throw Error('Commercial proposal unavailable');
   await transaction(async q=>{
    const [lock]=await q("SELECT id FROM commercial_opportunities WHERE id=$1 AND user_id=$2 AND stage='lead' FOR UPDATE",[job.id,userId]);if(!lock)return;
    const stage=proposal.decision==='propose'?'negotiating':'deferred';
    await q("UPDATE commercial_opportunities SET stage=$3,proposal=$4,attempts=0,next_action_at=now()+interval '10 minutes',updated_at=now() WHERE id=$1 AND user_id=$2",[job.id,userId,stage,JSON.stringify(proposal)]);
    await event(q,job,job.executive_id,'commercial-'+stage,proposal.title||'Commercial opportunity deferred',ctx.executive+': '+proposal.reason+(stage==='negotiating'?' · Nonbinding proposal to '+ctx.customer_company+' for USD '+job.proposed_value:''));
    await audit(q,job,job.executive_id,ctx.executive,'opportunity.'+stage,'commercial-opportunity',job.id,null,proposal,proposal.reason);
   });
  }else{
   const raw=await ask('You are the named fictional customer, with your own commercial interests. Evaluate this nonbinding simulated proposal. Accept the exact offered terms in principle, decline, or defer. Do not invent a purchase order, cash transfer, signature or other figures. Return JSON {decision:"accept" or "decline" or "defer",reason:"..."}. Acceptance is conditional on both parties approving the final agreement.',JSON.stringify({...ctx,proposal:job.proposal,priceUSD:job.proposed_value}),{json:true,fallback:null});
   const response=parseCustomerResponse(raw);if(!response)throw Error('Customer response unavailable');
   await transaction(async q=>{
    const [lock]=await q("SELECT id FROM commercial_opportunities WHERE id=$1 AND user_id=$2 AND stage='negotiating' FOR UPDATE",[job.id,userId]);if(!lock)return;
    if(response.decision!=='accept'){
     const stage=response.decision==='decline'?'lost':'deferred';
     await q('UPDATE commercial_opportunities SET stage=$3,negotiation=$4,updated_at=now() WHERE id=$1 AND user_id=$2',[job.id,userId,stage,JSON.stringify(response)]);
     await event(q,job,job.customer_contact_id,'commercial-'+stage,ctx.customer_company+' · '+stage,response.reason);
     return;
    }
    const contractId=uid(),terms=job.proposal.scope+'\nNonbinding simulated agreement: USD '+job.proposed_value+' for one incremental service milestone, modeled delivery after an operating day following Chairman approval, invoice due 7 days after delivery. Separate from baseline modeled sales. Customer may pay or delay. No real funds or external contact. Customer response: '+response.reason;
    await q("INSERT INTO business_contracts(id,user_id,world_id,company_id,title,counterparty,contract_type,value,terms,operation_key) VALUES($1,$2,$3,$4,$5,$6,'modeled-service',$7,$8,$9)",[contractId,userId,job.world_id,job.company_id,job.proposal.title,ctx.customer_company,job.proposed_value,terms,'contract:opportunity:'+job.id]);
    await q("UPDATE commercial_opportunities SET stage='drafted',negotiation=$3,contract_id=$4,updated_at=now() WHERE id=$1 AND user_id=$2",[job.id,userId,JSON.stringify(response),contractId]);
    await event(q,job,job.executive_id,'contract-drafted',job.proposal.title,ctx.customer_company+' accepted in principle. Draft awaiting legal review and Chairman approval. USD '+job.proposed_value);
    await audit(q,job,job.executive_id,ctx.executive,'contract.drafted','contract',contractId,null,{opportunityId:job.id,response,value:job.proposed_value},'Nonbinding proposal accepted in principle.');
   });
  }
 }catch(error){
  if(job.attempts>=5)await sql("UPDATE commercial_opportunities SET stage='failed',updated_at=now() WHERE id=$1 AND user_id=$2 AND stage=$3",[job.id,userId,job.stage]);
  throw error;
 }
}
export async function processCommercialMilestones(userId){
 // Only approved, active, system-originated contracts are eligible.
 await transaction(async q=>{
  const active=await q(`SELECT o.*,c.updated_at AS activated_at FROM commercial_opportunities o JOIN business_contracts c ON c.id=o.contract_id AND c.user_id=o.user_id AND c.world_id=o.world_id AND c.company_id=o.company_id
    WHERE o.user_id=$1 AND o.stage='drafted' AND c.status='active' AND c.contract_type='modeled-service'
    AND c.value=o.proposed_value AND NOT EXISTS(SELECT 1 FROM commercial_milestones m WHERE m.contract_id=c.id) ORDER BY c.updated_at LIMIT 5`,[userId]);
  for(const o of active)await q("INSERT INTO commercial_milestones(id,user_id,world_id,opportunity_id,contract_id,company_id,amount,due_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8::timestamptz+interval '1 day') ON CONFLICT(contract_id) DO NOTHING",[uid(),userId,o.world_id,o.id,o.contract_id,o.company_id,o.proposed_value,o.activated_at]);
 });
 const due=await sql("SELECT id FROM commercial_milestones WHERE user_id=$1 AND status IN ('pending','delivered','invoiced') AND due_at<=now() ORDER BY due_at LIMIT 8",[userId]);
 for(const item of due)await transaction(async q=>{
  const [m]=await q('SELECT * FROM commercial_milestones WHERE id=$1 AND user_id=$2 FOR UPDATE',[item.id,userId]);if(!m||!['pending','delivered','invoiced'].includes(m.status))return;
  const [c]=await q('SELECT * FROM companies WHERE id=$1 AND user_id=$2 AND world_id=$3 FOR UPDATE',[m.company_id,userId,m.world_id]);
  const [contract]=await q('SELECT * FROM business_contracts WHERE id=$1 AND user_id=$2 AND world_id=$3 FOR UPDATE',[m.contract_id,userId,m.world_id]);if(!c||!contract)return;
  if(m.status==='pending'){
   if(contract.status!=='active'){await q("UPDATE commercial_milestones SET status='blocked',updated_at=now() WHERE id=$1 AND user_id=$2",[m.id,userId]);return;}
   const [evidence]=await q("SELECT id FROM economy_journal WHERE user_id=$1 AND company_id=$2 AND kind='sale' AND operation_key LIKE 'operation:%' AND effective_at>=($3::timestamptz-interval '1 day') ORDER BY effective_at LIMIT 1",[userId,c.id,m.due_at]);if(!evidence)return;
   await q("UPDATE commercial_milestones SET status='delivered',delivery_journal_id=$3,updated_at=now() WHERE id=$1 AND user_id=$2",[m.id,userId,evidence.id]);
   await event(q,m,null,'commercial-delivered',contract.title,'Modeled service milestone delivered based on a recorded operating day; invoice not yet paid.');
   return;
  }
  if(m.status==='delivered'){
   if(contract.status!=='active'){await q("UPDATE commercial_milestones SET status='blocked',updated_at=now() WHERE id=$1 AND user_id=$2",[m.id,userId]);return;}
   const id=uid(),number='INV-AUTO-'+id.toUpperCase(),description='Incremental simulated service milestone · '+contract.title;
   await q("INSERT INTO business_invoices(id,user_id,world_id,company_id,invoice_number,customer_name,description,amount,due_at,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '7 days',$9)",[id,userId,m.world_id,c.id,number,contract.counterparty,description,m.amount,'invoice:milestone:'+m.id]);
   await recordSystemInvoice(q,c,'invoice:'+id,m.amount,'Invoice '+number+' issued to '+contract.counterparty,'Commercial operations');
   await q("UPDATE commercial_milestones SET status='invoiced',invoice_id=$3,due_at=now()+interval '7 days',updated_at=now() WHERE id=$1 AND user_id=$2",[m.id,userId,id]);
   await event(q,m,null,'invoice-issued',number+' issued',contract.counterparty+' · USD '+m.amount+' · incremental service');
   return;
  }
  const [invoice]=await q("SELECT * FROM business_invoices WHERE id=$1 AND user_id=$2 AND company_id=$3 FOR UPDATE",[m.invoice_id,userId,c.id]);if(!invoice)return;
  if(invoice.status==='paid'){await q("UPDATE commercial_milestones SET status='paid',updated_at=now() WHERE id=$1 AND user_id=$2",[m.id,userId]);return;}
  // Do not invent a payment or settle a disputed obligation. A subsequent
  // customer decision is required; overdue receivables enter CFO review.
  if(invoice.status!=='issued'||contract.status!=='active'||invoice.risk_level!=='none')return;
  await q("UPDATE commercial_milestones SET due_at=now()+interval '1 day',updated_at=now() WHERE id=$1 AND user_id=$2",[m.id,userId]);
 });
}
export async function commercialSnapshot(userId){
 const [opportunities,milestones]=await Promise.all([
 sql('SELECT o.*,c.name AS company_name,p.name AS customer_name,p.company AS customer_company,x.name AS executive_name FROM commercial_opportunities o JOIN companies c ON c.id=o.company_id AND c.user_id=o.user_id JOIN contacts p ON p.id=o.customer_contact_id AND p.user_id=o.user_id JOIN contacts x ON x.id=o.executive_id AND x.user_id=o.user_id WHERE o.user_id=$1 ORDER BY o.created_at DESC LIMIT 100',[userId]),
 sql('SELECT * FROM commercial_milestones WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[userId])]);
 return {opportunities,milestones};
}
