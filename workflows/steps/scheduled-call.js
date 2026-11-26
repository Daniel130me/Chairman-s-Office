"use step";

import {completeScheduledCall} from '../../lib/executive-actions.mjs';

export async function deliverScheduledCall(jobId){
  return completeScheduledCall(jobId);
}
