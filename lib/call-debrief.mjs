const deliverable=/\b(debrief|recap|summary|meeting\s+minutes|call\s+notes)\b/i;
const action=/\b(send|text|message|write|prepare|share|deliver|put|save)\b/i;
export function requestsCallDebrief(transcript){
 const userText=(Array.isArray(transcript)?transcript:[])
  .filter(item=>String(item?.role||'').toLowerCase()==='user')
  .map(item=>String(item?.text||'').trim())
  .filter(Boolean).join(' ').replace(/\s+/g,' ');
 if(!userText||!deliverable.test(userText)||!action.test(userText))return false;
 return /\b(send|text|message|write|prepare|share|deliver|put|save)\b.{0,120}\b(debrief|recap|summary|meeting\s+minutes|call\s+notes)\b/i.test(userText)
  || /\b(debrief|recap|summary|meeting\s+minutes|call\s+notes)\b.{0,140}\b(to me|for me|my message|message app|messages app|as a text|via text|in messages)\b/i.test(userText);
}
export function formatCallDebrief({contactName,summary,transcript}={}){
 let content=String(summary||'').trim();
 if(!content){
  const recorded=(Array.isArray(transcript)?transcript:[])
   .filter(item=>['user','assistant'].includes(String(item?.role||'').toLowerCase()))
   .map(item=>(String(item.role).toLowerCase()==='user'?'Chairman':'Executive')+': '+String(item.text||'').trim())
   .filter(line=>!line.endsWith(': ')).slice(0,30);
  content=recorded.length
   ?'Recorded exchange:\n'+recorded.map(line=>'- '+line).join('\n')
   :'No substantive discussion was captured in the call transcript. No decisions or action items can be confirmed.';
 }
 if(content.length>5200)content=content.slice(0,5190).trimEnd()+'…';
 return (String(contactName||'Your executive').trim()+' — Call debrief\n\n'+content+'\n\nDelivery status: This debrief has been saved to your Chairman’s Office Messages app following your request.').slice(0,5600);
}
