import {sql,transaction,uid} from '../backend/src/db.mjs';
import {EconomyError} from './economy-rules.mjs';
const clean=(v,n=1000)=>String(v??'').trim().slice(0,n);
export async function createSecurityIncident(user,body){
 const title=clean(body.title,160),category=body.category,severity=body.severity,description=clean(body.description,3000),location=clean(body.location,200);
 if(!title||!description||!['personal','physical','cyber','fraud','corporate','travel'].includes(category)||!['low','medium','high','critical'].includes(severity))throw new EconomyError('Enter an incident title, description, category and severity.');
 return transaction(async q=>{
  const w=(await q('SELECT id FROM worlds WHERE user_id=$1',[user.id]))[0];if(!w)throw new EconomyError('Empire unavailable.',404);
  const reporter=body.reportedBy?(await q('SELECT id FROM contacts WHERE id=$1 AND user_id=$2 AND world_id=$3',[body.reportedBy,user.id,w.id]))[0]:null;
  const assignee=body.assignedTo?(await q("SELECT id FROM contacts WHERE id=$1 AND user_id=$2 AND world_id=$3 AND kind='internal' AND title IN ('Chief Security Officer','Internal Audit Director','General Counsel')",[body.assignedTo,user.id,w.id]))[0]:null;
  if(body.reportedBy&&!reporter)throw new EconomyError('Reporting contact unavailable.',404);
  if(body.assignedTo&&!assignee)throw new EconomyError('Select an internal security or legal contact.',404);
  const caseId=uid(),incidentId=uid();
  const caseSeverity=severity==='medium'?'moderate':severity;
  await q('INSERT INTO investigation_cases(id,user_id,world_id,title,allegation,severity,opened_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
   [caseId,user.id,w.id,title,description,caseSeverity,reporter?.name||'Security Desk']);
  const row=(await q(`INSERT INTO security_incidents(id,user_id,world_id,title,category,severity,description,location,reported_by_contact_id,assigned_to_contact_id,source_investigation_id,origin,source_context)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'reported',$12) RETURNING *`,
   [incidentId,user.id,w.id,title,category,severity,description,location||null,reporter?.id||null,assignee?.id||null,caseId,JSON.stringify({reporterId:reporter?.id||null,reportedThrough:'Security app'})]))[0];
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,w.id,'security-incident-reported',title,severity.toUpperCase()+' · '+category+' · '+description]);
  return row;
 });
}
export async function updateSecurityIncident(user,id,body){
 const status=body.status,findings=clean(body.findings,3000);
 if(!['reported','investigating','resolved','false-alarm'].includes(status)||!findings)throw new EconomyError('Choose a valid incident status and record findings or next steps.');
 return transaction(async q=>{
  const old=(await q('SELECT * FROM security_incidents WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]))[0];if(!old)throw new EconomyError('Security incident unavailable.',404);
  const assignee=body.assignedTo?(await q("SELECT id FROM contacts WHERE id=$1 AND user_id=$2 AND world_id=$3 AND kind='internal' AND title IN ('Chief Security Officer','Internal Audit Director','General Counsel')",[body.assignedTo,user.id,old.world_id]))[0]:null;
  if(body.assignedTo&&!assignee)throw new EconomyError('Assigned contact unavailable.',404);
  const row=(await q("UPDATE security_incidents SET status=$1,findings=$2,assigned_to_contact_id=coalesce($3,assigned_to_contact_id),updated_at=now(),resolved_at=CASE WHEN $1 IN ('resolved','false-alarm') THEN now() ELSE NULL END WHERE id=$4 AND user_id=$5 RETURNING *",[status,findings,assignee?.id||null,id,user.id]))[0];
  if(['resolved','false-alarm'].includes(status)&&old.source_investigation_id){
   const caseStatus=status==='false-alarm'?'unsubstantiated':'closed';
   await q("UPDATE investigation_cases SET status=$1,finding=$2,updated_at=now() WHERE id=$3 AND user_id=$4 AND status IN ('open','in-review')",[caseStatus,findings,old.source_investigation_id,user.id]);
  }
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,old.world_id,'security-incident-'+status,old.title,findings]);
  return row;
 });
}
export async function addSecurityEvidence(user,id,body){
 const type=body.evidenceType,description=clean(body.description,2000),reference=clean(body.sourceReference,300);
 if(!['observation','document','message','transaction','witness','other'].includes(type)||!description)throw new EconomyError('Enter an evidence type and description.');
 return transaction(async q=>{
  const [incident]=await q("SELECT id,source_investigation_id FROM security_incidents WHERE id=$1 AND user_id=$2 AND status IN ('reported','investigating') FOR UPDATE",[id,user.id]);if(!incident)throw new EconomyError('Open security incident unavailable.',404);
  const evidence=(await q(`INSERT INTO security_incident_evidence(id,user_id,incident_id,evidence_type,description,source_reference,epistemic_status,provenance)
   VALUES($1,$2,$3,$4,$5,$6,'unverified',$7) RETURNING *`,[uid(),user.id,id,type,description,reference||null,JSON.stringify({recordedBy:'Chairman',notIndependentlyVerified:true})]))[0];
  if(incident?.source_investigation_id)await q(`INSERT INTO investigation_evidence(id,user_id,case_id,evidence_type,description,source_reference,collected_by,epistemic_status,provenance)
   VALUES($1,$2,$3,$4,$5,$6,'Chairman','unverified',$7)`,[uid(),user.id,incident.source_investigation_id,type,description,reference||'security-incident:'+id,JSON.stringify({securityEvidenceId:evidence.id})]);
  return evidence;
 });
}
// Mirror recorded high-risk financial investigations into Security without
// inventing threats or automatically deciding guilt. One incident per case.
export async function processSecurityIncidents(userId){
 const worlds=await sql('SELECT id FROM worlds WHERE user_id=$1',[userId]);
 for(const world of worlds)await transaction(async q=>{
  const [locked]=await q('SELECT id FROM worlds WHERE user_id=$1 AND id=$2 FOR UPDATE',[userId,world.id]);if(!locked)return;
  const cases=await q(`SELECT i.id,i.title,i.allegation,i.severity,i.source_invoice_id
    FROM investigation_cases i WHERE i.user_id=$1 AND i.world_id=$2 AND i.status IN ('open','in-review')
    AND i.source_invoice_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM security_incidents s WHERE s.user_id=i.user_id AND s.source_investigation_id=i.id)
    ORDER BY i.opened_at LIMIT 10`,[userId,world.id]);
  const [security]=await q("SELECT id,name,title FROM contacts WHERE user_id=$1 AND world_id=$2 AND kind='internal' AND title IN ('Chief Security Officer','Internal Audit Director','General Counsel') ORDER BY CASE title WHEN 'Chief Security Officer' THEN 0 WHEN 'Internal Audit Director' THEN 1 ELSE 2 END,id LIMIT 1",[userId,world.id]);
  for(const item of cases){
   const [incident]=await q(`INSERT INTO security_incidents(id,user_id,world_id,title,category,severity,status,description,assigned_to_contact_id,source_investigation_id,findings,origin,source_context)
     VALUES($1,$2,$3,$4,'fraud',$5,$6,$7,$8,$9,$10,'detected',$11) ON CONFLICT(user_id,source_investigation_id) WHERE source_investigation_id IS NOT NULL DO NOTHING RETURNING *`,
     [uid(),userId,world.id,item.title,item.severity==='critical'?'critical':item.severity==='high'?'high':'medium',security?'investigating':'reported',item.allegation,security?.id||null,item.id,security?'Assigned for verification. No misconduct has been established.':null,JSON.stringify({sourceType:'recorded-invoice-investigation',investigationId:item.id,sourceInvoiceId:item.source_invoice_id,notAFinding:true})]);
   if(!incident)continue;
   const evidence=await q('SELECT id,evidence_type,description,source_reference,confidence,epistemic_status,provenance FROM investigation_evidence WHERE user_id=$1 AND case_id=$2 ORDER BY created_at LIMIT 50',[userId,item.id]);
   for(const e of evidence)await q('INSERT INTO security_incident_evidence(id,user_id,incident_id,evidence_type,description,source_reference,epistemic_status,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[uid(),userId,incident.id,e.evidence_type,e.description,e.source_reference||'investigation-evidence:'+e.id,e.epistemic_status||'unverified',JSON.stringify({investigationEvidenceId:e.id,originalProvenance:e.provenance||{},confidence:e.confidence})]);
   await q('INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),userId,world.id,security?.id||null,'security-incident-reported',incident.title,(security?security.name+' assigned to verify. ':'Awaiting security assignment. ')+item.allegation+' No conclusion has been reached.']);
   await q('INSERT INTO world_audit_log(id,user_id,world_id,actor_type,actor_name,action,entity_type,entity_id,after_state,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[uid(),userId,world.id,'system','Internal controls','security.incident-linked','security-incident',incident.id,JSON.stringify({source_investigation_id:item.id,assigned_to:security?.id||null,evidence_count:evidence.length}),'Recorded invoice verification case mirrored for review; not a finding of fraud.']);
  }
  if(security){
   const unassigned=await q("SELECT id,title FROM security_incidents WHERE user_id=$1 AND world_id=$2 AND status IN ('reported','investigating') AND assigned_to_contact_id IS NULL ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED",[userId,world.id]);
   for(const item of unassigned){
    await q("UPDATE security_incidents SET assigned_to_contact_id=$1,status='investigating',updated_at=now() WHERE id=$2 AND user_id=$3",[security.id,item.id,userId]);
    await q('INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),userId,world.id,security.id,'security-incident-investigating',item.title,security.name+' has been assigned to review recorded evidence. No findings yet.']);
   }
  }
 });
}
export async function securitySnapshot(userId){
 const [incidents,evidence]=await Promise.all([
  sql('SELECT i.*,r.name AS reporter_name,a.name AS assignee_name FROM security_incidents i LEFT JOIN contacts r ON r.id=i.reported_by_contact_id AND r.user_id=i.user_id LEFT JOIN contacts a ON a.id=i.assigned_to_contact_id AND a.user_id=i.user_id WHERE i.user_id=$1 ORDER BY i.created_at DESC LIMIT 100',[userId]),
  sql('SELECT e.* FROM security_incident_evidence e WHERE e.user_id=$1 ORDER BY e.created_at DESC LIMIT 300',[userId])
 ]);
 return {securityIncidents:incidents,securityEvidence:evidence};
}
