import test from 'node:test';
import assert from 'node:assert/strict';
import {sql,uid,database} from '../backend/src/db.mjs';
import {checkpointCall,recoverAbandonedCalls,monitorTravel,requestConcierge,resolveDisruption,executiveTravelSnapshot} from '../lib/executive-experience.mjs';
test('executive call and travel persistence with tenant isolation',{skip:process.env.RUN_EXECUTIVE_EXPERIENCE_DB_TESTS!=='1',timeout:60000},async()=>{
 assert.match(process.env.DATABASE_URL||'',/@127\.0\.0\.1:5432\/chairman_ci\?/);
 const u={id:uid()},other={id:uid()},world=uid(),contact=uid(),call=uid(),trip=uid();
 try{
  await sql('INSERT INTO users(id,name,email,pass_hash) VALUES($1,$2,$3,$4),($5,$6,$7,$4)',[u.id,'Chairman',u.id+'@ci.invalid','fixture',other.id,'Other',other.id+'@ci.invalid']);
  await sql("INSERT INTO worlds(id,user_id,name,region,timezone,sectors,chief) VALUES($1,$2,'CI Group','Fictional','UTC','[]','Chief')",[world,u.id]);
  await sql("INSERT INTO contacts(id,user_id,world_id,name,title,kind) VALUES($1,$2,$3,'Executive','CFO','internal')",[contact,u.id,world]);
  await sql("INSERT INTO calls(id,user_id,world_id,contact_id) VALUES($1,$2,$3,$4)",[call,u.id,world,contact]);
  const a={role:'assistant',text:'Opening remarks'},b={role:'user',text:'Proceed with the review'};
  assert.equal((await checkpointCall(u,call,{offset:0,transcript:[a]})).saved,1);
  assert.equal((await checkpointCall(u,call,{offset:1,transcript:[b]})).saved,2);
  assert.equal((await checkpointCall(u,call,{offset:0,transcript:[a]})).saved,2);
  await assert.rejects(()=>checkpointCall(other,call,{transcript:[]}),/unavailable/);
  await sql("UPDATE calls SET last_heartbeat_at=now()-interval '11 minutes' WHERE id=$1",[call]);
  await recoverAbandonedCalls(u.id);
  const [closed]=await sql('SELECT status,transcript FROM calls WHERE id=$1',[call]);assert.equal(closed.status,'failed');assert.equal(closed.transcript.length,2);
  await sql("INSERT INTO travel_trips(id,user_id,world_id,trip_type,title,origin,destination,purpose,depart_at,operation_key) VALUES($1,$2,$3,'business','Trip','A','B','Review',now()+interval '1 day',$4)",[trip,u.id,world,uid()]);
  await monitorTravel(u.id);await monitorTravel(u.id);
  const snapshot=await executiveTravelSnapshot(u.id);assert.equal(snapshot.disruptions.length,1);assert.equal(snapshot.disruptions[0].kind,'missing-booking');
  await assert.rejects(()=>resolveDisruption(other,snapshot.disruptions[0].id,{reason:'Recorded resolution'}),/unavailable/);
  await resolveDisruption(u,snapshot.disruptions[0].id,{reason:'Confirmed alternative transport arrangement'});
  const j=await requestConcierge(u,trip,{operationKey:uid()});assert.equal(j.status,'pending');
  assert.equal((await requestConcierge(u,trip,{operationKey:uid()})).id,j.id);
 }finally{await sql('DELETE FROM users WHERE id=ANY($1::uuid[])',[[u.id,other.id]]);await database().end();}
});
