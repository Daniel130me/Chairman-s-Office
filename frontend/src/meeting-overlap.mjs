// Only an explicitly recorded, short executive interjection is eligible.
export function overlapCandidate(turn,index,count,next,remaining){
 if(!turn||!next||turn.replay||next.replay||!turn.round_id||turn.round_id!==next.round_id||!turn.contact_id||!next.contact_id||turn.contact_id===next.contact_id||next.delivery_style!=='interjection'||typeof next.message!=='string'||next.message.length>100||index!==count-1||!Number.isFinite(remaining)||remaining<=.10||remaining>.45)return null;
 return next;
}
// The second voice is a different, already recorded speaker; no synthetic acknowledgements.
export function startBriefOverlap(blob,{onAudible,createAudio=url=>new Audio(url),createUrl=b=>URL.createObjectURL(b),revokeUrl=url=>URL.revokeObjectURL(url)}={}){
 const url=createUrl(blob),audio=createAudio(url);let settled=false,audible=false,timer,resolveDone;
 const done=new Promise(resolve=>{resolveDone=resolve;});
 function finish(ok){if(settled)return;settled=true;clearTimeout(timer);audio.onplaying=null;audio.onended=null;audio.onerror=null;try{audio.pause();audio.removeAttribute('src');audio.load();}catch{}revokeUrl(url);resolveDone({ok,audible});}
 audio.volume=.65;
 audio.onplaying=()=>{if(!audible){audible=true;try{if(onAudible?.()===false)finish(false);}catch{finish(false);}}};
 audio.onended=()=>finish(true);audio.onerror=()=>finish(false);timer=setTimeout(()=>finish(false),18000);
 try{Promise.resolve(audio.play()).catch(()=>finish(false));}catch{finish(false);}
 return {done,cancel:()=>finish(false)};
}
export function mayAutoDebate({enabled,source,participants,busy,voiceBusy,micBusy,hasDraft,hidden,ended,held}){
 return !!(enabled&&source&&participants>=2&&!busy&&!voiceBusy&&!micBusy&&!hasDraft&&!hidden&&!ended&&!held);
}
