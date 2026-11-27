import {sql,transaction,uid} from '../backend/src/db.mjs';
import {enqueueCharacterMemory} from './character-intelligence.mjs';
const clamp=n=>Math.max(0,Math.min(100,n));
const deltas=Object.freeze({'supplier-delivery':[2,1,-1,1,1],'client-payment':[2,1,-1,1,1],'client-dispute':[-2,0,3,-1,-2],'supplier-quality-issue':[-3,-1,3,-1,-2],'supplier-late':[-2,-1,2,-1,-1]});
export function relationshipAfter(before,type){
 const d=deltas[type];if(!d)return null;
 return {trust:clamp((before.trust??60)+d[0]),respect:clamp((before.respect??55)+d[1]),tension:clamp((before.tension??10)+d[2]),loyalty:clamp((before.loyalty??55)+d[3]),reputation:clamp((before.reputation??55)+d[4])};
}
export async function processRelationshipOutcomes(userId){
 const candidates=await sql(`WITH candidates AS (
 SELECT p.world_id,s.supplier_contact_id AS contact_id,'supplier-delivery:'||s.id AS source_key,'supplier-delivery' AS type,'Approved supplier order delivered: '||p.po_number AS reason,s.updated_at AS occurred_at
 FROM supplier_negotiations s JOIN purchase_orders p ON p.id=s.purchase_order_id AND p.user_id=s.user_id WHERE s.user_id=$1 AND s.status='delivered' AND p.status IN ('received','paid')
 UNION ALL
 SELECT p.world_id,c.id,'supplier-quality:'||r.id,'supplier-quality-issue','Recorded supplier quality issue: '||p.po_number,r.created_at
 FROM supplier_reviews r JOIN purchase_orders p ON p.id=r.purchase_order_id AND p.user_id=r.user_id
 JOIN LATERAL (SELECT id FROM contacts WHERE user_id=p.user_id AND world_id=p.world_id AND kind IN ('supplier','vendor') AND lower(company)=lower(p.vendor_name) ORDER BY id LIMIT 1) c ON true
 WHERE r.user_id=$1 AND r.quality IN ('mixed','defective')
 UNION ALL
 SELECT p.world_id,c.id,'supplier-late:'||p.id,'supplier-late','Recorded overdue supplier delivery: '||p.po_number,p.overdue_reported_at
 FROM purchase_orders p JOIN LATERAL (SELECT id FROM contacts WHERE user_id=p.user_id AND world_id=p.world_id AND kind IN ('supplier','vendor') AND lower(company)=lower(p.vendor_name) ORDER BY id LIMIT 1) c ON true
 WHERE p.user_id=$1 AND p.overdue_reported_at IS NOT NULL
 UNION ALL
 SELECT m.world_id,o.customer_contact_id,'client-payment:'||m.id,'client-payment','Customer settled recorded invoice '||i.invoice_number,m.updated_at
 FROM commercial_milestones m JOIN commercial_opportunities o ON o.id=m.opportunity_id AND o.user_id=m.user_id
 JOIN business_invoices i ON i.id=m.invoice_id AND i.user_id=m.user_id WHERE m.user_id=$1 AND m.status='paid' AND i.status='paid'
 UNION ALL
 SELECT m.world_id,o.customer_contact_id,'client-dispute:'||m.id,'client-dispute','Recorded customer dispute: '||c.title,m.updated_at
 FROM commercial_milestones m JOIN commercial_opportunities o ON o.id=m.opportunity_id AND o.user_id=m.user_id
 JOIN business_contracts c ON c.id=m.contract_id AND c.user_id=m.user_id WHERE m.user_id=$1 AND m.status='blocked' AND m.payment_decision->>'decision'='dispute' AND c.status='disputed'
 ) SELECT * FROM candidates c WHERE NOT EXISTS(SELECT 1 FROM relationship_outcomes r WHERE r.user_id=$1 AND r.source_key=c.source_key) ORDER BY occurred_at LIMIT 20`,[userId]);
 for(const item of candidates)await transaction(async q=>{
  const [person]=await q('SELECT id,name,organization_id,trust,respect,tension,loyalty,reputation FROM contacts WHERE id=$1 AND user_id=$2 AND world_id=$3 FOR UPDATE',[item.contact_id,userId,item.world_id]);if(!person)return;
  const before={trust:person.trust??60,respect:person.respect??55,tension:person.tension??10,loyalty:person.loyalty??55,reputation:person.reputation??55},after=relationshipAfter(before,item.type);if(!after)return;
  const [outcome]=await q('INSERT INTO relationship_outcomes(id,user_id,world_id,contact_id,source_key,reason,before_state,after_state) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(user_id,source_key) DO NOTHING RETURNING id',[uid(),userId,item.world_id,person.id,item.source_key,item.reason,JSON.stringify(before),JSON.stringify(after)]);
  if(!outcome)return;
  await q('UPDATE contacts SET trust=$1,respect=$2,tension=$3,loyalty=$4,reputation=$5 WHERE id=$6 AND user_id=$7',[after.trust,after.respect,after.tension,after.loyalty,after.reputation,person.id,userId]);
  if(person.organization_id)await q('UPDATE external_organizations SET reputation=LEAST(100,GREATEST(0,reputation+$1)) WHERE id=$2 AND user_id=$3',[['client-dispute','supplier-quality-issue','supplier-late'].includes(item.type)?-2:1,person.organization_id,userId]);
  const liaisonTitle=item.type.startsWith('supplier-')?'Chief Operating Officer':'Chief Commercial Officer';
  const [liaison]=await q("SELECT id FROM contacts WHERE user_id=$1 AND world_id=$2 AND kind='internal' AND title=$3 LIMIT 1",[userId,item.world_id,liaisonTitle]);
  if(liaison)for(const [from,to] of [[liaison.id,person.id],[person.id,liaison.id]]){
   const [rel]=await q(`INSERT INTO character_relationships(id,user_id,world_id,from_contact_id,to_contact_id,relationship_label,trust,respect,loyalty,tension,familiarity)
    VALUES($1,$2,$3,$4,$5,'professional-counterparty',50,50,40,10,15) ON CONFLICT(user_id,from_contact_id,to_contact_id) DO UPDATE SET updated_at=now() RETURNING *`,[uid(),userId,item.world_id,from,to]);
   const delta=['client-dispute','supplier-quality-issue','supplier-late'].includes(item.type)?{trust:-2,respect:0,loyalty:-1,tension:3,familiarity:1}:{trust:2,respect:1,loyalty:1,tension:-1,familiarity:1};
   const beforePair={trust:rel.trust,respect:rel.respect,loyalty:rel.loyalty,tension:rel.tension,familiarity:rel.familiarity};
   const afterPair={trust:clamp(rel.trust+delta.trust),respect:clamp(rel.respect+delta.respect),loyalty:clamp(rel.loyalty+delta.loyalty),tension:clamp(rel.tension+delta.tension),familiarity:clamp(rel.familiarity+delta.familiarity)};
   const sourceKey=item.source_key+':relationship:'+from;
   const [created]=await q(`INSERT INTO character_relationship_events(id,user_id,world_id,relationship_id,source_key,event_type,reason,delta,before_state,after_state)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(user_id,source_key) DO NOTHING RETURNING id`,
    [uid(),userId,item.world_id,rel.id,sourceKey,item.type,item.reason,JSON.stringify(delta),JSON.stringify(beforePair),JSON.stringify(afterPair)]);
   if(created)await q('UPDATE character_relationships SET trust=$1,respect=$2,loyalty=$3,tension=$4,familiarity=$5,updated_at=now() WHERE id=$6 AND user_id=$7',[afterPair.trust,afterPair.respect,afterPair.loyalty,afterPair.tension,afterPair.familiarity,rel.id,userId]);
  }
  await enqueueCharacterMemory(q,{userId,worldId:item.world_id,contactId:person.id,sourceType:'commercial-relationship-outcome',sourceId:item.source_key,context:{outcomeType:item.type,reason:item.reason,relationshipChange:after,epistemicStatus:'confirmed'}});
  if(liaison)await enqueueCharacterMemory(q,{userId,worldId:item.world_id,contactId:liaison.id,sourceType:'commercial-relationship-outcome',sourceId:item.source_key,context:{counterparty:person.name,outcomeType:item.type,reason:item.reason,relationshipChange:'Recorded business outcome affected the professional relationship.'}});
  await q('INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),userId,item.world_id,person.id,'relationship-outcome','Relationship development · '+person.name,item.reason+' · Modeled relationship indicators updated from the recorded outcome.']);
 });
}
export async function relationshipSnapshot(userId){return sql('SELECT r.*,c.name AS contact_name FROM relationship_outcomes r JOIN contacts c ON c.id=r.contact_id AND c.user_id=r.user_id WHERE r.user_id=$1 ORDER BY r.created_at DESC LIMIT 150',[userId]);}
