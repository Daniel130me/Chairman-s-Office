export function normalizeTranscript(value){
 return Array.isArray(value)?value.filter(x=>x&&typeof x==='object'&&typeof x.text==='string'&&x.text.trim()).slice(0,150).map(x=>({role:String(x.role||'speaker').slice(0,30),text:x.text.slice(0,3000)})):[];
}
export function mergeTranscript(saved,incoming){
 const a=normalizeTranscript(saved),b=normalizeTranscript(incoming);
 const prefix=(x,y)=>x.every((v,i)=>v.role===y[i]?.role&&v.text===y[i]?.text);
 if(prefix(a,b))return b;if(prefix(b,a))return a;
 // A checkpoint is an append-only snapshot of a single call, not a second conversation.
 return a;
}
export function parseConcierge(raw,bookingIds){
 if(!raw||typeof raw!=='object'||!Array.isArray(raw.actions)||typeof raw.summary!=='string'||!raw.summary.trim())return null;
 const actions=raw.actions.slice(0,5).map(a=>{
  if(!a||!['review','contact-provider','plan-alternative','review-meeting','confirm-booking'].includes(a.type)||typeof a.detail!=='string'||!a.detail.trim())return null;
  if(a.bookingId&&!bookingIds.includes(a.bookingId))return null;
  return {type:a.type,detail:a.detail.trim().slice(0,500),bookingId:a.bookingId||null};
 });
 if(actions.some(a=>!a))return null;
 return {summary:raw.summary.trim().slice(0,1200),actions};
}
export function meetingConflict(trip,meeting){
 const start=Date.parse(meeting.start_at),depart=Date.parse(trip.depart_at);
 const end=start+(Number(meeting.duration_minutes)||45)*60000;
 return Number.isFinite(start)&&Number.isFinite(depart)&&start<depart+7200000&&end>depart-7200000;
}
export function speechChunks(text,max=180){
 const out=[];let remaining=String(text||'').trim();
 while(remaining.length>max){
  // Prefer complete clauses/sentences, keeping the first audio segment short.
  const limit=out.length?max:Math.min(max,120);
  const prefix=remaining.slice(0,limit+1);
  let cut=0;
  for(const match of prefix.matchAll(/[.!?;:](?=\s)/g)){const end=match.index+1;if(end>=Math.min(45,limit/2)&&end<=limit)cut=end;}
  if(!cut)cut=remaining.lastIndexOf(' ',limit);
  if(cut<=0){cut=remaining.lastIndexOf(' ',max);if(cut<=0)cut=max;}
  out.push(remaining.slice(0,cut).trim());remaining=remaining.slice(cut).trim();
 }
 if(remaining)out.push(remaining);return out;
}
