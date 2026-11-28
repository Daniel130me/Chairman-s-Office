import {one,sql,uid,transaction} from '../backend/src/db.mjs';
import {startColleagueCall,resolveColleagueRecipient} from './colleague-calls.mjs';
import {createCalendarEvent,CalendarConflictError} from './calendar-events.mjs';
import {extractTimeCandidates,parseMeetingTime} from './calendar-intents.mjs';
export function isMeetingProposalText(value){
 const text=String(value||'');
 const meeting=/\b(meet|meeting|appointment|calendar|schedule|discuss|talk|call)\b/i.test(text);
 const genuineOffer=/\b(?:i can make time|i(?:'|’)m available|i am available|available at|available on|my calendar (?:is )?(?:clear|open)|calendar is clear|what works (?:best )?for your schedule|whichever suits|let me know which (?:slot|time) works|i can do|i(?:'|’)m free|i am free|happy to meet|i have time)\b/i.test(text);
 return meeting&&genuineOffer;
}
function proposalPriority(text){return /\b(urgent|quickly|immediately|deadline|before|signed contract|offers? expire|time[- ]sensitive)\b/i.test(text)?'high':'normal';}
export function proposalAgenda(text){
 const value=String(text||'').replace(/[\u00a0\u202f]/g,' ').replace(/\*\*/g,'').trim();
 if(/\bBerlin offers\b/i.test(value))return 'Urgent discussion about the Berlin offers and the potential talent implications';
 const discussed=value.match(/\b(?:discuss(?:ing)?|talk(?:ing)? about|explor(?:e|ing))\s+(.+?)(?:[.!?]|$)/i);
 if(discussed)return ('Discuss '+discussed[1].trim()).slice(0,400);
 const subject=value.match(/\b(?:meeting|call|discussion)\s+(?:about|regarding)\s+(.+?)(?:[.!?]|$)/i);
 if(subject)return subject[1].trim().slice(0,400);
 return 'Agenda to be agreed with attendees';
}
export async function recordMeetingProposalFromMessage(userId,worldId,contactId,messageId,body){
 if(!isMeetingProposalText(body))return null;
 return transaction(async q=>{
  const [proposal]=await q(`INSERT INTO meeting_proposals(id,user_id,world_id,contact_id,source_message_id,proposal_text,agenda,priority)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(user_id,source_message_id) DO NOTHING RETURNING *`,
   [uid(),userId,worldId,contactId,messageId,String(body).slice(0,2000),proposalAgenda(body),proposalPriority(body)]);
  if(!proposal)return (await q('SELECT * FROM meeting_proposals WHERE user_id=$1 AND source_message_id=$2',[userId,messageId]))[0]||null;
  const [contact]=await q('SELECT name FROM contacts WHERE id=$1 AND user_id=$2',[contactId,userId]);
  await q('INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[
   uid(),userId,worldId,contactId,'meeting-proposal-received','Meeting proposal from '+(contact?.name||'an executive'),String(body).slice(0,500)
  ]);
  return proposal;
 });
}
export async function syncMeetingProposals(userId){
 const messages=await sql(`SELECT m.id,m.world_id,m.contact_id,m.body FROM messages m
  WHERE m.user_id=$1 AND m.direction='incoming' AND m.channel IN ('chat','email')
  AND m.created_at>now()-interval '45 days'
  AND NOT EXISTS (SELECT 1 FROM meeting_proposals p WHERE p.user_id=m.user_id AND p.source_message_id=m.id)
  ORDER BY m.created_at DESC LIMIT 250`,[userId]);
 let inserted=0;
 for(const message of messages){
  if(!isMeetingProposalText(message.body))continue;
  const result=await recordMeetingProposalFromMessage(userId,message.world_id,message.contact_id,message.id,message.body);
  if(result?.status==='awaiting-chairman')inserted++;
 }
 return inserted;
}
export async function meetingProposalSnapshot(userId){
 const proposals=await sql(`SELECT p.*,c.name AS contact_name,c.title AS contact_title,e.starts_at AS scheduled_start
  FROM meeting_proposals p JOIN contacts c ON c.id=p.contact_id AND c.user_id=p.user_id
  LEFT JOIN calendar_events e ON e.id=p.scheduled_event_id AND e.user_id=p.user_id
  WHERE p.user_id=$1 AND p.status NOT IN ('scheduled','declined','expired')
  ORDER BY CASE p.priority WHEN 'high' THEN 0 ELSE 1 END,p.created_at DESC LIMIT 80`,[userId]);
 return proposals.filter(p=>isMeetingProposalText(p.proposal_text)).map(p=>({...p,agenda:proposalAgenda(p.proposal_text)})).slice(0,40);
}
export async function chooseMeetingProposalSlot(user,proposalId,optionText){
 const proposal=await one('SELECT * FROM meeting_proposals WHERE id=$1 AND user_id=$2',[proposalId,user.id]);
 if(!proposal)throw new Error('Meeting proposal unavailable.');
 if(proposal.status==='scheduled')throw new Error('This meeting already has a confirmed invitation.');
 if(proposal.status==='coordinating')throw new Error('Amara is already coordinating this proposal. Wait for her report before changing the selected time.');
 const world=await one('SELECT timezone FROM worlds WHERE id=$1 AND user_id=$2',[proposal.world_id,user.id]);
 if(!world)throw new Error('The Chairman’s Office world is unavailable.');
 const slot=parseMeetingTime(String(optionText||''),proposal.proposal_text,world.timezone||'Africa/Lagos',new Date());
 const errors={
  'missing-time':'Choose one of the proposed times shown.',
  'ambiguous-time':'Choose only one proposed time.',
  'missing-date':'I could not identify the date. Choose one of the listed date-and-time options.',
  'ambiguous-date':'The proposed date is ambiguous. Ask Amara to clarify it before booking.',
  'past-date':'That proposed time has already passed. Ask for a new option.',
  'invalid-date':'The proposed date is invalid.',
  'invalid-timezone':'The proposed timezone is invalid.'
 };
 if(slot.error)throw new Error(errors[slot.error]||'I could not interpret that meeting time safely.');
 const updated=await one(`UPDATE meeting_proposals SET chairman_preferred_start_at=$3,chairman_preferred_timezone=$4,
  chairman_preferred_timezone_label=$5,updated_at=now()
  WHERE id=$1 AND user_id=$2 AND status IN ('awaiting-chairman','needs-chairman') RETURNING *`,
  [proposal.id,user.id,slot.startAt,slot.timezone,slot.timezoneLabel]);
 if(!updated)throw new Error('This proposal is no longer awaiting your selection.');
 return {proposalId:proposal.id,startAt:slot.startAt,timezone:slot.timezone,timezoneLabel:slot.timezoneLabel};
}
export async function coordinateMeetingProposal(user,proposalId){
 const proposal=await one('SELECT * FROM meeting_proposals WHERE id=$1 AND user_id=$2',[proposalId,user.id]);
 if(!proposal)throw new Error('Meeting proposal unavailable.');
 if(proposal.status==='scheduled')return {alreadyScheduled:true};
 if(proposal.status==='coordinating'){
  const prior=await one('SELECT id,status FROM colleague_calls WHERE user_id=$1 AND meeting_proposal_id=$2 ORDER BY started_at DESC LIMIT 1',[user.id,proposal.id]);
  if(prior)return {alreadyCoordinating:true,call:prior};
 }
 const world=await one('SELECT * FROM worlds WHERE id=$1 AND user_id=$2',[proposal.world_id,user.id]);
 const amara=await one("SELECT id,name FROM contacts WHERE user_id=$1 AND world_id=$2 AND title='Chief of Staff' ORDER BY created_at LIMIT 1",[user.id,proposal.world_id]);
 const other=await one('SELECT id,name FROM contacts WHERE id=$1 AND user_id=$2',[proposal.contact_id,user.id]);
 if(!world||!amara||!other)throw new Error('Amara or the meeting participant is unavailable.');
 const preferred=proposal.chairman_preferred_start_at
  ?'The Chairman has selected '+new Date(proposal.chairman_preferred_start_at).toISOString()+' ('+(proposal.chairman_preferred_timezone_label||proposal.chairman_preferred_timezone||world.timezone)+') as his preferred slot. Ask '+other.name+' to confirm this exact slot; do not substitute another time without the Chairman’s approval.'
  :'The Chairman has not selected a time yet. Ask '+other.name+' for exact date, start-time, timezone and duration options. Do not choose or book a slot on the Chairman’s behalf. Report the options to the Chairman so he can choose.';
 const reason='The Chairman has asked you to coordinate a meeting with '+other.name+'. Original proposal: '+proposal.proposal_text+'. Agenda: '+(proposal.agenda||'Business discussion')+'. '+preferred+' Do not invent availability. If the other person cannot accept the preferred slot, report their alternatives and wait for the Chairman.';
 const result=await startColleagueCall({userId:user.id,worldId:world.id,callerId:amara.id,recipientLabel:other.name,reason,reportToChairman:true,meetingProposalId:proposal.id,operationKey:'meeting-proposal:'+proposal.id+':'+(proposal.chairman_preferred_start_at?new Date(proposal.chairman_preferred_start_at).toISOString():'options')});
 await sql("UPDATE meeting_proposals SET status='coordinating',updated_at=now() WHERE id=$1 AND user_id=$2 AND status<>'scheduled'",[proposal.id,user.id]);
 return {call:result.call,conversation:result.conversation,caller:amara.name,recipient:other.name};
}
export async function handleChiefOfStaffCalendarRequest({user,world,contact,history,body,outgoingId}){
 if(contact?.title!=='Chief of Staff')return null;
 const asksOnlyForChairmanCallback=/\b(?:call|phone)\s+(?:me|the chairman|chairman)\b/i.test(body)&&!(/\b(?:call|phone|ring|speak to|talk to|contact|reach)\s+(?!(?:me|the chairman|chairman)\b)[a-z]/i.test(body));
 if(asksOnlyForChairmanCallback)return null;
 const hasSpecificTime=extractTimeCandidates(body).length===1&&/\b(today|tomorrow|day after tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|20\d{2}-\d{2}-\d{2})\b/i.test(body);
 const explicitMeeting=(/\b(schedule|book|arrange|set up|put|add|coordinate)\b/i.test(body)&&/\b(meeting|call|appointment|discussion|calendar)\b/i.test(body))||(/\b(call|phone)\b/i.test(body)&&hasSpecificTime);
 const followUpIntent=/\b(call|phone|tell|confirm|works|choose|prefer|available|availability)\b/i.test(body);
 if(!explicitMeeting&&!followUpIntent)return null;
 const target=await resolveColleagueRecipient(user.id,world.id,body,contact.id);
 let proposal=null;
 if(target.contact){
  proposal=await one("SELECT * FROM meeting_proposals WHERE user_id=$1 AND contact_id=$2 AND status IN ('awaiting-chairman','needs-chairman','coordinating') ORDER BY created_at DESC LIMIT 1",[user.id,target.contact.id]);
 }else{
  const pending=await sql("SELECT p.* FROM meeting_proposals p WHERE p.user_id=$1 AND p.status IN ('awaiting-chairman','needs-chairman','coordinating') ORDER BY p.created_at DESC LIMIT 5",[user.id]);
  if(pending.length===1){
   proposal=pending[0];
   const [person]=await sql('SELECT id,name FROM contacts WHERE id=$1 AND user_id=$2',[proposal.contact_id,user.id]);
   if(person)target.contact=person;
  }else if(pending.length>1)return {reply:'I have more than one meeting proposal awaiting your direction. Which person should I contact?'};
 }
 if(!target.contact){
  if(!explicitMeeting)return null;
  return {reply:target.ambiguous?'I found more than one person matching that name or role. Please give me the full name.':'Certainly, Chairman. Who should I coordinate the meeting with? Please give me the person’s name or role.'};
 }
 if(!proposal&&!explicitMeeting)return null;
 if(!proposal){
  proposal=await one(`INSERT INTO meeting_proposals(id,user_id,world_id,contact_id,source_message_id,proposal_text,agenda,priority)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(user_id,source_message_id) DO NOTHING RETURNING *`,
   [uid(),user.id,world.id,target.contact.id,outgoingId,String(body).slice(0,2000),proposalAgenda(body),proposalPriority(body)]);
  if(!proposal)proposal=await one('SELECT * FROM meeting_proposals WHERE user_id=$1 AND source_message_id=$2',[user.id,outgoingId]);
 }
 if(!proposal)return {reply:'I could not create the meeting coordination record, so I have not contacted the attendee yet.'};
 const timeCandidates=extractTimeCandidates(body);
 if(timeCandidates.length>1)return {reply:'I can coordinate that, Chairman. Which single date and time do you want me to ask '+target.contact.name+' to confirm?'};
 let preferred=null;
 if(timeCandidates.length===1){
  preferred=parseMeetingTime(body,proposal.proposal_text,world.timezone,new Date());
  if(preferred.error==='past-date')return {reply:'That preferred slot has already passed. What future date and time should I give '+target.contact.name+'?'};
  if(preferred.error==='missing-date'||preferred.error==='ambiguous-date')return {reply:'I have the time, Chairman, but need the exact date before I can confirm it with '+target.contact.name+'.'};
  if(preferred.error)return {reply:'Please give me one clear future date, time and timezone so I can confirm the invitation accurately.'};
  await sql('UPDATE meeting_proposals SET chairman_preferred_start_at=$3,chairman_preferred_timezone=$4,chairman_preferred_timezone_label=$5,updated_at=now() WHERE id=$1 AND user_id=$2',[proposal.id,user.id,preferred.startAt,preferred.timezone,preferred.timezoneLabel]);
  proposal={...proposal,chairman_preferred_start_at:preferred.startAt,chairman_preferred_timezone:preferred.timezone,chairman_preferred_timezone_label:preferred.timezoneLabel};
 }
 if(proposal.status==='coordinating'){
  return {reply:preferred?'Certainly, Chairman. I have added your preferred slot to my ongoing conversation with '+target.contact.name+'. I will confirm that exact time with them before placing the invitation on your Calendar.':'I am already coordinating with '+target.contact.name+'. I will report the exact options as soon as we have them.'};
 }
 const preferredInstruction=preferred
  ?'The Chairman’s preferred slot is '+preferred.startAt+' ('+preferred.timezoneLabel+'). Ask '+target.contact.name+' to confirm this exact time. Do not substitute another slot without the Chairman’s approval.'
  :'The Chairman has not selected a time yet. Ask '+target.contact.name+' for exact date, time, timezone and duration options, then report them to the Chairman. Do not book or choose a time on his behalf.';
 const reason='The Chairman asked me to coordinate a meeting with '+target.contact.name+'. Original request: '+proposal.proposal_text+'. Agenda: '+(proposal.agenda||'Business discussion')+'. '+preferredInstruction+' Do not invent availability.';
 const result=await startColleagueCall({userId:user.id,worldId:world.id,callerId:contact.id,recipientLabel:target.contact.name,reason,reportToChairman:true,meetingProposalId:proposal.id,operationKey:'chief-calendar:'+outgoingId});
 await sql("UPDATE meeting_proposals SET status='coordinating',updated_at=now() WHERE id=$1 AND user_id=$2",[proposal.id,user.id]);
 return {reply:'Certainly, Chairman. I have arranged for me to speak directly with '+target.contact.name+' to confirm '+(preferred?'your preferred slot':'the exact available options').'. I will report back and only add a confirmed invitation to your Calendar after the time is agreed.'};
}
