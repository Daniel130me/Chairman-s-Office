const DAYS=['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
export function meetingProposalChoices(value){
 const text=String(value??'').replace(/[\u00a0\u202f]/g,' ');
 const pattern=/\b(?:next\s+week\s+)?(?:on\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s+(?:at\s+)?(?:(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)|([01]?\d|2[0-3]):([0-5]\d))\s*(CET|CEST|WAT|UTC|GMT|EST|EDT|CST|CDT|MST|MDT|PST|PDT)\b/gi;
 const choices=[],seen=new Set();
 for(const match of text.matchAll(pattern)){
  const day=match[1].toLowerCase(),suffix=match[4]?.replace(/\./g,'').toUpperCase()||'';
  const hour=Number(match[2]??match[5]),minute=Number(match[3]??match[6]??0),zone=match[7].toUpperCase();
  if(!DAYS.includes(day)||!Number.isInteger(hour)||hour<0||hour>(suffix?12:23)||((suffix)&&hour<1))continue;
  const time=suffix?String(hour)+(minute?':'+String(minute).padStart(2,'0'):'')+' '+suffix:String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0');
  const optionText=day[0].toUpperCase()+day.slice(1)+' '+time+' '+zone;
  const key=[day,hour,minute,suffix,zone].join(':');
  if(seen.has(key))continue;
  seen.add(key);
  choices.push({key,day,hour,minute,timezone:zone,optionText,label:day[0].toUpperCase()+day.slice(1)+' · '+time+' '+zone});
 }
 return choices;
}
