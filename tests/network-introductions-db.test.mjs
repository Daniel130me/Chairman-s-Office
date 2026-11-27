import test from 'node:test';
import assert from 'node:assert/strict';
import {sql,transaction,uid,database} from '../backend/src/db.mjs';
import {persistNetworkIntroduction} from '../lib/network-introductions.mjs';
test('real PostgreSQL network introduction is atomic, retry-safe and tenant-scoped',{skip:process.env.RUN_NETWORK_INTRO_DB_TESTS!=='1',timeout:60000},async()=>{
 assert.match(process.env.DATABASE_URL||'',/@127\.0\.0\.1:5432\/chairman_ci\?/);
 const userId=uid(),other=uid(),worldId=uid(),companyId=uid(),internalId=uid();
 try{
  await sql('INSERT INTO users(id,name,email,pass_hash) VALUES($1,$2,$3,$4),($5,$6,$7,$4)',[userId,'Chairman',userId+'@ci.invalid','fixture',other,'Other',other+'@ci.invalid']);
  await sql("INSERT INTO worlds(id,user_id,name,region,timezone,sectors,chief) VALUES($1,$2,'CI Group','Fictional','UTC','[]','Chief')",[worldId,userId]);
  await sql("INSERT INTO companies(id,user_id,world_id,name,sector,valuation,cash,revenue) VALUES($1,$2,$3,'Logistics company','Logistics',10000,1000,0)",[companyId,userId,worldId]);
  await sql("INSERT INTO contacts(id,user_id,world_id,name,title,kind) VALUES($1,$2,$3,'Chief','Chief Operating Officer','internal')",[internalId,userId,worldId]);
  const [{attempt_token:attemptToken}]=await sql("UPDATE worlds SET last_network_intro_attempt_at=now() WHERE id=$1 RETURNING last_network_intro_attempt_at::text AS attempt_token",[worldId]);
  const decision={decision:'introduce',name:'Mara Eze',title:'Managing Director',organization:'Northstar Logistics Group',organizationStrategy:'Expand enterprise logistics partnerships.',kind:'partner',sector:'Logistics',temperament:'Direct, thoughtful and pragmatic.',agenda:'Build a long-term logistics partnership.',message:'Good afternoon Chairman. I lead Northstar Logistics Group and would like to discuss regional logistics.',reason:'The group has a logistics network gap and needs an independent partner.',trigger:'portfolio network gap'};
  const input={userId,worldId,company:{id:companyId},decision,context:{},operationKey:'intro:'+worldId,attemptToken};
  assert.equal(await transaction(q=>persistNetworkIntroduction(q,{...input,userId:other})),false);
  assert.equal(await transaction(q=>persistNetworkIntroduction(q,{...input,attemptToken:'superseded'})),false);
  const [a,b]=await Promise.all([transaction(q=>persistNetworkIntroduction(q,input)),transaction(q=>persistNetworkIntroduction(q,input))]);
  assert.equal(a.introduced,true);assert.equal(b.contactId,a.contactId);
  for(const table of ['network_introductions','external_organizations','messages','threads','events','stakeholder_engagements','character_memory_jobs']){
   const [{n}]=await sql('SELECT count(*)::int n FROM '+table+' WHERE user_id=$1 AND world_id=$2',[userId,worldId]);assert.equal(n,1,table);
  }
  assert.equal((await sql("SELECT count(*)::int n FROM contacts WHERE user_id=$1 AND world_id=$2 AND kind<>'internal'",[userId,worldId]))[0].n,1);
  assert.equal((await sql("SELECT count(*)::int n FROM character_relationships WHERE user_id=$1 AND world_id=$2",[userId,worldId]))[0].n,2);
  assert.equal(await transaction(q=>persistNetworkIntroduction(q,{...input,operationKey:'new-key',decision:{...decision,name:'Second executive'}})),false);
  await sql("UPDATE worlds SET last_network_intro_at=now()-interval '25 hours' WHERE id=$1",[worldId]);
  await sql("UPDATE companies SET disposed_at=now() WHERE id=$1",[companyId]);
  assert.equal(await transaction(q=>persistNetworkIntroduction(q,{...input,operationKey:'disposed-key',decision:{...decision,name:'Second executive'}})),false);
  assert.equal((await sql("SELECT count(*)::int n FROM network_introductions WHERE world_id=$1",[worldId]))[0].n,1);
 }finally{await sql('DELETE FROM users WHERE id=ANY($1::uuid[])',[[userId,other]]);await database().end();}
});
