import {start} from 'workflow/api';
import {scheduledCall} from '../workflows/scheduled-call.js';
import {arrangeExecutiveCall,removeScheduledCallJob} from './executive-actions.mjs';

export async function scheduleExecutiveCall(options){
  const action=await arrangeExecutiveCall(options);
  if(!action.jobId||action.alreadyScheduled)return action;

  try{
    const run=await start(scheduledCall,[action.jobId,action.delaySeconds]);
    return {...action,runId:run.runId};
  }catch{
    await removeScheduledCallJob(action.jobId);
    throw new Error('I could not schedule that call right now. Please try again.');
  }
}
