import test from 'node:test';
import assert from 'node:assert/strict';
import {sql,transaction,uid,database} from '../backend/src/db.mjs';
import {processCharacterConsequences,characterDevelopmentSnapshot,recordCharacterAssessment,withdrawCharacterAssessment,ownDevelopment,evolvedRelationships} from '../lib/character-development.mjs';
import {enqueueAgencyDecision,executeAgencyDecision,setAuthorityGrant} from '../lib/character-agency.mjs';
import {ensureCharacterPsychology,characterPsychologyContext} from '../lib/character-psychology.mjs';
import {executeBusinessTasks} from '../lib/economy.mjs';
import {hireEmployee,terminateEmployee} from '../lib/employment.mjs';
import {openInvestigation,addInvestigationEvidence,resolveInvestigation} from '../lib/operations.mjs';
test('Phase 3: verified effects, delayed outcomes, evidence scoring, corrections and career continuity',{skip:process.env.RUN_CHARACTER_DEVELOPMENT_DB_TESTS!=='1',timeout:90000},async()=>{
 assert.match(process.env.DATABASE_URL||'',/@127\.0\.0\.1:5432\/chairman_ci\?/);
 const u=uid(),other=uid(),w=uid(),co=uid(),manager=uid(),user={id:u,name:'Chairman'};
 try{
  await sql('INSERT INTO users(id,name,email,pass_hash) VALUES($1,$2,$3,$4),($5,$6,$7,$4)',[u,'Chairman',u+'@ci.invalid','fixture',other,'Other',other+'@ci.invalid']);
  await sql("INSERT INTO worlds(id,user_id,name,region,timezone,sectors,chief) VALUES($1,$2,'CI Group','Fictional','UTC','[]','Chief')",[w,u]);
  await sql("INSERT INTO companies(id,user_id,world_id,name,sector,valuation,cash,revenue) VALUES($1,$2,$3,'CI Company','Finance',10000,1000,0)",[co,u,w]);
  await sql("INSERT INTO contacts(id,user_id,world_id,name,title,kind) VALUES($1,$2,$3,'Manager','Group CFO','internal')",[manager,u,w]);
  const employee=await hireEmployee(user,{companyId:co,name:'Analyst',title:'Group CFO',salary:'1000',operationKey:uid()});const actor=employee.contact_id;
  const original=await ensureCharacterPsychology(u,actor);
  await setAuthorityGrant(user,manager,{companyId:co,actionType:'assign-task',mode:'delegated',reason:'Test delegation'});
  async function make(choice='act',actionType='assign-task',payload=null){
   const sourceId=uid(),d={choice,actionType,title:'Financial review',reason:'Recorded instruction',uncertainty:'',evidenceIds:[sourceId],payload:payload||{companyId:co,assigneeId:actor,taskType:'financial-review',title:'Financial review',detail:'Review ledger'}};
   const row=await transaction(q=>enqueueAgencyDecision(q,{userId:u,worldId:w,contactId:manager,companyId:co,sourceType:'chairman-message',sourceId,evidence:{requestedAction:d}}));
   await sql("UPDATE character_decision_records SET status='processing',attempts=1,attempted_at=now(),decision_context=$2 WHERE id=$1",[row.id,JSON.stringify({roleAtDecision:'Group CFO',knownEvidence:{instruction:'Financial review'}})]);
   return transaction(q=>executeAgencyDecision(q,{...row,attempts:1,status:'processing'},d));
  }
  const refusal=await make('refuse','none',{});
  const decisions=[];for(let i=0;i<3;i++)decisions.push(await make());
  await Promise.all([processCharacterConsequences(u),processCharacterConsequences(u)]);
  assert.equal((await sql("SELECT count(*)::int n FROM character_outcome_watches WHERE user_id=$1 AND status='pending'",[u]))[0].n,3);
  let snap=await characterDevelopmentSnapshot(u);assert.equal(snap.characterPerformance.find(p=>p.id===actor).score,null);assert.equal(snap.characterPerformance.find(p=>p.id===manager).dimensions.loyalty.score,null);
  await executeBusinessTasks(u);await processCharacterConsequences(u);await processCharacterConsequences(u);
  const result=await sql("SELECT * FROM character_consequences WHERE user_id=$1 AND contact_id=$2 AND outcome='report-delivered' ORDER BY id",[u,actor]);
  assert.equal(result.length,3);assert.ok(result.every(r=>r.parent_id&&r.decision_id&&r.observer_id===manager));
  assert.equal((await sql("SELECT count(*)::int n FROM character_outcome_watches WHERE user_id=$1 AND status='resolved'",[u]))[0].n,3);
  assert.equal((await sql("SELECT count(*)::int n FROM character_consequences WHERE user_id=$1 AND stage='indirect'",[u]))[0].n,3);
  const learned=await ownDevelopment(u,actor);assert.equal(learned.stateOffsets.confidence,2);assert.equal((await characterPsychologyContext(u,actor)).baselineState.confidence,original.baseline_state.confidence+2);assert.deepEqual(await ensureCharacterPsychology(u,actor),original);
  assert.equal((await evolvedRelationships(u,manager,[]))[0].trust,53);assert.deepEqual(await evolvedRelationships(u,actor,[]),[]);
  const judgment=await recordCharacterAssessment(user,manager,{kind:'judgment',finding:'sound',sourceId:refusal.id,attribution:'direct',confidence:1,reason:'Recorded constraints justified refusal',knownAtDecision:'The available instructions and role mandate'});
  const badLuck=await recordCharacterAssessment(user,manager,{kind:'judgment',finding:'unsound',sourceId:decisions[0].id,attribution:'external',confidence:1,reason:'External shock after decision',knownAtDecision:'No evidence of the shock at the time'});
  assert.deepEqual(badLuck.impacts,{});
  const work=await recordCharacterAssessment(user,actor,{kind:'performance',finding:'strong',sourceId:result[0].id,attribution:'direct',confidence:1,reason:'Reviewed report quality'});
  snap=await characterDevelopmentSnapshot(u);assert.ok(snap.characterPerformance.find(p=>p.id===actor).rankEligible);assert.equal(snap.characterPerformance.find(p=>p.id===manager).dimensions.judgment.score,54);
  await withdrawCharacterAssessment(user,judgment.id,{reason:'Reviewed decision again; earlier assessment withdrawn'});
  snap=await characterDevelopmentSnapshot(u);assert.equal(snap.characterPerformance.find(p=>p.id===manager).dimensions.judgment.score,null);
  const investigation=await openInvestigation(user,{companyId:co,title:'Review conduct',allegation:'Unverified concern'});
  const ev=await addInvestigationEvidence(user,investigation.id,{description:'Fixture evidence',sourceReference:'fixture:record',confidence:.9});
  const conduct={kind:'conduct',finding:'substantiated',sourceId:investigation.id,attribution:'direct',confidence:.9,reason:'Evidence reviewed',subjectLink:'Fixture evidence links conduct to character',evidenceIds:[ev.id]};
  await assert.rejects(recordCharacterAssessment(user,actor,conduct));
  await resolveInvestigation(user,investigation.id,{status:'substantiated',finding:'Confirmed fixture conduct'});
  const confirmed=await recordCharacterAssessment(user,actor,conduct);assert.equal(confirmed.impacts.integrity,-5);
  await assert.rejects(recordCharacterAssessment(user,actor,conduct));
  assert.equal((await characterDevelopmentSnapshot(other)).characterPerformance.length,0);
  await assert.rejects(recordCharacterAssessment({id:other,name:'Other'},actor,conduct));
  await terminateEmployee(user,employee.id,{reason:'Fixture termination'});await processCharacterConsequences(u);
  snap=await characterDevelopmentSnapshot(u);const former=snap.characterPerformance.find(p=>p.id===actor);assert.equal(former.kind,'former-employee');assert.equal(former.rank,null);assert.ok(former.recentEvidence.some(r=>r.outcome==='employment-ended'));assert.ok(former.dimensions.integrity.score<50);
 }finally{await sql('DELETE FROM users WHERE id=ANY($1::uuid[])',[[u,other]]);await database().end();}
});
