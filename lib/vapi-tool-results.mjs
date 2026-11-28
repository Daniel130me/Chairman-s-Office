import {createHash} from 'node:crypto';
export function describeSchedule(action,{selfCallback=false}={}){
 const who=action?.contact?.name+' ('+action?.contact?.title+')';
 const seconds=Number(action?.delaySeconds)||0;
 const when=seconds<60?seconds+' seconds':seconds%60===0?(seconds/60)+' minutes':Math.floor(seconds/60)+' minutes and '+(seconds%60)+' seconds';
 if(seconds===0){
  const caller=selfCallback?'me':who;
  return 'The incoming call from '+caller+' has been placed on your Chairman’s Office line and should appear now. The Chairman must end the current call, if one is active, before answering the new call.';
 }
 if(selfCallback)return 'I have scheduled my callback for '+when+' from now. If you are still on another call when it becomes due, it will wait until that call ends.';
 return 'A callback from '+who+' has been scheduled for '+when+' from now. If the Chairman is still on another call when it becomes due, it will wait until that call ends.';
}
export function normalizeChairmanMessage(value){
 if(typeof value!=='string')throw new Error('The message content is missing.');
 const body=value.replace(/\r\n?/g,'\n').trim();
 if(!body)throw new Error('The message content is empty.');
 if(body.length>3500)throw new Error('The message is too long. Keep it under 3,500 characters.');
 if(/\[(?:chairman(?:['’]s)?\s+name|your\s+(?:full\s+)?name|insert\s+(?:name|phone|number))\]/i.test(body))throw new Error('The message still contains an unfinished placeholder.');
 return body;
}
export function deterministicMessageKey(callId,toolCallId){
 const bytes=createHash('sha256').update(String(callId)+'|'+String(toolCallId)).digest();
 bytes[6]=(bytes[6]&0x0f)|0x50;
 bytes[8]=(bytes[8]&0x3f)|0x80;
 const hex=bytes.subarray(0,16).toString('hex');
 return hex.slice(0,8)+'-'+hex.slice(8,12)+'-'+hex.slice(12,16)+'-'+hex.slice(16,20)+'-'+hex.slice(20,32);
}
