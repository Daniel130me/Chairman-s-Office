import {parseCallIntent} from './executive-intents.mjs';
import {scheduleExecutiveCall} from './call-workflow.mjs';

function delayLabel(seconds){
 if(seconds<60)return seconds+' seconds';
 if(seconds%60===0)return (seconds/60)+' minutes';
 return Math.floor(seconds/60)+' minutes and '+(seconds%60)+' seconds';
}

// Shared action path for typed chat and transcribed voice notes.
// The assistant confirms only after a durable invitation or scheduled job exists.
export async function handleCallIntent({userId,worldId,defaultContactId,text,actionKey,schedule=scheduleExecutiveCall}={}){
 const intent=parseCallIntent(text);
 if(!intent)return null;
 if(intent.clarification)return {handled:true,scheduled:false,reply:intent.clarification,intent};
 try{
  const action=await schedule({userId,worldId,recipient:intent.recipient,defaultContactId,delaySeconds:intent.delaySeconds,kind:intent.kind,actionKey,reason:String(text||'').slice(0,240)});
  const contactName=action.contact?.name||'the executive';
  const when=delayLabel(action.delaySeconds);
  let reply;
  if(intent.kind==='assistant-callback'){
   reply=action.delaySeconds===0
    ?'Certainly, Chairman. I have arranged my callback. An incoming call from '+contactName+' has been placed on your Chairman’s Office line and should appear now.'
    :'Certainly, Chairman. I have scheduled my callback for '+when+'. It will arrive as an incoming call in Chairman’s Office.';
  }else{
   reply=action.delaySeconds===0
    ?'Certainly, Chairman. I have arranged for '+contactName+' to call you now. Their incoming call should appear in your Chairman’s Office Phone app.'
    :'Certainly, Chairman. I have arranged for '+contactName+' to call you in '+when+'.';
  }
  return {handled:true,scheduled:true,reply,intent,action};
 }catch(error){
  console.warn('Executive call request was not scheduled',error?.code||error?.name||'error');
  const detail=String(error?.message||'').trim();
  return {handled:true,scheduled:false,intent,reply:detail&&detail.length<220?'I could not arrange that call. '+detail:'I could not arrange that call just now. Please try again.'};
 }
}
