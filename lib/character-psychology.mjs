import {sql} from '../backend/src/db.mjs';
import {ownDevelopment} from './character-development.mjs';
import {deriveConstitution,initialPsychologicalState,appraiseInfluences,validateConstitution} from './character-psychology-rules.mjs';
export async function ensureCharacterPsychology(userId,contactId,q=sql){
 const [contact]=await q('SELECT c.id,c.user_id,c.world_id,c.title,c.company,c.kind,c.temperament,c.agenda,c.ambition,c.personality_profile FROM contacts c JOIN worlds w ON w.id=c.world_id AND w.user_id=c.user_id WHERE c.user_id=$1 AND c.id=$2',[userId,contactId]);
 if(!contact)return null;
 const [prior]=await q('SELECT constitution,baseline_state,version FROM character_psychology WHERE user_id=$1 AND world_id=$2 AND contact_id=$3',[userId,contact.world_id,contactId]);
 if(prior){if(!validateConstitution(prior.constitution))throw Error('Stored character constitution invalid');return prior;}
 const constitution=deriveConstitution(contact),state=initialPsychologicalState(constitution);
 await q(`INSERT INTO character_psychology(contact_id,user_id,world_id,constitution,baseline_state)
 SELECT c.id,c.user_id,c.world_id,$4::jsonb,$5::jsonb FROM contacts c JOIN worlds w ON w.id=c.world_id AND w.user_id=c.user_id
 WHERE c.user_id=$1 AND c.world_id=$2 AND c.id=$3 ON CONFLICT(contact_id) DO NOTHING`,[userId,contact.world_id,contactId,JSON.stringify(constitution),JSON.stringify(state)]);
 const [row]=await q('SELECT constitution,baseline_state,version FROM character_psychology WHERE user_id=$1 AND world_id=$2 AND contact_id=$3',[userId,contact.world_id,contactId]);
 return row||null;
}
export async function characterPsychologyContext(userId,contactId,context={},q=sql){
 const row=await ensureCharacterPsychology(userId,contactId,q);
 if(!row)return null;
 const tasks=context.tasks??await q('SELECT id,status FROM business_tasks WHERE user_id=$1 AND assignee_id=$2 ORDER BY created_at DESC LIMIT 12',[userId,contactId]);
 const development=await ownDevelopment(userId,contactId,q);
 const [person]=await q('SELECT id,title,company,kind FROM contacts WHERE id=$1 AND user_id=$2',[contactId,userId]);
 const constitution=structuredClone(row.constitution),baseline={...row.baseline_state};
 if(person)constitution.professionalIdentity=deriveConstitution(person).professionalIdentity;
 for(const [key,delta] of Object.entries(development.traitOffsets))if(Object.hasOwn(constitution.traits,key))constitution.traits[key]=Math.max(0,Math.min(100,constitution.traits[key]+delta));
 for(const [key,delta] of Object.entries(development.stateOffsets))if(Object.hasOwn(baseline,key))baseline[key]=Math.max(0,Math.min(100,baseline[key]+delta));
 return {...appraiseInfluences({...context,constitution,baseline,tasks}),foundationalTraits:row.constitution.traits,development};
}
export async function initializeCharacterPsychology(userId,q=sql){
 const contacts=await q(`SELECT c.id FROM contacts c JOIN worlds w ON w.id=c.world_id AND w.user_id=c.user_id
 LEFT JOIN character_psychology p ON p.contact_id=c.id WHERE c.user_id=$1 AND p.contact_id IS NULL ORDER BY c.id LIMIT 10`,[userId]);
 for(const c of contacts)await ensureCharacterPsychology(userId,c.id,q);
 return contacts.length;
}
