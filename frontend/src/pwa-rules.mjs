const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const targets=new Set(['activity','phone','messages','calendar','board','finance','documents','deals','intelligence','news','employees','operations','investigations','approvals','security','family','travel','giving','inventory','loans','acquisitions','mail','contacts','companies','assistant','settings']);
export function notificationTarget(value){return targets.has(value)?value:'activity';}
export function notificationIntent({inviteId,eventId,target}={}){
 return {inviteId:UUID.test(String(inviteId||''))?inviteId:null,eventId:UUID.test(String(eventId||''))?eventId:null,target:notificationTarget(target)};
}
export function liveInvite(invite,now=Date.now()){
 const due=new Date(invite?.due_at).getTime(),age=now-due;
 return invite?.status==='pending'&&Number.isFinite(due)&&age>=0&&age<(invite.kind==='welcome'?3600000:900000);
}
export function shouldPoll({online,visible,activeCall=false,checking=false}){return online&&visible&&!activeCall&&!checking;}
