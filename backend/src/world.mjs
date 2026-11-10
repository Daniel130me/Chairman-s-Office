import { id, now, insert, get, all, run, decode, audit } from './db.mjs';
import { askAI, parseJSON } from './ai.mjs';

const DAY=86400000;
const names={chief:'Amara Okafor',cfo:'David Williams',coo:'Sarah Mensah',legal:'Victoria Cole',board:'Dr. Hassan Adeyemi',mentor:'Alexander Morgan',rival:'Rebecca Chen',vendor:'Ibrahim Bello',investor:'Grace Tan',client:'Michael Brooks'};
const sectorIdeas={
 technology:['Enterprise software expansion','A major enterprise customer is evaluating a multi-year platform contract. Product capacity and security assurances need review.','Commercial contract'],
 finance:['Regional credit expansion','Risk and treasury teams disagree over the capital required for a proposed regional lending expansion.','Capital allocation'],
 agriculture:['Export and processing investment','The export unit has a prospective purchase agreement, but cold-chain capacity could affect delivery reliability.','Supply chain'],
 healthcare:['Healthcare facility expansion','A new specialty clinic proposal offers growth but requires staffing, equipment and governance review.','Capital allocation'],
 logistics:['Distribution network acquisition','An acquisition could improve last-mile coverage, though the target has uncertain fleet maintenance liabilities.','Acquisition'],
 energy:['Renewable energy project','A solar infrastructure opportunity has attractive projections but unclear long-term offtake commitments.','Investment'],
 realestate:['Mixed-use development review','A development partnership offers strong projected rental income, but land and planning documentation remain incomplete.','Development'],
 manufacturing:['Plant modernization tender','Two equipment suppliers propose different schedules and maintenance guarantees for an aging production line.','Procurement'],
 aviation:['Fleet expansion assessment','A proposed aircraft lease could open new routes but carries significant utilization and currency risks.','Fleet strategy'],
 retail:['Regional retail expansion','Management recommends opening new stores; Finance wants evidence of location-level profitability.','Expansion'],
 media:['Content licensing negotiation','An international content partnership could accelerate reach but contains costly minimum guarantees.','Licensing'],
 education:['Education platform expansion','An institutional rollout promises scale but requires infrastructure and training investment.','Expansion'],
 hospitality:['Premium hotel partnership','A hotel-management partner is offering a joint venture with performance guarantees to review.','Joint venture']
};
const samples=[...Object.keys(sectorIdeas)];
export function cleanSector(s){return String(s||'').toLowerCase().replace(/[^a-z]/g,'').slice(0,32)||'technology';}
export function ideaFor(s){return sectorIdeas[cleanSector(s)]||[`${String(s).replace(/^./,x=>x.toUpperCase())} growth initiative`,`Management has presented a new ${s} opportunity. The team needs to evaluate commercial potential, operations, and financing before proceeding.`,'Strategy'];}
function contact(db,userId,worldId,{name,title,company,kind,relationship,temperament,agenda,trust=60}){
 const c={id:id(),user_id:userId,world_id:worldId,name,title,company,kind,relationship,temperament,agenda,trust,availability:'available',voice_id:null,vapi_assistant_id:null,last_contact_at:null,created_at:now()};insert(db,'contacts',c);return c;
}
function event(db,u,w,kind,title,body,threadId=null,contactId=null){const e={id:id(),user_id:u,world_id:w,thread_id:threadId,contact_id:contactId,kind,title,body,created_at:now()};insert(db,'events',e);return e;}
function message(db,u,w,c,body,direction='incoming',channel='message') {const m={id:id(),user_id:u,world_id:w,contact_id:c,direction,channel,body,created_at:now()};insert(db,'messages',m);return m;}
function document(db,u,w,threadId,contactId,title,kind,body){const d={id:id(),user_id:u,world_id:w,thread_id:threadId,contact_id:contactId,title,kind,body,created_at:now()};insert(db,'documents',d);return d;}
function invite(db,u,w,c,kind,subject,preview,offsetMs=0,threadId=null){const i={id:id(),user_id:u,world_id:w,contact_id:c,thread_id:threadId,kind,subject,preview,due_at:new Date(Date.now()+offsetMs).toISOString(),status:'pending',created_at:now()};insert(db,'invites',i);return i;}
function thread(db,u,w,company,cont,title,category,summary,priority='normal') {
 const t={id:id(),user_id:u,world_id:w,company_id:company,contact_id:cont,title,category,summary,stage:0,status:'open',priority,next_at:new Date(Date.now()+15*60000).toISOString(),created_at:now(),updated_at:now()};insert(db,'threads',t);return t;
}

