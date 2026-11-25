import {timingSafeEqual} from 'node:crypto';
import {start} from 'workflow/api';
import {worldEngine} from '../../../../workflows/world-engine.js';
import {one,sql,uid} from '../../../../backend/src/db.mjs';
import {intervalSeconds} from '../../../../lib/schedule.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
function authorized(request){
  const secret=process.env.CRON_SECRET||'';
  const a=Buffer.from('Bearer '+secret),b=Buffer.from(request.headers.get('authorization')||'');
  return secret.length>=32&&a.length===b.length&&timingSafeEqual(a,b);
}
export async function GET(request){
  if(!authorized(request))return Response.json({error:'Unauthorized'},{status:401});
  if(process.env.WORLD_ENGINE_ENABLED!=='true')return Response.json({ok:true,enabled:false});
  const day=new Date().toISOString().slice(0,10),token=uid();
  const claim=await one(`INSERT INTO engine_runs(day,token) VALUES($1,$2)
    ON CONFLICT(day) DO UPDATE SET token=EXCLUDED.token,started_at=now(),heartbeat_at=now(),run_id=NULL
    WHERE engine_runs.heartbeat_at<now()-interval '20 minutes' RETURNING day`,[day,token]);
  if(!claim)return Response.json({ok:true,alreadyRunning:true});
  try{
    const run=await start(worldEngine,[day,token,intervalSeconds(process.env.WORLD_ENGINE_INTERVAL_SECONDS)]);
    await sql('UPDATE engine_runs SET run_id=$1 WHERE day=$2 AND token=$3',[run.runId,day,token]);
    return Response.json({ok:true,runId:run.runId});
  }catch(e){
    await sql('DELETE FROM engine_runs WHERE day=$1 AND token=$2 AND run_id IS NULL',[day,token]);
    console.error('Workflow start failed',e.name);return Response.json({error:'Unable to start world engine'},{status:503});
  }
}
export const POST=GET;
