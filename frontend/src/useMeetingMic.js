import {useEffect,useRef,useState} from 'react';
const supportedMime=()=>['audio/webm;codecs=opus','audio/mp4','audio/ogg;codecs=opus','audio/webm'].find(m=>MediaRecorder.isTypeSupported(m));
// An opt-in conversational microphone. Echo cancellation is requested, not guaranteed.
// Audio is uploaded only for a detected utterance; silence is discarded locally.
export function useMeetingMic({meetingId,onStartSpeaking,onTranscript,onError}){
 const session=useRef(null),callbacks=useRef(null),[phase,setPhase]=useState('off');
 callbacks.current={onStartSpeaking,onTranscript,onError};
 const supported=typeof window!=='undefined'&&!!navigator.mediaDevices?.getUserMedia&&!!window.MediaRecorder&&!!(window.AudioContext||window.webkitAudioContext);
 function stop(){
  const s=session.current;session.current=null;if(!s){setPhase('off');return;}
  s.closed=true;cancelAnimationFrame(s.frame);s.abort?.abort();if(s.recorder?.state!=='inactive')try{s.recorder?.stop();}catch{}
  s.stream?.getTracks().forEach(t=>t.stop());s.context?.close().catch(()=>{});setPhase('off');
 }
 async function start(){
  if(session.current||!supported)return;
  const s={closed:false,stream:null,context:null,recorder:null,frame:0,processing:false,noise:.004};
  session.current=s;setPhase('starting');
  try{
   const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
   if(s.closed||session.current!==s){stream.getTracks().forEach(t=>t.stop());return;}
   s.stream=stream;const Context=window.AudioContext||window.webkitAudioContext;s.context=new Context();await s.context.resume();
   if(s.closed)return;
   const source=s.context.createMediaStreamSource(stream),analyser=s.context.createAnalyser();analyser.fftSize=1024;source.connect(analyser);
   const samples=new Float32Array(analyser.fftSize);const mime=supportedMime();let loudSince=0,lastLoud=0,started=0,confirmed=false,chunks=[];
   function startRecording(now){
    chunks=[];confirmed=false;started=now;lastLoud=now;
    const recorder=new MediaRecorder(stream,mime?{mimeType:mime,audioBitsPerSecond:64000}:{audioBitsPerSecond:64000});s.recorder=recorder;
    recorder.ondataavailable=e=>{if(e.data?.size)chunks.push(e.data);};
    recorder.onerror=()=>{if(!s.closed){callbacks.current.onError('Microphone recording failed.');stop();}};
    recorder.onstop=async()=>{
     if(s.closed||session.current!==s)return;
     if(!confirmed){s.recorder=null;return;}
     s.processing=true;setPhase('transcribing');
     try{
      const blob=new Blob(chunks,{type:recorder.mimeType||chunks[0]?.type||mime});
      if(blob.size<16||blob.size>2097152)throw Error('Recording is empty or too large.');
      s.abort=new AbortController();const response=await fetch('/api/meetings/'+encodeURIComponent(meetingId)+'/transcribe',{method:'POST',credentials:'include',headers:{'Content-Type':blob.type,'X-CO-Request':'1','X-Transcription-Consent':'1'},body:blob,signal:s.abort.signal});
      const result=await response.json().catch(()=>({}));if(!response.ok||!result.text)throw Error(result.error||'Speech could not be recognised.');
      if(!s.closed&&session.current===s)await callbacks.current.onTranscript(result.text);
     }catch(e){if(!s.closed&&e.name!=='AbortError')callbacks.current.onError(e.message);}
     finally{if(!s.closed&&session.current===s){s.processing=false;s.recorder=null;loudSince=0;setPhase('listening');}}
    };
    recorder.start();
   }
   function tick(now){
    if(s.closed)return;
    analyser.getFloatTimeDomainData(samples);let energy=0;for(const x of samples)energy+=x*x;
    const rms=Math.sqrt(energy/samples.length),threshold=Math.max(.018,s.noise*3.5),loud=rms>threshold;
    if(!s.processing){
     if(!s.recorder&&loud){try{startRecording(now);loudSince=now;}catch(e){callbacks.current.onError(e.message);stop();return;}}
     if(s.recorder?.state==='recording'){
      if(loud){lastLoud=now;if(!loudSince)loudSince=now;if(!confirmed&&now-loudSince>=150){confirmed=true;setPhase('speaking');callbacks.current.onStartSpeaking();}}
      else if(!confirmed)loudSince=0;
      if((!confirmed&&now-started>900)||(confirmed&&now-lastLoud>650)||now-started>12000)s.recorder.stop();
     }else if(!loud&&!s.recorder){s.noise=s.noise*.98+rms*.02;}
    }
    s.frame=requestAnimationFrame(tick);
   }
   for(const t of stream.getAudioTracks())t.onended=()=>{if(!s.closed){callbacks.current.onError('Microphone disconnected.');stop();}};
   setPhase('listening');s.frame=requestAnimationFrame(tick);
  }catch(e){if(session.current===s){callbacks.current.onError(e.message||'Microphone unavailable.');stop();}}
 }
 useEffect(()=>{const hidden=()=>{if(document.hidden&&session.current)stop();};document.addEventListener('visibilitychange',hidden);return()=>{document.removeEventListener('visibilitychange',hidden);stop();};},[meetingId]);
 return {supported,phase,start,stop,active:phase!=='off',capturing:['speaking','transcribing'].includes(phase)};
}
