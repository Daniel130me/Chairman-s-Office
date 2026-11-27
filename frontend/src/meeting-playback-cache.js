// Per-boardroom, bounded in-memory cache; never persisted or shared across users.
export function createVoiceAudioCache({maxEntries=12,maxBytes=12*1024*1024}={}){
 const entries=new Map();let bytes=0;
 function get(key){const value=entries.get(key);if(value){entries.delete(key);entries.set(key,value);}return value;}
 function set(key,value){
  if(!value||!Number.isFinite(value.size)||value.size<=0||value.size>maxBytes)return;
  if(entries.has(key)){bytes-=entries.get(key).size;entries.delete(key);}
  entries.set(key,value);bytes+=value.size;
  while(entries.size>maxEntries||bytes>maxBytes){const first=entries.keys().next().value;bytes-=entries.get(first).size;entries.delete(first);}
 }
 return {get,set,clear(){entries.clear();bytes=0;},size:()=>entries.size};
}
export function nextVoiceSegment(turn,index,chunkCount,queue){
 if(index+1<chunkCount)return {turn,index:index+1};
 return queue.length?{turn:queue[0],index:0}:null;
}
