const WEEKDAYS=['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
const MONTHS={jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,mayy:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12};
const FIXED_ZONES={
 UTC:{timezone:'UTC',timezoneLabel:'UTC'},GMT:{timezone:'UTC',timezoneLabel:'GMT'},
 WAT:{timezone:'Etc/GMT-1',timezoneLabel:'WAT'},CET:{timezone:'Etc/GMT-1',timezoneLabel:'CET'},CEST:{timezone:'Etc/GMT-2',timezoneLabel:'CEST'},
 EST:{timezone:'Etc/GMT+5',timezoneLabel:'EST'},EDT:{timezone:'Etc/GMT+4',timezoneLabel:'EDT'},
 CST:{timezone:'Etc/GMT+6',timezoneLabel:'CST'},CDT:{timezone:'Etc/GMT+5',timezoneLabel:'CDT'},
 MST:{timezone:'Etc/GMT+7',timezoneLabel:'MST'},MDT:{timezone:'Etc/GMT+6',timezoneLabel:'MDT'},
 PST:{timezone:'Etc/GMT+8',timezoneLabel:'PST'},PDT:{timezone:'Etc/GMT+7',timezoneLabel:'PDT'}
};
function zonedParts(date,timezone){
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:timezone,weekday:'long',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
 const values=Object.fromEntries(parts.map(part=>[part.type,part.value]));
 return {year:Number(values.year),month:Number(values.month),day:Number(values.day),weekday:String(values.weekday).toLowerCase(),hour:Number(values.hour),minute:Number(values.minute)};
}
function addDays(parts,count){
 const date=new Date(Date.UTC(parts.year,parts.month-1,parts.day+count));
 return {year:date.getUTCFullYear(),month:date.getUTCMonth()+1,day:date.getUTCDate()};
}
function validDate(parts){
 if(!parts||!Number.isInteger(parts.year)||!Number.isInteger(parts.month)||!Number.isInteger(parts.day))return false;
 const date=new Date(Date.UTC(parts.year,parts.month-1,parts.day));
 return date.getUTCFullYear()===parts.year&&date.getUTCMonth()+1===parts.month&&date.getUTCDate()===parts.day;
}
function zoneLabel(timezone){
 try{return new Intl.DateTimeFormat('en',{timeZone:timezone,timeZoneName:'short'}).formatToParts(new Date()).find(part=>part.type==='timeZoneName')?.value||timezone;}
 catch{return timezone;}
}
export function normaliseCalendarTimezone(value,fallback='UTC'){
 const label=String(value||'').trim(),key=label.toUpperCase();
 if(FIXED_ZONES[key])return {...FIXED_ZONES[key],invalid:false};
 const candidate=label||fallback;
 try{new Intl.DateTimeFormat('en',{timeZone:candidate});return {timezone:candidate,timezoneLabel:label||zoneLabel(candidate),invalid:false};}
 catch{const safe=String(fallback||'UTC');return {timezone:safe,timezoneLabel:zoneLabel(safe),invalid:!!label};}
}
export function extractTimeCandidates(value){
 const text=String(value||''),pattern=/\b(?:at\s*)?(\d{1,2})(?::([0-5]\d))?\s*(a\.?m\.?|p\.?m\.?)\b|\b(?:at\s*)?([01]?\d|2[0-3]):([0-5]\d)\b/gi,found=[];
 for(const match of text.matchAll(pattern)){
  let hour,minute;
  if(match[1]){
   hour=Number(match[1]);minute=Number(match[2]||0);
   const suffix=match[3].toLowerCase().replace(/\./g,'');
   if(hour<1||hour>12)continue;
   if(suffix==='am'&&hour===12)hour=0;
   if(suffix==='pm'&&hour!==12)hour+=12;
  }else{hour=Number(match[4]);minute=Number(match[5]);}
  found.push({hour,minute,raw:match[0],index:match.index});
 }
 return found;
}
function extractDate(raw,context,timezone,now,time){
 const current=zonedParts(now,timezone),rawText=String(raw||''),contextText=String(context||'');
 for(const source of [rawText,contextText]){
  const iso=[...source.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)];
  if(iso.length>1)return {error:'ambiguous-date'};
  if(iso.length===1){const parts={year:Number(iso[0][1]),month:Number(iso[0][2]),day:Number(iso[0][3])};return validDate(parts)?parts:{error:'invalid-date'};}
  const monthFirst=[...source.matchAll(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2})(?:,?\s+(20\d{2}))?\b/gi)];
  const dayFirst=[...source.matchAll(/\b(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)(?:\s+(20\d{2}))?\b/gi)];
  const named=[...monthFirst.map(m=>({month:MONTHS[m[1].toLowerCase()],day:Number(m[2]),year:m[3]?Number(m[3]):null})),...dayFirst.map(m=>({month:MONTHS[m[2].toLowerCase()],day:Number(m[1]),year:m[3]?Number(m[3]):null}))];
  if(named.length>1)return {error:'ambiguous-date'};
  if(named.length===1){let {year,month,day}=named[0];year=year||current.year;let parts={year,month,day};if(!validDate(parts))return {error:'invalid-date'};if(!named[0].year&&(month<current.month||(month===current.month&&day<current.day)))parts={...parts,year:year+1};return parts;}
 }
 const weekdayPattern=/\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi;
 const rawDays=[...rawText.matchAll(weekdayPattern)],distinctRaw=[...new Set(rawDays.map(x=>x[2].toLowerCase()))];
 if(distinctRaw.length>1)return {error:'ambiguous-date'};
 const resolveWeekday=chosen=>{
  const weekday=chosen[2].toLowerCase(),target=weekday==='sunday'?6:WEEKDAYS.indexOf(weekday),today=current.weekday==='sunday'?6:WEEKDAYS.indexOf(current.weekday);
  const all=rawText+' '+contextText;
  const explicitNextWeek=/\bnext\s+week\b/i.test(all);
  const explicitNext=!!chosen[1]||/\bnext\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.test(all);
  let delta;
  if(explicitNextWeek)delta=7-today+target;
  else if(explicitNext)delta=(target-today+7)%7||7;
  else{delta=(target-today+7)%7;if(delta===0&&(time.hour<current.hour||(time.hour===current.hour&&time.minute<=current.minute)))delta=7;}
  return addDays(current,delta);
 };
 if(rawDays.length===1)return resolveWeekday(rawDays[0]);
 const relativePattern=/\b(day after tomorrow|tomorrow|today|in\s+\d+\s+days?)\b/i;
 const relative=rawText.match(relativePattern)||contextText.match(relativePattern);
 if(relative){
  const phrase=relative[1].toLowerCase();
  if(phrase==='today')return {year:current.year,month:current.month,day:current.day};
  if(phrase==='tomorrow')return addDays(current,1);
  if(phrase==='day after tomorrow')return addDays(current,2);
  const days=Number(phrase.match(/\d+/)?.[0]);
  if(Number.isInteger(days)&&days>0&&days<=90)return addDays(current,days);
 }
 const contextDays=[...contextText.matchAll(weekdayPattern)],distinctContext=[...new Set(contextDays.map(x=>x[2].toLowerCase()))];
 if(distinctContext.length>1)return {error:'ambiguous-date'};
 if(contextDays.length===1)return resolveWeekday(contextDays[0]);
 return {error:'missing-date'};
}
function zonedDateTimeToUtc(parts,hour,minute,timezone){
 const desired=Date.UTC(parts.year,parts.month-1,parts.day,hour,minute,0,0);let guess=desired;
 for(let i=0;i<4;i++){const actual=zonedParts(new Date(guess),timezone),represented=Date.UTC(actual.year,actual.month-1,actual.day,actual.hour,actual.minute,0,0),correction=desired-represented;if(!correction)break;guess+=correction;}
 return new Date(guess);
}
export function parseMeetingTime(text,context='',defaultTimezone='UTC',now=new Date()){
 const times=extractTimeCandidates(text);
 if(times.length!==1)return {error:times.length?'ambiguous-time':'missing-time'};
 const all=String(text||'')+' '+String(context||''),zoneMatch=all.match(/\b(CET|CEST|WAT|UTC|GMT|EST|EDT|CST|CDT|MST|MDT|PST|PDT)\b/i);
 const zone=normaliseCalendarTimezone(zoneMatch?.[1]||defaultTimezone,defaultTimezone);
 if(zone.invalid)return {error:'invalid-timezone'};
 const date=extractDate(text,context,zone.timezone,now,times[0]);
 if(date?.error)return date;
 if(!validDate(date))return {error:'missing-date'};
 const start=zonedDateTimeToUtc(date,times[0].hour,times[0].minute,zone.timezone);
 if(!Number.isFinite(start.getTime()))return {error:'invalid-date'};
 if(start.getTime()<=new Date(now).getTime())return {error:'past-date'};
 return {startAt:start.toISOString(),timezone:zone.timezone,timezoneLabel:zone.timezoneLabel,date,hour:times[0].hour,minute:times[0].minute};
}
export function isMeetingAcceptance(value){
 const text=String(value||'');
 if(/\b(not available|unavailable|cannot attend|can't attend|won't work|doesn't work|will not work|not work|conflict|unable to attend)\b/i.test(text))return false;
 return /\b(confirmed|works for me|that works|that suits|available at|i can do|happy to|let's do|let us do|see you|i will be there|i'll be there)\b/i.test(text);
}
