
import test from 'node:test';
import assert from 'node:assert/strict';
import {sql,transaction,uid,database} from '../backend/src/db.mjs';
import {enqueueAgencyDecision,executeAgencyDecision,setAuthorityGrant,agencySnapshot,processAgencyJob} from '../lib/character-agency.mjs';
test('agency PostgreSQL: refusal, authority, task assignment, spending caps, review, rollback and tenant isolation',{skip:process.env.RUN_CHARACTER_AGENCY_DB_TESTS!=='1',timeout:60000},async()=>{
 assert.match(process.env.DATABASE_URL||'',/@127\.0\.0\.1:5432\/chairman_ci\?/);
 const userId=uid(),other=uid(),worldId=uid(),companyId=uid(),actorId=uid(),reviewerId=uid();
 const user={id:userId,name:'Chairman'},actor={id:actorId,name:'CFO',title:'Group CFO'};
 const base={title:'Review financial position',reason:'Recorded instruction and evidence',uncertainty:'',evidenceIds:[],choice:'act',actionType:'assign-task',payload:{companyId,assigneeId:actorId,taskType:'financial-review',title:'Review financial position',detail:'Review current ledger'}};
 const create=async(decision,sourceType='chairman-message')=>{
  const sourceId=uid();decision={...decision,evidenceIds:[sourceId]};
  const row=await transaction(q=>enqueueAgencyDecision(q,{userId,worldId,contactId:actorId,companyId,sourceType,sourceId,evidence:{requestedAction:decision}}));
  await sql("UPDATE character_decision_records SET status='processing',attempts=1,attempted_at=now() WHERE id=$1",[row.id]);
  return {row:{...row,status:'processing',attempts:1},decision};
 };
 const execute=async ({row,decision})=>transaction(q=>executeAgencyDecision(q,row,decision));
 try{
  await sql('INSERT INTO users(id,name,email,pass_hash) VALUES($1,$2,$3,$4),($5,$6,$7,$4)',[userId,'Chairman',userId+'@ci.invalid','fixture',other,'Other',other+'@ci.invalid']);
  await sql("INSERT INTO worlds(id,user_id,name,region,timezone,sectors,chief) VALUES($1,$2,'CI Group','Fictional','UTC','[]','Chief')",[worldId,userId]);
  await sql("INSERT INTO companies(id,user_id,world_id,name,sector,valuation,cash,revenue) VALUES($1,$2,$3,'CI Company','Finance',10000,1000,0)",[companyId,userId,worldId]);
  await sql("INSERT INTO contacts(id,user_id,world_id,name,title,kind) VALUES($1,$2,$3,'CFO','Group CFO','internal'),($4,$2,$3,'Counsel','General Counsel','internal')",[actorId,userId,worldId,reviewerId]);
  assert.equal(await transaction(q=>enqueueAgencyDecision(q,{userId:other,worldId,contactId:actorId,sourceType:'goal-review',sourceId:'wrong',evidence:{}})),null);
  const refusal=await create({...base,choice:'refuse',actionType:'none',payload:{}});
  assert.equal((await execute(refusal)).status,'decided');
  const task=await create(base,'goal-review');
  const [a,b]=await Promise.all([execute(task),execute(task)]);
  assert.equal(a.status,'executed');assert.equal(b.result.taskId,a.result.taskId);
  assert.equal((await sql('SELECT count(*)::int n FROM business_tasks WHERE user_id=$1',[userId]))[0].n,1);
  assert.equal((await sql('SELECT assigned_by_contact_id FROM business_tasks WHERE id=$1',[a.result.taskId]))[0].assigned_by_contact_id,actorId);
  const expense={...base,actionType:'expense',payload:{companyId,amount:'50.00',description:'Fictional supplies'}};
  const noGrant=await execute(await create(expense));assert.equal(noGrant.status,'awaiting-approval');assert.ok(noGrant.approval_id);
  await setAuthorityGrant(user,actorId,{companyId,actionType:'expense',mode:'delegated',perActionLimit:'60',dailyLimit:'90',reason:'Fixture delegation'});
  const payment=await execute(await create(expense));assert.equal(payment.status,'executed');assert.ok(payment.result.journalId);
  const cap=await execute(await create(expense));assert.equal(cap.status,'awaiting-approval');
  assert.equal((await sql("SELECT count(*)::int n FROM economy_journal WHERE user_id=$1 AND kind='expense'",[userId]))[0].n,1);
  await setAuthorityGrant(user,actorId,{companyId,actionType:'expense',mode:'coapproval',reviewerId,perActionLimit:'60',dailyLimit:'200',reason:'Independent review'});
  const pending=await create(expense),review=await execute(pending);assert.equal(review.status,'awaiting-review');
  assert.equal(review.reviewer_id,reviewerId);
  await sql("UPDATE character_decision_records SET review=$2 WHERE id=$1",[review.id,JSON.stringify({choice:'approve',reviewerId})]);
  const reviewed=await transaction(q=>executeAgencyDecision(q,pending.row,pending.decision,{reviewed:true}));assert.equal(reviewed.status,'executed');
  await setAuthorityGrant(user,actorId,{companyId,actionType:'expense',mode:'prohibited',reason:'Revoked'});
  assert.equal((await execute(await create(expense))).status,'blocked');
  const negotiation=await create({...base,choice:'negotiate',actionType:'communicate',payload:{recipientId:reviewerId,body:'Can we discuss alternate terms?'}},'goal-review');
  const sent=await execute(negotiation);assert.equal(sent.status,'executed');assert.ok(sent.result.messageId);
  assert.equal((await sql('SELECT count(*)::int n FROM world_conversation_messages WHERE id=$1 AND user_id=$2',[sent.result.messageId,userId]))[0].n,1);
  const failed=await transaction(q=>enqueueAgencyDecision(q,{userId,worldId,contactId:actorId,sourceType:'goal-review',sourceId:uid(),evidence:{title:'Fixture'}}));
  const failedResult=await processAgencyJob(userId,failed.id,async()=>null);assert.equal(failedResult.status,'pending');assert.equal(failedResult.decision,null);
  assert.equal((await agencySnapshot(other)).characterDecisions.length,0);
  assert.equal((await agencySnapshot(other)).characterAuthorityGrants.length,0);
 }finally{await sql('DELETE FROM users WHERE id=ANY($1::uuid[])',[[userId,other]]);await database().end();}
});
