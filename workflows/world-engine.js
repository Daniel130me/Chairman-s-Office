import {sleep} from 'workflow';
import {runWorldEngineTick} from './steps/world-engine.js';

// Bounded daily run; the runtime persists progress while sleeping.
export async function worldEngine(day,token,interval){
  "use workflow";
  const cycles=Math.ceil(25*60*60/interval);
  for(let i=0;i<cycles;i++){
    if(!await runTick(day,token,interval))return;
    if(i<cycles-1)await sleep(interval*1000);
  }
}

// Keep this step name stable so already-started durable runs can resume.
async function runTick(day,token,interval){
  "use step";
  return runWorldEngineTick(day,token,interval);
}
