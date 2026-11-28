import {one,sql,uid,transaction} from '../backend/src/db.mjs';
import {startColleagueCall,resolveColleagueRecipient} from './colleague-calls.mjs';
import {createCalendarEvent,CalendarConflictError} from './calendar-events.mjs';
import {extractTimeCandidates,parseMeetingTime} from './calendar-intents.mjs';
function isMeetingProposalText(value){
 const text=String(value||'');
 return /\b(meet|meeting|appointment|calendar|schedule|discuss|talk)\b/i.test(text)&&
  /\b(make time|available|availability|free|later|tomorrow|today|morning|afternoon|evening|next week|what works|works best|calendar clear|can do)\b/i.test(text);
}
function proposalPriority(text){return /\b(urgent|quickly|immediately|deadline|before|signed contract|offers? expire|time[- ]sensitive)\b/i.test(text)?'high':'normal';}
function proposalAgenda(text){
 const value=String(text||'');
 const named=value.match(/\b(?:about|regarding|on)\s+(.+?)(?:[.!?]|$)/i);
 if(named)return named[1].trim().slice(0,400);
 if(/\bBerlin offers\b/i.test(value))return 'Urgent discussion about the Berlin offers and the potential talent implications';
 if(/\btalent|engineer|poach/i.test(value))return 'Talent retention and the threatened loss of key engineers';
 return 'Business meeting proposed by '+value.slice(0,120);
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
 return sql(`SELECT p.*,c.name AS contact_name,c.title AS contact_title,e.starts_at AS scheduled_start
  FROM meeting_proposals p JOIN contacts c ON c.id=p.contact_id AND c.user_id=p.user_id
  LEFT JOIN calendar_events e ON e.id=p.scheduled_event_id AND e.user_id=p.user_id
  WHERE p.user_id=$1 AND p.status NOT IN ('scheduled','declined','expired')
  ORDER BY CASE p.priority WHEN 'high' THEN 0 ELSE 1 END,p.created_at DESC LIMIT 40`,[userId]);
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
 const reason='The Chairman has asked you to coordinate a meeting with '+other.name+'. Original proposal: '+proposal.proposal_text+'. Agenda: '+(proposal.agenda||'Business discussion')+'. Speak directly with '+other.name+', confirm one exact future date, start time, timezone and duration, and do not invent availability. If no single slot is agreed, report the available options and ask the Chairman to choose.'+(proposal.priority==='high'?' This proposal is time-sensitive; prioritise it.':'');
 const result=await startColleagueCall({
  userId:user.id,worldId:world.id,callerId:amara.id,recipientLabel:other.name,reason,
  reportToChairman:true,meetingProposalId:proposal.id,operationKey:'meeting-proposal:'+proposal.id
 });
 await sql("UPDATE meeting_proposals SET status='coordinating',updated_at=now() WHERE id=$1 AND user_id=$2 AND status<>'scheduled'",[proposal.id,user.id]);
 return {call:result.call,conversation:result.conversation,caller:amara.name,recipient:other.name};
}
export async function handleChiefOfStaffCalendarRequest({user,world,contact,body,outgoingId}){
 if(contact?.title!=='Chief of Staff')return null;
 if(!/\b(schedule|book|arrange|set up|put|add|coordinate)\b/i.test(body)||!/\b(meeting|call|appointment|discussion)\b/i.test(body))return null;
 const target=await resolveColleagueRecipient(user.id,world.id,body,contact.id);
 if(!target.contact)return {reply:target.ambiguous?'I found more than one person matching that name or role. Please give me the full name.':'Certainly, Chairman. Who should I coordinate the meeting with? Please give me the person’s name or role.'};
 let proposal=await one("SELECT * FROM meeting_proposals WHERE user_id=$1 AND contact_id=$2 AND status IN ('awaiting-chairman','needs-chairman') ORDER BY created_at DESC LIMIT 1",[user.id,target.contact.id]);
 if(!proposal){
  proposal=await one(`INSERT INTO meeting_proposals(id,user_id,world_id,contact_id,source_message_id,proposal_text,agenda,priority)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(user_id,source_message_id) DO NOTHING RETURNING *`,
   [uid(),user.id,world.id,target.contact.id,outgoingId,String(body).slice(0,2000),proposalAgenda(body),proposalPriority(body)]);
  if(!proposal)proposal=await one('SELECT * FROM meeting_proposals WHERE user_id=$1 AND source_message_id=$2',[user.id,outgoingId]);
 }
 const reason='The Chairman asked me to coordinate a meeting with '+target.contact.name+'. Original request: '+(proposal?.proposal_text||String(body).slice(0,500))+'. Agenda: '+(proposal?.agenda||'Business discussion')+'. Please confirm one exact future date, time, timezone and duration. Do not invent availability.';
 const result=await startColleagueCall({userId:user.id,worldId:world.id,callerId:contact.id,recipientLabel:target.contact.name,reason,reportToChairman:true,meetingProposalId:proposal?.id||null,operationKey:'chief-calendar:'+outgoingId});
 if(proposal)await sql("UPDATE meeting_proposals SET status='coordinating',updated_at=now() WHERE id=$1 AND user_id=$2",[proposal.id,user.id]);
 return {reply:'Certainly, Chairman. I have arranged for me to speak directly with '+target.contact.name+' to confirm an exact meeting time. I will report back to you and place the confirmed invitation on your Calendar. The call and its transcript will also be recorded in Messages.'};
}
