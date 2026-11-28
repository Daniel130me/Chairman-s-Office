export const MAX_COORDINATION_DEPTH=3;
export const AGENCY_QUEUE_LIMIT=24;
export function agencyPriority(source,evidence={}){
 if(source==='chairman-message')return 100;
 if(source==='colleague-message')return 80;
 if(source==='business-event'){
  if(['open-investigation','overdue-loan-installment','overdue-invoice'].includes(evidence.source_type))return 90;
  return 65;
 }
 if(source==='assigned-task')return 60;
 return evidence.priority==='high'?55:40;
}
export function coordinationAllowed({depth,recipient,actor,choice}){
 return Number.isInteger(depth)&&depth>=0&&depth<MAX_COORDINATION_DEPTH&&recipient&&recipient!==actor&&recipient!=='chairman'&&choice!=='inaction';
}
export function validateAutonomyPolicy(input){
 const dailyAttemptLimit=Number(input.dailyAttemptLimit);
 if(!Number.isInteger(dailyAttemptLimit)||dailyAttemptLimit<0||dailyAttemptLimit>100000||typeof input.paused!=='boolean')return null;
 return {dailyAttemptLimit,paused:input.paused};
}
