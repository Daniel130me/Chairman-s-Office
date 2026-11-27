import {start} from 'workflow/api';
import {worldEngine} from '../workflows/world-engine.js';
import {sql,transaction,uid} from '../backend/src/db.mjs';
import {intervalSeconds} from './schedule.mjs';

// A singleton key replaces date-based workers. Increment the revision when
// engine code needs a running workflow to hand over to the new deployment.
export const ENGINE_KEY='2000-01-01';
export const ENGINE_REVISION=22;
export async function activateWorldEngine(){
  if(process.env.WORLD_ENGINE_ENABLED!=='true')return {ok:true,enabled:false};
  const day=ENGINE_KEY,token=uid();
  const claimed=await transaction(async q=>{
    const [claim]=await q(`INSERT INTO engine_runs(day,token,revision) VALUES($1,$2,$3)
      ON CONFLICT(day) DO UPDATE SET token=EXCLUDED.token,revision=EXCLUDED.revision,started_at=now(),heartbeat_at=now(),run_id=NULL
      WHERE engine_runs.revision<EXCLUDED.revision OR
      (engine_runs.revision=EXCLUDED.revision AND engine_runs.heartbeat_at<now()-interval '20 minutes')
      RETURNING day`,[day,token,ENGINE_REVISION]);
    if(!claim)return false;
    // Fence the legacy daily workers without removing their history.
    await q("UPDATE engine_runs SET token='retired:'||token,revision=$1 WHERE day<>$2 AND revision=0",[ENGINE_REVISION,day]);
    return true;
  });
  if(!claimed)return {ok:true,alreadyRunning:true};
  try{
    const run=await start(worldEngine,[day,token,intervalSeconds(process.env.WORLD_ENGINE_INTERVAL_SECONDS)]);
    await sql('UPDATE engine_runs SET run_id=$1 WHERE day=$2 AND token=$3',[run.runId,day,token]);
    return {ok:true,runId:run.runId};
  }catch(error){
    // Do not remove an engine record after a potentially ambiguous enqueue result.
    // Let the watchdog reclaim this token only if no worker renews it.
    console.error('World engine start failed',error.code||error.name);
    throw error;
  }
}
