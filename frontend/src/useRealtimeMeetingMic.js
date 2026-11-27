import {useEffect,useRef,useState} from 'react';
import {api} from './api.js';
// The peer carries live microphone audio to the transcription provider. The
// durable meeting engine remains the only source of executive responses.
export function useRealtimeMeetingMic({meetingId,onStartSpeaking,onTranscript,onError}){
 const current=useRef(null),callbacks=useRef({}),[phase,setPhase]=useState('off'),[caption,setCaption]=useState('');
 callbacks.current={onStartSpeaking,onTranscript,onError};
 const supported=typeof window!=='undefined'&&!!navigator.mediaDevices?.getUserMedia&&!!window.RTCPeerConnection&&!!(window.AudioContext||window.webkitAudioContext);
 function stop(){
  const s=current.current;current.current=null;if(s){
   s.closed=true;cancelAnimationFrame(s.frame);clearTimeout(s.connectTimer);clearTimeout(s.sessionTimer);clearTimeout(s.finalTimer);s.abort.abort();
   s.channel?.close();s.pc?.close();s.stream?.getTracks().forEach(t=>t.stop());s.context?.close().catch(()=>{});
  }setPhase('off');setCaption('');
 }
 async function start(){
  if(current.current||!supported)return;
  const s={closed:false,abort:new AbortController(),frame:0,noise:.004,seen:new Set(),pending:false,talking:false,lastLoud:0,loudSince:0,startedAt:0,lastClear:0};
  current.current=s;setPhase('connecting');
  const live=()=>current.current===s&&!s.closed;
  const fail=message=>{if(live()){callbacks.current.onError(message);stop();}};
  function send(type){if(!live()||s.channel?.readyState!=='open')return false;try{s.channel.send(JSON.stringify({type}));return true;}catch{return false;}}
  try{
   s.stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
   if(!live()){s.stream.getTracks().forEach(t=>t.stop());return;}
   const track=s.stream.getAudioTracks()[0];track.enabled=false;track.onended=()=>fail('Streaming microphone disconnected.');
   const AudioCtx=window.AudioContext||window.webkitAudioContext;s.context=new AudioCtx();await s.context.resume();
   if(!live())return;
   const analyser=s.context.createAnalyser();analyser.fftSize=1024;s.context.createMediaStreamSource(s.stream).connect(analyser);
   const samples=new Float32Array(analyser.fftSize);
   const secret=await api('/meetings/'+meetingId+'/realtime-secret',{method:'POST',body:{consent:true}});
   if(!live())return;
   s.pc=new RTCPeerConnection();s.pc.addTransceiver(track,{direction:'sendonly'});
   s.channel=s.pc.createDataChannel('oai-events');
   function tick(now){
    if(!live())return;
    if(!s.pending){
     analyser.getFloatTimeDomainData(samples);let energy=0;for(const x of samples)energy+=x*x;
     const rms=Math.sqrt(energy/samples.length),loud=rms>Math.max(.018,s.noise*3.5);
     if(loud){
      if(!s.loudSince)s.loudSince=now;
      s.lastLoud=now;
      if(!s.talking&&now-s.loudSince>=150){s.talking=true;s.startedAt=now;setCaption('');setPhase('speaking');callbacks.current.onStartSpeaking();}
     }else if(!s.talking){s.loudSince=0;s.noise=s.noise*.98+rms*.02;}
     if(s.talking&&(now-s.lastLoud>=650||now-s.startedAt>=15000)){
      s.pending=true;s.talking=false;s.loudSince=0;setPhase('transcribing');
      if(!send('input_audio_buffer.commit')){fail('Streaming connection was lost.');return;}
      track.enabled=false;
      s.finalTimer=setTimeout(()=>fail('Streaming transcription did not finish. Use recorded speech mode to continue.'),15000);
     }else if(!s.talking&&!s.loudSince&&now-s.lastClear>5000){
      send('input_audio_buffer.clear');s.lastClear=now;setCaption('');
     }
    }
    s.frame=requestAnimationFrame(tick);
   }
   s.channel.onopen=()=>{if(!live())return;clearTimeout(s.connectTimer);track.enabled=true;s.lastClear=performance.now();setPhase('listening');s.frame=requestAnimationFrame(tick);};
   s.channel.onclose=()=>fail('Streaming microphone connection closed.');
   s.channel.onerror=()=>fail('Streaming microphone connection failed.');
   s.channel.onmessage=async e=>{
    if(!live())return;let event;try{event=JSON.parse(e.data);}catch{return;}
    if(event.type==='conversation.item.input_audio_transcription.delta'&&(s.talking||s.pending)&&typeof event.delta==='string')setCaption(prev=>(prev+event.delta).slice(-3000));
    if(event.type==='error'||event.type==='conversation.item.input_audio_transcription.failed'){fail('Streaming transcription unavailable. Use recorded speech mode.');return;}
    if(event.type!=='conversation.item.input_audio_transcription.completed'||!s.pending||!event.item_id||s.seen.has(event.item_id))return;
    s.seen.add(event.item_id);clearTimeout(s.finalTimer);const value=typeof event.transcript==='string'?event.transcript.trim().slice(0,3000):'';setCaption(value);
    try{if(value&&live())await callbacks.current.onTranscript(value);else if(live())callbacks.current.onError('No speech recognised; please repeat.');}
    catch(error){if(live())callbacks.current.onError(error.message);}
    finally{if(live()){s.pending=false;s.lastClear=performance.now();send('input_audio_buffer.clear');track.enabled=true;setPhase('listening');}}
   };
   s.pc.onconnectionstatechange=()=>{if(['failed','closed'].includes(s.pc.connectionState))fail('Streaming microphone disconnected.');};
   const offer=await s.pc.createOffer();await s.pc.setLocalDescription(offer);if(!live())return;
   const response=await fetch('https://api.openai.com/v1/realtime/calls',{method:'POST',headers:{Authorization:'Bearer '+secret.value,'Content-Type':'application/sdp'},body:offer.sdp,signal:s.abort.signal});
   if(!response.ok)throw Error('Streaming microphone could not connect. Use recorded speech mode.');
   const answer=await response.text();if(!live())return;
   await s.pc.setRemoteDescription({type:'answer',sdp:answer});
   if(!live())return;
   if(s.channel.readyState!=='open')s.connectTimer=setTimeout(()=>fail('Streaming microphone connection timed out.'),15000);
   s.sessionTimer=setTimeout(()=>fail('Streaming microphone session ended. Reconnect to continue.'),20*60*1000);
  }catch(e){if(live())fail(e.message||'Streaming microphone unavailable.');}
 }
 useEffect(()=>{const hidden=()=>{if(document.hidden&&current.current)stop();};document.addEventListener('visibilitychange',hidden);return()=>{document.removeEventListener('visibilitychange',hidden);stop();};},[meetingId]);
 return {supported,phase,caption,start,stop,active:phase!=='off',capturing:['speaking','transcribing'].includes(phase)};
}
