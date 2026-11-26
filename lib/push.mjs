import {sql,one} from '../backend/src/db.mjs';
import webpush from 'web-push';
import {pushEndpoint} from './validation.mjs';

export async function deliverInvitePush(inviteId){
  if(!process.env.VAPID_PUBLIC_KEY||!process.env.VAPID_PRIVATE_KEY)return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT||'mailto:admin@example.com',process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);

  const invite=await one(
    "UPDATE invites SET push_attempt_at=now(),push_attempts=push_attempts+1 "+
    "WHERE id=$1 AND status='pending' AND due_at<=now() AND push_sent_at IS NULL AND push_attempts<5 "+
    "AND (push_attempt_at IS NULL OR push_attempt_at<now()-interval '3 minutes') "+
    "AND EXISTS(SELECT 1 FROM push_subscriptions s WHERE s.user_id=invites.user_id) RETURNING *",
    [inviteId]
  );
  if(!invite)return false;

  const subscriptions=await sql('SELECT * FROM push_subscriptions WHERE user_id=$1',[invite.user_id]);
  let failed=false;
  for(const subscription of subscriptions){
    try{
      pushEndpoint(subscription.endpoint);
      if(subscription.subscription.endpoint!==subscription.endpoint)throw Error('Push endpoint mismatch');
      await webpush.sendNotification(
        subscription.subscription,
        JSON.stringify({title:invite.subject,body:'Incoming business call. Open Chairman’s Office to answer.',inviteId:invite.id}),
        {TTL:300,timeout:5000}
      );
    }catch(error){
      if([404,410].includes(error.statusCode)||error.status===400||error.message==='Push endpoint mismatch'){
        await sql('DELETE FROM push_subscriptions WHERE id=$1',[subscription.id]);
      }else failed=true;
    }
  }

  if(!failed)await sql('UPDATE invites SET push_sent_at=now() WHERE id=$1',[invite.id]);
  return !failed;
}
