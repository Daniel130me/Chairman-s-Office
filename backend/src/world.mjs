"use step";
import {mergeTranscript} from '../../lib/executive-experience-rules.mjs';

import {sql,one,transaction,uid,iso} from './db.mjs';
import {ask} from './ai.mjs';
import {handleCallIntent} from '../../lib/executive-call-intent.mjs';
import {normalizeMailSubject,replyMailSubject} from '../../lib/mail-rules.mjs';

import {createVapiActionToken} from '../../lib/vapi-action-token.mjs';
import {economySnapshot} from '../../lib/economy.mjs';
import {boardSnapshot} from '../../lib/board-governance.mjs';
import {relationshipSnapshot} from '../../lib/relationship-world.mjs';
import {stakeholderSnapshot} from '../../lib/stakeholder-world.mjs';
import {supplierSnapshot} from '../../lib/supplier-world.mjs';
import {hrSnapshot} from '../../lib/hr-world.mjs';
import {employmentSnapshot} from '../../lib/employment.mjs';
import {operationsSnapshot} from '../../lib/operations.mjs';
import {communicationSnapshot,sendWorldMessage} from '../../lib/autonomous-communications.mjs';
import {marketSnapshot} from '../../lib/market-engine.mjs';
import {actionRequestsSnapshot,requestAction} from '../../lib/action-requests.mjs';
import {personalWealthSnapshot} from '../../lib/personal-wealth.mjs';
import {travelSnapshot} from '../../lib/travel.mjs';
import {securitySnapshot} from '../../lib/security.mjs';
import {securityIntelligenceSnapshot} from '../../lib/security-world.mjs';
import {grantImpactSnapshot,grantsSnapshot} from '../../lib/philanthropy.mjs';
import {realWorldNewsSnapshot} from '../../lib/real-world-news.mjs';
import {realWorldSignalSnapshot} from '../../lib/real-world-signals.mjs';
import {terminalRound,selectParticipants,appendMeetingResponse,finishMeetingRound,claimMeetingWorker,renewMeetingWorker} from '../../lib/meeting-session.mjs';
import {buildMeetingPrompt,parseMeetingReply} from '../../lib/meeting-rules.mjs';
import {characterContext,characterIntelligenceSnapshot,queueCharacterMemory,enqueueCharacterMemory} from '../../lib/character-intelligence.mjs';
const internal=[['Amara Okafor','Chief of Staff','Measured, perceptive and fiercely discreet','Protect the Chairman’s time and long-term reputation'],['Daniel Mercer','Group CFO','Precise, skeptical and analytically rigorous','Preserve liquidity and challenge weak forecasts'],['Nadia Mensah','Chief Operating Officer','Pragmatic, decisive and direct','Keep subsidiaries performing and execution realistic'],['Julian Hart','General Counsel','Calm, exacting and cautious','Prevent reputational and contractual exposure'],['Sophia Vale','Group Strategy Director','Creative, ambitious and competitive','Pursue defensible expansion opportunities'],['Marcus Reid','Board Chair','Independent and challenging','Ensure accountability and shareholder discipline'],['Grace Okafor','Group Human Resources Director','Empathetic, observant and firm','Build a capable workforce and protect fair employment practices'],['Maya Okoye','Chief Security Officer','Alert, disciplined and discreet','Protect people, information and company assets'],['Rafael Chen','Internal Audit Director','Methodical, independent and evidence-led','Identify control weaknesses and investigate irregularities'],['Tunde Adebayo','Chief Commercial Officer','Persuasive, commercially minded and competitive','Grow customer relationships and improve deal quality']];
const external=[['Aisha Rahman','Managing Partner','Meridian Capital','investor','Sharp and guarded','Earn favorable terms and obtain influence'],['Victor Sloane','CEO','Sloane Meridian Group','rival','Assertive and calculating','Outcompete the Chairman in key sectors'],['Elena Moretti','Founder','Moretti Ventures','friend','Warm but candid','Find joint ventures without sacrificing independence'],['Kwame Bediako','Regional Director','Atlas Infrastructure','partner','Dependable and cautious','Win strategic delivery contracts'],['Isabelle Laurent','Market Analyst','Independent Advisory','adviser','Thoughtful and sometimes contrarian','Help the Chairman see hidden risks'],['Farah Nasser','Managing Director','Sterling Procurement','vendor','Persuasive and opportunistic','Win competitive bids with profitable terms'],['David Okoro','Chief Executive','Northstar Consumer Group','client','Direct and commercially demanding','Secure reliable supply and favorable service levels'],['Priya Nair','Private Banker','Crown Meridian Bank','banker','Discreet and risk-conscious','Grow lending and wealth-management relationships'],['Ruth Mensah','Commissioner','West African Trade Authority','regulator','Formal and evidence-driven','Ensure compliance and protect public confidence'],['Daniel Brooks','Investigations Editor','The Continental Ledger','journalist','Persistent and skeptical','Publish stories that withstand scrutiny'],['Omar Haddad','Founder and CEO','Helix Industrial Systems','competitor','Ambitious and highly competitive','Win market share and recruit scarce talent'],['Grace Osei','Managing Director','Osei Global Supply','supplier','Practical and price-sensitive','Secure long-term procurement contracts'],['Samuel Dube','Chairman','Dube Ventures','friend','Sociable but strategically cautious','Build trusted business relationships'],['Alex Chen','General Partner','Summit Frontier Partners','investor','Analytical and impatient','Find high-growth investments with governance discipline']];
const scenarios=[['Strategic acquisition opportunity','A privately held competitor may be available at an attractive valuation. Finance wants diligence before any commitment.','strategy','high'],['Treasury and liquidity outlook','The CFO is reviewing cash reserves against an accelerated expansion plan.','finance','normal'],['Board governance review','The board has requested a clear explanation of execution risks and capital allocation.','board','high'],['New regional partnership','A cross-border partner has proposed commercial collaboration with meaningful upside and operational dependencies.','deal','normal'],['Reputation and stakeholder confidence','External stakeholders are watching how the group responds to shifting market conditions.','risk','normal']];
function first(s){return s.split(' ')[0];}
export async function createWorld(user,data){const name=String(data.name||'Aurelius Holdings').trim().slice(0,95),region=String(data.region||'Lagos, Nigeria').slice(0,100),timezone=String(data.timezone||'Africa/Lagos').slice(0,60),sectors=(Array.isArray(data.sectors)?data.sectors:['Technology','Finance','Infrastructure']).map(x=>String(x).slice(0,55)).slice(0,6),chief=String(data.chief||'Amara Okafor').slice(0,80),style=String(data.style||'balanced').slice(0,35);if(!name||!sectors.length)throw Error('Set a holding company and at least one sector.');try{new Intl.DateTimeFormat('en',{timeZone:timezone});}catch{throw Error('Invalid time zone');}
return transaction(async q=>{if((await q('SELECT id FROM worlds WHERE user_id=$1',[user.id])).length)throw Error('Your empire is already established.');const wid=uid();const valuation=3500000000;await q('INSERT INTO worlds(id,user_id,name,region,timezone,sectors,chief,style,valuation) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[wid,user.id,name,region,timezone,JSON.stringify(sectors),chief,style,valuation]);await q('INSERT INTO settings(user_id) VALUES($1)',[user.id]);const companies=[];for(let i=0;i<Math.min(4,sectors.length);i++){const cid=uid();const company={id:cid,name:`${name.replace(/\s+(holdings|group|international)$/i,'')} ${sectors[i]} ${i===0?'Limited':'Group'}`,sector:sectors[i],valuation:valuation/(i+2),cash:190000000/(i+1),revenue:390000000/(i+1)};companies.push(company);await q('INSERT INTO companies(id,user_id,world_id,name,sector,valuation,cash,revenue) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[cid,user.id,wid,company.name,company.sector,company.valuation,company.cash,company.revenue]);}
const contacts=[];for(const [idx,entry] of [...internal,...external].entries()){
 const isIn=idx<internal.length;const [name0,title,a,b,c,d]=entry;const cname=idx===0?chief:name0;const co=isIn?name:a;const id=uid();
 const temperament=isIn?a:c,agenda=isIn?b:d,kind=isIn?'internal':b;
 const expertise=[title,...(isIn?sectors.slice(0,2):[sectors[(idx-internal.length)%sectors.length]])];
 const personality={communicationStyle:temperament,motivators:agenda,riskPosture:/legal|audit|security|bank/i.test(title)?'cautious':'role-dependent',independentAgency:true};
 contacts.push({id,name:cname,title,company:co});
 await q('INSERT INTO contacts(id,user_id,world_id,name,title,company,kind,relationship,temperament,agenda,trust,loyalty,ambition,reputation,expertise,personality_profile) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',
 [id,user.id,wid,cname,title,co,kind,isIn?'executive':kind,temperament,agenda,isIn?75:54,isIn?72:38,isIn?55+(idx*7%35):68+((idx-internal.length)*5%25),58,JSON.stringify(expertise),JSON.stringify(personality)]);
}
for(let i=0;i<external.length;i++){
 const entry=external[i],contact=contacts[internal.length+i];
 const [personName,personTitle,orgName,kind,temperament,agenda]=entry;
 const orgType=kind==='rival'||kind==='competitor'?'competitor':kind;
 const orgId=uid();
 await q(`INSERT INTO external_organizations(id,user_id,world_id,name,sector,organization_type,strategy,market_position,reputation,competitive_pressure)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(user_id,world_id,name) DO NOTHING`,[orgId,user.id,wid,orgName,sectors[i%sectors.length],orgType,agenda,'established',kind==='rival'||kind==='competitor'?58:55,kind==='rival'||kind==='competitor'?72:25]);
 const org=(await q('SELECT id FROM external_organizations WHERE user_id=$1 AND world_id=$2 AND name=$3',[user.id,wid,orgName]))[0];
 await q('UPDATE contacts SET organization_id=$1 WHERE id=$2 AND user_id=$3',[org.id,contact.id,user.id]);
}
// Seed only plausible professional ties. Each direction is a separate private perspective.
const internalContacts=contacts.slice(0,internal.length);
for(const from of internalContacts)for(const to of internalContacts)if(from.id!==to.id){
 await q(`INSERT INTO character_relationships(id,user_id,world_id,from_contact_id,to_contact_id,relationship_label,trust,respect,loyalty,tension,familiarity)
  VALUES($1,$2,$3,$4,$5,'colleague',50,55,48,10,20) ON CONFLICT(user_id,from_contact_id,to_contact_id) DO NOTHING`,
  [uid(),user.id,wid,from.id,to.id]);
}
const liaisonByKind={investor:'Group CFO',banker:'Group CFO',rival:'Group Strategy Director',competitor:'Group Strategy Director',friend:'Chief of Staff',adviser:'Chief of Staff',client:'Chief Commercial Officer',supplier:'Chief Operating Officer',vendor:'Chief Operating Officer',partner:'Chief Operating Officer',regulator:'General Counsel',journalist:'General Counsel'};
for(let i=0;i<external.length;i++){
 const person=contacts[internal.length+i],kind=external[i][3],liaison=internalContacts.find(c=>c.title===liaisonByKind[kind])||internalContacts[0];
 const label=['rival','competitor'].includes(kind)?'rival':kind==='friend'?'business-friend':'professional-counterparty';
 for(const [from,to] of [[liaison,person],[person,liaison]]){
  await q(`INSERT INTO character_relationships(id,user_id,world_id,from_contact_id,to_contact_id,relationship_label,trust,respect,loyalty,tension,familiarity)
   VALUES($1,$2,$3,$4,$5,$6,45,50,28,15,12) ON CONFLICT(user_id,from_contact_id,to_contact_id) DO NOTHING`,
   [uid(),user.id,wid,from.id,to.id,label]);
 }
}
for(let i=0;i<scenarios.length;i++){const [title,summary,category,priority]=scenarios[i],id=uid(),actor=contacts[(i+1)%contacts.length];await q('INSERT INTO threads(id,user_id,world_id,company_id,contact_id,title,category,summary,priority) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,user.id,wid,companies[i%companies.length].id,actor.id,title,category,summary,priority]);await q('INSERT INTO events(id,user_id,world_id,thread_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[uid(),user.id,wid,id,actor.id,'briefing',title,summary]);}
const greeting=`Good morning, ${user.name}. Your office is established. Your leadership team is waiting, and the first matters are on your desk. I would like to brief you personally before the day begins.`;await q('INSERT INTO messages(id,user_id,world_id,contact_id,direction,channel,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),user.id,wid,contacts[0].id,'incoming','chat',greeting]);await q('INSERT INTO invites(id,user_id,world_id,contact_id,kind,subject,preview,due_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval \'20 seconds\')',[uid(),user.id,wid,contacts[0].id,'welcome',`Incoming call · ${chief}`,'Your chief of staff would like to welcome you personally.']);await q('INSERT INTO documents(id,user_id,world_id,title,kind,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,wid,'Chairman’s First Executive Brief','briefing',`CONFIDENTIAL — CHAIRMAN’S OFFICE\n\nGroup: ${name}\nHeadquarters: ${region}\nPortfolio: ${sectors.join(', ')}\n\nFirst priorities:\n• Meet the leadership team\n• Review treasury and growth strategy\n• Establish board reporting cadence\n• Evaluate the acquisition proposal`]);const tid=uid();await q('INSERT INTO tenders(id,user_id,world_id,title,budget) VALUES($1,$2,$3,$4,$5)',[tid,user.id,wid,'Regional technology modernization programme',24000000]);for(const [j,c] of contacts.slice(-3).entries())await q('INSERT INTO bids(id,user_id,tender_id,contact_id,amount,weeks,quality,risk) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[uid(),user.id,tid,c.id,22000000+j*1700000,14+j*4,86-j*7,j?'moderate':'low']);return {id:wid,name,region,timezone,sectors,chief,style};});}
export async function state(userId){const world=await one('SELECT * FROM worlds WHERE user_id=$1',[userId]);if(!world)return null;const tables=['companies','contacts','threads','events','messages','meetings','meeting_turns','documents','decisions','invites','calls','tenders','bids'];const outputs=await Promise.all(tables.map(t=>sql(`SELECT * FROM ${t} WHERE user_id=$1 ORDER BY ${t==='calls'?'started_at':'created_at'} DESC LIMIT 400`,[userId])));const data=Object.fromEntries(tables.map((t,i)=>[t,outputs[i]]));data.meetings=data.meetings.map(m=>({...m,attendees:m.attendees||[]}));data.tenders=data.tenders.map(t=>({...t,bids:data.bids.filter(b=>b.tender_id===t.id)}));data.settings=await one('SELECT * FROM settings WHERE user_id=$1',[userId]);const economy=await economySnapshot(userId);data.companies=economy.companies;const employees=await employmentSnapshot(userId);const hrCases=await hrSnapshot(userId);const governance=await boardSnapshot(userId);const stakeholderEngagements=await stakeholderSnapshot(userId);const relationshipOutcomes=await relationshipSnapshot(userId);const supplierNegotiations=await supplierSnapshot(userId);const operations=await operationsSnapshot(userId);const communications=await communicationSnapshot(userId);const market=await marketSnapshot(userId);const actionRequests=await actionRequestsSnapshot(userId);const wealth=await personalWealthSnapshot(userId);const travel=await travelSnapshot(userId);const security=await securitySnapshot(userId);const securityIntelligence=await securityIntelligenceSnapshot(userId);const intelligence=await characterIntelligenceSnapshot(userId);const grants=await grantsSnapshot(userId);const grantImpact=await grantImpactSnapshot(userId);const realWorldNews=await realWorldNewsSnapshot(userId);const realWorldSignals=await realWorldSignalSnapshot(userId);return {world,...data,economy,employees,hrCases,...governance,stakeholderEngagements,relationshipOutcomes,supplierNegotiations,operations,...communications,...market,actionRequests,...wealth,...travel,...security,...securityIntelligence,...intelligence,grants,grantImpact,realWorldNews,realWorldSignals};}
async function characterPrompt(user,contact,history,world){
  const economy=contact.kind==='internal'&&['Group CFO','Chief Operating Officer','Chief of Staff'].includes(contact.title)?await economySnapshot(user.id):null;
  const assigned=await sql("SELECT title,detail,status,outcome FROM business_tasks WHERE user_id=$1 AND assignee_id=$2 ORDER BY created_at DESC LIMIT 10",[user.id,contact.id]);
  const intelligence=await characterContext(user.id,contact.id);
  const signals=await sql('SELECT signal_key,label,value,unit,source_name,source_url,observed_at FROM real_world_signals WHERE user_id=$1 ORDER BY observed_at DESC LIMIT 20',[user.id]);
  const news=await realWorldNewsSnapshot(user.id,8);
  return [
    'You are '+contact.name+', '+contact.title+' at '+contact.company+' in the Chairman’s Office, an immersive fictional executive world.',
    'The Chairman is '+user.name+', leading '+world.name+' in '+world.region+'.',
    'Your name and identity are exactly '+contact.name+'. The executive directory is the source of truth. Never claim your name is Amara unless your directory name is Amara. Never replace your identity with another character’s name.',
    'This is a fictional business world, but your role, relationships, commitments and actions inside it are persistent and consequential. Never break character by saying you cannot call or coordinate with colleagues because the world is simulated.',
    'Do not claim real-world external actions occurred. You may complete supported actions inside the Chairman’s Office experience and must rely on their actual tool results before confirming success.',
    'You have your own incentives, knowledge, pride, human flaws and commitments. Temperament: '+contact.temperament+'. Personal agenda: '+contact.agenda+'. Trust: '+contact.trust+'/100; respect: '+contact.respect+'/100; loyalty: '+contact.loyalty+'/100; tension: '+contact.tension+'/100; ambition: '+contact.ambition+'/100.',
    'Your private durable memories, beliefs, reported claims and active goals are only those attached to your own character record. Other characters’ private memories and messages are not available to you. Treat each memory according to its epistemic status and confidence; a rumor or belief is never a confirmed fact. Your memories: '+JSON.stringify(intelligence.memories)+'. Your current goals: '+JSON.stringify(intelligence.goals)+'. Your own perspective on relationships: '+JSON.stringify(intelligence.relationships)+'.',
    'Do not infer knowledge of private matters from another person’s role, agenda, memory or access. You know a private fact only if it is in your own authorized records, was shared with you, or you personally observed it. If you do not know, say so.',
    'Authorised company figures (USD, since ledger activation; annual sales assumption is not actual revenue; valuation is an estimate): '+JSON.stringify(economy?.companies||[])+'; your assigned tasks: '+JSON.stringify(assigned)+'. Never claim unrecorded payments or task completion. Do not invent figures; if data is absent say it is unavailable.',
    'Sourced real-world indicators, including observation dates: '+JSON.stringify(signals)+'. These are external facts, not fictional company transactions; do not claim they changed company finances unless a recorded business action did so.',
    'Recent external news reports: '+JSON.stringify(news.map(n=>({headline:n.title,publisher:n.domain,publishedAt:n.published_at,url:n.url})))+'. These are third-party reports, not independently verified facts; distinguish claims from confirmed records and never change company finances solely because of a headline.',
    'Recent exchange: '+history.map(m=>m.direction+': '+m.body).join(' | ').slice(-3500)+'.',
    'Speak naturally, distinctly and credibly like a senior professional. You may disagree, ask questions, negotiate or hold back information when consistent with your character. Maintain continuity, specificity and consequences. Reply in plain conversational language, usually 1–4 sentences.'
  ].join(' ');
}

async function classifyBusinessAction(user,contact,body,operationKeyValue){
 if(contact.kind!=='internal'||!/\b(hire|recruit|fire|terminate|dismiss|expense|spend|pay|approve|contract|assign|delegate|investigation|investigate)\b/i.test(body))return null;
 const [companies,employees,contracts,executives]=await Promise.all([
  sql('SELECT id,name,sector FROM companies WHERE user_id=$1 AND disposed_at IS NULL',[user.id]),
  sql("SELECT e.id,p.name,e.job_title,e.status FROM employment_records e JOIN contacts p ON p.id=e.contact_id AND p.user_id=e.user_id WHERE e.user_id=$1 AND e.status='active'",[user.id]),
  sql("SELECT id,title,counterparty,status,value FROM business_contracts WHERE user_id=$1 AND status='draft'",[user.id]),
  sql("SELECT id,name,title,company FROM contacts WHERE user_id=$1 AND kind='internal'",[user.id])
 ]);
 const parsed=await ask(
  'You are a strict business-action intent parser for a fictional company simulation. Return JSON only: {"actionType":"expense|hire|fire|activate-contract|assign-task|none","title":"","reason":"","payload":{},"clarification":""}. Create an action only when the Chairman clearly instructs the executive to initiate a real action now, not when discussing a hypothetical, asking a question or exploring options. Never invent identifiers, salary, amount, names, companies or terms. Use only supplied IDs. If required details are missing, set actionType to none and ask one concise clarification. Never execute anything; the result is only a request for Chairman approval.',
  JSON.stringify({chairmanMessage:body,requestingExecutive:{name:contact.name,title:contact.title},companies,activeEmployees:employees,draftContracts:contracts,internalExecutives:executives,allowedPayloads:{
   expense:{companyId:'existing company id',amount:'positive decimal string',description:'reason'},
   hire:{companyId:'existing company id',name:'candidate name',title:'role',salary:'annual salary decimal string'},
   fire:{employmentId:'active employment record id',reason:'documented reason'},
   'activate-contract':{contractId:'draft contract id',reason:'approval reason'},
   'assign-task':{companyId:'existing company id or omitted',assigneeId:'internal contact id',title:'task title',detail:'instructions',taskType:'valid task type'}
  }}),
  {json:true,fallback:null}
 );
 if(!parsed||typeof parsed!=='object')return null;
 if(typeof parsed.clarification==='string'&&parsed.clarification.trim())return {clarification:parsed.clarification.trim().slice(0,300)};
 const allowed=['expense','hire','fire','activate-contract','assign-task'];
 if(!allowed.includes(parsed.actionType))return null;
 const request=await requestAction(user,contact.id,{actionType:parsed.actionType,title:parsed.title,reason:parsed.reason,payload:parsed.payload||{},operationKey:operationKeyValue});
 return {request};
}
export async function message(user,contactId,body,channel='chat',sourceCallId=null,subject=null){
  body=String(body||'').trim().slice(0,3500);
  if(!body)throw Error('Write a message.');
  if(channel!=='chat'&&channel!=='email')throw Error('Invalid message channel.');
  const mailSubject=channel==='email'?normalizeMailSubject(subject):null;
  const c=await one('SELECT * FROM contacts WHERE id=$1 AND user_id=$2',[contactId,user.id]);
  const w=await one('SELECT * FROM worlds WHERE user_id=$1',[user.id]);
  if(!c||!w)throw Error('Contact unavailable');

  if(sourceCallId&&!await one("SELECT id FROM calls WHERE id=$1 AND user_id=$2 AND world_id=$3 AND contact_id=$4 AND status IN ('missed','declined')",[sourceCallId,user.id,w.id,c.id]))throw Error('Call unavailable');
  const outgoingId=uid();
  await sql('INSERT INTO messages(id,user_id,world_id,contact_id,direction,channel,body,source_call_id,subject) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[outgoingId,user.id,w.id,c.id,'outgoing',sourceCallId?'missed-call':channel,body,sourceCallId,mailSubject]);
  if(sourceCallId&&c.availability&&c.availability!=='available')return {reply:null,delivery:'saved-no-reply'};
  const history=(await sql('SELECT direction,body FROM messages WHERE user_id=$1 AND contact_id=$2 ORDER BY created_at DESC LIMIT 12',[user.id,c.id])).reverse();
  const callAction=await handleCallIntent({userId:user.id,worldId:w.id,defaultContactId:c.id,text:body,actionKey:'message:'+outgoingId});
  let reply;
  if(callAction){
    reply=callAction.reply;
  }else{
    const proposed=await classifyBusinessAction(user,c,body,'message:'+outgoingId).catch(error=>{console.warn('Business action classification deferred',error.name||'error');return null;});
    if(proposed?.clarification)reply=proposed.clarification;
    else if(proposed?.request)reply='Chairman, I have submitted “'+proposed.request.title+'” to your Approvals app with the supporting reason. Nothing has been executed yet; I will proceed only after your decision.';
    else reply=await ask(
      (await characterPrompt(user,c,history,w))+(channel==='email'?' You are replying to a business email. Write a concise, professional email response with a greeting and sign-off. Do not invent email addresses.':'')+' Previous calls: '+(await sql("SELECT summary FROM calls WHERE user_id=$1 AND contact_id=$2 AND status='completed' ORDER BY ended_at DESC LIMIT 3",[user.id,c.id])).map(x=>x.summary).join(' | ').slice(0,3500),
      (channel==='email'?'The Chairman sent this email: ':'The Chairman says: ')+body+'\nRespond as '+c.name+'.',
      {fallback:null}
    );
  }

  if(!reply){
    await queueCharacterMemory({userId:user.id,worldId:w.id,contactId:c.id,sourceType:'direct-message',sourceId:outgoingId,context:{channel,chairmanMessage:body,characterReply:null,delivery:'saved-no-reply'}}).catch(error=>console.warn('Character memory queue unavailable',error.code||error.name));
    return {reply:null,delivery:'saved-no-reply'};
  }
  await sql('INSERT INTO messages(id,user_id,world_id,contact_id,direction,channel,body,subject) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[uid(),user.id,w.id,c.id,'incoming',channel,reply,channel==='email'?replyMailSubject(mailSubject):null]);
  await sql('UPDATE contacts SET last_contact_at=now() WHERE id=$1',[c.id]);
  await queueCharacterMemory({userId:user.id,worldId:w.id,contactId:c.id,sourceType:channel==='email'?'email':'direct-message',sourceId:outgoingId,context:{channel,subject:mailSubject,chairmanMessage:body,characterReply:reply}}).catch(error=>console.warn('Character memory queue unavailable',error.code||error.name));
  return {reply};
}
export async function sendGroupMessage(user,conversationId,body){return sendWorldMessage(user,conversationId,body);}
export async function makeInvite(user,contactId){const c=await one('SELECT * FROM contacts WHERE id=$1 AND user_id=$2',[contactId,user.id]);const w=await one('SELECT * FROM worlds WHERE user_id=$1',[user.id]);if(!c||!w)throw Error('Contact unavailable');return one('INSERT INTO invites(id,user_id,world_id,contact_id,kind,subject,preview,due_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()) RETURNING *',[uid(),user.id,w.id,c.id,'requested',`Incoming call · ${c.name}`,`${c.name} is available to speak.`]);}
export async function startCall(user,contactId,inviteId=null){
  const c=await one('SELECT * FROM contacts WHERE id=$1 AND user_id=$2',[contactId,user.id]);
  const w=await one('SELECT * FROM worlds WHERE user_id=$1',[user.id]);
  if(!c||!w)throw Error('Contact unavailable');

  if(!inviteId&&c.availability&&c.availability!=='available'){
    const missed=await one("INSERT INTO calls(id,user_id,world_id,contact_id,status,ended_at,summary) VALUES($1,$2,$3,$4,'missed',now(),$5) RETURNING *",[uid(),user.id,w.id,c.id,'No answer — contact unavailable']);
    return {call:missed,contact:c,unavailable:true};
  }
  const call=await transaction(async q=>{
    if(inviteId){
      const rows=await q("UPDATE invites SET status='answered' WHERE id=$1 AND user_id=$2 AND contact_id=$3 AND status='pending' AND due_at<=now() RETURNING id",[inviteId,user.id,c.id]);
      if(!rows.length)throw Error('Invitation unavailable');
    }
    return (await q('INSERT INTO calls(id,user_id,world_id,contact_id,invite_id) VALUES($1,$2,$3,$4,$5) RETURNING *',[uid(),user.id,w.id,c.id,inviteId]))[0];
  });

  const history=await sql('SELECT direction,body FROM messages WHERE user_id=$1 AND contact_id=$2 ORDER BY created_at DESC LIMIT 10',[user.id,c.id]);
  const previous=await sql("SELECT summary FROM calls WHERE user_id=$1 AND contact_id=$2 AND status='completed' ORDER BY ended_at DESC LIMIT 3",[user.id,c.id]);
  const colleagues=await sql('SELECT name,title,company FROM contacts WHERE user_id=$1 AND id<>$2 ORDER BY title,name',[user.id,c.id]);
  const invitation=inviteId?await one('SELECT subject,preview FROM invites WHERE id=$1 AND user_id=$2 AND contact_id=$3',[inviteId,user.id,c.id]):null;
  const actionToken=createVapiActionToken({userId:user.id,callId:call.id,sourceContactId:c.id});

  return {
    call,
    contact:c,
    context:(await characterPrompt(user,c,history.reverse(),w))+' Previous calls: '+previous.map(p=>p.summary).join(' | ').slice(0,3500)+(invitation?' Incoming call reason: '+invitation.subject+' — '+invitation.preview:''),
    assistantId:c.vapi_assistant_id||process.env.VAPI_ASSISTANT_ID||null,
    actionToken,
    colleagues
  };
}
export async function finishCall(user,id,transcript,status='completed'){
 const call=await one('SELECT * FROM calls WHERE id=$1 AND user_id=$2',[id,user.id]);if(!call)throw Error('Call unavailable');if(call.status!=='active')return {summary:call.summary};
 const rows=mergeTranscript(call.transcript,transcript);
 const summary=await ask('Summarize this fictional executive conversation precisely: decisions, commitments, risks, follow-ups. Do not invent facts.',JSON.stringify(rows),{fallback:rows.map(r=>r.role+': '+r.text).join(' ').slice(0,1500)||'Call completed; no transcript available.'});
 const updated=await transaction(async q=>{const [latest]=await q('SELECT * FROM calls WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]);if(!latest||latest.status!=='active')return null;const merged=mergeTranscript(latest.transcript,rows);const finalSummary=merged.length===rows.length?summary:merged.map(r=>r.role+': '+r.text).join(' ').slice(0,3000);return (await q("UPDATE calls SET ended_at=now(),status=$4,transcript=$1,summary=$2 WHERE id=$3 AND user_id=$5 AND status='active' RETURNING summary",[JSON.stringify(merged),finalSummary,id,status==='failed'?'failed':'completed',user.id]))[0];});
 const finalSummary=updated?.summary??(await one('SELECT summary FROM calls WHERE id=$1 AND user_id=$2',[id,user.id]))?.summary;
 if(updated&&rows.length)await queueCharacterMemory({userId:user.id,worldId:call.world_id,contactId:call.contact_id,sourceType:'voice-call',sourceId:id,context:{transcript:rows.slice(-40).map(r=>({role:r.role,text:r.text.slice(0,1200)})),summary:finalSummary,status}}).catch(error=>console.warn('Call memory queue unavailable',error.code||error.name));
 return {summary:finalSummary};
}
export async function createMeeting(user,data){
 const w=await one('SELECT * FROM worlds WHERE user_id=$1',[user.id]);if(!w)throw Error('Empire unavailable');
 const title=String(data.title||'Leadership strategy discussion').trim().slice(0,140);
 const selected=Array.isArray(data.attendees)?[...new Set(data.attendees)].slice(0,8):[];
 if(!selected.length)throw Error('Select attendees');
 const c=await sql('SELECT id FROM contacts WHERE user_id=$1 AND id=ANY($2::uuid[])',[user.id,selected]);
 if(c.length!==selected.length)throw Error('One or more meeting attendees are unavailable.');
 return transaction(async q=>{
  const meeting=(await q('INSERT INTO meetings(id,user_id,world_id,title,start_at,attendees,duration_minutes) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[uid(),user.id,w.id,title,data.start_at||iso(),JSON.stringify(c.map(x=>x.id)),Math.min(120,Math.max(10,Number(data.duration_minutes)||45))]))[0];
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,w.id,'meeting-scheduled',title,'A meeting was scheduled with '+c.length+' participants.']);
  return meeting;
 });
}
export async function meetingSpeak(user,meetingId,text,options={}){
 const w=await one('SELECT * FROM worlds WHERE user_id=$1',[user.id]);if(!w)throw Error('Empire unavailable');
 const m=await one('SELECT * FROM meetings WHERE id=$1 AND user_id=$2',[meetingId,user.id]);if(!m||m.status==='concluded')throw Error('Meeting unavailable');
 const contacts=selectParticipants(await sql('SELECT id FROM contacts WHERE user_id=$1 AND id=ANY($2::uuid[]) ORDER BY array_position($2::uuid[],id)',[user.id,m.attendees]),options.contactId);
 if(!contacts.length)throw Error('No participants');
 text=String(text||'What are your assessments of the situation?').trim().slice(0,3000);
 return transaction(async q=>{
  const locked=(await q('SELECT id,status FROM meetings WHERE id=$1 AND user_id=$2 FOR UPDATE',[meetingId,user.id]))[0];
  if(!locked||locked.status==='concluded')throw Error('Meeting unavailable');
  if(options.requestId){const [prior]=await q('SELECT r.*,t.message FROM meeting_rounds r JOIN meeting_turns t ON t.id=r.chairman_turn_id AND t.user_id=r.user_id WHERE r.user_id=$1 AND r.meeting_id=$2 AND r.client_request_id=$3',[user.id,meetingId,options.requestId]);if(prior){if(prior.source_round_id||prior.message!==text||prior.requested_contact_id!==(options.contactId||null))throw Error('Request reference already used.');return {roundId:prior.id,expectedResponses:prior.expected_responses,status:prior.status,replayed:true};}}
  const active=(await q("SELECT id FROM meeting_rounds WHERE meeting_id=$1 AND user_id=$2 AND status IN ('pending','running') FOR UPDATE",[meetingId,user.id]))[0];
  if(active&&!options.interrupt)throw Error('The board is still discussing the previous round. Interrupt to take the floor.');
  if(active)await q("UPDATE meeting_rounds SET status='interrupted',interrupted_at=now(),completed_at=now(),worker_token=NULL,worker_lease_until=NULL WHERE id=$1 AND user_id=$2",[active.id,user.id]);
  const chairmanTurn=(await q('INSERT INTO meeting_turns(id,user_id,meeting_id,speaker,message) VALUES($1,$2,$3,$4,$5) RETURNING *',[uid(),user.id,m.id,user.name,text]))[0];
  await q("UPDATE meetings SET status='in_progress' WHERE id=$1 AND user_id=$2",[m.id,user.id]);
  const round=(await q('INSERT INTO meeting_rounds(id,user_id,world_id,meeting_id,chairman_turn_id,expected_responses,client_request_id,requested_contact_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[uid(),user.id,w.id,m.id,chairmanTurn.id,contacts.length,options.requestId||null,options.contactId||null]))[0];
  await q('UPDATE meeting_turns SET round_id=$1 WHERE id=$2 AND user_id=$3',[round.id,chairmanTurn.id,user.id]);
  if(active){await q('UPDATE meeting_rounds SET interrupted_by=$1 WHERE id=$2 AND user_id=$3',[round.id,active.id,user.id]);await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,w.id,'meeting-interrupted',m.title,'Chairman redirected the discussion; saved responses retained.']);}
  return {roundId:round.id,chairmanTurn,expectedResponses:round.expected_responses,status:round.status};
 });
}
export async function continueBoardDebate(user,meetingId,sourceRoundId){
 return transaction(async q=>{
  const [m]=await q('SELECT * FROM meetings WHERE id=$1 AND user_id=$2 FOR UPDATE',[meetingId,user.id]);
  if(!m||m.status==='concluded')throw Error('Meeting unavailable');
  const [source]=await q('SELECT * FROM meeting_rounds WHERE id=$1 AND meeting_id=$2 AND user_id=$3',[sourceRoundId,meetingId,user.id]);
  if(!source)throw Error('Meeting round unavailable');
  const [prior]=await q('SELECT * FROM meeting_rounds WHERE source_round_id=$1 AND user_id=$2 AND meeting_id=$3',[source.id,user.id,m.id]);
  if(prior)return {roundId:prior.id,status:prior.status,expectedResponses:prior.expected_responses,replayed:true};
  const [latest]=await q('SELECT id FROM meeting_rounds WHERE meeting_id=$1 AND user_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1',[m.id,user.id]);
  if(latest?.id!==source.id||source.status!=='completed'||source.debate_depth>=2)throw Error('Only the latest completed discussion can continue, up to two follow-up rounds.');
  const people=await q('SELECT id FROM contacts WHERE user_id=$1 AND world_id=$2 AND id=ANY($3::uuid[])',[user.id,m.world_id,m.attendees]);
  if(people.length<2)throw Error('At least two executives are required to continue debate.');
  const [round]=await q('INSERT INTO meeting_rounds(id,user_id,world_id,meeting_id,chairman_turn_id,expected_responses,source_round_id,debate_depth) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[uid(),user.id,m.world_id,m.id,source.chairman_turn_id,people.length,source.id,source.debate_depth+1]);
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,m.world_id,'meeting-discussion',m.title,'Executives were invited to continue the debate without a new Chairman statement.']);
  return {roundId:round.id,status:round.status,expectedResponses:round.expected_responses};
 });
}
export async function runMeetingRound(roundId,userId){
 const round=await one('SELECT * FROM meeting_rounds WHERE id=$1 AND user_id=$2',[roundId,userId]);
 if(!round||terminalRound(round.status))return round;
 const claimed=await claimMeetingWorker(userId,roundId);if(!claimed)return;const workerToken=claimed.worker_token;
 try{
  const m=await one('SELECT * FROM meetings WHERE id=$1 AND user_id=$2',[round.meeting_id,userId]);
  const w=await one('SELECT * FROM worlds WHERE id=$1 AND user_id=$2',[round.world_id,userId]);
  const user=await one('SELECT id,name FROM users WHERE id=$1',[userId]);
  if(!m||!w||!user)throw Error('Meeting context unavailable');
  const allContacts=await sql('SELECT * FROM contacts WHERE user_id=$1 AND id=ANY($2::uuid[]) ORDER BY array_position($2::uuid[],id)',[userId,m.attendees]);
  const contacts=selectParticipants(allContacts,round.requested_contact_id);
  if(round.debate_depth%2===1)contacts.reverse();
  const prior=round.source_round_id?await sql('SELECT speaker,message FROM meeting_turns WHERE meeting_id=$1 AND user_id=$2 AND created_at<=$3 AND round_id IS DISTINCT FROM $4 ORDER BY created_at DESC,id DESC LIMIT 24',[m.id,userId,round.created_at,round.id]):await sql('SELECT speaker,message FROM meeting_turns WHERE meeting_id=$1 AND user_id=$2 AND created_at<=(SELECT created_at FROM meeting_turns WHERE id=$3 AND user_id=$2) ORDER BY created_at DESC,id DESC LIMIT 24',[m.id,userId,round.chairman_turn_id]);
  const history=prior.reverse();
  const existing=await sql('SELECT contact_id,speaker,message FROM meeting_turns WHERE round_id=$1 AND user_id=$2 AND contact_id IS NOT NULL ORDER BY created_at,id',[roundId,userId]);
  history.push(...existing.map(x=>({speaker:x.speaker,message:x.message})));
  const completed=new Set(existing.map(x=>x.contact_id));
  let saved=existing.length;
  for(const person of contacts){
   if(completed.has(person.id))continue;
   if(!await renewMeetingWorker(userId,roundId,workerToken))return {id:roundId,status:'superseded'};
   try{
    const context=await characterPrompt(user,person,history.map(turn=>({direction:turn.speaker,body:turn.message})),w);
    const allowInterjection=saved>0&&contacts.length>1&&!round.requested_contact_id;
    const prompt=buildMeetingPrompt({meetingTitle:m.title,empireName:w.name,person,attendees:allContacts,history,followUp:!!round.source_round_id,allowInterjection});
    const reply=await ask(context+' You are a distinct fictional executive in a private board meeting. Be candid, realistic and evidence-led. Keep spoken replies conversational and concise, normally two or three short sentences. Do not invent financial facts or completed actions.',prompt,{fallback:null});
    const parsed=parseMeetingReply(reply,{allowInterjection});if(!parsed)continue;
    const result=await appendMeetingResponse(userId,m.id,roundId,person,parsed.message,workerToken,parsed.deliveryStyle);
    if(result.stopped)return {id:roundId,status:'interrupted'};
    if(result.turn){history.push({speaker:result.turn.speaker,message:result.turn.message});saved=result.saved;completed.add(person.id);}

   }catch(error){console.warn('Board participant response unavailable',person.id,error.name||'error');}
  }
  const finished=await finishMeetingRound(userId,m.id,roundId,null,workerToken);
  if(!finished)return {id:roundId,status:'interrupted'};
  await sql('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),userId,w.id,'meeting-discussion',m.title,(round.source_round_id?'Executive follow-up debate; ':user.name+' addressed the meeting; ')+finished.responses_saved+' of '+finished.expected_responses+' executives responded.']);
  return finished;
 }catch(error){
  await finishMeetingRound(userId,round.meeting_id,roundId,String(error.message||'Meeting workflow failed').slice(0,500),workerToken);
  throw error;
 }
}
export async function meetingRounds(user,meetingId){
 return sql('SELECT id,status,expected_responses,responses_saved,error,created_at,started_at,completed_at,requested_contact_id,interrupted_at,worker_attempts,source_round_id,debate_depth FROM meeting_rounds WHERE meeting_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 5',[meetingId,user.id]);
}
export async function meetingRoundStatus(user,meetingId,roundId){
 return one('SELECT id,status,expected_responses,responses_saved,error,created_at,started_at,completed_at,requested_contact_id,interrupted_at,worker_attempts,source_round_id,debate_depth FROM meeting_rounds WHERE id=$1 AND meeting_id=$2 AND user_id=$3',[roundId,meetingId,user.id]);
}
export async function endMeeting(user,id){
 const m=await one('SELECT * FROM meetings WHERE id=$1 AND user_id=$2',[id,user.id]);if(!m)throw Error('Meeting unavailable');if(m.status==='concluded')return {minutes:m.minutes};
 if(await one("SELECT id FROM meeting_rounds WHERE meeting_id=$1 AND user_id=$2 AND status IN ('pending','running')",[id,user.id]))throw Error('Interrupt or finish the current discussion before concluding.');
 const turns=await sql('SELECT id,speaker,message,contact_id FROM meeting_turns WHERE meeting_id=$1 AND user_id=$2 ORDER BY created_at',[id,user.id]);
 const minutes=await ask('Write sober professional meeting minutes based strictly on these fictional discussion turns. Include agenda, divergent views, decisions (only if made), unresolved matters and follow-ups.',JSON.stringify({title:m.title,turns}),{fallback:m.title+'\n\n'+turns.map(x=>x.speaker+': '+x.message).join('\n\n')});
 return transaction(async q=>{
  const [locked]=await q('SELECT status FROM meetings WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]);if(!locked)throw Error('Meeting unavailable');
  if(locked.status!=='concluded'){const [count]=await q('SELECT count(*)::int n FROM meeting_turns WHERE meeting_id=$1 AND user_id=$2',[id,user.id]);const [activeRound]=await q("SELECT id FROM meeting_rounds WHERE meeting_id=$1 AND user_id=$2 AND status IN ('pending','running')",[id,user.id]);if(activeRound||count.n!==turns.length)throw Error('Discussion changed; conclude again using the latest transcript.');}
  const rows=await q("UPDATE meetings SET minutes=$1,status='concluded' WHERE id=$2 AND user_id=$3 AND status<>'concluded' RETURNING minutes",[minutes,id,user.id]);
  if(!rows.length)return {minutes:(await q('SELECT minutes FROM meetings WHERE id=$1 AND user_id=$2',[id,user.id]))[0].minutes};
  await q('INSERT INTO documents(id,user_id,world_id,title,kind,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,m.world_id,'Minutes — '+m.title,'board minutes',minutes]);
  const attendeeIds=Array.isArray(m.attendees)?m.attendees:[];
  for(const contactId of attendeeIds)await enqueueCharacterMemory(q,{userId:user.id,worldId:m.world_id,contactId,sourceType:'board-meeting',sourceId:id,context:{meetingTitle:m.title,minutes:String(minutes).slice(0,6000),turns:turns.slice(-80).map(t=>({speaker:t.speaker,message:String(t.message).slice(0,1200)}))}});
  return {minutes};
 });
}
export async function recordDecision(user,threadId,content){const t=await one('SELECT * FROM threads WHERE id=$1 AND user_id=$2',[threadId,user.id]);if(!t)throw Error('Matter unavailable');const d=await one('INSERT INTO decisions(id,user_id,world_id,thread_id,content) VALUES($1,$2,$3,$4,$5) RETURNING *',[uid(),user.id,t.world_id,t.id,String(content).slice(0,3500)]);await sql('UPDATE threads SET stage=stage+1,summary=$1,updated_at=now() WHERE id=$2',[`Chairman's direction: ${content}`,t.id]);return d;}
export async function negotiate(user,tenderId,bidId,amount){const b=await one('SELECT b.*,t.world_id FROM bids b JOIN tenders t ON t.id=b.tender_id WHERE b.id=$1 AND t.id=$2 AND t.user_id=$3',[bidId,tenderId,user.id]);if(!b)throw Error('Bid unavailable');const proposed=Number(amount);if(!Number.isFinite(proposed)||proposed<=0)throw Error('Enter a valid amount');await sql('UPDATE bids SET amount=$1,status=$2 WHERE id=$3',[proposed,'counteroffer',b.id]);await sql('INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),user.id,b.world_id,b.contact_id,'negotiation','Counteroffer submitted',`A counteroffer of $${proposed.toLocaleString()} was recorded for commercial discussion.`]);return {reply:'Your counteroffer has been recorded. The counterparty will consider its commercial implications.'};}
export async function prefer(user,tenderId,bidId){const b=await one('SELECT b.id FROM bids b JOIN tenders t ON t.id=b.tender_id WHERE b.id=$1 AND t.id=$2 AND t.user_id=$3',[bidId,tenderId,user.id]);if(!b)throw Error('Bid unavailable');await sql("UPDATE bids SET status='submitted' WHERE tender_id=$1 AND status='preferred'",[tenderId]);await sql("UPDATE bids SET status='preferred' WHERE id=$1",[bidId]);return {ok:true};}
