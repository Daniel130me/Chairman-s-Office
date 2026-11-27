function normalized(value){return String(value||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();}
function firstName(value){return normalized(value).split(' ')[0]||'';}
export function parseFollowup(result,{callerName=''}={}){
 if(!result||typeof result.leaveMessage!=='boolean')return null;
 if(!result.leaveMessage)return {leaveMessage:false};
 const body=typeof result.body==='string'?result.body.trim():'';
 if(!body||body.length>2000)return null;
 if(/(?:\+?\d[\d\s().-]{6,}\d)/.test(body))return null;
 if(/\[(?:chairman|name|phone|number|insert|recipient)[^\]]*\]/i.test(body))return null;
 const greeting=body.match(/^(?:hi|hello|dear)\s+([^,!.]+)/i);
 if(greeting&&(normalized(greeting[1])===normalized(callerName)||firstName(greeting[1])===firstName(callerName)))return null;
 const introduction=body.match(/\bthis is\s+([A-Z][A-Za-z'-]+)/i);
 if(introduction&&firstName(introduction[1])!==firstName(callerName))return null;
 if(/\bcall me at\b|\bmy number is\b/i.test(body))return null;
 return {leaveMessage:true,body,mode:result.mode==='voicemail'?'voicemail':'text'};
}
export function fallbackFollowup({recipientName='',recipientTitle='Chairman',reason='',callDirection='incoming'}={}){
 const recipient=String(recipientTitle).toLowerCase().includes('chairman')
  ?('Chairman '+String(recipientName||'').trim()).trim()
  :(String(recipientName||'').trim()||'there');
 if(callDirection==='outgoing'){
  return {leaveMessage:true,mode:'voicemail',body:recipient+', I saw your call but could not answer at the time. Please let me know what you would like me to look into.'};
 }
 let detail=String(reason||'').trim();
 detail=detail.replace(/^.*?\b(?:would like to|wants to|needs to|is calling to)\s+/i,'').replace(/[.!?]+$/,'').trim();
 if(detail)detail=detail[0].toLowerCase()+detail.slice(1);
 const body=detail
  ?recipient+', I was calling to '+detail+'. Please let me know when you are available.'
  :recipient+', I was trying to reach you. Please let me know when you are available.';
 return {leaveMessage:true,mode:'voicemail',body};
}
