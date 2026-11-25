import {sql,one,uid,transaction} from '../backend/src/db.mjs';
import {ask} from '../backend/src/ai.mjs';
import webpush from 'web-push';
import {localTime,isQuiet,inWindow} from './schedule.mjs';
import {pushEndpoint} from './validation.mjs';

// Daily keys make invitations safe to retry.
async function invite(w,c,kind,day,subject,preview){
  const row=await one(`INSERT INTO invites(id,user_id,world_id,contact_id,kind,subject,preview,due_at,schedule_key)
    VALUES($1,$2,$3,$4,$5,$6,$7,now(),$8) ON CONFLICT(user_id,schedule_key) DO NOTHING RETURNING id`,
    [uid(),w.user_id,w.id,c.id,kind,subject,preview,day+':'+kind]);
  return !!row;
}
async function develop(w){
  if(Date.now()-new Date(w.last_tick).getTime()<45*60000)return;
  const t=await one("SELECT * FROM threads WHERE user_id=$1 AND status='open' ORDER BY updated_at ASC,id LIMIT 1",[w.user_id]);
  if(!t)return;
  const c=await one('SELECT * FROM contacts WHERE id=$1 AND user_id=$2',[t.contact_id,w.user_id]);
  const content=await ask('Create a short concrete fictional business development with stakes and consequences. Never claim real actions occurred.',`Group: ${w.name}; issue: ${t.title}; previous: ${t.summary}; executive: ${c?.name||'Leadership team'}`,{fallback:'A new review is needed before resources are committed. '+t.summary});
  // Compare timestamps so a retry cannot overwrite a newer decision.
  await transaction(async q=>{
    const current=await q('UPDATE worlds SET last_tick=now() WHERE id=$1 AND last_tick=$2 RETURNING id',[w.id,w.last_tick]);
    if(!current.length)return;
    const changed=await q('UPDATE threads SET stage=stage+1,summary=$1,updated_at=now() WHERE id=$2 AND user_id=$3 AND updated_at=$4 RETURNING id',[content,t.id,w.user_id,t.updated_at]);
    if(changed.length)await q('INSERT INTO events(id,user_id,world_id,thread_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[uid(),w.user_id,w.id,t.id,t.contact_id,'development',t.title,content]);
  });
}
async function processWorld(w){
  const s=await one('SELECT * FROM settings WHERE user_id=$1',[w.user_id]);
  if(!s)return;
  const now=localTime(w.timezone);
  if(!isQuiet(now.minute,s.quiet_start,s.quiet_end)){
    const chief=await one("SELECT * FROM contacts WHERE user_id=$1 AND title='Chief of Staff' LIMIT 1",[w.user_id]);
    const count=await one("SELECT count(*)::int AS n FROM invites WHERE user_id=$1 AND kind IN ('morning','evening','network','development-call') AND created_at>=now()-interval '24 hours'",[w.user_id]);
    let remaining=Math.max(0,s.max_daily-count.n);
    if(chief)for(const [kind,time,subject] of [['morning',s.morning,'Your morning executive briefing'],['evening',s.evening,'Evening update from your office']]){
      if(remaining>0&&inWindow(now.minute,time)&&await invite(w,chief,kind,now.day,subject,chief.name+' would like to review your priorities and outstanding decisions.'))remaining--;
    }
    if(remaining>0&&now.minute>=14*60&&now.minute<18*60){
      const contacts=await sql("SELECT * FROM contacts WHERE user_id=$1 AND kind<>'internal' ORDER BY name",[w.user_id]);
      if(contacts.length){
        const c=contacts[(Number(now.day.slice(-2))+w.user_id.charCodeAt(0))%contacts.length];
        if(await invite(w,c,'network',now.day,'Incoming call · '+c.name,c.name+' from '+c.company+' would like to discuss a new development.'))remaining--;
      }
    }
    if(remaining>0&&s.urgent){
      const t=await one("SELECT title,contact_id FROM threads WHERE user_id=$1 AND priority='high' AND status='open' AND stage>0 ORDER BY updated_at DESC LIMIT 1",[w.user_id]);
      const c=t&&await one('SELECT * FROM contacts WHERE id=$1 AND user_id=$2',[t.contact_id,w.user_id]);
      if(c)await invite(w,c,'development-call',now.day,'Incoming call · '+c.name,c.name+' needs your direction on '+t.title+'.');
    }
  }
  await develop(w);
}
async function deliverPush(){
  if(!process.env.VAPID_PUBLIC_KEY||!process.env.VAPID_PRIVATE_KEY)return;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT||'mailto:admin@example.com',process.env.VAPID_PUBLIC_KEY,process.env.VAPID_PRIVATE_KEY);
  const invites=await sql(`WITH due AS (
    SELECT i.id FROM invites i WHERE i.status='pending' AND i.due_at<=now() AND i.push_sent_at IS NULL AND i.push_attempts<5
    AND (i.push_attempt_at IS NULL OR i.push_attempt_at<now()-interval '3 minutes')
    AND EXISTS(SELECT 1 FROM push_subscriptions s WHERE s.user_id=i.user_id)
    ORDER BY i.due_at LIMIT 20 FOR UPDATE SKIP LOCKED
  ) UPDATE invites i SET push_attempt_at=now(),push_attempts=push_attempts+1 FROM due WHERE i.id=due.id RETURNING i.*`);
  await Promise.all(invites.map(async inv=>{
    const subs=await sql('SELECT * FROM push_subscriptions WHERE user_id=$1',[inv.user_id]);
    let failed=false;
    for(const sub of subs){
      try{
        pushEndpoint(sub.endpoint);
        if(sub.subscription.endpoint!==sub.endpoint)throw Error('Push endpoint mismatch');
        await webpush.sendNotification(sub.subscription,JSON.stringify({title:inv.subject,body:inv.preview,inviteId:inv.id}),{TTL:300,timeout:5000});
      }catch(e){
        if([404,410].includes(e.statusCode)||e.status===400||e.message==='Push endpoint mismatch')await sql('DELETE FROM push_subscriptions WHERE id=$1',[sub.id]);
        else failed=true;
      }
    }
    if(!failed)await sql('UPDATE invites SET push_sent_at=now() WHERE id=$1',[inv.id]);
  }));
}
export async function tick(interval){
  const token=uid();
  const lease=await one(`UPDATE engine_control SET lease_until=now()+interval '5 minutes',lease_token=$1
    WHERE name='world' AND lease_until<now() AND last_tick<=now()-($2::int*interval '1 second') RETURNING name`,[token,Math.max(1,interval-5)]);
  if(!lease)return;
  try{
    await sql("UPDATE invites SET status='missed' WHERE status='pending' AND due_at<now()-CASE WHEN kind='welcome' THEN interval '1 hour' ELSE interval '15 minutes' END");
    const worlds=await sql('SELECT * FROM worlds ORDER BY scheduler_checked_at NULLS FIRST,id LIMIT 10');
    for(let i=0;i<worlds.length;i+=3){
      await Promise.all(worlds.slice(i,i+3).map(async w=>{
        try{await processWorld(w);}catch(e){console.error('World engine',w.id,e.code||e.name);}
        await sql('UPDATE worlds SET scheduler_checked_at=now() WHERE id=$1',[w.id]);
      }));
    }
    await deliverPush();
    await sql("DELETE FROM request_limits WHERE bucket<now()-interval '1 day'");
  }finally{
    await sql("UPDATE engine_control SET last_tick=now(),lease_until='-infinity',lease_token=NULL WHERE name='world' AND lease_token=$1",[token]);
  }
}
