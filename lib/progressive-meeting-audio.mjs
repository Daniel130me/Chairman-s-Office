import {voiceForContact,MAX_AUDIO_BYTES} from './voice-notes.mjs';
import {EconomyError} from './economy-rules.mjs';
export function progressiveMeetingAudioAvailable(){return process.env.MEETING_PROGRESSIVE_AUDIO==='1'&&!!process.env.GROQ_API_KEY?.trim();}
export async function boundedWavStream(body,maxBytes=MAX_AUDIO_BYTES){
 if(!body)throw new Error('Missing audio stream');
 const reader=body.getReader(),prefix=[];let length=0;
 try{
  while(length<12){const {value,done}=await reader.read();if(done)throw new Error('Incomplete WAV header');length+=value.byteLength;if(length>maxBytes)throw new Error('Audio limit exceeded');prefix.push(value);}
  const header=new Uint8Array(12);let pos=0;
  for(const chunk of prefix){const copy=chunk.subarray(0,12-pos);header.set(copy,pos);pos+=copy.length;if(pos===12)break;}
  const tag=(start,text)=>[...text].every((c,i)=>header[start+i]===c.charCodeAt(0));
  if(!tag(0,'RIFF')||!tag(8,'WAVE'))throw new Error('Invalid WAV header');
 }catch(e){await reader.cancel().catch(()=>{});throw e;}
 return new ReadableStream({
  async pull(controller){
   try{
    if(prefix.length){controller.enqueue(prefix.shift());return;}
    const {value,done}=await reader.read();if(done){controller.close();return;}
    length+=value.byteLength;if(length>maxBytes)throw new Error('Audio limit exceeded');
    controller.enqueue(value);
   }catch(e){await reader.cancel().catch(()=>{});controller.error(e);}
  },
  cancel(reason){return reader.cancel(reason);}
 });
}
export async function progressiveSpeech(text,contact,signal){
 if(!progressiveMeetingAudioAvailable()||!text||text.length>200)throw new EconomyError('Progressive voice unavailable.',503);
 const timeout=AbortSignal.timeout(45000),combined=signal?AbortSignal.any([signal,timeout]):timeout;
 try{
  const response=await fetch('https://api.groq.com/openai/v1/audio/speech',{method:'POST',headers:{Authorization:'Bearer '+process.env.GROQ_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:'canopylabs/orpheus-v1-english',input:text,voice:voiceForContact(contact.id,contact.voice_id),response_format:'wav'}),signal:combined});
  if(!response.ok||Number(response.headers.get('content-length')||0)>MAX_AUDIO_BYTES){await response.body?.cancel().catch(()=>{});throw Error('Provider response unavailable');}
  const stream=await boundedWavStream(response.body);
  return new Response(stream,{headers:{'Content-Type':'audio/wav','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Accept-Ranges':'none'}});
 }catch(e){throw new EconomyError('Progressive executive audio unavailable.',503);}
}
