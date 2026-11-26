import {runWorldEngineTick} from '../lib/world-engine.mjs';
import {sleep} from 'workflow';
import {start} from 'workflow/api';

// Bounded durable runs hand off to a successor without needing the phone to be open.
export async function worldEngine(day,token,interval){
  "use workflow";
  const cycles=Math.ceil(6*60*60/interval);
  for(let i=0;i<cycles;i++){
    if(!await runTick(day,token,interval))return;
    await sleep(interval*1000);
  }
  // The successor inherits the fenced token. An obsolete token cannot tick.
  // start is durable in Workflow v5; no in-memory timers or external cron are required.
  if(await runTick(day,token,interval))await start(worldEngine,[day,token,interval]);
}

// Keep this step name stable so already-started durable runs can resume.
async function runTick(day,token,interval){
  "use step";
  return runWorldEngineTick(day,token,interval);
}
