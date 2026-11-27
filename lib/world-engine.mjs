"use step";

import {sql,one,uid,transaction} from '../backend/src/db.mjs';
import webpush from 'web-push';
import {localTime,isQuiet,inWindow,minutes} from './schedule.mjs';
import {pushEndpoint} from './validation.mjs';
import {processMissedCallMessages} from './missed-call-messages.mjs';
import {processVoiceNotes} from './voice-notes.mjs';

import {processRecurringGrants} from './philanthropy.mjs';
import {processPersonalUpkeep} from './personal-wealth.mjs';
import {recoverAbandonedCalls,monitorTravel,processConcierge} from './executive-experience.mjs';
import {processProviderDisruptions,processReplacementQuotes} from './travel-rebooking.mjs';
import {processTravel} from './travel.mjs';
import {processBoardVotes} from './board-governance.mjs';
import {processRelationshipOutcomes} from './relationship-world.mjs';
import {processStakeholders} from './stakeholder-world.mjs';
import {processRfqs} from './supplier-rfq.mjs';
import {processSuppliers} from './supplier-world.mjs';
import {processHR} from './hr-world.mjs';
import {processDisputeDeadlines} from './dispute-payment-plans.mjs';
import {processContractObligations,syncCommercialDisputes,processSupplierDeadlines} from './advanced-operations.mjs';
import {processProcurement} from './procurement.mjs';
import {processSecurityIncidents} from './security.mjs';
import {processSecurityScenario,processSecurityReviews,processSecurityInterviews} from './security-world.mjs';
import {processCharacterMemory,processCharacterAgenda,processCharacterRelationships} from './character-intelligence.mjs';
import {processCovenants} from './corporate-finance.mjs';
import {processLoanObligations} from './loan-schedule.mjs';
import {advanceEconomy,executeBusinessTasks} from './economy.mjs';
import {processAutonomousCommunications} from './autonomous-communications.mjs';
import {processColleagueCalls,processColleagueAudio} from './colleague-calls.mjs';
import {processMarketMoves} from './market-engine.mjs';
import {processApprovedActions} from './action-requests.mjs';
import {processAutonomousExecutives} from './autonomous-executives.mjs';
import {processCommercialOpportunities,processCommercialMilestones,processCommercialCollections} from './commercial-world.mjs';
import {pushEventKinds,notificationForEvent} from './event-notifications.mjs';
// Daily keys make invitations safe to retry.
async function invite(w,c,kind,day,subject,preview){
  const row=await one(`INSERT INTO invites(id,user_id,world_id,contact_id,kind,subject,preview,due_at,schedule_key)
    VALUES($1,$2,$3,$4,$5,$6,$7,now(),$8) ON CONFLICT(user_id,schedule_key) DO NOTHING RETURNING id`,
    [uid(),w.user_id,w.id,c.id,kind,subject,preview,day+':'+kind]);
  return !!row;
}
// Completed financial work can lead to a call at any hour, not merely a briefing window.
async function reportCalls(w,s,quiet){
 if(quiet||s.max_daily===0)return;
 await transaction(async q=>{
  const lock=(await q('SELECT id FROM worlds WHERE id=$1 AND user_id=$2 FOR UPDATE',[w.id,w.user_id]))[0];
  if(!lock)return;
  const count=(await q("SELECT count(*)::int AS n FROM invites WHERE user_id=$1 AND created_at>=now()-interval '24 hours'",[w.user_id]))[0];
  const remaining=Math.max(0,s.max_daily-count.n);
  if(!remaining)return;
  const rows=await q(`SELECT t.id,t.title,t.task_type,t.assignee_id,t.outcome_document_id,c.name
    FROM business_tasks t JOIN contacts c ON c.id=t.assignee_id AND c.user_id=t.user_id
    WHERE t.user_id=$1 AND t.world_id=$2 AND t.status='completed'
    AND t.outcome_document_id IS NOT NULL AND t.report_call_invite_id IS NULL AND c.kind='internal'
    ORDER BY t.completed_at DESC LIMIT $3 FOR UPDATE OF t SKIP LOCKED`,[w.user_id,w.id,remaining]);
  for(const row of rows){
   const key='review:'+row.id;
   let inv=(await q(`INSERT INTO invites(id,user_id,world_id,contact_id,kind,subject,preview,due_at,schedule_key)
   VALUES($1,$2,$3,$4,'report-ready',$5,$6,now(),$7) ON CONFLICT(user_id,schedule_key) DO NOTHING RETURNING id`,[uid(),w.user_id,w.id,row.assignee_id,'Incoming call · '+row.name,'The '+row.task_type+' is complete. '+row.title+' is filed in Documents.',key]))[0];
   if(!inv)inv=(await q('SELECT id FROM invites WHERE user_id=$1 AND schedule_key=$2',[w.user_id,key]))[0];
   if(inv)await q('UPDATE business_tasks SET report_call_invite_id=$2 WHERE id=$1',[row.id,inv.id]);
  }
 });
}
async function processWorld(w){
  // Stages are independent: an unavailable AI provider or failed economic
  // transaction must not prevent other business activity from progressing.
  await runStage(w,'economy',()=>advanceEconomy(w.user_id));
  await runStage(w,'loan-obligations',()=>processLoanObligations(w.user_id));
  await runStage(w,'loan-covenants',()=>processCovenants(w.user_id));
  await runStage(w,'security-incidents',()=>processSecurityIncidents(w.user_id));
  await runStage(w,'security-scenarios',()=>processSecurityScenario(w.user_id));
  await runStage(w,'security-reviews',()=>processSecurityReviews(w.user_id));
  await runStage(w,'security-interviews',()=>processSecurityInterviews(w.user_id));
  await runStage(w,'procurement',()=>processProcurement(w.user_id));
  await runStage(w,'supplier-deadlines',()=>processSupplierDeadlines(w.user_id));
  await runStage(w,'supplier-rfqs',()=>processRfqs(w.user_id));
  await runStage(w,'suppliers',()=>processSuppliers(w.user_id));
  await runStage(w,'relationships',()=>processRelationshipOutcomes(w.user_id));
  await runStage(w,'stakeholders',()=>processStakeholders(w.user_id));
  await runStage(w,'board-votes',()=>processBoardVotes(w.user_id));
  await runStage(w,'travel-monitor',()=>monitorTravel(w.user_id));
  await runStage(w,'travel-provider',()=>processProviderDisruptions(w.user_id));
  await runStage(w,'travel-replacement-quotes',()=>processReplacementQuotes(w.user_id));
  await runStage(w,'travel-concierge',()=>processConcierge(w.user_id));
  await runStage(w,'travel',()=>processTravel(w.user_id));
  await runStage(w,'call-recovery',()=>recoverAbandonedCalls(w.user_id));
  await runStage(w,'personal-upkeep',()=>processPersonalUpkeep(w.user_id));
  await runStage(w,'philanthropy',()=>processRecurringGrants(w.user_id));
  await runStage(w,'human-resources',()=>processHR(w.user_id));
  await runStage(w,'commercial-opportunities',()=>processCommercialOpportunities(w.user_id));
  await runStage(w,'commercial-milestones',()=>processCommercialMilestones(w.user_id));
  await runStage(w,'commercial-collections',()=>processCommercialCollections(w.user_id));
  await runStage(w,'contract-obligations',()=>processContractObligations(w.user_id));
  await runStage(w,'dispute-payment-deadlines',()=>processDisputeDeadlines(w.user_id));
  await runStage(w,'commercial-disputes',()=>syncCommercialDisputes(w.user_id));
  await runStage(w,'executive-work',()=>processAutonomousExecutives(w.user_id));
  await runStage(w,'tasks',()=>executeBusinessTasks(w.user_id));
  await runStage(w,'approved-actions',()=>processApprovedActions(w.user_id));
  await runStage(w,'communications',()=>processAutonomousCommunications(w.user_id));
  await runStage(w,'character-memory',()=>processCharacterMemory(w.user_id));
  await runStage(w,'character-agendas',()=>processCharacterAgenda(w.user_id));
  await runStage(w,'character-relationships',()=>processCharacterRelationships(w.user_id));
  await runStage(w,'colleague-calls',()=>processColleagueCalls(w.user_id));
  await runStage(w,'colleague-audio',()=>processColleagueAudio(w.user_id));
  await runStage(w,'market',()=>processMarketMoves(w.user_id));
  await runStage(w,'call-scheduling',()=>scheduleWorldCalls(w));
}
async function runStage(w,stage,fn){
  let code=null;
  try{await fn();}
  catch(error){
    code=String(error.code||error.name||'error').slice(0,80);
    console.error('World engine stage',w.id,stage,code);
  }
  try{
    await sql(`INSERT INTO engine_stage_status(world_id,stage,last_attempt_at,last_success_at,last_error_code,consecutive_failures)
      VALUES($1,$2,now(),CASE WHEN $3::text IS NULL THEN now() ELSE NULL END,$3,CASE WHEN $3::text IS NULL THEN 0 ELSE 1 END)
      ON CONFLICT(world_id,stage) DO UPDATE SET last_attempt_at=now(),
      last_success_at=COALESCE(EXCLUDED.last_success_at,engine_stage_status.last_success_at),
      last_error_code=EXCLUDED.last_error_code,
      consecutive_failures=CASE WHEN EXCLUDED.last_error_code IS NULL THEN 0 ELSE engine_stage_status.consecutive_failures+1 END`,
      [w.id,stage,code]);
  }catch(error){console.error('World stage status',stage,error.code||error.name);}
}
async function scheduleWorldCalls(w){
  const s=await one('SELECT * FROM settings WHERE user_id=$1',[w.user_id]);
  if(!s)return;
  const now=localTime(w.timezone);
  const quiet=!!s.quiet_enabled&&isQuiet(now.minute,s.quiet_start,s.quiet_end);
  await reportCalls(w,s,quiet);
  if(!quiet){
    const chief=await one("SELECT * FROM contacts WHERE user_id=$1 AND title='Chief of Staff' LIMIT 1",[w.user_id]);
    const count=await one("SELECT count(*)::int AS n FROM invites WHERE user_id=$1 AND created_at>=now()-interval '24 hours'",[w.user_id]);
    let remaining=Math.max(0,s.max_daily-count.n);
    if(chief)for(const [kind,time,subject] of [['morning',s.morning,'Your morning executive briefing'],['evening',s.evening,'Evening update from your office']]){
      if(remaining>0&&inWindow(now.minute,time)){
        // A briefing window crossing midnight belongs to the day on which it began.
        const day=now.minute<minutes(time)?new Date(Date.parse(now.day+'T00:00:00Z')-86400000).toISOString().slice(0,10):now.day;
        if(await invite(w,chief,kind,day,subject,chief.name+' would like to review your priorities and outstanding decisions.'))remaining--;
      }
    }
    if(remaining>0&&s.urgent){
      const t=await one("SELECT title,contact_id FROM threads WHERE user_id=$1 AND priority='high' AND status='open' AND updated_at>=now()-interval '24 hours' ORDER BY updated_at DESC LIMIT 1",[w.user_id]);
      const c=t&&await one('SELECT * FROM contacts WHERE id=$1 AND user_id=$2',[t.contact_id,w.user_id]);
      if(c)await invite(w,c,'development-call',now.day,'Incoming call · '+c.name,c.name+' needs your direction on '+t.title+'.');
    }
  }
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
        const itemKey='invite:'+inv.id;
        if(await one('SELECT 1 FROM push_device_receipts WHERE subscription_id=$1 AND item_key=$2 AND user_id=$3',[sub.id,itemKey,inv.user_id]))continue;
        pushEndpoint(sub.endpoint);
        if(sub.subscription.endpoint!==sub.endpoint)throw Error('Push endpoint mismatch');
        await webpush.sendNotification(sub.subscription,JSON.stringify({title:'Incoming executive call',body:'Incoming business call. Open Chairman’s Office to answer.',inviteId:inv.id}),{TTL:300,timeout:5000});
        await sql('INSERT INTO push_device_receipts(user_id,subscription_id,item_key) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[inv.user_id,sub.id,itemKey]);
      }catch(e){
        if([404,410].includes(e.statusCode)||e.status===400||e.message==='Push endpoint mismatch')await sql('DELETE FROM push_subscriptions WHERE id=$1',[sub.id]);
        else failed=true;
      }
    }
    if(!failed)await sql('UPDATE invites SET push_sent_at=now() WHERE id=$1',[inv.id]);
  }));
  const events=await sql(`WITH due AS (
    SELECT e.id FROM events e WHERE e.kind=ANY($1::text[]) AND e.push_sent_at IS NULL AND e.push_attempts<5
      AND e.created_at>=now()-interval '48 hours'
      AND (e.push_attempt_at IS NULL OR e.push_attempt_at<now()-interval '3 minutes')
      AND EXISTS(SELECT 1 FROM push_subscriptions s WHERE s.user_id=e.user_id)
    ORDER BY e.created_at LIMIT 30 FOR UPDATE SKIP LOCKED
  ) UPDATE events e SET push_attempt_at=now(),push_attempts=push_attempts+1 FROM due WHERE e.id=due.id RETURNING e.*`,[pushEventKinds]);
  await Promise.all(events.map(async event=>{
    const notification=notificationForEvent(event.kind);if(!notification)return;
    const subs=await sql('SELECT * FROM push_subscriptions WHERE user_id=$1',[event.user_id]);
    let failed=false;
    for(const sub of subs){
      try{
        const itemKey='event:'+event.id;
        if(await one('SELECT 1 FROM push_device_receipts WHERE subscription_id=$1 AND item_key=$2 AND user_id=$3',[sub.id,itemKey,event.user_id]))continue;
        pushEndpoint(sub.endpoint);
        if(sub.subscription.endpoint!==sub.endpoint)throw Error('Push endpoint mismatch');
        await webpush.sendNotification(sub.subscription,JSON.stringify({...notification,eventId:event.id}),{TTL:3600,timeout:5000});
        await sql('INSERT INTO push_device_receipts(user_id,subscription_id,item_key) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[event.user_id,sub.id,itemKey]);
      }catch(error){
        if([404,410].includes(error.statusCode)||error.status===400||error.message==='Push endpoint mismatch')await sql('DELETE FROM push_subscriptions WHERE id=$1',[sub.id]);
        else failed=true;
      }
    }
    if(!failed)await sql('UPDATE events SET push_sent_at=now() WHERE id=$1',[event.id]);
  }));
}
export async function tick(interval){
  const token=uid();
  // Older databases may contain a lock row with NULL timestamps. Treat it as unlocked,
  // and create the singleton row defensively before trying to acquire the lease.
  await one("INSERT INTO engine_control(name) VALUES('world') ON CONFLICT(name) DO NOTHING RETURNING name");
  const lease=await one(`UPDATE engine_control SET lease_until=now()+interval '5 minutes',lease_token=$1
    WHERE name='world'
      AND COALESCE(lease_until,'-infinity'::timestamptz)<now()
      AND COALESCE(last_tick,'-infinity'::timestamptz)<=now()-($2::int*interval '1 second')
    RETURNING name`,[token,Math.max(1,interval-5)]);
  if(!lease)return;
  try{
    await sql("UPDATE invites SET status='missed' WHERE status='pending' AND due_at<now()-CASE WHEN kind='welcome' THEN interval '1 hour' ELSE interval '15 minutes' END");
    const worlds=await sql('SELECT *,last_tick::text AS exact_last_tick FROM worlds ORDER BY scheduler_checked_at NULLS FIRST,id LIMIT 10');
    for(let i=0;i<worlds.length;i+=3){
      await Promise.all(worlds.slice(i,i+3).map(async w=>{
        try{await processWorld(w);}catch(e){console.error('World engine',w.id,e.code||e.name);}
        await sql('UPDATE worlds SET scheduler_checked_at=now() WHERE id=$1',[w.id]);
      }));
    }
    try{await deliverPush();}catch(error){console.error('World engine push',error.code||error.name);}
    try{await processMissedCallMessages();}catch(error){console.error('World engine missed-call',error.code||error.name);}
    try{await processVoiceNotes();}catch(error){console.error('World engine voice notes',error.code||error.name);}
    await sql("DELETE FROM request_limits WHERE bucket<now()-interval '1 day'");
  }finally{
    await sql("UPDATE engine_control SET last_tick=now(),lease_until='-infinity',lease_token=NULL WHERE name='world' AND lease_token=$1",[token]);
  }
}


// Durable workflow step: keep database access and the full world simulation in Node.
export async function runWorldEngineTick(day,token,interval){
  "use step";
  if(process.env.WORLD_ENGINE_ENABLED!=='true')return false;
  const active=await one('UPDATE engine_runs SET heartbeat_at=now() WHERE day=$1 AND token=$2 RETURNING day',[day,token]);
  if(!active)return false;
  await tick(interval);
  return true;
}
