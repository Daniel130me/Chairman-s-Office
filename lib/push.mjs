import {sql,one} from '../backend/src/db.mjs';
import webpush from 'web-push';
import {pushEndpoint} from './validation.mjs';
import {invitationPush} from './push-rules.mjs';
export function configurePush(){
 if(!process.env.VAPID_PUBLIC_KEY||!process.env.VAPID_PRIVATE_KEY)return false;
 webpush.setVapidDetails(process.env.VAPID_SUBJECT||'mailto:admin@example.com',process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
 return true;
}
// Receipt means the browser push service accepted the request, not that a human saw it.
export async function deliverDevicePush(sub,itemKey,payload,ttl){
 try{
  const active=await one('SELECT * FROM push_subscriptions WHERE id=$1 AND user_id=$2 AND endpoint=$3',[sub.id,sub.user_id,sub.endpoint]);
  if(!active)return 'gone';
  if(await one('SELECT 1 FROM push_device_receipts WHERE subscription_id=$1 AND item_key=$2 AND user_id=$3',[sub.id,itemKey,sub.user_id]))return 'accepted';
  pushEndpoint(active.endpoint);
  if(active.subscription.endpoint!==active.endpoint)throw Error('Push endpoint mismatch');
  await webpush.sendNotification(active.subscription,JSON.stringify(payload),{TTL:ttl,timeout:5000});
  await sql('INSERT INTO push_device_receipts(user_id,subscription_id,item_key) SELECT user_id,id,$3 FROM push_subscriptions WHERE id=$1 AND user_id=$2 ON CONFLICT DO NOTHING',[sub.id,sub.user_id,itemKey]);
  return 'accepted';
 }catch(error){
  if([404,410].includes(error.statusCode)||error.status===400||error.message==='Push endpoint mismatch'){
   await sql('DELETE FROM push_subscriptions WHERE id=$1 AND user_id=$2 AND endpoint=$3',[sub.id,sub.user_id,sub.endpoint]);return 'gone';
  }
  return 'retry';
 }
}
export async function deliverInvitePush(inviteId){
 if(!configurePush())return false;
 const invite=await one(`UPDATE invites SET push_attempt_at=now(),push_attempts=push_attempts+1
  WHERE id=$1 AND status='pending' AND due_at<=now() AND push_sent_at IS NULL AND push_attempts<5
  AND due_at>now()-CASE WHEN kind='welcome' THEN interval '1 hour' ELSE interval '15 minutes' END
  AND (push_attempt_at IS NULL OR push_attempt_at<now()-interval '3 minutes')
  AND EXISTS(SELECT 1 FROM push_subscriptions s WHERE s.user_id=invites.user_id) RETURNING *`,[inviteId]);
 if(!invite)return false;
 const subscriptions=await sql('SELECT * FROM push_subscriptions WHERE user_id=$1 ORDER BY id',[invite.user_id]);
 let accepted=false,failed=false;
 for(const sub of subscriptions){
  const current=await one("SELECT * FROM invites WHERE id=$1 AND user_id=$2 AND status='pending'",[invite.id,invite.user_id]);const push=current&&invitationPush(current);if(!push)break;
  const result=await deliverDevicePush(sub,'invite:'+invite.id,push.payload,push.ttl);accepted||=result==='accepted';failed||=result==='retry';
 }
 if(accepted&&!failed)await sql('UPDATE invites SET push_sent_at=now() WHERE id=$1 AND user_id=$2',[invite.id,invite.user_id]);
 return accepted&&!failed;
}
