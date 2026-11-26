import {sql,transaction,uid} from '../backend/src/db.mjs';
const clamp=n=>Math.max(0,Math.min(100,n));
const deltas=Object.freeze({'supplier-delivery':[2,1,-1],'client-payment':[2,1,-1],'client-dispute':[-2,0,3]});
export function relationshipAfter(before,type){
 const d=deltas[type];if(!d)return null;
 return {trust:clamp((before.trust??60)+d[0]),respect:clamp((before.respect??55)+d[1]),tension:clamp((before.tension??10)+d[2])};
}
export async function processRelationshipOutcomes(userId){
 const candidates=await sql(`WITH candidates AS (
 SELECT p.world_id,s.supplier_contact_id AS contact_id,'supplier-delivery:'||s.id AS source_key,'supplier-delivery' AS type,'Approved supplier order delivered: '||p.po_number AS reason,s.updated_at AS occurred_at
 FROM supplier_negotiations s JOIN purchase_orders p ON p.id=s.purchase_order_id AND p.user_id=s.user_id WHERE s.user_id=$1 AND s.status='delivered' AND p.status IN ('received','paid')
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
  const [person]=await q('SELECT id,name,trust,respect,tension FROM contacts WHERE id=$1 AND user_id=$2 AND world_id=$3 FOR UPDATE',[item.contact_id,userId,item.world_id]);if(!person)return;
  const before={trust:person.trust??60,respect:person.respect??55,tension:person.tension??10},after=relationshipAfter(before,item.type);if(!after)return;
  const [outcome]=await q('INSERT INTO relationship_outcomes(id,user_id,world_id,contact_id,source_key,reason,before_state,after_state) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(user_id,source_key) DO NOTHING RETURNING id',[uid(),userId,item.world_id,person.id,item.source_key,item.reason,JSON.stringify(before),JSON.stringify(after)]);
  if(!outcome)return;
  await q('UPDATE contacts SET trust=$1,respect=$2,tension=$3 WHERE id=$4 AND user_id=$5',[after.trust,after.respect,after.tension,person.id,userId]);
  await q('INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),userId,item.world_id,person.id,'relationship-outcome','Relationship development · '+person.name,item.reason+' · Modeled relationship indicators updated from the recorded outcome.']);
 });
}
export async function relationshipSnapshot(userId){return sql('SELECT r.*,c.name AS contact_name FROM relationship_outcomes r JOIN contacts c ON c.id=r.contact_id AND c.user_id=r.user_id WHERE r.user_id=$1 ORDER BY r.created_at DESC LIMIT 150',[userId]);}
