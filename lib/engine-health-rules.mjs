// PostgreSQL may return +/-Infinity for uninitialized timestamps.
export function safeEngineDate(value){
 if(value==null||value==='')return null;
 const time=new Date(value).getTime();
 return Number.isFinite(time)?new Date(time).toISOString():null;
}
export function classifyEngineHealth({enabled,engine,world,stages=[],expectedRevision,now=Date.now()}){
 const fresh=(value,limit)=>{const timestamp=safeEngineDate(value);if(!timestamp)return false;const age=now-Date.parse(timestamp);return age>=-60000&&age<=limit;};
 const active=fresh(engine?.heartbeat_at,20*60*1000);
 const worldFresh=fresh(world?.scheduler_checked_at,30*60*1000);
 const failures=stages.some(s=>Number(s.consecutive_failures)>=3);
 const health=!enabled?'disabled':!engine||!world?'not_started':!active||!worldFresh||!Number.isInteger(engine.revision)||engine.revision<expectedRevision?'stale':failures?'degraded':'healthy';
 return {health,active,worldFresh};
}
