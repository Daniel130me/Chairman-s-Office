import {sleep} from 'workflow';
import {one} from '../backend/src/db.mjs';
import {tick} from '../lib/world-engine.mjs';

// Bounded daily run; the runtime persists progress while sleeping.
export async function worldEngine(day,token,interval){
  "use workflow";
  const cycles=Math.ceil(25*60*60/interval);
  for(let i=0;i<cycles;i++){
    if(!await runTick(day,token,interval))return;
    if(i<cycles-1)await sleep(interval*1000);
  }
}
async function runTick(day,token,interval){
  "use step";
  if(process.env.WORLD_ENGINE_ENABLED!=='true')return false;
  const active=await one('UPDATE engine_runs SET heartbeat_at=now() WHERE day=$1 AND token=$2 RETURNING day',[day,token]);
  if(!active)return false;
  await tick(interval);
  return true;
}
