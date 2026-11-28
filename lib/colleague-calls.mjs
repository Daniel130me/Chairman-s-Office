import {sql,one,uid,transaction} from '../backend/src/db.mjs';
import {ask} from '../backend/src/ai.mjs';
import {synthesizeVoicemail} from './voice-notes.mjs';
import {parseFollowup,fallbackFollowup} from './voicemail-rules.mjs';
import {enqueueCharacterMemory} from './character-intelligence.mjs';
import {HttpError} from './validation.mjs';
import {createCalendarEvent,CalendarConflictError,describeCalendarEvent} from './calendar-events.mjs';
import {parseMeetingTime,isMeetingAcceptance,extractTimeCandidates} from './calendar-intents.mjs';
import {deliverInvitePush} from './push.mjs';
import {realWorldDecisionContext} from './real-world-context.mjs';
const clean=(value,max=200)=>typeof value==='string'?value.trim().slice(0,max):'';
export function callAvailability(availability){
 if(!availability||availability==='available')return 'available';
 return availability==='declined'?'declined':'missed';
}
export function parseCallDialogue(raw){
 if(!raw||!['completed','declined'].includes(raw.outcome))return null;
 if(raw.outcome==='declined')return {outcome:'declined',turns:[]};
 if(!Array.isArray(raw.turns)||raw.turns.length<2||raw.turns.length>4)return null;
 const turns=raw.turns.map((t,i)=>({speaker:t?.speaker,body:clean(t?.body)}));
 if(turns.some((t,i)=>t.speaker!==(i%2===0?'caller':'recipient')||!t.body))return null;
 return {outcome:'completed',turns};
}
export async function queueColleagueCall(q,{world,conversation,speaker,recipient,reason,reportToChairman=false,meetingProposalId=null,operationKey=null}){
 const body=clean(reason,500);if(!body||speaker.id===recipient.id)return false;
 const key=clean(operationKey,240)||('colleague-call:'+conversation.id+':'+new Date().toISOString().slice(0,13));
 const inserted=await q(`INSERT INTO colleague_calls(id,user_id,world_id,conversation_id,caller_id,recipient_id,reason,operation_key,report_to_chairman,meeting_proposal_id)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(user_id,operation_key) DO NOTHING RETURNING id`,
 [uid(),world.user_id,world.id,conversation.id,speaker.id,recipient.id,body,key,reportToChairman===true,meetingProposalId||null]);
 return !!inserted.length;
}
export async function resolveColleagueRecipient(userId,worldId,label,excludeId=null){
 const contacts=await sql('SELECT id,name,title,company FROM contacts WHERE user_id=$1 AND world_id=$2 ORDER BY name',[userId,worldId]);
 const normalise=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 const text=normalise(label);
 if(!text)return {contact:null,ambiguous:false};
 const eligible=contacts.filter(person=>person.id!==excludeId);
 const full=eligible.filter(person=>{const name=normalise(person.name);return name&&text.includes(name);});
 if(full.length===1)return {contact:full[0],ambiguous:false};
 if(full.length>1)return {contact:null,ambiguous:true};
 const words=text.split(' ');
 const nameMatches=eligible.filter(person=>{
  const tokens=normalise(person.name).split(' ').filter(token=>token.length>2&&token!=='the');
  return tokens.some(token=>words.includes(token));
 });
 if(nameMatches.length===1)return {contact:nameMatches[0],ambiguous:false};
 if(nameMatches.length>1)return {contact:null,ambiguous:true};
 const roleMatches=eligible.filter(person=>{const title=normalise(person.title);return title&&text.includes(title);});
 if(roleMatches.length===1)return {contact:roleMatches[0],ambiguous:false};
 if(roleMatches.length>1)return {contact:null,ambiguous:true};
 const aliases=['cfo','coo','ceo','general counsel','chief of staff','board chair'];
 const matches=eligible.filter(person=>{
  const title=normalise(person.title);
  return aliases.some(alias=>text.includes(alias)&&title.includes(alias));
 });
 return matches.length===1?{contact:matches[0],ambiguous:false}:{contact:null,ambiguous:matches.length>1};
}
export async function startColleagueCall({userId,worldId,callerId,recipientLabel,reason,reportToChairman=false,meetingProposalId=null,operationKey=null}){
 const world=await one('SELECT * FROM worlds WHERE id=$1 AND user_id=$2',[worldId,userId]);
 const caller=await one('SELECT * FROM contacts WHERE id=$1 AND user_id=$2 AND world_id=$3',[callerId,userId,worldId]);
 if(!world||!caller)throw new Error('The calling executive is unavailable.');
 const resolved=await resolveColleagueRecipient(userId,worldId,recipientLabel,callerId);
 if(!resolved.contact)throw new Error(resolved.ambiguous?'More than one colleague matches that name or role. Please use a full name.':'That colleague could not be found in the executive directory.');
 const recipient=resolved.contact;
 if(recipient.id===caller.id)throw new Error('Choose another colleague; an executive cannot call themselves.');
 const cleanReason=clean(reason,500);
 if(!cleanReason)throw new Error('Explain what the colleague call should cover.');
 const key=clean(operationKey,240)||('delegated-colleague-call:'+uid());
 return transaction(async q=>{
  const [existing]=await q('SELECT * FROM colleague_calls WHERE user_id=$1 AND operation_key=$2',[userId,key]);
  if(existing){
   const [conversation]=await q('SELECT * FROM world_conversations WHERE id=$1 AND user_id=$2',[existing.conversation_id,userId]);
   return {call:existing,conversation,caller,recipient,alreadyExists:true};
  }
  const threadId=uid(),conversationId=uid();
  const priority=/urgent|quickly|immediately|deadline|before|risk|crisis/i.test(cleanReason)?'high':'normal';
  const title=('Call · '+caller.name+' ↔ '+recipient.name).slice(0,140);
  await q('INSERT INTO threads(id,user_id,world_id,contact_id,title,category,summary,priority,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[
   threadId,userId,worldId,caller.id,title,'network',cleanReason,priority,'open'
  ]);
  const [conversation]=await q('INSERT INTO world_conversations(id,user_id,world_id,thread_id,title) VALUES($1,$2,$3,$4,$5) RETURNING *',[
   conversationId,userId,worldId,threadId,caller.name+' ↔ '+recipient.name+' · '+cleanReason.slice(0,75)
  ]);
  for(const person of [caller,recipient])await q('INSERT INTO world_conversation_participants(user_id,conversation_id,contact_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[userId,conversationId,person.id]);
  await queueColleagueCall(q,{world,conversation,speaker:caller,recipient,reason:cleanReason,reportToChairman,meetingProposalId,operationKey:key});
  const [call]=await q('SELECT * FROM colleague_calls WHERE user_id=$1 AND operation_key=$2',[userId,key]);
  await q('INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[
   uid(),userId,worldId,caller.id,'colleague-call-requested',caller.name+' will call '+recipient.name,cleanReason
  ]);
  return {call,conversation,caller,recipient,alreadyExists:false};
 });
}
export function acceptedMeetingSlot(turns,reason,proposal,timezone){
 const recipientIndex=turns.findIndex(turn=>turn.speaker==='recipient'&&isMeetingAcceptance(turn.body));
 if(recipientIndex<0)return null;
 const callerConfirmation=turns.slice(recipientIndex+1).find(turn=>turn.speaker==='caller'&&/\b(that works|confirmed|i will put|i'll put|i will schedule|i'll schedule|i will confirm|i'll confirm|book it|i will reserve|i'll reserve|i have it|i've got it)\b/i.test(turn.body));
 if(!callerConfirmation)return null;
 const preferred=proposal?.chairman_preferred_start_at;
 if(!preferred)return null;
 const context=[reason,proposal?.proposal_text||'',...turns.map(turn=>turn.body)].join(' ');
 const recipientText=turns[recipientIndex].body;
 let slot;
 if(!extractTimeCandidates(recipientText).length){
  slot={startAt:new Date(preferred).toISOString(),timezone:proposal.chairman_preferred_timezone||timezone||'UTC',timezoneLabel:proposal.chairman_preferred_timezone_label||proposal.chairman_preferred_timezone||timezone||'UTC'};
 }else{
  slot=parseMeetingTime(recipientText,context,timezone||'UTC',new Date());
 }
 if(!slot||slot.error)return null;
 return Math.abs(new Date(slot.startAt).getTime()-new Date(preferred).getTime())<=60000?slot:null;
}
async function deliverColleagueCallReport(call,caller,recipient,turns,outcome,followup,proposal,calendarEvent,calendarIssue){
 const transcript=turns.map(turn=>(turn.speaker==='caller'?caller.name:recipient.name)+': '+turn.body).join('\n');
 const meetingLine=proposal?(calendarEvent?'Confirmed meeting invitation: '+describeCalendarEvent(calendarEvent)+'. It is now on the Chairman’s Calendar.':('No calendar invitation has been created. '+(calendarIssue||'No single exact date and time was mutually confirmed.'))):'';
 const outcomeLine=outcome==='completed'?'The colleague conversation completed.':outcome==='declined'?'The recipient declined the call.':outcome==='missed'?'The recipient did not answer.':'The colleague call could not be completed.';
 const body=[caller.name+' reporting back to the Chairman.', 'I was asked to speak with '+recipient.name+' about: '+call.reason, outcomeLine,transcript,followup?'A follow-up message was left for '+recipient.name+'.':'',meetingLine].filter(Boolean).join('\n\n').slice(0,3500);
 const invite=await transaction(async q=>{
  const [prior]=await q('SELECT id FROM messages WHERE user_id=$1 AND client_message_key=$2 LIMIT 1',[call.user_id,call.id]);
  if(!prior){
   const [message]=await q("INSERT INTO messages(id,user_id,world_id,contact_id,direction,channel,body,client_message_key) VALUES($1,$2,$3,$4,'incoming','chat',$5,$6) ON CONFLICT DO NOTHING RETURNING id",[
    uid(),call.user_id,call.world_id,caller.id,body,call.id
   ]);
   if(message){
    await q('UPDATE contacts SET last_contact_at=now() WHERE id=$1 AND user_id=$2',[caller.id,call.user_id]);
    await q('INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[
     uid(),call.user_id,call.world_id,caller.id,'colleague-call-reported','Call report from '+caller.name,body.slice(0,500)
    ]);
   }
  }
  const [created]=await q(`INSERT INTO invites(id,user_id,world_id,contact_id,thread_id,kind,subject,preview,due_at,schedule_key)
   VALUES($1,$2,$3,$4,$5,'network',$6,$7,now(),$8) ON CONFLICT(user_id,schedule_key) DO NOTHING RETURNING id`,[
   uid(),call.user_id,call.world_id,caller.id,null,'Incoming call · '+caller.name,body.slice(0,240),'colleague-call-report:'+call.id
  ]);
  if(created)return created;
  return (await q('SELECT id FROM invites WHERE user_id=$1 AND schedule_key=$2',[call.user_id,'colleague-call-report:'+call.id]))[0]||null;
 });
 if(invite?.id)await deliverInvitePush(invite.id).catch(error=>console.warn('Colleague call report push deferred',error.name||'error'));
}

const contextPerson=p=>({name:p.name,title:p.title,company:p.company,temperament:p.temperament,agenda:p.agenda,availability:p.availability,expertise:p.expertise||[]});
async function recordMessage(q,call,sender,recipient,body,channel,audio){
 const id=uid();
 await q('INSERT INTO world_conversation_messages(id,user_id,world_id,conversation_id,sender_contact_id,recipient_contact_id,sender_name,body,channel,source_colleague_call_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,call.user_id,call.world_id,call.conversation_id,sender.id,recipient.id,sender.name,body,channel,call.id]);
 await enqueueCharacterMemory(q,{userId:call.user_id,worldId:call.world_id,contactId:sender.id,sourceType:'colleague-call',sourceId:id,context:{channel,message:body,recipient:recipient.name,conversationId:call.conversation_id}});
 await enqueueCharacterMemory(q,{userId:call.user_id,worldId:call.world_id,contactId:recipient.id,sourceType:'colleague-call',sourceId:id,context:{channel,message:body,sender:sender.name,conversationId:call.conversation_id}});
 if(audio)await q('INSERT INTO colleague_call_audio(message_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[id,call.user_id]);
}
export async function processColleagueCalls(userId){
 const calls=await sql(`WITH due AS (SELECT id FROM colleague_calls WHERE user_id=$1 AND status='pending' AND (attempted_at IS NULL OR attempted_at<now()-interval '5 minutes') ORDER BY started_at LIMIT 1 FOR UPDATE SKIP LOCKED)
 UPDATE colleague_calls c SET attempted_at=now(),attempts=attempts+1 FROM due WHERE c.id=due.id RETURNING c.*`,[userId]);
 for(const call of calls){
  try{
   const people=await sql('SELECT * FROM contacts WHERE user_id=$1 AND world_id=$2 AND id=ANY($3::uuid[])',[userId,call.world_id,[call.caller_id,call.recipient_id]]);
   const caller=people.find(p=>p.id===call.caller_id),recipient=people.find(p=>p.id===call.recipient_id);
   const matter=await one('SELECT t.title,t.summary,t.status FROM world_conversations c JOIN threads t ON t.id=c.thread_id AND t.user_id=c.user_id WHERE c.id=$1 AND c.user_id=$2 AND c.world_id=$3',[call.conversation_id,userId,call.world_id]);
   const proposal=call.meeting_proposal_id?await one('SELECT * FROM meeting_proposals WHERE id=$1 AND user_id=$2',[call.meeting_proposal_id,userId]):null;
   const world=await one('SELECT timezone FROM worlds WHERE id=$1 AND user_id=$2',[call.world_id,userId]);
   if(!caller||!recipient||!matter||matter.status!=='open'){
    await sql("UPDATE colleague_calls SET status='failed',ended_at=now() WHERE id=$1 AND user_id=$2 AND status='pending'",[call.id,userId]);continue;
   }
   const history=await sql('SELECT sender_name,body,channel FROM world_conversation_messages WHERE user_id=$1 AND conversation_id=$2 ORDER BY created_at DESC LIMIT 12',[userId,call.conversation_id]);
   const externalContext=await realWorldDecisionContext(userId,10);
   const context={caller:contextPerson(caller),recipient:contextPerson(recipient),matter,reason:call.reason,history:history.reverse(),realWorldContext:externalContext,meetingProposal:proposal?{proposalText:proposal.proposal_text,agenda:proposal.agenda,priority:proposal.priority,chairmanPreferredStartAt:proposal.chairman_preferred_start_at,chairmanPreferredTimezone:proposal.chairman_preferred_timezone}:null};
   let outcome=callAvailability(recipient.availability),turns=[],followup=null;
   if(outcome==='available'){
    const raw=await ask('Generate a brief fictional business phone exchange. Each named character has independent interests; alternate caller and recipient, and allow the recipient to decline when appropriate. Use current real-world intelligence when it materially affects the business discussion, explain relevant news or currency/weather risks with source and date, and challenge an unsafe assumption when warranted. Distinguish reported claims from verified facts. If meetingProposal is present, coordinate the proposal. If chairmanPreferredStartAt is present, ask the recipient to confirm that exact slot; if no preferred slot is present, ask for exact options and do not choose or book a time on the Chairman’s behalf. If the recipient agrees to the preferred slot, the caller must repeat and explicitly confirm that same slot in a later turn. If no precise mutual agreement exists, do not imply a booking. Use only provided facts; never claim completed actions, monetary figures or commitments without evidence. Return JSON {outcome:"completed" or "declined",turns:[{speaker:"caller",body:"..."},{speaker:"recipient",body:"..."}]}. Two to four turns, each at most 200 characters. If declined, return empty turns.',JSON.stringify(context),{json:true,fallback:null});
    const parsed=parseCallDialogue(raw);if(!parsed)throw Error('Colleague dialogue unavailable');
    outcome=parsed.outcome;turns=parsed.turns;
   }
   if(outcome!=='completed'){
    const raw=await ask(
     'You are '+caller.name+', the caller. The recipient is '+recipient.name+', '+recipient.title+'. The recipient did not answer your incoming call. Leave a brief message TO THE RECIPIENT, speaking as yourself. Address the recipient by their name or title. Never greet yourself by your own name or claim to be another person. Use only the supplied call reason and history. Do not invent phone numbers, facts, promises or completed actions. Keep under 200 characters. Return JSON {leaveMessage:boolean,mode:"text"|"voicemail",body:string}.',
     JSON.stringify({...context,outcome}),
     {json:true,fallback:null}
    );
    const parsed=parseFollowup(raw,{callerName:caller.name});
    const decision=parsed||(raw?.leaveMessage===true?fallbackFollowup({recipientName:recipient.name,recipientTitle:recipient.title,reason:call.reason,callDirection:'incoming'}):null);
    if(!decision)throw Error('Colleague follow-up unavailable');
    if(decision.leaveMessage)followup={body:decision.body,mode:decision.mode};
   }
   let saved=false;
   await transaction(async q=>{
    const [lock]=await q("SELECT id FROM colleague_calls WHERE id=$1 AND user_id=$2 AND status='pending' FOR UPDATE",[call.id,userId]);if(!lock)return;
    const [current]=await q("SELECT id FROM world_conversations WHERE id=$1 AND user_id=$2 AND status='open' FOR UPDATE",[call.conversation_id,userId]);if(!current){await q("UPDATE colleague_calls SET status='failed',ended_at=now() WHERE id=$1 AND user_id=$2",[call.id,userId]);return;}
    for(const turn of turns){const sender=turn.speaker==='caller'?caller:recipient;await recordMessage(q,call,sender,sender.id===caller.id?recipient:caller,turn.body,'call-transcript',true);}
    if(followup)await recordMessage(q,call,caller,recipient,followup.body,followup.mode==='voicemail'?'colleague-voicemail':'missed-call',followup.mode==='voicemail');
    await q("UPDATE colleague_calls SET status=$3,ended_at=now() WHERE id=$1 AND user_id=$2",[call.id,userId,outcome]);
    if(turns.length||followup)await q('UPDATE world_conversations SET last_message_at=now(),updated_at=now() WHERE id=$1 AND user_id=$2',[call.conversation_id,userId]);
    await q('INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),userId,call.world_id,caller.id,'colleague-call-'+outcome,caller.name+' called '+recipient.name,call.reason+(followup?' · A follow-up message was left.':'')]);
    saved=true;
   });
   if(!saved)continue;
   let calendarEvent=null,calendarIssue='';
   if(proposal){
    const slot=outcome==='completed'?acceptedMeetingSlot(turns,call.reason,proposal,world?.timezone):null;
    if(!slot){
     calendarIssue=outcome!=='completed'?'The colleague call did not complete, so no invitation was created.':proposal.chairman_preferred_start_at?'The recipient did not confirm the Chairman’s preferred slot. No invitation was added; review the transcript and choose a confirmed time.':'The recipient’s availability options have been recorded, but the Chairman has not selected a preferred slot. No invitation was added.';
    }
    if(slot){
     try{
      const created=await createCalendarEvent({userId,worldId:call.world_id,attendeeIds:[recipient.id],title:('Meeting with '+recipient.name+' · '+String(proposal.agenda||'Business discussion')).slice(0,140),agenda:proposal.agenda||proposal.proposal_text,startsAt:slot.startAt,durationMinutes:30,timezone:slot.timezone,timezoneLabel:slot.timezoneLabel,status:'confirmed',source:'colleague-call',sourceContactId:recipient.id,sourceMessageId:proposal.source_message_id,coordinatorContactId:caller.id,idempotencyKey:'colleague-call:'+call.id});
      calendarEvent=created.event;
     }catch(error){calendarIssue=error instanceof CalendarConflictError?'The agreed slot conflicts with '+error.conflictTitle+'.':String(error.message||'The calendar invitation could not be saved.');}
    }
    await sql(calendarEvent?"UPDATE meeting_proposals SET status='scheduled',scheduled_event_id=$3,updated_at=now() WHERE id=$1 AND user_id=$2":"UPDATE meeting_proposals SET status='needs-chairman',updated_at=now() WHERE id=$1 AND user_id=$2",calendarEvent?[proposal.id,userId,calendarEvent.id]:[proposal.id,userId]);
   }
   if(call.report_to_chairman)await deliverColleagueCallReport(call,caller,recipient,turns,outcome,followup,proposal,calendarEvent,calendarIssue);
  }catch(error){
   console.warn('Colleague call deferred',error.code||error.name);
   if(call.attempts>=5)await transaction(async q=>{
    const rows=await q("UPDATE colleague_calls SET status='failed',ended_at=now() WHERE id=$1 AND user_id=$2 AND status='pending' RETURNING id",[call.id,userId]);if(rows.length)await q('INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),userId,call.world_id,call.caller_id,'colleague-call-failed','Colleague call could not complete',call.reason+' · AI service unavailable after retries.']);
   });
  }
 }
}
export async function processColleagueAudio(userId){
 const jobs=await sql(`WITH due AS (SELECT a.message_id FROM colleague_call_audio a JOIN world_conversation_messages m ON m.id=a.message_id AND m.user_id=a.user_id WHERE a.user_id=$1 AND a.audio IS NULL AND a.attempts<5 AND (a.attempted_at IS NULL OR a.attempted_at<now()-interval '5 minutes') ORDER BY m.created_at LIMIT 2 FOR UPDATE OF a SKIP LOCKED)
 UPDATE colleague_call_audio a SET attempted_at=now(),attempts=attempts+1 FROM due WHERE a.message_id=due.message_id RETURNING a.message_id`,[userId]);
 for(const job of jobs){
  const m=await one('SELECT m.body,c.id,c.voice_id,c.name,c.title FROM world_conversation_messages m JOIN contacts c ON c.id=m.sender_contact_id AND c.user_id=m.user_id WHERE m.id=$1 AND m.user_id=$2',[job.message_id,userId]);if(!m)continue;
  const audio=await synthesizeVoicemail(m.body,m);if(!audio)continue;
  await transaction(async q=>{await q('UPDATE colleague_call_audio SET audio=$3 WHERE message_id=$1 AND user_id=$2 AND audio IS NULL',[job.message_id,userId,audio]);await q('UPDATE world_conversation_messages SET audio_available=true WHERE id=$1 AND user_id=$2',[job.message_id,userId]);});
 }
}
export async function readColleagueAudio(userId,messageId){
 const row=await one('SELECT a.audio FROM colleague_call_audio a JOIN world_conversation_messages m ON m.id=a.message_id AND m.user_id=a.user_id WHERE a.message_id=$1 AND a.user_id=$2 AND a.audio IS NOT NULL',[messageId,userId]);
 if(!row)throw new HttpError(404,'Recording unavailable.');
 return new Response(row.audio,{headers:{'Content-Type':'audio/wav','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
}
export async function colleagueCallSnapshot(userId){return sql('SELECT * FROM colleague_calls WHERE user_id=$1 ORDER BY started_at DESC LIMIT 200',[userId]);}
