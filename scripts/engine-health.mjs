import {sql,database} from '../backend/src/db.mjs';
try{
 const [r]=await sql(`SELECT
 (SELECT count(*)::int FROM worlds) worlds,
 (SELECT count(*)::int FROM worlds WHERE scheduler_checked_at IS NULL OR scheduler_checked_at<now()-interval '30 minutes') stale_worlds,
 (SELECT count(*)::int FROM engine_stage_status WHERE consecutive_failures>=3) repeatedly_failed_stages,
 (SELECT count(*)::int FROM engine_runs WHERE day='2000-01-01' AND heartbeat_at>=now()-interval '20 minutes') active_engine,
 (SELECT count(*)::int FROM meeting_rounds WHERE status IN ('pending','running') AND coalesce(worker_lease_until,created_at+interval '3 minutes')<now()) stale_meeting_rounds`);
 const failures=await sql('SELECT stage,count(*)::int affected FROM engine_stage_status WHERE consecutive_failures>=3 GROUP BY stage ORDER BY stage');
 console.log(JSON.stringify({checkedAt:new Date().toISOString(),...r,failures},null,2));
 if(r.stale_worlds||r.repeatedly_failed_stages||r.stale_meeting_rounds||(process.env.WORLD_ENGINE_ENABLED==='true'&&r.worlds&&!r.active_engine))process.exitCode=1;
}catch(e){console.error('Engine health check failed:',e.code||e.name);process.exitCode=1;}finally{await database().end();}
