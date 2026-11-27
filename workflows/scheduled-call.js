import {completeScheduledCall} from '../lib/executive-actions.mjs';
import {sleep} from 'workflow';

// Durable callback: Vercel Workflow waits without keeping a server process alive.
export async function scheduledCall(jobId,delaySeconds){
  "use workflow";
  await sleep(Math.max(0,Number(delaySeconds)||0)*1000);
  for(let attempt=0;attempt<4;attempt++){
    const invite=await deliver(jobId);
    if(invite)return;
    if(attempt<3)await sleep(1000);
  }
}

// Keep this step name stable so already-started durable runs can resume.
async function deliver(jobId){
  "use step";
  return completeScheduledCall(jobId);
}
