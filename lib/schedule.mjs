// Pure scheduling helpers, independent of database and AI.
export function localTime(timezone,date=new Date()) {
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:timezone||'UTC',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
  const get=key=>parts.find(p=>p.type===key).value;
  return {day:get('year')+'-'+get('month')+'-'+get('day'),minute:Number(get('hour'))*60+Number(get('minute'))};
}
export function minutes(value){return Number(value.slice(0,2))*60+Number(value.slice(3,5));}
export function isQuiet(minute,start,end){const a=minutes(start),b=minutes(end);return a<=b?minute>=a&&minute<b:minute>=a||minute<b;}
export function inWindow(minute,start,width=75){return (minute-minutes(start)+1440)%1440<width;}
export function intervalSeconds(value){const n=Number(value);return Number.isFinite(n)&&n>=60&&n<=900?Math.floor(n):120;}
