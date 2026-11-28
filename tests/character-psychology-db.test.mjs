import test from 'node:test';
import assert from 'node:assert/strict';
import {sql,uid,database} from '../backend/src/db.mjs';
import {ensureCharacterPsychology,initializeCharacterPsychology,characterPsychologyContext} from '../lib/character-psychology.mjs';
test('psychology persists once, is tenant scoped, and supports existing and new contacts',{skip:process.env.RUN_CHARACTER_PSYCHOLOGY_DB_TESTS!=='1',timeout:60000},async()=>{
 assert.match(process.env.DATABASE_URL||'',/@127\.0\.0\.1:5432\/chairman_ci\?/);
 const userId=uid(),other=uid(),worldId=uid(),otherWorld=uid(),a=uid(),b=uid(),foreign=uid();
 try{
  await sql('INSERT INTO users(id,name,email,pass_hash) VALUES($1,$2,$3,$4),($5,$6,$7,$4)',[userId,'Chairman',userId+'@ci.invalid','fixture',other,'Other',other+'@ci.invalid']);
  await sql("INSERT INTO worlds(id,user_id,name,region,timezone,sectors,chief) VALUES($1,$2,'CI Group','Fictional','UTC','[]','Chief'),($3,$4,'Other Group','Fictional','UTC','[]','Other Chief')",[worldId,userId,otherWorld,other]);
  await sql("INSERT INTO contacts(id,user_id,world_id,name,title,kind,temperament,agenda) VALUES($1,$2,$3,'First CFO','Group CFO','internal','Careful','Protect liquidity'),($4,$2,$3,'Second CFO','Group CFO','internal','Direct','Protect liquidity'),($5,$6,$7,'Foreign CFO','Group CFO','internal','Calm','Protect liquidity')",[a,userId,worldId,b,foreign,other,otherWorld]);
  assert.equal(await ensureCharacterPsychology(other,a),null);
  assert.equal(await characterPsychologyContext(userId,foreign),null);
  const [first,retry]=await Promise.all([ensureCharacterPsychology(userId,a),ensureCharacterPsychology(userId,a)]);
  assert.deepEqual(first,retry);
  assert.equal((await sql('SELECT count(*)::int n FROM character_psychology WHERE user_id=$1',[userId]))[0].n,1);
  assert.equal(await initializeCharacterPsychology(userId),1);
  assert.equal(await initializeCharacterPsychology(userId),0);
  const second=await ensureCharacterPsychology(userId,b);
  assert.notEqual(first.constitution.temperament,second.constitution.temperament);
  await sql("UPDATE contacts SET temperament='Different later description' WHERE id=$1 AND user_id=$2",[a,userId]);
  assert.deepEqual(await ensureCharacterPsychology(userId,a),first);
  const context=await characterPsychologyContext(userId,a,{tasks:[{id:'test',status:'pending'}]});
  assert.ok(context.currentAppraisal.stress>first.baseline_state.stress);
  assert.deepEqual((await ensureCharacterPsychology(userId,a)).baseline_state,first.baseline_state);
  assert.equal((await sql('SELECT count(*)::int n FROM character_psychology WHERE user_id=$1',[other]))[0].n,0);
 }finally{await sql('DELETE FROM users WHERE id=ANY($1::uuid[])',[[userId,other]]);await database().end();}
});
