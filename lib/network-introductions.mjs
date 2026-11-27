import {transaction,uid} from '../backend/src/db.mjs';
import {ask} from '../backend/src/ai.mjs';
import {enqueueCharacterMemory} from './character-intelligence.mjs';
import {networkIntroductionDue,parseNetworkIntroduction} from './network-introduction-rules.mjs';
const MAX_EXTERNAL_CONTACTS=28;
const utcDate=()=>new Date().toISOString().slice(0,10);
const normalize=value=>String(value??'').trim().toLowerCase();
const organizationType=kind=>kind==='rival'||kind==='competitor'?'competitor':kind==='vendor'?'supplier':kind==='banker'?'financial-institution':kind==='journalist'?'media':kind;
const liaisonTitle=kind=>['investor','banker'].includes(kind)?'Group CFO':['rival','competitor'].includes(kind)?'Group Strategy Director':['friend','adviser'].includes(kind)?'Chief of Staff':kind==='client'?'Chief Commercial Officer':['supplier','vendor','partner'].includes(kind)?'Chief Operating Officer':'General Counsel';
// Lock the owning world before inspecting or writing any introduction. A retry
// may overlap a slow provider call; the exact database-issued attempt token
// prevents a superseded result from creating contacts after a newer claim.
async function lockIntroduction(q,{userId,worldId,operationKey,attemptToken}){
 const [world]=await q('SELECT id,last_network_intro_at,last_network_intro_attempt_at::text AS attempt_token FROM worlds WHERE id=$1 AND user_id=$2 FOR UPDATE',[worldId,userId]);
 if(!world)return {ready:false};
 const [prior]=await q('SELECT contact_id,organization_id FROM network_introductions WHERE user_id=$1 AND world_id=$2 AND operation_key=$3',[userId,worldId,operationKey]);
 if(prior)return {ready:false,prior:{introduced:Boolean(prior.contact_id),contactId:prior.contact_id||null,organizationId:prior.organization_id||null}};
 if(attemptToken!==undefined&&world.attempt_token!==attemptToken)return {ready:false};
 if(!networkIntroductionDue({lastNetworkIntroAt:world.last_network_intro_at}))return {ready:false};
 return {ready:true};
}
async function recordDeferral(q,{userId,worldId,decision,operationKey,context}){
 await q(`INSERT INTO network_introductions(id,user_id,world_id,decision,reason,trigger_summary,payload,operation_key)
  VALUES($1,$2,$3,'deferred',$4,$5,$6::jsonb,$7) ON CONFLICT(user_id,operation_key) DO NOTHING`,
 [uid(),userId,worldId,decision.reason,decision.trigger,JSON.stringify({decision:'defer',context:context||{}}),operationKey]);
 await q('UPDATE worlds SET last_network_intro_at=now() WHERE id=$1',[worldId]);
 return false;
}
export async function persistNetworkIntroduction(q,{userId,worldId,company,decision,context,operationKey,attemptToken}){
 const gate=await lockIntroduction(q,{userId,worldId,operationKey,attemptToken});
 if(!gate.ready)return gate.prior||false;
 if(decision.decision==='defer')return recordDeferral(q,{userId,worldId,decision,operationKey,context:{reason:decision.reason,trigger:decision.trigger}});
 const [count]=await q("SELECT count(*)::int AS total FROM contacts WHERE user_id=$1 AND world_id=$2 AND kind<>'internal'",[userId,worldId]);
 if(Number(count?.total||0)>=MAX_EXTERNAL_CONTACTS)return false;
 if(company?.id){
  const [active]=await q('SELECT id FROM companies WHERE id=$1 AND user_id=$2 AND world_id=$3 AND disposed_at IS NULL FOR SHARE',[company.id,userId,worldId]);
  if(!active)return false;
 }
 const [duplicate]=await q('SELECT id FROM contacts WHERE user_id=$1 AND world_id=$2 AND lower(name)=lower($3) LIMIT 1',[userId,worldId,decision.name]);
 if(duplicate)return recordDeferral(q,{userId,worldId,decision:{reason:'A duplicate contact name was detected; no second person was created.',trigger:decision.trigger},operationKey,context:{duplicateName:decision.name}});
 let organization=(await q('SELECT id,name,sector FROM external_organizations WHERE user_id=$1 AND world_id=$2 AND lower(name)=lower($3) LIMIT 1',[userId,worldId,decision.organization]))[0];
 if(!organization){
  organization=(await q(`INSERT INTO external_organizations(id,user_id,world_id,name,sector,organization_type,strategy,market_position,reputation,competitive_pressure,status)
   VALUES($1,$2,$3,$4,$5,$6,$7,'emerging',52,20,'active') RETURNING id,name,sector`,
  [uid(),userId,worldId,decision.organization,decision.sector,organizationType(decision.kind),decision.organizationStrategy]))[0];
 }
 const contactId=uid(),threadId=uid(),messageId=uid();
 const expertise=JSON.stringify([decision.sector,decision.title]);
 const personality=JSON.stringify({communicationStyle:decision.temperament,motivators:decision.agenda,independentAgency:true,introductionReason:decision.reason,origin:'fictional-network-introduction'});
 await q(`INSERT INTO contacts(id,user_id,world_id,name,title,company,kind,relationship,temperament,agenda,trust,respect,tension,availability,last_contact_at,organization_id,loyalty,ambition,reputation,expertise,personality_profile)
  VALUES($1,$2,$3,$4,$5,$6,$7,'New professional contact',$8,$9,48,50,5,'available',now(),$10,35,65,52,$11::jsonb,$12::jsonb)`,
 [contactId,userId,worldId,decision.name,decision.title,organization.name,decision.kind,decision.temperament,decision.agenda,organization.id,expertise,personality]);
 await q(`INSERT INTO threads(id,user_id,world_id,contact_id,title,category,summary,priority)
  VALUES($1,$2,$3,$4,$5,'network',$6,'normal')`,
 [threadId,userId,worldId,contactId,'Introduction: '+decision.name,decision.message]);
 await q(`INSERT INTO messages(id,user_id,world_id,contact_id,direction,channel,body,created_at)
  VALUES($1,$2,$3,$4,'incoming','chat',$5,now())`,[messageId,userId,worldId,contactId,decision.message]);
 await q(`INSERT INTO events(id,user_id,world_id,thread_id,contact_id,kind,title,body)
  VALUES($1,$2,$3,$4,$5,'stakeholder-contact',$6,$7)`,
 [uid(),userId,worldId,threadId,contactId,'New business contact: '+decision.name,decision.name+': '+decision.message]);
 const engagementContext=JSON.stringify({source:'network-introduction',name:decision.name,title:decision.title,organization:organization.name,reason:decision.reason,trigger:decision.trigger,message:decision.message});
 const engagementDecision=JSON.stringify({decision:'contact',reason:decision.reason,title:'Introduction: '+decision.name,message:decision.message,channel:'message',networkIntroduction:true});
 await q(`INSERT INTO stakeholder_engagements(id,user_id,world_id,contact_id,thread_id,context,operation_key,status,attempts,attempted_at,decision,completed_at)
  VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,'sent',1,now(),$8::jsonb,now()) ON CONFLICT(user_id,operation_key) DO NOTHING`,
 [uid(),userId,worldId,contactId,threadId,engagementContext,'network-intro-contact:'+contactId+':'+utcDate(),engagementDecision]);
 const [liaison]=await q(`SELECT id FROM contacts WHERE user_id=$1 AND world_id=$2 AND kind='internal' AND title=$3 ORDER BY created_at ASC LIMIT 1`,
 [userId,worldId,liaisonTitle(decision.kind)]);
 const [fallback]=liaison?[]:await q(`SELECT id FROM contacts WHERE user_id=$1 AND world_id=$2 AND kind='internal' ORDER BY created_at ASC LIMIT 1`,[userId,worldId]);
 const internal=liaison||fallback;
 if(internal){
  for(const [from,to] of [[contactId,internal.id],[internal.id,contactId]]){
   await q(`INSERT INTO character_relationships(id,user_id,world_id,from_contact_id,to_contact_id,relationship_label,trust,respect,loyalty,tension,familiarity)
    VALUES($1,$2,$3,$4,$5,'network-introduction',45,50,30,5,8) ON CONFLICT(user_id,from_contact_id,to_contact_id) DO NOTHING`,
   [uid(),userId,worldId,from,to]);
  }
 }
 await enqueueCharacterMemory(q,{userId,worldId,contactId,sourceType:'network-introduction',sourceId:messageId,context:{message:decision.message,reason:decision.reason,trigger:decision.trigger}});
 await q(`INSERT INTO network_introductions(id,user_id,world_id,company_id,contact_id,organization_id,decision,reason,trigger_summary,payload,operation_key)
  VALUES($1,$2,$3,$4,$5,$6,'introduced',$7,$8,$9::jsonb,$10) ON CONFLICT(user_id,operation_key) DO NOTHING`,
 [uid(),userId,worldId,company?.id||null,contactId,organization.id,decision.reason,decision.trigger,JSON.stringify({name:decision.name,title:decision.title,kind:decision.kind,organization:organization.name,sector:decision.sector,message:decision.message}),operationKey]);
 await q('UPDATE worlds SET last_network_intro_at=now() WHERE id=$1',[worldId]);
 return {introduced:true,contactId,organizationId:organization.id,threadId};
}
export async function processNetworkIntroductions(userId){
 const context=await transaction(async q=>{
  const [world]=await q(`SELECT w.id,w.user_id,w.name,w.region,w.sectors,w.last_network_intro_at,w.last_network_intro_attempt_at,u.name AS chairman_name FROM worlds w JOIN users u ON u.id=w.user_id WHERE w.user_id=$1 FOR UPDATE OF w`,[userId]);
  if(!world||!networkIntroductionDue({lastNetworkIntroAt:world.last_network_intro_at,lastNetworkIntroAttemptAt:world.last_network_intro_attempt_at}))return null;
  const [claim]=await q('UPDATE worlds SET last_network_intro_attempt_at=now() WHERE id=$1 AND user_id=$2 RETURNING last_network_intro_attempt_at::text AS attempt_token',[world.id,userId]);
  const [count]=await q(`SELECT count(*)::int AS total FROM contacts WHERE user_id=$1 AND world_id=$2 AND kind<>'internal'`,[userId,world.id]);
  if(Number(count?.total||0)>=MAX_EXTERNAL_CONTACTS)return null;
  const companies=await q('SELECT id,name,sector,revenue,valuation FROM companies WHERE user_id=$1 AND world_id=$2 AND disposed_at IS NULL ORDER BY created_at ASC LIMIT 12',[userId,world.id]);
  if(!companies.length)return null;
  const existingContacts=await q(`SELECT c.name,c.title,c.company,c.kind,c.agenda,o.name AS organization_name,o.sector
   FROM contacts c LEFT JOIN external_organizations o ON o.id=c.organization_id
   WHERE c.user_id=$1 AND c.world_id=$2 AND c.kind<>'internal' ORDER BY c.created_at DESC LIMIT 40`,[userId,world.id]);
  const existingOrganizations=await q(`SELECT name,sector,organization_type FROM external_organizations
   WHERE user_id=$1 AND world_id=$2 AND status='active' ORDER BY reputation DESC LIMIT 25`,[userId,world.id]);
  const marketMoves=await q(`SELECT title,description,impact,move_type FROM market_moves
   WHERE user_id=$1 AND world_id=$2 AND created_at>=now()-interval '14 days' ORDER BY created_at DESC LIMIT 8`,[userId,world.id]);
  const openThreads=await q(`SELECT title,category,summary,status FROM threads
   WHERE user_id=$1 AND world_id=$2 AND status='open' ORDER BY updated_at DESC LIMIT 8`,[userId,world.id]);
  const sectors=[...new Set(companies.map(c=>c.sector).filter(Boolean))];
  return {world:{id:world.id,name:world.name,region:world.region},chairmanName:world.chairman_name,companies,existingContacts,existingOrganizations,marketMoves,openThreads,sectors,primarySector:companies[0].sector,attemptToken:claim.attempt_token};
 });
 if(!context)return false;
 const {attemptToken,...providerContext}=context;
 const system=`You manage external network development for a fictional Chairman's Office simulation. Decide whether one genuinely useful new external person should initiate contact now. Use the Chairman's portfolio, network gaps, recent competitor moves and open matters. Never create a person merely to increase contact count. All new people and organizations must be fictional; never use real-world people or companies. Do not claim a referral, prior relationship, meeting, endorsement, accepted offer or completed deal unless the supplied context proves it. The first message is an unsolicited, nonbinding INCOMING message from the newly introduced person TO the Chairman. Write in first person as that new person, introduce yourself using the generated person's name and title, and address the Chairman using the exact chairmanName field supplied in context. Never write as the Chairman, never say 'I am the Chairman', never greet the new person, and never include a Chairman signature or any bracketed name placeholder. Do not present fictional characters as real officials or imply real-world regulatory authority, endorsement or approval. It must be natural, specific and concise. Do not fabricate private information or numeric financial facts. If no strong reason exists, defer. Allowed contact kinds: investor, banker, regulator, journalist, friend, adviser, partner, supplier, vendor, client, competitor, rival, former-employee. Choose a sector that matches the supplied active sectors. Return JSON only: {decision:'introduce'|'defer',reason,trigger,name,title,organization,organizationStrategy,kind,sector,temperament,agenda,message}. trigger should refer to a supplied recent market move/open matter or say 'portfolio network gap'.`;
 const raw=await ask(system,JSON.stringify(providerContext),{json:true,fallback:null});
 const decision=parseNetworkIntroduction(raw,context);
 if(!decision)return false;
 const operationKey='network-intro:'+context.world.id+':'+utcDate();
 const company=context.companies.find(c=>normalize(c.sector)===normalize(decision.sector))||context.companies[0];
 return transaction(q=>persistNetworkIntroduction(q,{userId,worldId:context.world.id,company,decision,context,operationKey,attemptToken}));
}