export function setupWorld(db,user,values){
 if(get(db,'SELECT id FROM worlds WHERE user_id=?',user.id))throw new Error('This account already has an empire.');
 const name=String(values.name||'').trim().slice(0,90),region=String(values.region||'Lagos, Nigeria').trim().slice(0,100),timezone=String(values.timezone||'Africa/Lagos').trim();
 if(name.length<3)throw new Error('Please enter a holding-company name.');
 try{new Intl.DateTimeFormat('en',{timeZone:timezone});}catch{throw new Error('Invalid timezone.');}
 const raw=Array.isArray(values.sectors)?values.sectors:[], sectors=[...new Set(raw.map(cleanSector))].slice(0,6);
 if(!sectors.length)throw new Error('Choose at least one industry.');
 const world={id:id(),user_id:user.id,name,region,timezone,sectors:JSON.stringify(sectors),chief:String(values.chief||names.chief).trim().slice(0,70)||names.chief,valuation:sectors.length*240000000+850000000,last_tick:now(),created_at:now()};
 db.exec('BEGIN');
 try{
  insert(db,'worlds',world);
  insert(db,'settings',{user_id:user.id,morning:'07:30',evening:'19:00',quiet_start:'21:00',quiet_end:'07:00',max_daily:3,urgent:1,notifications:1});
  const companies=sectors.map((s,i)=>{
   const corporation=values.companies?.[i]||`${name.replace(/(Holdings|Group|International|Global)/ig,'').trim()} ${s[0].toUpperCase()+s.slice(1)}`;
   const c={id:id(),user_id:user.id,world_id:world.id,name:String(corporation).slice(0,110),sector:s,valuation:240000000+i*48000000,cash:56000000+i*6100000,revenue:43000000+i*7200000,created_at:now()};insert(db,'companies',c);return c;
  });
  const internal=[
   {name:world.chief,title:'Chief of Staff',company:name,kind:'internal',relationship:'trusted executive',temperament:'composed, discreet, concise, resourceful',agenda:'Protect the Chairman’s time and coordinate executive action.',trust:90},
   {name:names.cfo,title:'Group Chief Financial Officer',company:name,kind:'internal',relationship:'senior finance executive',temperament:'cautious, evidence-led, firm',agenda:'Preserve capital and challenge questionable investments.',trust:79},
   {name:names.coo,title:'Group Chief Operating Officer',company:name,kind:'internal',relationship:'operations leader',temperament:'decisive, grounded, sometimes impatient',agenda:'Deliver results and unblock operational teams.',trust:75},
   {name:names.legal,title:'Group Legal Counsel',company:name,kind:'internal',relationship:'legal adviser',temperament:'precise, skeptical, ethical',agenda:'Protect the group from legal and compliance risk.',trust:82},
   {name:names.board,title:'Independent Board Director',company:name,kind:'internal',relationship:'board director',temperament:'wise, candid, challenging',agenda:'Question management assumptions and defend long-term value.',trust:71}
  ].map(c=>contact(db,user.id,world.id,c));
  const external=[
   {name:names.mentor,title:'Chairman & Investor',company:'Westbridge Capital',kind:'friend',relationship:'long-standing business friend',temperament:'warm, blunt, strategic',agenda:'Share opportunities, protect reputation, seek mutually beneficial deals.',trust:80},
   {name:names.rival,title:'Chief Executive Officer',company:'Northbridge Industries',kind:'competitor',relationship:'respected industry rival',temperament:'polished, highly competitive',agenda:'Win contracts and market share; sometimes consider alliances.',trust:42},
   {name:names.vendor,title:'Managing Director',company:'Atlas Engineering',kind:'bidder',relationship:'supplier and bidder',temperament:'persuasive, technical, pragmatic',agenda:'Win contracts, negotiate terms, protect margins.',trust:58},
   {name:names.investor,title:'Managing Partner',company:'Eastline Investments',kind:'investor',relationship:'potential co-investor',temperament:'analytical, direct, ambitious',agenda:'Find strong returns with appropriate protections.',trust:59},
   {name:names.client,title:'Chief Procurement Officer',company:'Horizon Enterprises',kind:'client',relationship:'prospective enterprise customer',temperament:'demanding, fair, cost-conscious',agenda:'Secure delivery commitments and competitive terms.',trust:64}
  ].map(c=>contact(db,user.id,world.id,c));
  companies.forEach((c,i)=>{
   const [title,summary,category]=ideaFor(c.sector),actor=internal[i%2===0?1:2];
   const t=thread(db,user.id,world.id,c.id,actor.id,title,category,summary,i===0?'high':'normal');
   document(db,user.id,world.id,t.id,actor.id,`${title} — Management Brief`,'brief',`EXECUTIVE BRIEFING\n${c.name}\n\nSituation: ${summary}\n\nRequested consideration: strategic rationale, projected return, risk exposure, implementation capacity, and alternatives.\n\nThis is a fictional management proposal. Figures are initial assumptions, not audited accounts.`);
   if(i===0){
    const m={id:id(),user_id:user.id,world_id:world.id,thread_id:t.id,title:`Board review: ${title}`,start_at:new Date(Date.now()+2*60*60000).toISOString(),duration_minutes:35,attendees:JSON.stringify(internal.slice(1).map(x=>x.id)),status:'scheduled',minutes:null,created_at:now()}; insert(db,'meetings',m);
   }
  });
  const t=thread(db,user.id,world.id,companies[0].id,external[2].id,`Tender: ${companies[0].sector} facilities and systems`,'Procurement',`The procurement committee has invited competing suppliers to deliver an improvement programme for ${companies[0].name}.`, 'normal');
  const tender={id:id(),user_id:user.id,world_id:world.id,company_id:companies[0].id,thread_id:t.id,title:`${companies[0].name} — Facility & Systems Tender`,budget:9500000,status:'open',created_at:now()}; insert(db,'tenders',tender);
  for(const [ci,amount,weeks,q,risk] of [[external[2],8200000,18,83,'Medium: longer warranty exclusions'],[external[3],8950000,14,90,'Low: strong technical record'],[external[1],7200000,24,67,'High: uncertain delivery capacity']]){insert(db,'bids',{id:id(),user_id:user.id,tender_id:tender.id,contact_id:ci.id,amount,weeks,quality:q,risk,status:'submitted'});}
  message(db,user.id,world.id,external[0].id,`Congratulations on your new chapter. Let's catch up soon—there are a few opportunities worth discussing.`);
  insert(db,'meetings',{id:id(),user_id:user.id,world_id:world.id,thread_id:null,title:'Private industry leaders luncheon',start_at:new Date(Date.now()+2*DAY).toISOString(),duration_minutes:50,attendees:JSON.stringify([external[0].id,external[3].id]),status:'scheduled',minutes:null,created_at:now()});
  message(db,user.id,world.id,internal[0].id,`Good day, Chairman. I have established your executive office and briefed the leadership team. Your first portfolio review is ready.`);
  message(db,user.id,world.id,internal[1].id,`Chairman, attached in your Documents library is our initial management brief. I would welcome your review of its projected risks before tomorrow's board discussion.`, 'incoming', 'email');
  message(db,user.id,world.id,external[2].id,`Chairman, our tender proposal is ready. I'd appreciate the opportunity to clarify our delivery timeline and technical guarantees.`);
  event(db,user.id,world.id,'welcome','Executive office established',`${world.name} now has ${companies.length} active subsidiaries, a leadership team and external professional network.`);
  invite(db,user.id,world.id,internal[0].id,'welcome','Your first executive briefing',`Good day, Chairman. ${world.chief} has prepared your initial agenda.`,90000);
  invite(db,user.id,world.id,external[0].id,'network','A business associate requests a call',`${external[0].name} has heard of a business opportunity and would like to speak directly.`,8*60000);
  audit(db,user.id,'world_created',{worldId:world.id,sectors});
  db.exec('COMMIT');return world;
 }catch(e){db.exec('ROLLBACK');throw e;}
}

