"use step";

import {one} from '../../backend/src/db.mjs';
import {tick} from '../../lib/world-engine.mjs';

// All database and Node-dependent work stays inside a step module.
export async function runWorldEngineTick(day,token,interval){
  if(process.env.WORLD_ENGINE_ENABLED!=='true')return false;
  const active=await one('UPDATE engine_runs SET heartbeat_at=now() WHERE day=$1 AND token=$2 RETURNING day',[day,token]);
  if(!active)return false;
  await tick(interval);
  return true;
}
