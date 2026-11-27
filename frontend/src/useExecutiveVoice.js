import {useEffect,useRef,useState} from 'react';
import {speechChunks} from '../../lib/executive-experience-rules.mjs';
export function useExecutiveVoice({turns,members,enabled,notify}){
 const queue=useRef([]),seen=useRef(new Set()),running=useRef(false),generation=useRef(0),audio=useRef(null),abort=useRef(null),settle=useRef(null),on=useRef(enabled);
 const [speaker,setSpeaker]=useState(null),[mode,setMode]=useState('idle');
 on.current=enabled;
 function stop(){
  generation.current++;queue.current=[];abort.current?.abort();audio.current?.pause();settle.current?.();settle.current=null;
  window.speechSynthesis?.cancel();running.current=false;setSpeaker(null);setMode('idle');
 }
 function skip(){stop();}
 function localSpeech(text,member){
  return new Promise(resolve=>{
   if(!window.speechSynthesis||!window.SpeechSynthesisUtterance)return resolve();
   const u=new SpeechSynthesisUtterance(text),voices=window.speechSynthesis.getVoices(),english=voices.filter(v=>v.lang?.startsWith('en')),pool=english.length?english:voices;
   const index=Math.max(0,members.findIndex(m=>m.id===member?.id));if(pool.length)u.voice=pool[index%pool.length];
   u.pitch=.9+(index%4)*.07;u.rate=.96+(index%3)*.03;let timer;
   const done=()=>{clearTimeout(timer);settle.current=null;resolve();};settle.current=done;u.onend=done;u.onerror=done;
   timer=setTimeout(()=>{window.speechSynthesis.cancel();done();},45000);window.speechSynthesis.speak(u);
  });
 }
 async function playBuffer(blob){
  const url=URL.createObjectURL(blob),a=new Audio(url);audio.current=a;
  try{await new Promise((resolve,reject)=>{let timer;const done=()=>{clearTimeout(timer);settle.current=null;resolve();};settle.current=done;a.onended=done;a.onerror=()=>{clearTimeout(timer);reject(Error('Audio unavailable'));};timer=setTimeout(()=>{a.pause();done();},45000);a.play().catch(e=>{clearTimeout(timer);reject(e);});});}
  finally{a.pause();URL.revokeObjectURL(url);if(audio.current===a)audio.current=null;}
 }
 async function drain(){
  if(running.current||!on.current)return;running.current=true;const token=generation.current;
  try{
   while(on.current&&generation.current===token&&queue.current.length){
    const t=queue.current.shift(),member=members.find(m=>m.id===t.contact_id);setSpeaker(t.contact_id);
    const chunks=speechChunks(t.message);let useLocal=false;
    for(let i=0;i<chunks.length&&on.current&&generation.current===token;i++){
     if(!useLocal)try{
      const ac=new AbortController();abort.current=ac;
      const response=await fetch('/api/meeting-voice/'+encodeURIComponent(t.id)+'/'+i,{credentials:'include',signal:ac.signal,cache:'no-store'});
      if(!response.ok)throw Error('Provider unavailable');const blob=await response.blob();if(generation.current!==token||!on.current)break;
      setMode('provider');await playBuffer(blob);continue;
     }catch{if(generation.current!==token||!on.current)break;useLocal=true;}
     setMode('browser');await localSpeech(chunks[i],member);
    }
   }
  }finally{if(generation.current===token){running.current=false;setSpeaker(null);setMode('idle');}}
 }
 function markHistory(history){seen.current=new Set(history.map(t=>t.id));}
 function replay(t){if(!on.current||!t.contact_id)return;stop();queue.current.push(t);void drain();}
 useEffect(()=>{if(!enabled){stop();return;}for(const t of turns){if(seen.current.has(t.id))continue;seen.current.add(t.id);if(t.contact_id)queue.current.push(t);}void drain();},[turns,enabled]);
 useEffect(()=>()=>{generation.current++;queue.current=[];abort.current?.abort();audio.current?.pause();settle.current?.();window.speechSynthesis?.cancel();},[]);
 return {speaker,mode,skip,replay,markHistory};
}