export function snapshot(db,userId){
 const world=get(db,'SELECT * FROM worlds WHERE user_id=?',userId); if(!world)return null;
 const w=world.id;
 return {world:{...world,sectors:decode(world.sectors,[])},
  companies:all(db,'SELECT * FROM companies WHERE user_id=? AND world_id=? ORDER BY name',userId,w),
  contacts:all(db,'SELECT * FROM contacts WHERE user_id=? AND world_id=? ORDER BY kind,name',userId,w),
  threads:all(db,'SELECT * FROM threads WHERE user_id=? AND world_id=? ORDER BY CASE priority WHEN \'urgent\' THEN 0 WHEN \'high\' THEN 1 ELSE 2 END, updated_at DESC',userId,w),
  events:all(db,'SELECT * FROM events WHERE user_id=? AND world_id=? ORDER BY created_at DESC LIMIT 50',userId,w),
  messages:all(db,'SELECT * FROM messages WHERE user_id=? AND world_id=? ORDER BY created_at DESC LIMIT 120',userId,w),
  meetings:all(db,'SELECT * FROM meetings WHERE user_id=? AND world_id=? ORDER BY start_at DESC LIMIT 50',userId,w).map(x=>({...x,attendees:decode(x.attendees,[])})),
  documents:all(db,'SELECT * FROM documents WHERE user_id=? AND world_id=? ORDER BY created_at DESC LIMIT 70',userId,w),
  tenders:all(db,'SELECT * FROM tenders WHERE user_id=? AND world_id=? ORDER BY created_at DESC',userId,w).map(x=>({...x,bids:all(db,'SELECT * FROM bids WHERE tender_id=? AND user_id=?',x.id,userId)})),
  decisions:all(db,'SELECT * FROM decisions WHERE user_id=? AND world_id=? ORDER BY created_at DESC LIMIT 80',userId,w),
  invites:all(db,'SELECT * FROM invites WHERE user_id=? AND world_id=? ORDER BY created_at DESC LIMIT 30',userId,w),
  calls:all(db,'SELECT * FROM calls WHERE user_id=? AND world_id=? ORDER BY started_at DESC LIMIT 30',userId,w).map(x=>({...x,transcript:decode(x.transcript,[])})),
  settings:get(db,'SELECT * FROM settings WHERE user_id=?',userId),
  unread: get(db,"SELECT COUNT(*) n FROM invites WHERE user_id=? AND status IN ('pending','notified')",userId)?.n||0};
}

