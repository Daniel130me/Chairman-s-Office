import {createHash} from 'node:crypto';
import {one,transaction} from '../backend/src/db.mjs';
import {HttpError} from './validation.mjs';
export function realtimeMeetingAvailable(){return process.env.MEETING_REALTIME_ENABLED==='1'&&!!process.env.OPENAI_API_KEY?.trim();}
export function transcriptionSession(){
 return {type:'transcription',audio:{input:{format:{type:'audio/pcm',rate:24000},noise_reduction:{type:'near_field'},transcription:{model:'gpt-live-transcribe',languages:['en'],delay:'low'},turn_detection:null}}};
}
export async function createMeetingRealtimeSecret(user,meetingId,body){
 if(!realtimeMeetingAvailable())throw new HttpError(503,'Streaming microphone is not configured. Use recorded speech mode.');
 if(body?.consent!==true)throw new HttpError(400,'Explicit streaming microphone consent is required.');
 // Count attempts before provider contact; no provider credentials or audio are stored.
 await transaction(async q=>{
  const [m]=await q("SELECT id FROM meetings WHERE id=$1 AND user_id=$2 AND status<>'concluded' FOR UPDATE",[meetingId,user.id]);if(!m)throw new HttpError(404,'Meeting unavailable.');
  await q('SELECT id FROM users WHERE id=$1 FOR UPDATE',[user.id]);
  const [quota]=await q("SELECT count(*)::int n FROM meeting_realtime_attempts WHERE user_id=$1 AND created_at>now()-interval '1 day'",[user.id]);
  if(quota.n>=12)throw new HttpError(429,'Streaming microphone session limit reached.');
  const [recent]=await q("SELECT id FROM meeting_realtime_attempts WHERE user_id=$1 AND created_at>now()-interval '15 seconds' LIMIT 1",[user.id]);if(recent)throw new HttpError(429,'Wait briefly before reconnecting.');
  await q('INSERT INTO meeting_realtime_attempts(user_id,meeting_id) VALUES($1,$2)',[user.id,meetingId]);
 });
 const response=await fetch('https://api.openai.com/v1/realtime/client_secrets',{method:'POST',headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json','OpenAI-Safety-Identifier':createHash('sha256').update(user.id).digest('hex')},body:JSON.stringify({expires_after:{anchor:'created_at',seconds:60},session:transcriptionSession()}),signal:AbortSignal.timeout(15000)}).catch(()=>null);
 if(!response?.ok)throw new HttpError(503,'Streaming transcription provider unavailable. Use recorded speech mode.');
 const data=await response.json().catch(()=>null);
 if(typeof data?.value!=='string'||!Number.isFinite(data.expires_at))throw new HttpError(503,'Streaming transcription provider returned an invalid session.');
 return {value:data.value,expiresAt:data.expires_at};
}
