import {sql,transaction,uid} from '../backend/src/db.mjs';
import {EconomyError} from './economy-rules.mjs';
const clean=(v,n=1000)=>String(v??'').trim().slice(0,n);
export async function createSecurityIncident(user,body){
 const title=clean(body.title,160),category=body.category,severity=body.severity,description=clean(body.description,3000),location=clean(body.location,200);
 if(!title||!description||!['personal','physical','cyber','fraud','corporate','travel'].includes(category)||!['low','medium','high','critical'].includes(severity))throw new EconomyError('Enter an incident title, description, category and severity.');
 return transaction(async q=>{
  const w=(await q('SELECT id FROM worlds WHERE user_id=$1',[user.id]))[0];if(!w)throw new EconomyError('Empire unavailable.',404);
  const reporter=body.reportedBy?(await q('SELECT id FROM contacts WHERE id=$1 AND user_id=$2 AND world_id=$3',[body.reportedBy,user.id,w.id]))[0]:null;
  const assignee=body.assignedTo?(await q("SELECT id FROM contacts WHERE id=$1 AND user_id=$2 AND world_id=$3 AND kind='internal'",[body.assignedTo,user.id,w.id]))[0]:null;
  if(body.reportedBy&&!reporter)throw new EconomyError('Reporting contact unavailable.',404);
  if(body.assignedTo&&!assignee)throw new EconomyError('Select an internal security or legal contact.',404);
  const row=(await q('INSERT INTO security_incidents(id,user_id,world_id,title,category,severity,description,location,reported_by_contact_id,assigned_to_contact_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',[uid(),user.id,w.id,title,category,severity,description,location||null,reporter?.id||null,assignee?.id||null]))[0];
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,w.id,'security-incident-reported',title,severity.toUpperCase()+' · '+category+' · '+description]);
  return row;
 });
}
export async function updateSecurityIncident(user,id,body){
 const status=body.status,findings=clean(body.findings,3000);
 if(!['reported','investigating','resolved','false-alarm'].includes(status)||!findings)throw new EconomyError('Choose a valid incident status and record findings or next steps.');
 return transaction(async q=>{
  const old=(await q('SELECT * FROM security_incidents WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]))[0];if(!old)throw new EconomyError('Security incident unavailable.',404);
  const assignee=body.assignedTo?(await q("SELECT id FROM contacts WHERE id=$1 AND user_id=$2 AND world_id=$3 AND kind='internal'",[body.assignedTo,user.id,old.world_id]))[0]:null;
  if(body.assignedTo&&!assignee)throw new EconomyError('Assigned contact unavailable.',404);
  const row=(await q("UPDATE security_incidents SET status=$1,findings=$2,assigned_to_contact_id=coalesce($3,assigned_to_contact_id),updated_at=now(),resolved_at=CASE WHEN $1 IN ('resolved','false-alarm') THEN now() ELSE NULL END WHERE id=$4 AND user_id=$5 RETURNING *",[status,findings,assignee?.id||null,id,user.id]))[0];
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,old.world_id,'security-incident-'+status,old.title,findings]);
  return row;
 });
}
export async function addSecurityEvidence(user,id,body){
 const type=body.evidenceType,description=clean(body.description,2000),reference=clean(body.sourceReference,300);
 if(!['observation','document','message','transaction','witness','other'].includes(type)||!description)throw new EconomyError('Enter an evidence type and description.');
 return transaction(async q=>{
  const incident=(await q('SELECT id FROM security_incidents WHERE id=$1 AND user_id=$2',[id,user.id]))[0];if(!incident)throw new EconomyError('Security incident unavailable.',404);
  return (await q('INSERT INTO security_incident_evidence(id,user_id,incident_id,evidence_type,description,source_reference) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[uid(),user.id,id,type,description,reference||null]))[0];
 });
}
export async function securitySnapshot(userId){
 const [incidents,evidence]=await Promise.all([
  sql('SELECT i.*,r.name AS reporter_name,a.name AS assignee_name FROM security_incidents i LEFT JOIN contacts r ON r.id=i.reported_by_contact_id AND r.user_id=i.user_id LEFT JOIN contacts a ON a.id=i.assigned_to_contact_id AND a.user_id=i.user_id WHERE i.user_id=$1 ORDER BY i.created_at DESC LIMIT 100',[userId]),
  sql('SELECT e.* FROM security_incident_evidence e WHERE e.user_id=$1 ORDER BY e.created_at DESC LIMIT 300',[userId])
 ]);
 return {securityIncidents:incidents,securityEvidence:evidence};
}