const suffixes=['Management has completed a preliminary review. The opportunity remains attractive, but the risk assessment needs the Chairman’s direction.','A competitor has adjusted its offer. Management recommends examining the impact on margins before responding.','Finance has challenged the original assumptions and requested updated forecasts.','Legal has identified clauses that require clarification. The transaction should not proceed without clear safeguards.','The operations team has submitted a revised delivery plan with additional implementation considerations.'];
function createTick(db,userId,steps=1,force=false){
 const world=get(db,'SELECT * FROM worlds WHERE user_id=?',userId);if(!world)return {processed:0};
 const contacts=all(db,'SELECT * FROM contacts WHERE user_id=?',userId);
 const active=all(db,"SELECT * FROM threads WHERE user_id=? AND status='open' ORDER BY updated_at ASC",userId);
 if(!active.length)return {processed:0};
 let progressed=0;
 for(let k=0;k<Math.min(steps,3);k++){
  const t=active[(k+Math.floor(Date.now()/600000))%active.length];
  const newStage=t.stage+1, rel=get(db,'SELECT * FROM contacts WHERE id=? AND user_id=?',t.contact_id,userId);
  const last=get(db,'SELECT * FROM decisions WHERE thread_id=? AND user_id=? ORDER BY created_at DESC LIMIT 1',t.id,userId);
  const action=last?`Following the Chairman's instruction (“${last.content.slice(0,180)}”), the team revised its approach. `:'';
  const note=action+suffixes[(newStage+(k*2))%suffixes.length];
  run(db,'UPDATE threads SET stage=?,summary=?,updated_at=?,next_at=? WHERE id=? AND user_id=?',newStage,`${t.summary.slice(0,280)} ${note}`.slice(-900),now(),new Date(Date.now()+30*60000).toISOString(),t.id,userId);
  event(db,userId,world.id,'development',`Update: ${t.title}`,note,t.id,t.contact_id);
  if(newStage%2===0){ const target=rel||contacts.find(x=>x.kind==='internal'); if(target)message(db,userId,world.id,target.id,`Chairman, regarding ${t.title}: ${note}`); }
  if(last?.outcome==='pending')run(db,'UPDATE decisions SET outcome=? WHERE id=? AND user_id=?','management review underway',last.id,userId);
  // Periodically update bounded fictional operating assumptions and file a
  // coherent report. Major capital transfers are never inferred from chat.
  if(t.company_id&&newStage%4===0){
   const c=get(db,'SELECT * FROM companies WHERE id=? AND user_id=?',t.company_id,userId);
   if(c){
    const movement=(newStage%3)-1; // -1, 0, +1 bounded sensitivity
    const valuation=c.valuation+Math.round(c.valuation*movement*0.0008);
    const revenue=c.revenue+Math.round(c.revenue*movement*0.0005);
    const cash=c.cash+Math.round(c.revenue/365/32*0.08);
    run(db,'UPDATE companies SET valuation=?,revenue=?,cash=? WHERE id=? AND user_id=?',valuation,revenue,cash,c.id,userId);
    document(db,userId,world.id,t.id,t.contact_id,`${c.name} — Operating Review ${newStage}`,'finance',`SIMULATED OPERATING REPORT\n\nCompany: ${c.name}\nPortfolio valuation: $${valuation.toLocaleString()}\nAnnualized revenue assumption: $${revenue.toLocaleString()}\nCash position: $${cash.toLocaleString()}\n\nDrivers: cautious sensitivity adjustments and operating cash flows. These are simulated estimates, not audited actuals. Major transactions still require the Chairman's authorization.`);
   }
  }
  progressed++;
 }
 // External relationships also evolve independent of incoming phone calls.
 if((Date.now()/(15*60000)|0)%3===0){
  const ext=contacts.filter(x=>x.kind!=='internal'); const c=ext[Math.floor(Date.now()/DAY)%ext.length];
  if(c) {message(db,userId,world.id,c.id,`Good afternoon, Chairman. I wanted to follow up on our professional relationship. There may be an opportunity worth discussing when your schedule permits.`);event(db,userId,world.id,'network',`New note from ${c.name}`,`${c.company} has reached out for a conversation.`,null,c.id);}
 }
 run(db,'UPDATE worlds SET last_tick=? WHERE id=?',now(),world.id);
 return {processed:progressed};
}
export async function enrichLatestDevelopment(db,userId){
 const w=get(db,'SELECT * FROM worlds WHERE user_id=?',userId);if(!w)return null;
 const e=get(db,"SELECT * FROM events WHERE user_id=? AND kind='development' ORDER BY created_at DESC LIMIT 1",userId);
 if(!e)return null;
 const thread=get(db,'SELECT * FROM threads WHERE id=? AND user_id=?',e.thread_id,userId);
 const c=thread?.company_id?get(db,'SELECT name,sector,valuation,cash FROM companies WHERE id=? AND user_id=?',thread.company_id,userId):null;
 const actor=e.contact_id?get(db,'SELECT name,title,agenda FROM contacts WHERE id=? AND user_id=?',e.contact_id,userId):null;
 const decisions=all(db,'SELECT content,outcome FROM decisions WHERE thread_id=? AND user_id=? ORDER BY created_at DESC LIMIT 3',e.thread_id,userId);
 const fallback=()=>({title:e.title,body:e.body});
 const r=await askAI('You are the continuity editor of a clearly fictional business leadership simulation. Generate a credible executive update from the exact supplied state. Do not invent transactions, approvals, outcomes, or audited numbers. Return strict JSON {"title":"short professional headline","body":"2-4 sentence narrative outlining development, tradeoffs, next action"}. Keep it realistic and non-sensational.',JSON.stringify({group:w.name,company:c,matter:thread?.title,previous:e.body,executive:actor,decisions}),fallback,raw=>{const j=parseJSON(raw);if(typeof j.title!=='string'||typeof j.body!=='string'||j.body.length<35||j.body.length>1300)throw new Error('Bad executive development');return j;});
 if(r.provider!=='local-rules'){
  run(db,'UPDATE events SET title=?,body=? WHERE id=? AND user_id=?',r.value.title.slice(0,150),r.value.body.slice(0,1200),e.id,userId);
  const matching=actor&&get(db,"SELECT * FROM messages WHERE user_id=? AND contact_id=? AND direction='incoming' ORDER BY created_at DESC LIMIT 1",userId,e.contact_id);
  if(matching&&new Date(matching.created_at).getTime()>=new Date(e.created_at).getTime()-2000){run(db,'UPDATE messages SET body=? WHERE id=? AND user_id=?',r.value.body,matching.id,userId);}
 }
 return {provider:r.provider,title:r.value.title};
}
export function advanceWorld(db,userId,steps=1){return createTick(db,userId,steps,true);}
export function tickIfDue(db,userId){const w=get(db,'SELECT last_tick FROM worlds WHERE user_id=?',userId);if(!w)return {processed:0}; const interval=Number(process.env.WORLD_STEP_MINUTES||45)*60000; const elapsed=Date.now()-new Date(w.last_tick).getTime();return elapsed>=interval?createTick(db,userId,Math.min(3,Math.floor(elapsed/interval))):{processed:0};}

