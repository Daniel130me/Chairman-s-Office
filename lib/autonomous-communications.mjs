import {sql,one,transaction,uid} from '../backend/src/db.mjs';
import {ask} from '../backend/src/ai.mjs';
import {localTime,isQuiet} from './schedule.mjs';
function parseMessage(value){
 if(!value||typeof value!=='object'||typeof value.message!=='string')return null;
 const message=value.message.trim().slice(0,1600);
 if(!message)return null;
 return {message,needsChairman:value.needsChairman===true,callReason:typeof value.callReason==='string'?value.callReason.trim().slice(0,180):''};
}
async function reserve(userId){
 return transaction(async q=>{
  const w=(await q('SELECT * FROM worlds WHERE user_id=$1 FOR UPDATE',[userId]))[0];
  if(!w)return null;
  if(w.last_communication_at&&Date.now()-new Date(w.last_communication_at).getTime()<20*60*1000)return null;
  const s=(await q('SELECT * FROM settings WHERE user_id=$1',[userId]))[0];
  if(!s)return null;
  const now=localTime(w.timezone);
  const quiet=!!s.quiet_enabled&&isQuiet(now.minute,s.quiet_start,s.quiet_end);
  const thread=(await q("SELECT * FROM threads WHERE user_id=$1 AND status='open' ORDER BY CASE priority WHEN 'high' THEN 0 ELSE 1 END,updated_at ASC LIMIT 1",[userId]))[0];
  if(!thread)return null;
  const first=(await q('SELECT * FROM contacts WHERE id=$1 AND user_id=$2 AND world_id=$3',[thread.contact_id,userId,w.id]))[0];
  if(!first)return null;
  const second=(await q(`SELECT * FROM contacts WHERE user_id=$1 AND world_id=$2 AND id<>$3
    ORDER BY CASE
      WHEN $4='internal' AND kind<>'internal' THEN 0
      WHEN $4<>'internal' AND title IN ('Group CFO','Chief of Staff','General Counsel') THEN 0
      WHEN title='Group CFO' THEN 1 ELSE 2 END,
      last_contact_at DESC NULLS LAST,name LIMIT 1`,[userId,w.id,first.id,first.kind]))[0];
  if(!second)return null;
  let conversation=(await q('INSERT INTO world_conversations(id,user_id,world_id,thread_id,title) VALUES($1,$2,$3,$4,$5) ON CONFLICT(user_id,thread_id) DO UPDATE SET updated_at=now() RETURNING *',[uid(),userId,w.id,thread.id,thread.title]))[0];
  for(const c of [first,second])await q('INSERT INTO world_conversation_participants(user_id,conversation_id,contact_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[userId,conversation.id,c.id]);
  const history=await q('SELECT sender_name,body FROM world_conversation_messages WHERE user_id=$1 AND conversation_id=$2 ORDER BY created_at DESC LIMIT 8',[userId,conversation.id]);
  let speaker=first;
  if(history.length){
   const last=history[0];
   if(last.sender_name===first.name)speaker=second;
  }
  const recipient=speaker.id===first.id?second:first;
  await q('UPDATE worlds SET last_communication_at=now() WHERE id=$1',[w.id]);
  return {world:w,settings:s,thread,first,second,conversation,speaker,recipient,quiet,history:history.reverse()};
 });
}
export async function processAutonomousCommunications(userId){
 const ctx=await reserve(userId);
 if(!ctx)return false;
 const {world,thread,first,second,conversation,speaker,recipient,history,settings,quiet}=ctx;
 const raw=await ask(
  'You write one authentic message in an ongoing fictional business conversation between two people. Return JSON only: {"message":"...","needsChairman":false,"callReason":""}. Speak only as the named speaker. Use only facts in supplied context and conversation. Do not invent financial figures, completed work, external facts or promises. A call to the Chairman is warranted only when a decision, urgent risk or material opportunity genuinely requires the Chairman. Do not create artificial urgency. If no meaningful update exists, return {"message":"","needsChairman":false,"callReason":""}.',
  JSON.stringify({world:{name:world.name,region:world.region},matter:{title:thread.title,summary:thread.summary,priority:thread.priority},speaker:{name:speaker.name,title:speaker.title,company:speaker.company,temperament:speaker.temperament,agenda:speaker.agenda},recipient:{name:recipient.name,title:recipient.title,company:recipient.company,temperament:recipient.temperament,agenda:recipient.agenda},recentConversation:history}),
  {json:true,fallback:null}
 );
 const decision=parseMessage(raw);
 if(!decision)return false;
 await transaction(async q=>{
  const current=(await q("SELECT id FROM world_conversations WHERE id=$1 AND user_id=$2 AND status='open' FOR UPDATE",[conversation.id,userId]))[0];
  if(!current)return;
  await q('INSERT INTO world_conversation_messages(id,user_id,world_id,conversation_id,sender_contact_id,recipient_contact_id,sender_name,body) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[uid(),userId,world.id,conversation.id,speaker.id,recipient.id,speaker.name,decision.message]);
  await q('UPDATE world_conversations SET last_message_at=now(),updated_at=now() WHERE id=$1',[conversation.id]);
  await q('INSERT INTO events(id,user_id,world_id,thread_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[uid(),userId,world.id,thread.id,speaker.id,'colleague-message',thread.title,speaker.name+' to '+recipient.name+': '+decision.message]);
  await q('UPDATE contacts SET last_contact_at=now() WHERE id=ANY($1::uuid[])',[ [speaker.id,recipient.id] ]);
  if(decision.needsChairman&&decision.callReason&&!quiet){
   const count=(await q("SELECT count(*)::int n FROM invites WHERE user_id=$1 AND created_at>=now()-interval '24 hours'",[userId]))[0].n;
   if(count<settings.max_daily){
    await q('INSERT INTO invites(id,user_id,world_id,contact_id,thread_id,kind,subject,preview,due_at,schedule_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now(),$9) ON CONFLICT(user_id,schedule_key) DO NOTHING',[uid(),userId,world.id,speaker.id,thread.id,'network','Incoming call · '+speaker.name,decision.callReason,'autonomous-call:'+conversation.id+':'+new Date().toISOString().slice(0,13)]);
   }
  }
 });
 return true;
}
export async function sendWorldMessage(user,conversationId,body){
 body=String(body||'').trim().slice(0,2500);
 if(!body)throw new Error('Write a message.');
 const ctx=await transaction(async q=>{
  const c=(await q('SELECT * FROM world_conversations WHERE id=$1 AND user_id=$2 AND status=$3 FOR UPDATE',[conversationId,user.id,'open']))[0];
  if(!c)throw new Error('Conversation unavailable.');
  const participants=await q('SELECT p.contact_id,c.name,c.title,c.company,c.temperament,c.agenda FROM world_conversation_participants p JOIN contacts c ON c.id=p.contact_id AND c.user_id=p.user_id WHERE p.user_id=$1 AND p.conversation_id=$2 ORDER BY p.joined_at',[user.id,c.id]);
  if(!participants.length)throw new Error('Conversation has no participants.');
  await q('INSERT INTO world_conversation_messages(id,user_id,world_id,conversation_id,sender_name,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,c.world_id,c.id,user.name,body]);
  const history=await q('SELECT sender_name,body FROM world_conversation_messages WHERE user_id=$1 AND conversation_id=$2 ORDER BY created_at DESC LIMIT 12',[user.id,c.id]);
  await q('UPDATE world_conversations SET last_message_at=now(),updated_at=now() WHERE id=$1',[c.id]);
  return {conversation:c,participants,history:history.reverse()};
 });
 const speaker=ctx.participants[Math.max(0,(ctx.history.length-1)%ctx.participants.length)];
 const raw=await ask(
  'You are '+speaker.name+', '+speaker.title+' at '+speaker.company+'. Reply in your own voice in a fictional internal business group conversation. Keep to facts supplied in the thread and history. Do not claim an action is complete unless an actual action tool result is supplied. Do not invent data. Return JSON only: {"reply":"..."}',
  JSON.stringify({matter:ctx.conversation.title,participants:ctx.participants,history:ctx.history}),
  {json:true,fallback:null}
 );
 const reply=typeof raw?.reply==='string'?raw.reply.trim().slice(0,1600):'';
 if(!reply)return {delivery:'saved-no-reply'};
 await transaction(async q=>{
  const still=(await q("SELECT id FROM world_conversations WHERE id=$1 AND user_id=$2 AND status='open' FOR UPDATE",[conversationId,user.id]))[0];
  if(!still)return;
  await q('INSERT INTO world_conversation_messages(id,user_id,world_id,conversation_id,sender_contact_id,sender_name,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),user.id,ctx.conversation.world_id,conversationId,speaker.contact_id,speaker.name,reply]);
  await q('UPDATE world_conversations SET last_message_at=now(),updated_at=now() WHERE id=$1',[conversationId]);
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,ctx.conversation.world_id,'chairman-group-message',ctx.conversation.title,user.name+' posted in the conversation; '+speaker.name+' replied.']);
 });
 return {reply};
}
export async function communicationSnapshot(userId){
 const conversations=await sql(`SELECT w.*,t.summary AS matter_summary,
  coalesce((SELECT json_agg(json_build_object('id',c.id,'name',c.name,'title',c.title) ORDER BY c.name)
    FROM world_conversation_participants p JOIN contacts c ON c.id=p.contact_id AND c.user_id=p.user_id
    WHERE p.conversation_id=w.id AND p.user_id=w.user_id),'[]'::json) participants,
  (SELECT body FROM world_conversation_messages m WHERE m.conversation_id=w.id AND m.user_id=w.user_id ORDER BY created_at DESC LIMIT 1) last_message
  FROM world_conversations w JOIN threads t ON t.id=w.thread_id AND t.user_id=w.user_id
  WHERE w.user_id=$1 ORDER BY w.last_message_at DESC NULLS LAST,w.created_at DESC LIMIT 50`,[userId]);
 const worldConversationMessages=await sql('SELECT * FROM world_conversation_messages WHERE user_id=$1 ORDER BY created_at DESC LIMIT 500',[userId]);
 return {worldConversations:conversations,worldConversationMessages};
}
