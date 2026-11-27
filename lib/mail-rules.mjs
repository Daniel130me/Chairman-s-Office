export function normalizeMailSubject(value){
 const subject=String(value??'').trim().replaceAll(String.fromCharCode(13),' ').replaceAll(String.fromCharCode(10),' ').replace(/[ ]+/g,' ').slice(0,180);
 if(!subject)throw new Error('Enter an email subject.');
 return subject;
}
export function replyMailSubject(subject){
 const value=normalizeMailSubject(subject);
 return /^re:/i.test(value)?value:'Re: '+value;
}