export function decide(db,userId,threadId,content,source='chairman'){const w=get(db,'SELECT * FROM worlds WHERE user_id=?',userId),t=get(db,'SELECT * FROM threads WHERE id=? AND user_id=?',threadId,userId);if(!w||!t)throw new Error('Matter not found.');const clean=String(content||'').trim().slice(0,2000);if(clean.length<4)throw new Error('Directive is too short.');const d={id:id(),user_id:userId,world_id:w.id,thread_id:t.id,contact_id:t.contact_id,content:clean,source,outcome:'pending',created_at:now()};insert(db,'decisions',d);event(db,userId,w.id,'directive',`Chairman's directive: ${t.title}`,clean,t.id,t.contact_id); const chief=get(db,"SELECT * FROM contacts WHERE user_id=? AND title='Chief of Staff'",userId);if(chief)message(db,userId,w.id,chief.id,`I have recorded your directive regarding ${t.title}: “${clean}”. I'll arrange management's follow-up.`);audit(db,userId,'directive',{threadId,source});return d;}

export async function sendMessage(db,userId,contactId,body,channel='message'){
 const w=get(db,'SELECT * FROM worlds WHERE user_id=?',userId), c=get(db,'SELECT * FROM contacts WHERE id=? AND user_id=?',contactId,userId);if(!w||!c)throw new Error('Contact not found.'); const trimmed=String(body||'').trim().slice(0,2500);if(!trimmed)throw new Error('Message required.');
 channel=channel==='email'?'email':'message';
 message(db,userId,w.id,c.id,trimmed,'outgoing',channel);
 if(c.kind==='internal'&&/\b(i (approve|authorize|instruct|direct|reject|want you to)|please (prepare|review|negotiate|schedule)|do not proceed|hold off)\b/i.test(trimmed)){const t=get(db,"SELECT * FROM threads WHERE user_id=? AND (contact_id=? OR status='open') ORDER BY CASE WHEN contact_id=? THEN 0 ELSE 1 END,updated_at DESC LIMIT 1",userId,c.id,c.id);if(t)decide(db,userId,t.id,trimmed,channel);}
 const relevant=all(db,'SELECT title,summary FROM threads WHERE user_id=? AND contact_id=? ORDER BY updated_at DESC LIMIT 2',userId,c.id);
 const system=`You are ${c.name}, ${c.title} at ${c.company}. You are a fictional executive in a clearly established leadership simulation. Your temperament: ${c.temperament}. Your private objective: ${c.agenda}. Trust of Chairman: ${c.trust}/100. Respond as this person, realistically and concisely, to an in-world business message. Do not imply external actions truly occurred. Do not agree automatically; possess independent interests. One or two short paragraphs maximum.`;
 const fallback=()=> c.kind==='bidder'?`Chairman, thank you for your message. I can provide a revised delivery plan and walk your team through the cost assumptions. Which part of our offer concerns you most?`:c.kind==='competitor'?`Chairman, I appreciate the direct approach. I need to consider how that proposal affects our position. What specific terms are you prepared to discuss?`:c.kind==='friend'?`My friend, I see where you're coming from. I'd examine the downside before committing capital. What alternatives has your team considered?`:`Thank you, Chairman. I'll review the details and return with a practical recommendation. Is there a particular deadline you want us to work to?`;
 const r=await askAI(system,`Relevant matters: ${JSON.stringify(relevant)}\nChairman's message: ${trimmed}`,fallback);
 const reply=String(r.value).slice(0,2400);message(db,userId,w.id,c.id,reply,'incoming',channel);
 run(db,'UPDATE contacts SET trust=MIN(95,trust+1),last_contact_at=? WHERE id=? AND user_id=?',now(),c.id,userId);
 return {reply,provider:r.provider};
}

