export function normalizeEngineStatus(value){
 if(!value||typeof value!=='object'||!value.engine||typeof value.engine!=='object'||!value.world||typeof value.world!=='object'||!value.external||typeof value.external!=='object')return null;
 const finite=value=>value!==null&&value!==undefined&&value!==''&&typeof value!=='boolean'&&Number.isFinite(Number(value))?Number(value):null;
 const timestamp=value=>typeof value==='string'&&value.trim()&&Number.isFinite(Date.parse(value))?value:null;
 const stages=Array.isArray(value.stages)?value.stages.filter(x=>x&&typeof x==='object').map(x=>({
  stage:typeof x.stage==='string'?x.stage:'unknown',
  consecutive_failures:finite(x.consecutive_failures)??0,
  last_error_code:typeof x.last_error_code==='string'?x.last_error_code:null
 })): [];
 return {
  health:['healthy','degraded','stale','disabled','not_started'].includes(value.health)?value.health:'not_started',
  engine:{
   revision:finite(value.engine.revision),
   expectedRevision:finite(value.engine.expectedRevision),
   active:value.engine.active===true,
   lastTickAt:timestamp(value.engine.lastTickAt)
  },
  world:{lastCheckedAt:timestamp(value.world.lastCheckedAt)},
  external:{signalsAt:timestamp(value.external.signalsAt),newsAt:timestamp(value.external.newsAt)},
  stages
 };
}
