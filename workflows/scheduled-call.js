import {sleep} from 'workflow';
import {deliverScheduledCall} from './steps/scheduled-call.js';

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

// Keep this step name stable so already-started callbacks can resume.
async function deliver(jobId){
  "use step";
  return deliverScheduledCall(jobId);
}