export function callBrief(db,userId,contactId,inviteId){const w=get(db,'SELECT * FROM worlds WHERE user_id=?',userId), c=get(db,'SELECT * FROM contacts WHERE user_id=? AND id=?',userId,contactId);if(!w||!c)throw new Error('Contact not found.');if(inviteId){const i=get(db,'SELECT * FROM invites WHERE id=? AND user_id=?',inviteId,userId);if(!i||i.contact_id!==contactId)throw new Error('Invitation not found.');}
 const threads=all(db,"SELECT title,summary,status FROM threads WHERE user_id=? AND (contact_id=? OR priority='high') ORDER BY updated_at DESC LIMIT 4",userId,c.id);
 const decisions=all(db,'SELECT content,outcome FROM decisions WHERE user_id=? ORDER BY created_at DESC LIMIT 4',userId);
 const context=`This is an immersive but fictional corporate world. You are ${c.name}, ${c.title} at ${c.company}. Category: ${c.kind}. Relationship: ${c.relationship}. Personality: ${c.temperament}. Your interests: ${c.agenda}. The Chairman leads ${w.name} in ${w.region}. Relevant matters: ${JSON.stringify(threads)}. Previous Chairman directives: ${JSON.stringify(decisions)}. Converse naturally as this individual, bring business substance, ask relevant questions, push back when justified; do not claim real-world actions or money transfers. If you don't know a fact, say so. The user is already aware this is a simulation; do not mention it repeatedly.`;
 return {contact:c,world:w,context,firstMessage:c.title==='Chief of Staff'?`Good day, Chairman. This is ${c.name}. I have an update from your executive office. Is now a good time?`:`Good day, Chairman. ${c.name} speaking. I wanted to discuss a matter that may be of interest to you.`};
}
export function startCall(db,userId,contactId,inviteId=null){const b=callBrief(db,userId,contactId,inviteId);const call={id:id(),user_id:userId,world_id:b.world.id,contact_id:contactId,invite_id:inviteId,status:'active',started_at:now(),ended_at:null,transcript:'[]',summary:null};insert(db,'calls',call);if(inviteId)run(db,"UPDATE invites SET status='accepted' WHERE id=? AND user_id=?",inviteId,userId);return {callId:call.id,...b};}
export async function finishCall(db,userId,callId,transcript){const call=get(db,'SELECT * FROM calls WHERE id=? AND user_id=?',callId,userId);if(!call)throw new Error('Call not found');const lines=Array.isArray(transcript)?transcript.filter(x=>x&&['user','assistant'].includes(x.role)&&typeof x.text==='string').slice(0,100).map(x=>({role:x.role,text:x.text.slice(0,1500)})):[];
 const userText=lines.filter(x=>x.role==='user').map(x=>x.text).join('\n').slice(0,7500);
 const thread=get(db,"SELECT * FROM threads WHERE user_id=? AND status='open' ORDER BY CASE WHEN contact_id=? THEN 0 ELSE 1 END,updated_at DESC LIMIT 1",userId,call.contact_id);
 const fallback=()=>({summary:`Discussion with ${get(db,'SELECT name FROM contacts WHERE id=?',call.contact_id)?.name||'executive'}; ${lines.length} transcript turns recorded.`,directive:null});
 let analysis=fallback(),provider='local-rules';
 if(lines.length){const r=await askAI('Extract only explicitly stated, concrete directives from a fictional business call. Return JSON object: {"summary":"brief objective recap","directive":null or "exact authorized user instruction"}. Ignore assistant suggestions, ambiguous statements, and casual questions. Do not invent decisions.',JSON.stringify(lines),fallback,raw=>{const j=parseJSON(raw);if(typeof j.summary!=='string'||!(j.directive===null||typeof j.directive==='string'))throw new Error('Invalid extraction');return j;});analysis=r.value;provider=r.provider;}
 if(!analysis.directive){const line=lines.find(x=>x.role==='user'&&/\b(i (approve|authorize|instruct|direct|reject|want you to)|please (prepare|review|negotiate|schedule)|do not proceed|hold off)\b/i.test(x.text));if(line) analysis.directive=line.text;}
 run(db,'UPDATE calls SET status=?,ended_at=?,transcript=?,summary=? WHERE id=? AND user_id=?','ended',now(),JSON.stringify(lines),String(analysis.summary).slice(0,600),callId,userId);
 if(analysis.directive&&thread)decide(db,userId,thread.id,String(analysis.directive).slice(0,1000),'voice-call');
 return {summary:analysis.summary,directive:analysis.directive||null,provider};
}

