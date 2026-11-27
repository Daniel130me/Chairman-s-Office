import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ask,parseOutput,aiStatus} from '../backend/src/ai.mjs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('provider selection continues when syntactically valid JSON is semantically invalid',async()=>{
 const saved={fetch:globalThis.fetch,order:process.env.AI_ORDER,groq:process.env.GROQ_API_KEY,mistral:process.env.MISTRAL_API_KEY};
 const restore=(key,value)=>value===undefined?delete process.env[key]:process.env[key]=value;
 const calls=[];
 try{
  process.env.AI_ORDER='groq,mistral';
  process.env.GROQ_API_KEY='unit-test-groq';
  process.env.MISTRAL_API_KEY='unit-test-mistral';
  globalThis.fetch=async(url,options)=>{
   calls.push({url,payload:JSON.parse(options.body)});
   return {ok:true,status:200,json:async()=>({choices:[{message:{content:JSON.stringify({action:url.includes('groq')?'unauthorized':'review'})}}]})};
  };
  const result=await ask('Return JSON.','Test',{json:true,fallback:null,validate:x=>x.action==='review'?x:null});
  assert.deepEqual(result,{action:'review'});
  assert.equal(calls.length,2);
  assert.equal(calls[0].payload.response_format.type,'json_object');
  assert.equal(aiStatus().filter(p=>p.configured).length,2);
  assert.equal(parseOutput('not JSON',true),null);
 }finally{
  globalThis.fetch=saved.fetch;
  restore('AI_ORDER',saved.order);restore('GROQ_API_KEY',saved.groq);restore('MISTRAL_API_KEY',saved.mistral);
 }
});
test('executive backoff and security processing remain durable and tenant scoped',()=>{
 const executive=read('lib/autonomous-executives.mjs');
 const security=read('lib/security.mjs');
 const schema=read('lib/economy-schema.mjs');
 const engine=read('lib/world-engine.mjs');
 assert.match(executive,/interval '40 minutes'/);
 assert.match(executive,/decision->>'errorCode'='AI_EXECUTIVE_UNAVAILABLE'/);
 assert.match(executive,/validate:raw=>parseExecutiveDecision/);
 assert.match(executive,/overdue-loan-installment/);
 assert.match(schema,/security_incident_investigation_unique/);
 assert.match(security,/ON CONFLICT\(user_id,source_investigation_id\)/);
 assert.match(security,/No misconduct has been established/);
 assert.match(engine,/processSecurityIncidents\(w.user_id\)/);
 assert.match(security,/Chief Security Officer/);
});
