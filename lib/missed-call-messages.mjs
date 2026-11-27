import { sql, transaction, uid } from '../backend/src/db.mjs';
import { ask } from '../backend/src/ai.mjs';
import {synthesizeVoicemail,saveSyntheticAudio} from './voice-notes.mjs';
import {parseFollowup,fallbackFollowup} from './voicemail-rules.mjs';
export {parseFollowup,fallbackFollowup} from './voicemail-rules.mjs';
export const outgoingFollowupStatuses=Object.freeze(['missed','declined']);

// A provider failure is not a character decision. Leave the job retryable.
export async function processMissedCallMessages(limit = 2) {
  // Only new calls after this feature is enabled; do not flood old inboxes.
  const jobs = await sql(`WITH candidates AS (
    SELECT i.id FROM invites i
    WHERE i.status IN ('missed','declined') AND i.followup_state='pending'
      AND i.due_at<=now()
      AND (i.followup_attempt_at IS NULL OR i.followup_attempt_at < now()-interval '5 minutes')
    ORDER BY i.due_at LIMIT $1 FOR UPDATE SKIP LOCKED
  )
  UPDATE invites i SET followup_attempt_at=now()
  FROM candidates c WHERE i.id=c.id RETURNING i.*`, [limit]);
  for (const job of jobs) {
    try {
      const [contact] = await sql('SELECT id,name,title,company,temperament,agenda,voice_id FROM contacts WHERE id=$1 AND user_id=$2 AND world_id=$3', [job.contact_id,job.user_id,job.world_id]);
      if (!contact) continue;
      const history = await sql('SELECT direction,body FROM messages WHERE user_id=$1 AND contact_id=$2 ORDER BY created_at DESC LIMIT 8',[job.user_id,job.contact_id]);
      const [matter] = job.thread_id ? await sql('SELECT title,summary FROM threads WHERE id=$1 AND user_id=$2 AND contact_id=$3',[job.thread_id,job.user_id,job.contact_id]) : [];
      const [chairman]=await sql('SELECT name FROM users WHERE id=$1',[job.user_id]);
      const chairmanName=chairman?.name||'Chairman';
      const raw = await ask(
        'You are '+contact.name+', '+contact.title+', the caller. The recipient is Chairman '+chairmanName+'. The Chairman did not answer your incoming call. You are leaving a short voicemail or text TO HIM, speaking in your own first-person identity. Address him as Chairman '+chairmanName+' or Chairman. Never greet yourself by your own name. Never say you missed his call: he missed your incoming call. Use only the supplied call reason and history. Do not invent names, phone numbers, contact details, promises, deadlines, facts or completed actions. No phone numbers. Keep a voicemail under 200 characters. Return only JSON {leaveMessage:boolean,mode:"text"|"voicemail",body:string}.',
        JSON.stringify({caller:{name:contact.name,title:contact.title,company:contact.company,temperament:contact.temperament,agenda:contact.agenda},recipient:{name:chairmanName,title:'Chairman'},call:{direction:'incoming',subject:job.subject,reason:job.preview,status:job.status},matter,history:history.reverse()}),
        {json:true,fallback:null}
      );
      const parsed=parseFollowup(raw,{callerName:contact.name});
      const decision=parsed||(raw?.leaveMessage===true?fallbackFollowup({recipientName:chairmanName,recipientTitle:'Chairman',reason:job.preview,callDirection:'incoming'}):null);
      if (!decision) continue;
      const audio=decision.leaveMessage&&decision.mode==='voicemail'?await synthesizeVoicemail(decision.body,contact):null;
      await transaction(async q => {
        const [current] = await q("SELECT id FROM invites WHERE id=$1 AND user_id=$2 AND status IN ('missed','declined') AND followup_state='pending' FOR UPDATE",[job.id,job.user_id]);
        if (!current) return;
        if (decision.leaveMessage) {
          const inserted=await q("INSERT INTO messages(id,user_id,world_id,contact_id,direction,channel,body,source_invite_id) VALUES($1,$2,$3,$4,'incoming',$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id",[uid(),job.user_id,job.world_id,job.contact_id,audio?'voicemail':'missed-call',decision.body,job.id]);
          if(inserted.length&&audio)await saveSyntheticAudio(q,inserted[0].id,job.user_id,audio);
          if(inserted.length)await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),job.user_id,job.world_id,'missed-call-message','Missed call message · '+contact.name,'A caller left a message after an unanswered call.']);
        }
        await q('UPDATE invites SET followup_state=$1 WHERE id=$2 AND user_id=$3',[decision.leaveMessage?'sent':'skipped',job.id,job.user_id]);
      });
    } catch (error) {
      console.warn('Missed-call follow-up deferred',error.code||error.name);
    }
  }
  // If the Chairman called an unavailable contact, that contact may also leave a
  // contextual follow-up. This is a separate durable queue from unanswered inbound calls.
  const outgoing=await sql(`WITH candidates AS (
    SELECT c.id FROM calls c WHERE c.status=ANY($2::text[]) AND c.followup_state='pending'
      AND (c.followup_attempt_at IS NULL OR c.followup_attempt_at<now()-interval '5 minutes')
    ORDER BY c.ended_at LIMIT $1 FOR UPDATE SKIP LOCKED
  ) UPDATE calls c SET followup_attempt_at=now() FROM candidates x WHERE c.id=x.id RETURNING c.*`,[limit,outgoingFollowupStatuses]);
  for(const job of outgoing){
   try{
    const [contact]=await sql('SELECT id,name,title,company,temperament,agenda,voice_id FROM contacts WHERE id=$1 AND user_id=$2 AND world_id=$3',[job.contact_id,job.user_id,job.world_id]);
    if(!contact)continue;
    const history=await sql('SELECT direction,body FROM messages WHERE user_id=$1 AND contact_id=$2 ORDER BY created_at DESC LIMIT 8',[job.user_id,job.contact_id]);
    const [chairman]=await sql('SELECT name FROM users WHERE id=$1',[job.user_id]);
    const chairmanName=chairman?.name||'Chairman';
    const raw=await ask(
     'You are '+contact.name+', '+contact.title+'. The Chairman, '+chairmanName+', called you and you did not answer. You are now leaving a message TO THE CHAIRMAN, in your own first-person identity. Address him as Chairman '+chairmanName+' or Chairman. Acknowledge that you missed his call, not that he missed yours. Do not greet yourself by name. Do not invent a reason, names, phone numbers, contact details, promises or completed actions. Keep a voicemail under 200 characters. Return only JSON {leaveMessage:boolean,mode:"text"|"voicemail",body:string}.',
     JSON.stringify({caller:{name:contact.name,title:contact.title,company:contact.company,temperament:contact.temperament,agenda:contact.agenda},recipient:{name:chairmanName,title:'Chairman'},call:{direction:'outgoing',status:job.status,summary:job.summary,transcript:job.transcript},history:history.reverse()}),
     {json:true,fallback:null}
    );
    const parsed=parseFollowup(raw,{callerName:contact.name});
    const decision=parsed||(raw?.leaveMessage===true?fallbackFollowup({recipientName:chairmanName,recipientTitle:'Chairman',callDirection:'outgoing'}):null);
    if(!decision)continue;
    if(!decision.leaveMessage){
     await transaction(async q=>{await q("UPDATE calls SET followup_state='skipped' WHERE id=$1 AND user_id=$2 AND followup_state='pending'",[job.id,job.user_id]);});
     continue;
    }
    const body=decision.body;
    const audio=decision.mode==='voicemail'?await synthesizeVoicemail(body,contact):null;
    await transaction(async q=>{
     const current=(await q("SELECT id FROM calls WHERE id=$1 AND user_id=$2 AND status=ANY($3::text[]) AND followup_state='pending' FOR UPDATE",[job.id,job.user_id,outgoingFollowupStatuses]))[0];
     if(!current)return;
     const inserted=await q("INSERT INTO messages(id,user_id,world_id,contact_id,direction,channel,body,source_call_id) VALUES($1,$2,$3,$4,'incoming',$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id",[uid(),job.user_id,job.world_id,job.contact_id,audio?'voicemail':'missed-call',body,job.id]);
     if(inserted.length&&audio)await saveSyntheticAudio(q,inserted[0].id,job.user_id,audio);
     if(inserted.length)await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),job.user_id,job.world_id,'missed-call-message','Missed call message · '+contact.name,'A contact left a message after your unanswered call.']);
     await q("UPDATE calls SET followup_state='sent' WHERE id=$1 AND user_id=$2",[job.id,job.user_id]);
    });
   }catch(error){console.warn('Outgoing missed-call follow-up deferred',error.code||error.name);}
  }
}