export async function meetingSpeak(db,userId,meetingId,userMessage){
 const m=get(db,'SELECT * FROM meetings WHERE id=? AND user_id=?',meetingId,userId);if(!m)throw new Error('Meeting not found.');if(m.status==='completed')throw new Error('This meeting has already concluded.'); const w=get(db,'SELECT * FROM worlds WHERE id=? AND user_id=?',m.world_id,userId); const participants=decode(m.attendees,[]).map(id=>get(db,'SELECT * FROM contacts WHERE id=? AND user_id=?',id,userId)).filter(Boolean);
 const prior=all(db,'SELECT * FROM meeting_turns WHERE meeting_id=? AND user_id=? ORDER BY created_at DESC LIMIT 20',m.id,userId).reverse();
 if(userMessage&&String(userMessage).trim()){insert(db,'meeting_turns',{id:id(),user_id:userId,meeting_id:m.id,contact_id:null,speaker:'Chairman',message:String(userMessage).trim().slice(0,1200),created_at:now()});}
 const allTurns=all(db,'SELECT * FROM meeting_turns WHERE meeting_id=? AND user_id=? ORDER BY created_at DESC LIMIT 20',m.id,userId).reverse();
 const nextIndex=allTurns.filter(x=>x.speaker!=='Chairman').length%Math.max(1,participants.length);
 const request=String(userMessage||'').toLowerCase();const explicitlyAddressed=participants.find(p=>{const first=p.name.split(' ')[0].toLowerCase();const role=p.title.toLowerCase();return request.includes(first)||request.includes(role)||((role.includes('financial')&&request.includes('cfo'))||(role.includes('legal')&&request.includes('counsel'))||(role.includes('operat')&&request.includes('coo')));});
 const speaker=explicitlyAddressed||participants[nextIndex]||get(db,'SELECT * FROM contacts WHERE user_id=? ORDER BY created_at LIMIT 1',userId);
 const t=m.thread_id?get(db,'SELECT * FROM threads WHERE id=? AND user_id=?',m.thread_id,userId):null;
 const system=`You play ${speaker.name} (${speaker.title}) in a fictional board meeting. Personality: ${speaker.temperament}. Motivations: ${speaker.agenda}. The Chairman leads ${w.name}. You must give a substantive, specific response or question appropriate to your role. You may politely disagree. Speak naturally in a board meeting, 2 to 5 sentences. No meta-narration or stage directions. Business matter: ${t?.summary||m.title}. Do not claim any real-world action.`;
 const fallback=()=>{const sayings=[`Chairman, the central question is whether the projected return justifies the capital at risk. I recommend that we require a downside scenario before approving anything.`,`From an operating perspective, we can execute, but only if staffing and delivery milestones are properly funded. I'd like a phased rollout.`,`There are governance and contractual protections we cannot overlook. I recommend reviewing the termination and liability provisions before a final commitment.`,`I support the strategic opportunity, but management should return with measurable milestones and a clear accountability structure.`];return sayings[nextIndex%sayings.length];};
 const r=await askAI(system,`Previous turns: ${JSON.stringify(allTurns.map(x=>({speaker:x.speaker,message:x.message})).slice(-12))}\nRespond to the Chairman and advance discussion.`,fallback);
 const turn={id:id(),user_id:userId,meeting_id:m.id,contact_id:speaker.id,speaker:speaker.name,message:String(r.value).slice(0,1400),created_at:now()};insert(db,'meeting_turns',turn);
 run(db,"UPDATE meetings SET status='live' WHERE id=? AND user_id=?",m.id,userId);
 return {turn,provider:r.provider};
}
export function endMeeting(db,userId,meetingId){const m=get(db,'SELECT * FROM meetings WHERE id=? AND user_id=?',meetingId,userId);if(!m)throw new Error('Meeting not found');const turns=all(db,'SELECT * FROM meeting_turns WHERE meeting_id=? AND user_id=? ORDER BY created_at ASC',m.id,userId);const minutes=`Meeting: ${m.title}\n\n${turns.map(x=>`${x.speaker}: ${x.message}`).join('\n\n')}`;run(db,"UPDATE meetings SET status='completed',minutes=? WHERE id=? AND user_id=?",minutes,m.id,userId);document(db,userId,m.world_id,m.thread_id,null,`Minutes — ${m.title}`,'minutes',minutes);event(db,userId,m.world_id,'meeting',`Board meeting completed: ${m.title}`,'Meeting minutes filed in the document library.',m.thread_id);return {minutes};}
export function meetingHistory(db,userId,meetingId){const m=get(db,'SELECT * FROM meetings WHERE id=? AND user_id=?',meetingId,userId);if(!m)throw new Error('Meeting not found');return all(db,'SELECT * FROM meeting_turns WHERE meeting_id=? AND user_id=? ORDER BY created_at ASC',meetingId,userId);}
export function tenderDecision(db,userId,tenderId,bidId){const t=get(db,'SELECT * FROM tenders WHERE id=? AND user_id=?',tenderId,userId),bid=get(db,'SELECT * FROM bids WHERE id=? AND tender_id=? AND user_id=?',bidId,tenderId,userId);if(!t||!bid)throw new Error('Bid not found.');run(db,"UPDATE bids SET status=CASE WHEN id=? THEN 'preferred' ELSE 'not_selected' END WHERE tender_id=? AND user_id=?",bidId,tenderId,userId);run(db,"UPDATE tenders SET status='evaluation' WHERE id=? AND user_id=?",tenderId,userId);const vendor=get(db,'SELECT name,company FROM contacts WHERE id=? AND user_id=?',bid.contact_id,userId);const directive=`Selected ${vendor.company} as preferred bidder for ${t.title} at $${bid.amount.toLocaleString()}; subject to legal review and final contract approval.`;decide(db,userId,t.thread_id,directive,'tender-evaluation');return {directive};}
export function makeInvite(db,userId,contactId,threadId=null){const w=get(db,'SELECT * FROM worlds WHERE user_id=?',userId),c=get(db,'SELECT * FROM contacts WHERE id=? AND user_id=?',contactId,userId);if(!w||!c)throw new Error('Contact not found');return invite(db,userId,w.id,c.id,'contact',`${c.name} is calling`,`${c.name}, ${c.title} at ${c.company}, would like to speak with you.`,0,threadId);}
export function updateSettings(db,userId,values){const old=get(db,'SELECT * FROM settings WHERE user_id=?',userId);if(!old)throw new Error('Settings missing.');const time=v=>/^([01]\d|2[0-3]):[0-5]\d$/.test(v);const result={...old};for(const name of ['morning','evening','quiet_start','quiet_end'])if(values[name]!==undefined){if(!time(values[name]))throw new Error('Invalid clock time.');result[name]=values[name];}for(const name of ['max_daily','urgent'])if(values[name]!==undefined)result[name]=Math.max(0,Math.min(8,Number(values[name])||0));if(values.notifications!==undefined)result.notifications=values.notifications?1:0;run(db,'UPDATE settings SET morning=?,evening=?,quiet_start=?,quiet_end=?,max_daily=?,urgent=?,notifications=? WHERE user_id=?',result.morning,result.evening,result.quiet_start,result.quiet_end,result.max_daily,result.urgent,result.notifications,userId);return result;}

