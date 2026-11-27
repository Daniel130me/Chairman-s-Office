import {one,sql} from '../backend/src/db.mjs';
import {ENGINE_KEY,ENGINE_REVISION} from './engine-activation.mjs';
const date=value=>value?new Date(value).toISOString():null;
export async function realWorldEngineStatus(userId){
 const world=await one('SELECT id,scheduler_checked_at,last_real_signal_at,last_real_signal_attempt_at,last_real_news_at,last_real_news_attempt_at FROM worlds WHERE user_id=$1',[userId]);
 if(!world)return {health:'not_started',engine:{revision:null,expectedRevision:ENGINE_REVISION,active:false,lastTickAt:null},world:{lastCheckedAt:null},external:{signalsAt:null,newsAt:null},stages:[]};
 const [engine,control]=await Promise.all([
  one('SELECT revision,started_at,heartbeat_at FROM engine_runs WHERE day=$1',[ENGINE_KEY]),
  one("SELECT last_tick FROM engine_control WHERE name='world'")
 ]);
 const stages=await sql('SELECT stage,last_attempt_at,last_success_at,last_error_code,consecutive_failures FROM engine_stage_status WHERE world_id=$1 ORDER BY stage',[world.id]);
 const now=Date.now(),heartbeat=engine?.heartbeat_at?new Date(engine.heartbeat_at).getTime():0,checked=world.scheduler_checked_at?new Date(world.scheduler_checked_at).getTime():0;
 const active=!!heartbeat&&now-heartbeat<=20*60*1000,worldFresh=!!checked&&now-checked<=30*60*1000,failures=stages.filter(s=>s.consecutive_failures>=3).length;
 const enabled=process.env.WORLD_ENGINE_ENABLED==='true';
 const health=!enabled?'disabled':!engine?'not_started':!active||!worldFresh||engine.revision<ENGINE_REVISION?'stale':failures?'degraded':'healthy';
 return {health,enabled,engine:{revision:engine?.revision??null,expectedRevision:ENGINE_REVISION,active,startedAt:date(engine?.started_at),heartbeatAt:date(engine?.heartbeat_at),lastTickAt:date(control?.last_tick)},world:{lastCheckedAt:date(world.scheduler_checked_at),fresh:worldFresh},external:{signalsAt:date(world.last_real_signal_at),signalsAttemptAt:date(world.last_real_signal_attempt_at),newsAt:date(world.last_real_news_at),newsAttemptAt:date(world.last_real_news_attempt_at)},stages};
}
