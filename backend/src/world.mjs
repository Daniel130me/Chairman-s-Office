import {sql,one,transaction,uid,iso} from './db.mjs';
import {ask} from './ai.mjs';
import {parseCallIntent} from '../../lib/executive-intents.mjs';
import {normalizeMailSubject,replyMailSubject} from '../../lib/mail-rules.mjs';
import {scheduleExecutiveCall} from '../../lib/call-workflow.mjs';
import {createVapiActionToken} from '../../lib/vapi-action-token.mjs';
import {economySnapshot} from '../../lib/economy.mjs';
import {employmentSnapshot} from '../../lib/employment.mjs';
import {operationsSnapshot} from '../../lib/operations.mjs';
import {communicationSnapshot,sendWorldMessage} from '../../lib/autonomous-communications.mjs';
import {marketSnapshot} from '../../lib/market-engine.mjs';
import {actionRequestsSnapshot,requestAction} from '../../lib/action-requests.mjs';
import {personalWealthSnapshot} from '../../lib/personal-wealth.mjs';
import {travelSnapshot} from '../../lib/travel.mjs';
import {securitySnapshot} from '../../lib/security.mjs';
import {grantsSnapshot} from '../../lib/philanthropy.mjs';
import {realWorldNewsSnapshot} from '../../lib/real-world-news.mjs';
import {buildMeetingPrompt} from '../../lib/meeting-rules.mjs';
const internal=[['Amara Okafor','Chief of Staff','Measured, perceptive and fiercely discreet','Protect the Chairman’s time and long-term reputation'],['Daniel Mercer','Group CFO','Precise, skeptical and analytically rigorous','Preserve liquidity and challenge weak forecasts'],['Nadia Mensah','Chief Operating Officer','Pragmatic, decisive and direct','Keep subsidiaries performing and execution realistic'],['Julian Hart','General Counsel','Calm, exacting and cautious','Prevent reputational and contractual exposure'],['Sophia Vale','Group Strategy Director','Creative, ambitious and competitive','Pursue defensible expansion opportunities'],['Marcus Reid','Board Chair','Independent and challenging','Ensure accountability and shareholder discipline'],['Grace Okafor','Group Human Resources Director','Empathetic, observant and firm','Build a capable workforce and protect fair employment practices'],['Maya Okoye','Chief Security Officer','Alert, disciplined and discreet','Protect people, information and company assets'],['Rafael Chen','Internal Audit Director','Methodical, independent and evidence-led','Identify control weaknesses and investigate irregularities'],['Tunde Adebayo','Chief Commercial Officer','Persuasive, commercially minded and competitive','Grow customer relationships and improve deal quality']];
const external=[['Aisha Rahman','Managing Partner','Meridian Capital','investor','Sharp and guarded','Earn favorable terms and obtain influence'],['Victor Sloane','CEO','Sloane Meridian Group','rival','Assertive and calculating','Outcompete the Chairman in key sectors'],['Elena Moretti','Founder','Moretti Ventures','friend','Warm but candid','Find joint ventures without sacrificing independence'],['Kwame Bediako','Regional Director','Atlas Infrastructure','partner','Dependable and cautious','Win strategic delivery contracts'],['Isabelle Laurent','Market Analyst','Independent Advisory','adviser','Thoughtful and sometimes contrarian','Help the Chairman see hidden risks'],['Farah Nasser','Managing Director','Sterling Procurement','vendor','Persuasive and opportunistic','Win competitive bids with profitable terms'],['David Okoro','Chief Executive','Northstar Consumer Group','client','Direct and commercially demanding','Secure reliable supply and favorable service levels'],['Priya Nair','Private Banker','Crown Meridian Bank','banker','Discreet and risk-conscious','Grow lending and wealth-management relationships'],['Ruth Mensah','Commissioner','West African Trade Authority','regulator','Formal and evidence-driven','Ensure compliance and protect public confidence'],['Daniel Brooks','Investigations Editor','The Continental Ledger','journalist','Persistent and skeptical','Publish stories that withstand scrutiny'],['Omar Haddad','Founder and CEO','Helix Industrial Systems','competitor','Ambitious and highly competitive','Win market share and recruit scarce talent'],['Grace Osei','Managing Director','Osei Global Supply','supplier','Practical and price-sensitive','Secure long-term procurement contracts'],['Samuel Dube','Chairman','Dube Ventures','friend','Sociable but strategically cautious','Build trusted business relationships'],['Alex Chen','General Partner','Summit Frontier Partners','investor','Analytical and impatient','Find high-growth investments with governance discipline']];
const scenarios=[['Strategic acquisition opportunity','A privately held competitor may be available at an attractive valuation. Finance wants diligence before any commitment.','strategy','high'],['Treasury and liquidity outlook','The CFO is reviewing cash reserves against an accelerated expansion plan.','finance','normal'],['Board governance review','The board has requested a clear explanation of execution risks and capital allocation.','board','high'],['New regional partnership','A cross-border partner has proposed commercial collaboration with meaningful upside and operational dependencies.','deal','normal'],['Reputation and stakeholder confidence','External stakeholders are watching how the group responds to shifting market conditions.','risk','normal']];
function first(s){return s.split(' ')[0];}
export async function createWorld(user,data){const name=String(data.name||'Aurelius Holdings').trim().slice(0,95),region=String(data.region||'Lagos, Nigeria').slice(0,100),timezone=String(data.timezone||'Africa/Lagos').slice(0,60),sectors=(Array.isArray(data.sectors)?data.sectors:['Technology','Finance','Infrastructure']).map(x=>String(x).slice(0,55)).slice(0,6),chief=String(data.chief||'Amara Okafor').slice(0,80),style=String(data.style||'balanced').slice(0,35);if(!name||!sectors.length)throw Error('Set a holding company and at least one sector.');try{new Intl.DateTimeFormat('en',{timeZone:timezone});}catch{throw Error('Invalid time zone');}
return transaction(async q=>{if((await q('SELECT id FROM worlds WHERE user_id=$1',[user.id])).length)throw Error('Your empire is already established.');const wid=uid();const valuation=3500000000;await q('INSERT INTO worlds(id,user_id,name,region,timezone,sectors,chief,style,valuation) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[wid,user.id,name,region,timezone,JSON.stringify(sectors),chief,style,valuation]);await q('INSERT INTO settings(user_id) VALUES($1)',[user.id]);const companies=[];for(let i=0;i<Math.min(4,sectors.length);i++){const cid=uid();const company={id:cid,name:`${name.replace(/\s+(holdings|group|international)$/i,'')} ${sectors[i]} ${i===0?'Limited':'Group'}`,sector:sectors[i],valuation:valuation/(i+2),cash:190000000/(i+1),revenue:390000000/(i+1)};companies.push(company);await q('INSERT INTO companies(id,user_id,world_id,name,sector,valuation,cash,revenue) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[cid,user.id,wid,company.name,company.sector,company.valuation,company.cash,company.revenue]);}
const contacts=[];for(const [idx,entry] of [...internal,...external].entries()){const isIn=idx<internal.length;const [name0,title,a,b,c,d]=entry;const cname=idx===0?chief:name0;const co=isIn?name:a;const id=uid();contacts.push({id,name:cname,title,company:co});await q('INSERT INTO contacts(id,user_id,world_id,name,title,company,kind,relationship,temperament,agenda,trust) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[id,user.id,wid,cname,title,co,isIn?'internal':b,isIn?'executive':b,isIn?a:c,isIn?b:d,isIn?75:54]);}
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
for(let i=0;i<scenarios.length;i++){const [title,summary,category,priority]=scenarios[i],id=uid(),actor=contacts[(i+1)%contacts.length];await q('INSERT INTO threads(id,user_id,world_id,company_id,contact_id,title,category,summary,priority) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,user.id,wid,companies[i%companies.length].id,actor.id,title,category,summary,priority]);await q('INSERT INTO events(id,user_id,world_id,thread_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[uid(),user.id,wid,id,actor.id,'briefing',title,summary]);}
const greeting=`Good morning, ${user.name}. Your office is established. Your leadership team is waiting, and the first matters are on your desk. I would like to brief you personally before the day begins.`;await q('INSERT INTO messages(id,user_id,world_id,contact_id,direction,channel,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),user.id,wid,contacts[0].id,'incoming','chat',greeting]);await q('INSERT INTO invites(id,user_id,world_id,contact_id,kind,subject,preview,due_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval \'20 seconds\')',[uid(),user.id,wid,contacts[0].id,'welcome',`Incoming call · ${chief}`,'Your chief of staff would like to welcome you personally.']);await q('INSERT INTO documents(id,user_id,world_id,title,kind,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,wid,'Chairman’s First Executive Brief','briefing',`CONFIDENTIAL — CHAIRMAN’S OFFICE\n\nGroup: ${name}\nHeadquarters: ${region}\nPortfolio: ${sectors.join(', ')}\n\nFirst priorities:\n• Meet the leadership team\n• Review treasury and growth strategy\n• Establish board reporting cadence\n• Evaluate the acquisition proposal`]);const tid=uid();await q('INSERT INTO tenders(id,user_id,world_id,title,budget) VALUES($1,$2,$3,$4,$5)',[tid,user.id,wid,'Regional technology modernization programme',24000000]);for(const [j,c] of contacts.slice(-3).entries())await q('INSERT INTO bids(id,user_id,tender_id,contact_id,amount,weeks,quality,risk) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[uid(),user.id,tid,c.id,22000000+j*1700000,14+j*4,86-j*7,j?'moderate':'low']);return {id:wid,name,region,timezone,sectors,chief,style};});}
export async function state(userId){const world=await one('SELECT * FROM worlds WHERE user_id=$1',[userId]);if(!world)return null;const tables=['companies','contacts','threads','events','messages','meetings','meeting_turns','documents','decisions','invites','calls','tenders','bids'];const outputs=await Promise.all(tables.map(t=>sql(`SELECT * FROM ${t} WHERE user_id=$1 ORDER BY ${t==='calls'?'started_at':'created_at'} DESC LIMIT 400`,[userId])));const data=Object.fromEntries(tables.map((t,i)=>[t,outputs[i]]));data.meetings=data.meetings.map(m=>({...m,attendees:m.attendees||[]}));data.tenders=data.tenders.map(t=>({...t,bids:data.bids.filter(b=>b.tender_id===t.id)}));data.settings=await one('SELECT * FROM settings WHERE user_id=$1',[userId]);const economy=await economySnapshot(userId);data.companies=economy.companies;const employees=await employmentSnapshot(userId);const operations=await operationsSnapshot(userId);const communications=await communicationSnapshot(userId);const market=await marketSnapshot(userId);const actionRequests=await actionRequestsSnapshot(userId);const wealth=await personalWealthSnapshot(userId);const travel=await travelSnapshot(userId);const security=await securitySnapshot(userId);const grants=await grantsSnapshot(userId);const realWorldNews=await realWorldNewsSnapshot(userId);return {world,...data,economy,employees,operations,...communications,...market,actionRequests,...wealth,...travel,...security,grants,realWorldNews};}
async function characterPrompt(user,contact,history,world){
  const economy=contact.kind==='internal'&&['Group CFO','Chief Operating Officer','Chief of Staff'].includes(contact.title)?await economySnapshot(user.id):null;
  const assigned=await sql("SELECT title,detail,status,outcome FROM business_tasks WHERE user_id=$1 AND assignee_id=$2 ORDER BY created_at DESC LIMIT 10",[user.id,contact.id]);
  const signals=await sql('SELECT signal_key,label,value,unit,source_name,source_url,observed_at FROM real_world_signals WHERE user_id=$1 ORDER BY observed_at DESC LIMIT 20',[user.id]);
  const news=await realWorldNewsSnapshot(user.id,8);
  return [
    'You are '+contact.name+', '+contact.title+' at '+contact.company+' in the Chairman’s Office, an immersive fictional executive world.',
    'The Chairman is '+user.name+', leading '+world.name+' in '+world.region+'.',
    'Your name and identity are exactly '+contact.name+'. The executive directory is the source of truth. Never claim your name is Amara unless your directory name is Amara. Never replace your identity with another character’s name.',
    'This is a fictional business world, but your role, relationships, commitments and actions inside it are persistent and consequential. Never break character by saying you cannot call or coordinate with colleagues because the world is simulated.',
    'Do not claim real-world external actions occurred. You may complete supported actions inside the Chairman’s Office experience and must rely on their actual tool results before confirming success.',
    'You have your own incentives, knowledge, pride, human flaws and commitments. Temperament: '+contact.temperament+'. Personal agenda: '+contact.agenda+'. Trust: '+contact.trust+'/100; tension: '+contact.tension+'/100.',
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
  sql('SELECT id,name,sector FROM companies WHERE user_id=$1',[user.id]),
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

  if(sourceCallId&&!await one("SELECT id FROM calls WHERE id=$1 AND user_id=$2 AND world_id=$3 AND contact_id=$4 AND status='missed'",[sourceCallId,user.id,w.id,c.id]))throw Error('Call unavailable');
  const outgoingId=uid();
  await sql('INSERT INTO messages(id,user_id,world_id,contact_id,direction,channel,body,source_call_id,subject) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[outgoingId,user.id,w.id,c.id,'outgoing',sourceCallId?'missed-call':channel,body,sourceCallId,mailSubject]);
  const history=(await sql('SELECT direction,body FROM messages WHERE user_id=$1 AND contact_id=$2 ORDER BY created_at DESC LIMIT 12',[user.id,c.id])).reverse();
  const intent=parseCallIntent(body);
  let reply;

  if(intent?.clarification){
    reply=intent.clarification;
  }else if(intent){
    try{
      const action=await scheduleExecutiveCall({
        userId:user.id,
        worldId:w.id,
        recipient:intent.recipient,
        defaultContactId:c.id,
        delaySeconds:intent.delaySeconds,
        kind:intent.kind,
        reason:body
      });
      if(intent.kind==='assistant-callback'){
        const delay=action.delaySeconds;
        const when=delay<60?delay+' seconds':delay%60===0?(delay/60)+' minutes':Math.floor(delay/60)+' minutes and '+(delay%60)+' seconds';
        reply='Of course, Chairman. I have scheduled my callback for '+when+'. It will arrive on your executive line.';
      }else if(action.delaySeconds===0){
        reply='Certainly, Chairman. I have asked '+action.contact.name+', our '+action.contact.title+', to call you. Their incoming call will appear on your executive line once this conversation ends.';
      }else{
        const delay=action.delaySeconds;
        const when=delay<60?delay+' seconds':delay%60===0?(delay/60)+' minutes':Math.floor(delay/60)+' minutes and '+(delay%60)+' seconds';
        reply='Certainly, Chairman. I have arranged for '+action.contact.name+', our '+action.contact.title+', to call you in '+when+'.';
      }
    }catch(error){
      reply='I could not arrange that call just now. '+String(error?.message||'Please try again.');
    }
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

  if(!reply)return {reply:null,delivery:'saved-no-reply'};
  await sql('INSERT INTO messages(id,user_id,world_id,contact_id,direction,channel,body,subject) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[uid(),user.id,w.id,c.id,'incoming',channel,reply,channel==='email'?replyMailSubject(mailSubject):null]);
  await sql('UPDATE contacts SET last_contact_at=now() WHERE id=$1',[c.id]);
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
export async function finishCall(user,id,transcript,status='completed'){const call=await one('SELECT * FROM calls WHERE id=$1 AND user_id=$2',[id,user.id]);if(!call)throw Error('Call unavailable');if(call.status!=='active')return {summary:call.summary};const rows=Array.isArray(transcript)?transcript.filter(x=>x&&typeof x==='object').slice(0,150).map(x=>({role:String(x.role||'speaker').slice(0,30),text:String(x.text||'').slice(0,3000)})):[];const summary=await ask('Summarize this fictional executive conversation precisely: decisions, commitments, risks, follow-ups. Do not invent facts.',JSON.stringify(rows),{fallback:rows.map(r=>`${r.role}: ${r.text}`).join(' ').slice(0,1500)||'Call completed; no transcript available.'});const updated=await one("UPDATE calls SET ended_at=now(),status=$4,transcript=$1,summary=$2 WHERE id=$3 AND user_id=$5 AND status='active' RETURNING summary",[JSON.stringify(rows),summary,id,status==='failed'?'failed':'completed',user.id]);return {summary:updated?.summary??(await one('SELECT summary FROM calls WHERE id=$1 AND user_id=$2',[id,user.id]))?.summary};}
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
export async function meetingSpeak(user,meetingId,text){
 const w=await one('SELECT * FROM worlds WHERE user_id=$1',[user.id]);if(!w)throw Error('Empire unavailable');
 const m=await one('SELECT * FROM meetings WHERE id=$1 AND user_id=$2',[meetingId,user.id]);if(!m||m.status==='concluded')throw Error('Meeting unavailable');
 const contacts=await sql('SELECT id FROM contacts WHERE user_id=$1 AND id=ANY($2::uuid[]) ORDER BY array_position($2::uuid[],id)',[user.id,m.attendees]);
 if(!contacts.length)throw Error('No participants');
 text=String(text||'What are your assessments of the situation?').trim().slice(0,3000);
 return transaction(async q=>{
  const locked=(await q('SELECT id,status FROM meetings WHERE id=$1 AND user_id=$2 FOR UPDATE',[meetingId,user.id]))[0];
  if(!locked||locked.status==='concluded')throw Error('Meeting unavailable');
  const active=(await q("SELECT id FROM meeting_rounds WHERE meeting_id=$1 AND user_id=$2 AND status IN ('pending','running') FOR UPDATE",[meetingId,user.id]))[0];
  if(active)throw Error('The board is still discussing the previous round. Wait for it to finish before speaking again.');
  const chairmanTurn=(await q('INSERT INTO meeting_turns(id,user_id,meeting_id,speaker,message) VALUES($1,$2,$3,$4,$5) RETURNING *',[uid(),user.id,m.id,user.name,text]))[0];
  await q("UPDATE meetings SET status='in_progress' WHERE id=$1 AND user_id=$2",[m.id,user.id]);
  const round=(await q('INSERT INTO meeting_rounds(id,user_id,world_id,meeting_id,chairman_turn_id,expected_responses) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[uid(),user.id,w.id,m.id,chairmanTurn.id,contacts.length]))[0];
  await q('UPDATE meeting_turns SET round_id=$1 WHERE id=$2 AND user_id=$3',[round.id,chairmanTurn.id,user.id]);
  return {roundId:round.id,chairmanTurn,expectedResponses:round.expected_responses,status:round.status};
 });
}
export async function runMeetingRound(roundId,userId){
 const round=await one('SELECT * FROM meeting_rounds WHERE id=$1 AND user_id=$2',[roundId,userId]);
 if(!round||['completed','partial','failed'].includes(round.status))return round;
 await sql("UPDATE meeting_rounds SET status='running',started_at=coalesce(started_at,now()) WHERE id=$1 AND user_id=$2",[roundId,userId]);
 try{
  const m=await one('SELECT * FROM meetings WHERE id=$1 AND user_id=$2',[round.meeting_id,userId]);
  const w=await one('SELECT * FROM worlds WHERE id=$1 AND user_id=$2',[round.world_id,userId]);
  const user=await one('SELECT id,name FROM users WHERE id=$1',[userId]);
  if(!m||!w||!user)throw Error('Meeting context unavailable');
  const contacts=await sql('SELECT * FROM contacts WHERE user_id=$1 AND id=ANY($2::uuid[]) ORDER BY array_position($2::uuid[],id)',[userId,m.attendees]);
  const prior=await sql('SELECT speaker,message FROM meeting_turns WHERE meeting_id=$1 AND user_id=$2 AND created_at<=(SELECT created_at FROM meeting_turns WHERE id=$3 AND user_id=$2) ORDER BY created_at DESC LIMIT 24',[m.id,userId,round.chairman_turn_id]);
  const history=prior.reverse();
  const existing=await sql('SELECT contact_id FROM meeting_turns WHERE round_id=$1 AND user_id=$2 AND contact_id IS NOT NULL',[roundId,userId]);
  const completed=new Set(existing.map(x=>x.contact_id));
  let saved=existing.length;
  for(const person of contacts){
   if(completed.has(person.id))continue;
   try{
    const context=await characterPrompt(user,person,history.map(turn=>({direction:turn.speaker,body:turn.message})),w);
    const prompt=buildMeetingPrompt({meetingTitle:m.title,empireName:w.name,person,attendees:contacts,history});
    const reply=await ask(context+' You are a distinct fictional executive in a private board meeting. Be candid, realistic and evidence-led. Do not invent financial facts or completed actions.',prompt,{fallback:null});
    if(!reply||typeof reply!=='string'||!reply.trim())continue;
    const message=reply.trim().slice(0,1800);
    const inserted=await one('INSERT INTO meeting_turns(id,user_id,meeting_id,contact_id,speaker,message,round_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(round_id,contact_id) WHERE round_id IS NOT NULL AND contact_id IS NOT NULL DO NOTHING RETURNING id',[uid(),userId,m.id,person.id,person.name,message,roundId]);
    if(!inserted){const priorTurn=await one('SELECT speaker,message FROM meeting_turns WHERE round_id=$1 AND contact_id=$2',[roundId,person.id]);if(priorTurn){history.push(priorTurn);saved++;completed.add(person.id);}continue;}
    history.push({speaker:person.name,message});saved++;completed.add(person.id);
    await sql('UPDATE meeting_rounds SET responses_saved=$1 WHERE id=$2 AND user_id=$3',[saved,roundId,userId]);
   }catch(error){console.warn('Board participant response unavailable',person.id,error.name||'error');}
  }
  const status=saved>=contacts.length?'completed':'partial';
  await sql('UPDATE meeting_rounds SET status=$1,responses_saved=$2,completed_at=now(),error=NULL WHERE id=$3 AND user_id=$4',[status,saved,roundId,userId]);
  await sql('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),userId,w.id,'meeting-discussion',m.title,user.name+' addressed the meeting; '+saved+' of '+contacts.length+' executives responded in sequence.']);
  return {id:roundId,status,responses_saved:saved,expected_responses:contacts.length};
 }catch(error){
  await sql("UPDATE meeting_rounds SET status='failed',error=$1,completed_at=now() WHERE id=$2 AND user_id=$3",[String(error.message||'Meeting workflow failed').slice(0,500),roundId,userId]);
  throw error;
 }
}
export async function meetingRounds(user,meetingId){
 return sql('SELECT id,status,expected_responses,responses_saved,error,created_at,started_at,completed_at FROM meeting_rounds WHERE meeting_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 5',[meetingId,user.id]);
}
export async function meetingRoundStatus(user,meetingId,roundId){
 return one('SELECT id,status,expected_responses,responses_saved,error,created_at,started_at,completed_at FROM meeting_rounds WHERE id=$1 AND meeting_id=$2 AND user_id=$3',[roundId,meetingId,user.id]);
}
export async function endMeeting(user,id){const m=await one('SELECT * FROM meetings WHERE id=$1 AND user_id=$2',[id,user.id]);if(!m)throw Error('Meeting unavailable');if(m.status==='concluded')return {minutes:m.minutes};const t=await sql('SELECT speaker,message FROM meeting_turns WHERE meeting_id=$1 AND user_id=$2 ORDER BY created_at',[id,user.id]);const minutes=await ask('Write sober professional meeting minutes based strictly on these fictional discussion turns. Include agenda, divergent views, decisions (only if made), unresolved matters and follow-ups.',JSON.stringify({title:m.title,turns:t}),{fallback:`${m.title}\n\n${t.map(x=>x.speaker+': '+x.message).join('\n\n')}`});return transaction(async q=>{
  const rows=await q("UPDATE meetings SET minutes=$1,status='concluded' WHERE id=$2 AND user_id=$3 AND status<>'concluded' RETURNING minutes",[minutes,id,user.id]);
  if(!rows.length)return {minutes:(await q('SELECT minutes FROM meetings WHERE id=$1 AND user_id=$2',[id,user.id]))[0].minutes};
  await q('INSERT INTO documents(id,user_id,world_id,title,kind,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,m.world_id,`Minutes — ${m.title}`,'board minutes',minutes]);return {minutes};
});}
export async function recordDecision(user,threadId,content){const t=await one('SELECT * FROM threads WHERE id=$1 AND user_id=$2',[threadId,user.id]);if(!t)throw Error('Matter unavailable');const d=await one('INSERT INTO decisions(id,user_id,world_id,thread_id,content) VALUES($1,$2,$3,$4,$5) RETURNING *',[uid(),user.id,t.world_id,t.id,String(content).slice(0,3500)]);await sql('UPDATE threads SET stage=stage+1,summary=$1,updated_at=now() WHERE id=$2',[`Chairman's direction: ${content}`,t.id]);return d;}
export async function negotiate(user,tenderId,bidId,amount){const b=await one('SELECT b.*,t.world_id FROM bids b JOIN tenders t ON t.id=b.tender_id WHERE b.id=$1 AND t.id=$2 AND t.user_id=$3',[bidId,tenderId,user.id]);if(!b)throw Error('Bid unavailable');const proposed=Number(amount);if(!Number.isFinite(proposed)||proposed<=0)throw Error('Enter a valid amount');await sql('UPDATE bids SET amount=$1,status=$2 WHERE id=$3',[proposed,'counteroffer',b.id]);await sql('INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),user.id,b.world_id,b.contact_id,'negotiation','Counteroffer submitted',`A counteroffer of $${proposed.toLocaleString()} was recorded for commercial discussion.`]);return {reply:'Your counteroffer has been recorded. The counterparty will consider its commercial implications.'};}
export async function prefer(user,tenderId,bidId){const b=await one('SELECT b.id FROM bids b JOIN tenders t ON t.id=b.tender_id WHERE b.id=$1 AND t.id=$2 AND t.user_id=$3',[bidId,tenderId,user.id]);if(!b)throw Error('Bid unavailable');await sql("UPDATE bids SET status='submitted' WHERE tender_id=$1 AND status='preferred'",[tenderId]);await sql("UPDATE bids SET status='preferred' WHERE id=$1",[bidId]);return {ok:true};}
