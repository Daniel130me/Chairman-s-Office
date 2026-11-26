import {completeScheduledCall} from '../../lib/executive-actions.mjs';

export async function deliverScheduledCall(jobId){
  "use step";
  return completeScheduledCall(jobId);
}
