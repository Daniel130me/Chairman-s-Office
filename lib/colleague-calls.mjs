import {sql,one,uid,transaction} from '../backend/src/db.mjs';
import {ask} from '../backend/src/ai.mjs';
import {synthesizeVoicemail} from './voice-notes.mjs';
import {HttpError} from './validation.mjs';
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
export async function queueColleagueCall(q,{world,conversation,speaker,recipient,reason}){
 const body=clean(reason,500);if(!body||speaker.id===recipient.id)return false;
 const key='colleague-call:'+conversation.id+':'+new Date().toISOString().slice(0,13);
 const inserted=await q(`INSERT INTO colleague_calls(id,user_id,world_id,conversation_id,caller_id,recipient_id,reason,operation_key)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(user_id,operation_key) DO NOTHING RETURNING id`,
 [uid(),world.user_id,world.id,conversation.id,speaker.id,recipient.id,body,key]);
 return !!inserted.length;
}
const contextPerson=p=>({name:p.name,title:p.title,company:p.company,temperament:p.temperament,agenda:p.agenda,availability:p.availability});
async function recordMessage(q,call,sender,recipient,body,channel,audio){
 const id=uid();
 await q('INSERT INTO world_conversation_messages(id,user_id,world_id,conversation_id,sender_contact_id,recipient_contact_id,sender_name,body,channel,source_colleague_call_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,call.user_id,call.world_id,call.conversation_id,sender.id,recipient.id,sender.name,body,channel,call.id]);
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
   if(!caller||!recipient||!matter||matter.status!=='open'){
    await sql("UPDATE colleague_calls SET status='failed',ended_at=now() WHERE id=$1 AND user_id=$2 AND status='pending'",[call.id,userId]);continue;
   }
   const history=await sql('SELECT sender_name,body,channel FROM world_conversation_messages WHERE user_id=$1 AND conversation_id=$2 ORDER BY created_at DESC LIMIT 12',[userId,call.conversation_id]);
   const context={caller:contextPerson(caller),recipient:contextPerson(recipient),matter,reason:call.reason,history:history.reverse()};
   let outcome=callAvailability(recipient.availability),turns=[],followup=null;
   if(outcome==='available'){
    const raw=await ask('Generate a brief fictional business phone exchange. Each named character has independent interests; alternate caller and recipient, and allow the recipient to decline when appropriate. Use only provided facts; never claim completed actions, monetary figures or commitments without evidence. Return JSON {outcome:"completed" or "declined",turns:[{speaker:"caller",body:"..."},{speaker:"recipient",body:"..."}]}. Two to four turns, each at most 200 characters. If declined, return empty turns.',JSON.stringify(context),{json:true,fallback:null});
    const parsed=parseCallDialogue(raw);if(!parsed)throw Error('Colleague dialogue unavailable');
    outcome=parsed.outcome;turns=parsed.turns;
   }
   if(outcome!=='completed'){
    const raw=await ask('You are the named fictional caller. Decide whether to leave a message after this unanswered call. Return JSON {leaveMessage:true or false,mode:"text" or "voicemail",body:"..."}. Use the reason and history only. Do not fabricate facts. Keep under 200 characters.',JSON.stringify({...context,outcome}),{json:true,fallback:null});
    if(typeof raw?.leaveMessage!=='boolean')throw Error('Colleague follow-up unavailable');
    if(raw.leaveMessage){const body=clean(raw.body);if(!body)throw Error('Colleague follow-up empty');followup={body,mode:raw.mode==='voicemail'?'voicemail':'text'};}
   }
   await transaction(async q=>{
    const [lock]=await q("SELECT id FROM colleague_calls WHERE id=$1 AND user_id=$2 AND status='pending' FOR UPDATE",[call.id,userId]);if(!lock)return;
    const [current]=await q("SELECT id FROM world_conversations WHERE id=$1 AND user_id=$2 AND status='open' FOR UPDATE",[call.conversation_id,userId]);if(!current){await q("UPDATE colleague_calls SET status='failed',ended_at=now() WHERE id=$1 AND user_id=$2",[call.id,userId]);return;}
    for(const turn of turns){const sender=turn.speaker==='caller'?caller:recipient;await recordMessage(q,call,sender,sender.id===caller.id?recipient:caller,turn.body,'call-transcript',true);}
    if(followup)await recordMessage(q,call,caller,recipient,followup.body,followup.mode==='voicemail'?'colleague-voicemail':'missed-call',followup.mode==='voicemail');
    await q("UPDATE colleague_calls SET status=$3,ended_at=now() WHERE id=$1 AND user_id=$2",[call.id,userId,outcome]);
    if(turns.length||followup)await q('UPDATE world_conversations SET last_message_at=now(),updated_at=now() WHERE id=$1 AND user_id=$2',[call.conversation_id,userId]);
    await q('INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),userId,call.world_id,caller.id,'colleague-call-'+outcome,caller.name+' called '+recipient.name,call.reason+(followup?' · A follow-up message was left.':'')]);
   });
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
  const m=await one('SELECT m.body,c.id,c.voice_id FROM world_conversation_messages m JOIN contacts c ON c.id=m.sender_contact_id AND c.user_id=m.user_id WHERE m.id=$1 AND m.user_id=$2',[job.message_id,userId]);if(!m)continue;
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