export function setContactVoice(db,userId,contactId,fields){
 const c=get(db,'SELECT * FROM contacts WHERE user_id=? AND id=?',userId,contactId);if(!c)throw new Error('Contact not found.');
 const voiceId=String(fields.voiceId||'').trim().slice(0,160)||null;
 const assistantId=String(fields.vapiAssistantId||'').trim().slice(0,160)||null;
 run(db,'UPDATE contacts SET voice_id=?,vapi_assistant_id=? WHERE id=? AND user_id=?',voiceId,assistantId,c.id,userId);
 return {voiceId,vapiAssistantId:assistantId};
}
export function negotiateTender(db,userId,tenderId,bidId,proposedAmount){
 const t=get(db,'SELECT * FROM tenders WHERE id=? AND user_id=?',tenderId,userId);
 const b=get(db,'SELECT * FROM bids WHERE id=? AND tender_id=? AND user_id=?',bidId,tenderId,userId);
 if(!t||!b)throw new Error('Bid not found.');
 const amount=Number(proposedAmount);if(!Number.isInteger(amount)||amount<1000||amount>=1e10)throw new Error('Enter a valid counteroffer amount.');
 const vendor=get(db,'SELECT * FROM contacts WHERE id=? AND user_id=?',b.contact_id,userId);
 const reduction=(b.amount-amount)/b.amount;
 const agreed=reduction<=0.06;
 message(db,userId,t.world_id,vendor.id,`For the ${t.title} tender, we propose a revised contract price of $${amount.toLocaleString()}. Please advise on terms and delivery impacts.`,'outgoing','email');
 const reply=agreed?`Chairman, we can provisionally accept a price of $${amount.toLocaleString()}, subject to contract review, scope confirmation and final management approval.`:`Chairman, the proposed reduction is beyond our current margin. We can reconsider scope, timing, or maintenance support, but cannot accept $${amount.toLocaleString()} as it stands.`;
 message(db,userId,t.world_id,vendor.id,reply,'incoming','email');
 if(agreed)run(db,'UPDATE bids SET amount=?,status=? WHERE id=? AND user_id=?',amount,'revised',b.id,userId);
 event(db,userId,t.world_id,'negotiation',`Tender negotiation: ${vendor.company}`,reply,t.thread_id,vendor.id);
 run(db,'UPDATE contacts SET trust=MAX(25,MIN(95,trust+?)) WHERE id=? AND user_id=?',agreed?2:-1,vendor.id,userId);
 return {agreed,reply,amount:agreed?amount:b.amount};
}
