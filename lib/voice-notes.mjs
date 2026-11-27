import {sql,one,uid,transaction} from '../backend/src/db.mjs';
import {ask} from '../backend/src/ai.mjs';
import {handleCallIntent} from './executive-call-intent.mjs';
import {fallbackFollowup} from './voicemail-rules.mjs';
import {HttpError,uuid} from './validation.mjs';
export const MAX_AUDIO_BYTES=2097152;
const voices=['autumn','diana','hannah','austin','daniel','troy'];
const ext={'audio/webm':'webm','audio/ogg':'ogg','audio/mp4':'m4a','audio/wav':'wav','audio/mpeg':'mp3'};
export function audioMime(input){const mime=String(input||'').split(';')[0].trim().toLowerCase();return Object.hasOwn(ext,mime)?mime:null;}
const femaleNames=new Set(['amara','daniella','danielle','aisha','elena','ruth','grace','nadia','maya','sophia','farah','priya','isabelle','aurelia','sarah','mary','julia','emma','olivia','fatima','chioma','ada','ngozi']);
const maleNames=new Set(['daniel','marcus','victor','samuel','tunde','david','omar','kwame','julian','rafael','alex','michael','james','john','peter','ibrahim','chidi','emeka']);
export function voiceForContact(id,preferred,name='',title=''){
 if(voices.includes(preferred))return preferred;
 let hash=0;for(const ch of String(id))hash=(Math.imul(hash,31)+ch.charCodeAt(0))>>>0;
 const first=String(name||'').trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z'-]/g,'');
 const role=String(title||'').toLowerCase();
 if(femaleNames.has(first))return role==='chief of staff'?'autumn':['autumn','diana','hannah'][hash%3];
 if(maleNames.has(first))return ['austin','daniel','troy'][hash%3];
 return voices[hash%voices.length];
}
export function validAudio(bytes,mime){
 if(!bytes||bytes.length<16||bytes.length>MAX_AUDIO_BYTES)return false;
 const at=(offset,text)=>Array.from(text).every((ch,i)=>bytes[offset+i]===ch.charCodeAt(0));
 switch(mime){
 case 'audio/webm':return bytes[0]===26&&bytes[1]===69&&bytes[2]===223&&bytes[3]===163;
 case 'audio/ogg':return at(0,'OggS');
 case 'audio/mp4':return at(4,'ftyp');
 case 'audio/wav':return at(0,'RIFF')&&at(8,'WAVE');
 case 'audio/mpeg':return at(0,'ID3')||(bytes[0]===255&&(bytes[1]&224)===224);
 default:return false;
 }
}
async function boundedBytes(request){
 if(Number(request.headers.get('content-length')||0)>MAX_AUDIO_BYTES)throw new HttpError(413,'Recording is too large.');
 const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'Recording required.');
 let total=0;const chunks=[];
 for(;;){const {value,done}=await reader.read();if(done)break;total+=value.byteLength;if(total>MAX_AUDIO_BYTES){await reader.cancel();throw new HttpError(413,'Recording is too large.');}chunks.push(value);}
 return Buffer.concat(chunks);
}
const endpoint='https://api.groq.com/openai/v1/audio/';
export async function synthesizeVoicemail(text,contact){
 if(!process.env.GROQ_API_KEY||!text||text.length>180)return null;
 try{
  const r=await fetch(endpoint+'speech',{method:'POST',headers:{Authorization:'Bearer '+process.env.GROQ_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:'canopylabs/orpheus-v1-english',input:'[professionally] '+text,voice:voiceForContact(contact.id,contact.voice_id,contact.name,contact.title),response_format:'wav'}),signal:AbortSignal.timeout(15000)});
  if(!r.ok)return null;const bytes=await boundedBytes(r);return validAudio(bytes,'audio/wav')?bytes:null;
 }catch(error){console.warn('Voicemail synthesis unavailable',error.name);return null;}
}
async function transcribe(audio,mime){
 if(!process.env.GROQ_API_KEY)return null;
 try{
  const form=new FormData();form.append('file',new Blob([audio],{type:mime}),'recording.'+ext[mime]);form.append('model','whisper-large-v3-turbo');
  const r=await fetch(endpoint+'transcriptions',{method:'POST',headers:{Authorization:'Bearer '+process.env.GROQ_API_KEY},body:form,signal:AbortSignal.timeout(20000)});
  if(!r.ok)return null;const data=await r.json();return typeof data.text==='string'&&data.text.trim()?data.text.trim().slice(0,3500):null;
 }catch(error){console.warn('Voice transcription unavailable',error.name);return null;}
}
export async function transcribeMeetingAudio(user,meetingId,request){
 if(request.headers.get('x-transcription-consent')!=='1')throw new HttpError(400,'Microphone transcription consent is required.');
 const meeting=await one("SELECT id FROM meetings WHERE id=$1 AND user_id=$2 AND status<>'concluded'",[meetingId,user.id]);if(!meeting)throw new HttpError(404,'Meeting unavailable.');
 const mime=audioMime(request.headers.get('content-type'));if(!mime)throw new HttpError(415,'Unsupported meeting audio.');
 const audio=await boundedBytes(request);if(!validAudio(audio,mime))throw new HttpError(400,'Invalid meeting recording.');
 const text=await transcribe(audio,mime);if(!text)throw new HttpError(503,'Speech transcription unavailable or no speech recognised.');
 // Audio is not stored by the application; only confirmed text is submitted to the meeting.
 return {text:text.slice(0,3000)};
}
export async function uploadVoiceNote(user,contactId,request){
 const key=uuid(request.headers.get('x-message-key'),'message key');
 const callId=request.headers.get('x-source-call-id')?uuid(request.headers.get('x-source-call-id'),'call'):null;
 if(request.headers.get('x-transcription-consent')!=='1')throw new HttpError(400,'Recording and transcription consent is required.');
 const mime=audioMime(request.headers.get('content-type'));if(!mime)throw new HttpError(415,'Unsupported audio format.');
 const audio=await boundedBytes(request);if(!validAudio(audio,mime))throw new HttpError(400,'Invalid audio recording.');
 return transaction(async q=>{
  const [c]=await q('SELECT id,world_id,name FROM contacts WHERE id=$1 AND user_id=$2',[contactId,user.id]);if(!c)throw new HttpError(404,'Contact unavailable.');
  const [prior]=await q('SELECT id,contact_id,source_call_id FROM messages WHERE user_id=$1 AND client_message_key=$2',[user.id,key]);
  if(prior){if(prior.contact_id!==c.id||prior.source_call_id!==callId)throw new HttpError(409,'Message key already used.');return {id:prior.id,alreadySaved:true};}
  if(callId){const [call]=await q("SELECT id FROM calls WHERE id=$1 AND user_id=$2 AND world_id=$3 AND contact_id=$4 AND status IN ('missed','declined')",[callId,user.id,c.world_id,c.id]);if(!call)throw new HttpError(404,'Call unavailable.');}
  const [quota]=await q("SELECT count(*)::int AS n FROM voice_notes WHERE user_id=$1 AND created_at>=now()-interval '24 hours' AND NOT synthetic",[user.id]);if(quota.n>=30)throw new HttpError(429,'Daily recording limit reached.');
  const id=uid();
  const rows=await q("INSERT INTO messages(id,user_id,world_id,contact_id,direction,channel,body,source_call_id,audio_available,transcription_status,client_message_key) VALUES($1,$2,$3,$4,'outgoing',$5,'Voice recording — transcription pending',$6,true,'pending',$7) ON CONFLICT DO NOTHING RETURNING id",[id,user.id,c.world_id,c.id,callId?'voicemail':'voice-note',callId,key]);
  if(!rows.length){const [existing]=await q('SELECT id,contact_id,source_call_id FROM messages WHERE user_id=$1 AND client_message_key=$2',[user.id,key]);if(!existing||existing.contact_id!==c.id||existing.source_call_id!==callId)throw new HttpError(409,'Message key already used.');return {id:existing.id,alreadySaved:true};}
  await q('INSERT INTO voice_notes(message_id,user_id,mime_type,audio) VALUES($1,$2,$3,$4)',[id,user.id,mime,audio]);
  await q("INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,'voice-note-sent',$5,$6)",[uid(),user.id,c.world_id,c.id,'Voice message to '+c.name,'Chairman recorded a voice message.']);
  return {id,queued:true};
 });
}
export async function readVoiceNote(userId,messageId){
 const row=await one('SELECT v.audio,v.mime_type FROM voice_notes v JOIN messages m ON m.id=v.message_id AND m.user_id=v.user_id WHERE v.message_id=$1 AND v.user_id=$2',[messageId,userId]);
 if(!row)throw new HttpError(404,'Voice recording unavailable.');
 return new Response(row.audio,{headers:{'Content-Type':row.mime_type,'Cache-Control':'private, no-store','Content-Length':String(row.audio.length),'X-Content-Type-Options':'nosniff','Content-Disposition':'inline'}});
}
async function repairHistoricalVoicemails(limit=2){
 const jobs=await sql(`WITH due AS (
  SELECT v.message_id FROM voice_notes v
  JOIN messages m ON m.id=v.message_id AND m.user_id=v.user_id
  JOIN contacts c ON c.id=m.contact_id AND c.user_id=m.user_id
  LEFT JOIN invites i ON i.id=m.source_invite_id AND i.user_id=m.user_id
  WHERE v.synthetic=true AND m.channel='voicemail'
    AND (
      lower(m.body) LIKE 'hi '||lower(split_part(c.name,' ',1))||'%'
      OR lower(m.body) LIKE 'hello '||lower(split_part(c.name,' ',1))||'%'
      OR lower(m.body) LIKE 'dear '||lower(split_part(c.name,' ',1))||'%'
      OR lower(m.body) LIKE 'hi '||lower(split_part(i.preview,' ',1))||'%'
      OR lower(m.body) LIKE 'hello '||lower(split_part(i.preview,' ',1))||'%'
      OR m.body ~* '(call me at|my number is|[0-9]{3}[- ]?[0-9]{4})'
    )
    AND (v.attempted_at IS NULL OR v.attempted_at<now()-interval '5 minutes')
  ORDER BY v.created_at LIMIT $1 FOR UPDATE OF v SKIP LOCKED
 )
 UPDATE voice_notes v SET attempted_at=now()
 FROM due WHERE v.message_id=due.message_id
 RETURNING v.message_id,v.user_id`,[limit]);
 for(const job of jobs){
  try{
   const m=await one("SELECT m.id,m.user_id,m.world_id,m.contact_id,m.body,m.source_invite_id,m.source_call_id,c.name,c.title,c.company,c.voice_id FROM messages m JOIN contacts c ON c.id=m.contact_id AND c.user_id=m.user_id WHERE m.id=$1 AND m.user_id=$2 AND m.channel='voicemail'",[job.message_id,job.user_id]);
   if(!m)continue;
   const [chairman]=await sql('SELECT name FROM users WHERE id=$1',[job.user_id]);
   let reason='',callDirection='incoming';
   if(m.source_invite_id){
    const invite=await one('SELECT preview FROM invites WHERE id=$1 AND user_id=$2',[m.source_invite_id,job.user_id]);
    reason=invite?.preview||'';
   }else if(m.source_call_id)callDirection='outgoing';
   const replacement=fallbackFollowup({recipientName:chairman?.name||'Chairman',recipientTitle:'Chairman',reason,callDirection});
   const audio=await synthesizeVoicemail(replacement.body,m);
   if(!audio)continue;
   await transaction(async q=>{
    const [current]=await q("SELECT v.message_id FROM voice_notes v JOIN messages m ON m.id=v.message_id AND m.user_id=v.user_id WHERE v.message_id=$1 AND v.user_id=$2 AND v.synthetic=true AND m.channel='voicemail' AND m.body=$3 FOR UPDATE OF v",[m.id,job.user_id,m.body]);
    if(!current)return;
    await q("UPDATE messages SET body=$3,audio_available=true,transcription_status='ready' WHERE id=$1 AND user_id=$2 AND channel='voicemail'",[m.id,job.user_id,replacement.body]);
    await q("UPDATE voice_notes SET audio=$3,mime_type='audio/wav' WHERE message_id=$1 AND user_id=$2 AND synthetic=true",[m.id,job.user_id,audio]);
   });
  }catch(error){console.warn('Historical voicemail repair deferred',error.code||error.name);}
 }
}
export async function processVoiceNotes(limit=3){
 const jobs=await sql(`WITH due AS (SELECT v.message_id FROM voice_notes v JOIN messages m ON m.id=v.message_id AND m.user_id=v.user_id JOIN contacts c ON c.id=m.contact_id AND c.user_id=m.user_id WHERE NOT v.synthetic AND v.reply_status='pending' AND (v.transcript_status='pending' OR c.availability='available' OR c.availability IS NULL) AND (v.attempted_at IS NULL OR v.attempted_at<now()-interval '5 minutes') ORDER BY v.created_at LIMIT $1 FOR UPDATE OF v SKIP LOCKED)
 UPDATE voice_notes v SET attempted_at=now() FROM due WHERE v.message_id=due.message_id RETURNING v.message_id,v.user_id,v.transcript_status`,[limit]);
 for(const job of jobs){
  try{
   const m=await one('SELECT m.*,c.name,c.title,c.company,c.temperament,c.agenda,c.availability FROM messages m JOIN contacts c ON c.id=m.contact_id AND c.user_id=m.user_id WHERE m.id=$1 AND m.user_id=$2',[job.message_id,job.user_id]);if(!m)continue;
   let text=m.body;
   if(job.transcript_status==='pending'){
    const v=await one('SELECT audio,mime_type FROM voice_notes WHERE message_id=$1 AND user_id=$2',[m.id,m.user_id]);if(!v)continue;
    text=await transcribe(v.audio,v.mime_type);if(!text)continue;
    await transaction(async q=>{await q("UPDATE messages SET body=$3,transcription_status='ready' WHERE id=$1 AND user_id=$2",[m.id,m.user_id,text]);await q("UPDATE voice_notes SET transcript_status='ready' WHERE message_id=$1 AND user_id=$2",[m.id,m.user_id]);});
   }
   if(m.availability&&m.availability!=='available')continue;
   const history=await sql('SELECT direction,body FROM messages WHERE user_id=$1 AND contact_id=$2 ORDER BY created_at DESC LIMIT 10',[m.user_id,m.contact_id]);
   const callAction=await handleCallIntent({userId:m.user_id,worldId:m.world_id,defaultContactId:m.contact_id,text,actionKey:'voice-note:'+m.id});
   const reply=callAction?.reply||await ask('Reply as the named fictional executive to the Chairman’s recorded message. Use the supplied context only. Do not claim to execute an action or invent facts. If asked to perform an action requiring a tool, acknowledge the request without claiming execution. Return natural text.',JSON.stringify({contact:{name:m.name,title:m.title,company:m.company,temperament:m.temperament,agenda:m.agenda},message:text,history:history.reverse()}),{fallback:null});
   if(!reply)continue;
   await transaction(async q=>{
    const [lock]=await q("SELECT message_id FROM voice_notes WHERE message_id=$1 AND user_id=$2 AND reply_status='pending' FOR UPDATE",[m.id,m.user_id]);if(!lock)return;
    await q("INSERT INTO messages(id,user_id,world_id,contact_id,direction,channel,body) VALUES($1,$2,$3,$4,'incoming','chat',$5)",[uid(),m.user_id,m.world_id,m.contact_id,String(reply).slice(0,3500)]);
    await q("UPDATE voice_notes SET reply_status='sent' WHERE message_id=$1 AND user_id=$2",[m.id,m.user_id]);
    await q("INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,'missed-call-message',$5,$6)",[uid(),m.user_id,m.world_id,m.contact_id,'Reply from '+m.name,'A contact replied to the recorded message.']);
   });
  }catch(error){console.warn('Voice note processing deferred',error.code||error.name);}
 }
 await repairHistoricalVoicemails(Math.min(limit,2));
}
export async function saveSyntheticAudio(q,messageId,userId,audio){
 if(!audio)return;
 await q("INSERT INTO voice_notes(message_id,user_id,mime_type,audio,transcript_status,reply_status,synthetic) VALUES($1,$2,'audio/wav',$3,'ready','skipped',true) ON CONFLICT DO NOTHING",[messageId,userId,audio]);
 await q("UPDATE messages SET audio_available=true,transcription_status='ready' WHERE id=$1 AND user_id=$2",[messageId,userId]);
}
