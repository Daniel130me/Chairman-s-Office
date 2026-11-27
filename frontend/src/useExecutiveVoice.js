import {useEffect,useRef,useState} from 'react';
import {speechChunks} from '../../lib/executive-experience-rules.mjs';
import {createVoiceAudioCache,nextVoiceSegment} from './meeting-playback-cache.js';
export function useExecutiveVoice({turns,members,enabled,paused=false,notify,onPlayback}){
 const queue=useRef([]),seen=useRef(new Set()),running=useRef(false),generation=useRef(0),audio=useRef(null),settle=useRef(null),suppressed=useRef(new Set()),requests=useRef(new Map()),config=useRef({}),cache=useRef(null),playingSegment=useRef(null);
 if(!cache.current)cache.current=createVoiceAudioCache();
 const [speaker,setSpeaker]=useState(null),[mode,setMode]=useState('idle');
 config.current={members,enabled,paused,notify,onPlayback};
 const playable=()=>config.current.enabled&&!config.current.paused;
 function cancelRequests(){for(const entry of requests.current.values())entry.controller.abort();requests.current.clear();}
 function stop(clear=true){
  generation.current++;playingSegment.current=null;if(clear)queue.current=[];cancelRequests();audio.current?.pause();settle.current?.();settle.current=null;
  window.speechSynthesis?.cancel();running.current=false;setSpeaker(null);setMode('idle');
 }
 function skip(){stop();}
 function suppressRound(id){if(id)suppressed.current.add(id);stop();}
 function load(turn,index){
  const key=turn.id+':'+index;
  const cached=cache.current.get(key);if(cached)return Promise.resolve(cached);
  if(requests.current.has(key))return requests.current.get(key).promise;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);
  const promise=fetch('/api/meeting-voice/'+encodeURIComponent(turn.id)+'/'+index,{credentials:'include',signal:controller.signal,cache:'no-store'}).then(async r=>{
   if(!r.ok)throw Error('Voice provider unavailable');const blob=await r.blob();
   if(!controller.signal.aborted&&blob.size>0&&blob.size<=2097152){cache.current.set(key,blob);return blob;}return null;
  }).catch(()=>null).finally(()=>{clearTimeout(timer);if(requests.current.get(key)?.controller===controller)requests.current.delete(key);});
  requests.current.set(key,{controller,promise});return promise;
 }
 function prefetchNext(){
  const segment=playingSegment.current;if(!segment||!playable())return;
  const next=nextVoiceSegment(segment.turn,segment.index,segment.count,queue.current);
  if(next)void load(next.turn,next.index);
 }
 function localSpeech(text,member,onStart){
  return new Promise(resolve=>{
   if(!window.speechSynthesis||!window.SpeechSynthesisUtterance){resolve(false);return;}
   const u=new SpeechSynthesisUtterance(text),voices=window.speechSynthesis.getVoices(),english=voices.filter(v=>v.lang?.startsWith('en')),pool=english.length?english:voices;
   const index=Math.max(0,config.current.members.findIndex(m=>m.id===member?.id));if(pool.length)u.voice=pool[index%pool.length];
   u.pitch=.9+(index%4)*.07;u.rate=.96+(index%3)*.03;let timer,doneCalled=false;
   const done=(ok=true)=>{if(doneCalled)return;doneCalled=true;clearTimeout(timer);if(settle.current===cancel)settle.current=null;resolve(ok);};
   const cancel=()=>done(false);settle.current=cancel;u.onstart=onStart;u.onend=()=>done();u.onerror=()=>done(false);
   timer=setTimeout(()=>{window.speechSynthesis.cancel();done(false);},45000);window.speechSynthesis.speak(u);
  });
 }
 async function playBuffer(blob,onStart){
  const url=URL.createObjectURL(blob),a=new Audio(url);audio.current=a;
  try{return await new Promise(resolve=>{let timer,finished=false;
   const done=ok=>{if(finished)return;finished=true;clearTimeout(timer);if(settle.current===cancel)settle.current=null;resolve(ok);};
   const cancel=()=>done(false);settle.current=cancel;a.onplaying=onStart;a.onended=()=>done(true);a.onerror=()=>done(false);
   timer=setTimeout(()=>{a.pause();done(false);},45000);a.play().catch(()=>done(false));
  });}finally{a.pause();URL.revokeObjectURL(url);if(audio.current===a)audio.current=null;}
 }
 async function drain(){
  if(running.current||!playable())return;running.current=true;const token=generation.current;
  try{
   while(playable()&&generation.current===token&&queue.current.length){
    const t=queue.current.shift();if(!t.replay&&suppressed.current.has(t.round_id))continue;
    const member=config.current.members.find(m=>m.id===t.contact_id),chunks=speechChunks(t.message);
    setSpeaker(t.contact_id);let useLocal=false,started=false;
    const audible=()=>{if(!started&&generation.current===token&&playable()){started=true;if(!t.replay)config.current.onPlayback?.(t);}};
    for(let i=0;i<chunks.length&&playable()&&generation.current===token;i++){
     if(!useLocal){
      setMode('loading');const blob=await load(t,i);
      if(generation.current!==token||!playable())break;
      if(blob){
       // Prefetch the next segment, including a new speaker arriving during playback.
       playingSegment.current={turn:t,index:i,count:chunks.length};prefetchNext();
       setMode('provider');const played=await playBuffer(blob,audible);
       if(generation.current===token)playingSegment.current=null;
       if(generation.current!==token||!playable())break;
       if(played)continue;
      }
      useLocal=true;cancelRequests();
     }
     setMode('browser');const played=await localSpeech(chunks[i],member,audible);
     if(!played&&generation.current===token&&playable()){
      config.current.notify?.('Voice playback unavailable. The complete response is in the transcript; tap Replay voice to try again.');
      break;
     }
    }
   }
  }finally{if(generation.current===token){playingSegment.current=null;running.current=false;setSpeaker(null);setMode('idle');}}
 }
 function markHistory(history){seen.current=new Set(history.map(t=>t.id));}
 function replay(t){if(!playable()||!t.contact_id)return;stop();queue.current.push({...t,replay:true});void drain();}
 useEffect(()=>{if(paused)stop(false);},[paused]);
 useEffect(()=>{
  if(!enabled){for(const t of turns)seen.current.add(t.id);stop();return;}
  for(const t of turns){if(seen.current.has(t.id))continue;seen.current.add(t.id);if(t.contact_id&&!suppressed.current.has(t.round_id))queue.current.push(t);}
  prefetchNext();void drain();
 },[turns,enabled,paused]);
 useEffect(()=>()=>{generation.current++;queue.current=[];playingSegment.current=null;cancelRequests();cache.current.clear();audio.current?.pause();settle.current?.();window.speechSynthesis?.cancel();},[]);
 return {speaker,mode,skip,replay,markHistory,suppressRound};
}
