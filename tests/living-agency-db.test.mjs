import test from 'node:test';
import assert from 'node:assert/strict';
import {sql,transaction,uid,database} from '../backend/src/db.mjs';
import {enqueueAgencyDecision,executeAgencyDecision,processAgencyJob,enqueueScheduledAgency} from '../lib/character-agency.mjs';
import {processCharacterConsequences} from '../lib/character-development.mjs';
import {processColleagueCalls,recoverColleagueCallFollowups} from '../lib/colleague-calls.mjs';
import {withAutonomousScope,reserveProviderAttempt,finishProviderAttempt,setAutonomyPolicy,autonomousUsageSnapshot} from '../lib/autonomous-ai-budget.mjs';
import {activityHistory} from '../lib/activity-history.mjs';
test('Phase 4 living world: simulated 72 hours, independent recipients, calls, recovery, budget and isolation',{skip:process.env.RUN_LIVING_AGENCY_DB_TESTS!=='1',timeout:120000},async()=>{
 assert.match(process.env.DATABASE_URL||'',/@127\.0\.0\.1:5432\/chairman_ci\?/);
 const u=uid(),other=uid(),w=uid(),a=uid(),b=uid();
 try{
  await sql('INSERT INTO users(id,name,email,pass_hash) VALUES($1,$2,$3,$4),($5,$6,$7,$4)',[u,'Chairman',u+'@ci.invalid','fixture',other,'Other',other+'@ci.invalid']);
  await sql("INSERT INTO worlds(id,user_id,name,region,timezone,sectors,chief) VALUES($1,$2,'CI Group','Fictional','UTC','[]','Chief')",[w,u]);
  await sql("INSERT INTO contacts(id,user_id,world_id,name,title,kind) VALUES($1,$2,$3,'CFO','Group CFO','internal'),($4,$2,$3,'Supplier','Supplier director','supplier')",[a,u,w,b]);
  const source=uid();
  const row=await transaction(q=>enqueueAgencyDecision(q,{userId:u,worldId:w,contactId:a,sourceType:'goal-review',sourceId:source,evidence:{title:'External supplier review'}}));
  const decide=(id,recipient,channel='text',reportToChairman=false)=>({choice:'consult',actionType:'communicate',title:'Consultation',reason:'Review recorded matter',uncertainty:'No assumptions',evidenceIds:[id],payload:{recipientId:recipient,body:'Can we review the recorded matter?',channel,reportToChairman}});
  let decision=await processAgencyJob(u,row.id,async()=>decide(source,b));
  assert.equal(decision.status,'executed');assert.ok(decision.result.nextDecisionId);
  const conversationId=decision.result.conversationId;
  for(let i=1;i<=3;i++){
   const nextId=decision.result.nextDecisionId;assert.ok(nextId);
   const [next]=await sql('SELECT * FROM character_decision_records WHERE id=$1',[nextId]);assert.equal(next.coordination_depth,i);assert.equal(next.evidence.conversationId,conversationId);
   assert.ok(!JSON.stringify(next.evidence).includes('ownPsychology'));
   decision=await processAgencyJob(u,nextId,async(s,input)=>{
    const ctx=JSON.parse(input);assert.equal(ctx.actor.id,next.contact_id);assert.ok(ctx.externalContext.rules);assert.ok(ctx.ownPsychology);
    if(i%2===1)assert.equal(ctx.companies.length,0,'External character must not receive company list');
    return decide(next.source_id,next.contact_id===a?b:a);
   });
   assert.equal(decision.status,'executed');assert.equal(decision.result.conversationId,conversationId);
  }
  assert.equal(decision.result.nextDecisionId,null);
  assert.equal((await sql('SELECT count(*)::int n FROM world_conversation_messages WHERE user_id=$1 AND conversation_id=$2',[u,conversationId]))[0].n,4);
  const callSource=uid(),callJob=await transaction(q=>enqueueAgencyDecision(q,{userId:u,worldId:w,contactId:a,sourceType:'goal-review',sourceId:callSource,evidence:{title:'Call supplier'}}));
  const call=await processAgencyJob(u,callJob.id,async()=>decide(callSource,b,'call',true));
  assert.ok(call.result.callId);assert.equal(call.result.callStatus,'queued');
  await processColleagueCalls(u,async(s,input)=>{const ctx=JSON.parse(input);return {choice:'speak',body:ctx.speaker.name==='CFO'?'Can we discuss terms?':'I need more evidence.',continue:false};});
  const [saved]=await sql('SELECT * FROM colleague_calls WHERE id=$1',[call.result.callId]);assert.equal(saved.status,'completed');assert.ok(saved.followup_processed_at);
  const reports=await sql('SELECT * FROM messages WHERE user_id=$1 AND client_message_key=$2',[u,saved.id]);assert.equal(reports.length,1);
  await sql('UPDATE colleague_calls SET followup_processed_at=NULL,followup_attempt_at=NULL WHERE id=$1',[saved.id]);
  await recoverColleagueCallFollowups(u);assert.equal((await sql('SELECT count(*)::int n FROM messages WHERE user_id=$1 AND client_message_key=$2',[u,saved.id]))[0].n,1);
  await processCharacterConsequences(u);assert.equal((await sql("SELECT count(*)::int n FROM character_consequences WHERE user_id=$1 AND decision_id=$2 AND outcome='call-completed'",[u,call.id]))[0].n,1);
  // Advance a controlled scheduler clock over 72 hours; no UI or real providers
  // are needed. The database still enforces idempotency and isolation.
  const goal=uid();await sql("INSERT INTO character_goals(id,user_id,world_id,contact_id,goal_type,title,description,rationale,source_key) VALUES($1,$2,$3,$4,'business','Review supplier','Monitor terms','Recorded objective',$5)",[goal,u,w,b,'fixture:'+goal]);
  const first=new Date(Date.now()-72*3600000);
  for(let day=0;day<3;day++){
   const now=new Date(first.getTime()+day*86400000+3600000);
   const r=await enqueueScheduledAgency(u,{now});assert.ok(r);assert.equal(r.contact_id,b);
   const outcome=await processAgencyJob(u,r.id,async()=>({choice:'inaction',actionType:'none',title:'Wait for evidence',reason:'No new actionable information',uncertainty:'',evidenceIds:[r.source_id],payload:{}}));
   assert.equal(outcome.status,'decided');
   await sql('UPDATE character_decision_records SET created_at=$2,completed_at=$2 WHERE id=$1',[r.id,now]);
   assert.equal(await enqueueScheduledAgency(u,{now}),null);
  }
  assert.equal((await sql("SELECT count(*)::int n FROM character_decision_records WHERE user_id=$1 AND source_type='goal-review' AND source_id LIKE $2",[u,goal+':%']))[0].n,3);
  await setAutonomyPolicy(u,{dailyAttemptLimit:2,paused:false});
  const spend=()=>withAutonomousScope(u,'fixture',async()=>{const ticket=await reserveProviderAttempt('fixture',100);await finishProviderAttempt(ticket,20,true);return ticket;});
  const results=await Promise.allSettled([spend(),spend(),spend()]);assert.equal(results.filter(x=>x.status==='fulfilled').length,2);
  const usage=await autonomousUsageSnapshot(u);assert.equal(usage.usage[0].attempts,2);assert.equal(usage.usage[0].successes,2);assert.equal((await autonomousUsageSnapshot(other)).usage.length,0);
  assert.equal(await reserveProviderAttempt('fixture',1),null,'Interactive request is not counted in autonomous budget');
  assert.ok((await activityHistory(u,null)).rows.some(r=>r.source==='characterDecisions'));
  assert.equal((await activityHistory(other,null)).rows.length,0);
 }finally{await sql('DELETE FROM users WHERE id=ANY($1::uuid[])',[[u,other]]);await database().end();}
});
