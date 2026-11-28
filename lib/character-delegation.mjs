import {startColleagueCall,resolveColleagueRecipient} from './colleague-calls.mjs';
export function parseDelegatedCallRequest(value){
 const text=String(value||'').trim();
 if(!text||/\bcall\s+(?:me|myself|the chairman|chairman)\b/i.test(text))return null;
 const match=text.match(/\b(?:call|phone|ring|speak to|talk to|contact|reach)\s+(?:the\s+|our\s+)?([a-z][a-z.'-]*(?:\s+[a-z][a-z.'-]*)?)/i);
 if(!match)return null;
 const recipient=match[1].trim();
 if(!recipient||/^(me|myself|chairman|himself|herself|them|someone|somebody|anyone)$/i.test(recipient))return null;
 const reportToChairman=/\b(call me back|call me and|then call me|report back|come back to me|tell me what|let me know what|update me|brief me|come and explain|call me .*tell me)\b/i.test(text);
 return {recipient,reason:text.slice(0,500),reportToChairman};
}
export async function handleDelegatedColleagueCall({user,world,contact,body,outgoingId}){
 const intent=parseDelegatedCallRequest(body);
 if(!intent)return null;
 const target=await resolveColleagueRecipient(user.id,world.id,intent.recipient,contact.id);
 if(!target.contact)return {reply:target.ambiguous?'I found more than one colleague matching that name or role. Please give me the full name.':'I could not identify “'+intent.recipient+'” in the executive directory. Please confirm the person’s name or role.'};
 const result=await startColleagueCall({
  userId:user.id,worldId:world.id,callerId:contact.id,recipientLabel:target.contact.name,
  reason:intent.reason,reportToChairman:intent.reportToChairman,operationKey:'chairman-message:'+outgoingId
 });
 return {reply:'Understood, Chairman. I have queued a call from me to '+target.contact.name+' and recorded it in the internal Messages conversation. '+(intent.reportToChairman?'Once we have spoken, I will send you a written report and call you back with the outcome.':'You will be able to follow the conversation and its transcript in Messages.')+' This is an in-app executive call, not an external phone call.'};
}
