import test from 'node:test';
import assert from 'node:assert/strict';
import {agencyPriority,coordinationAllowed,validateAutonomyPolicy} from '../lib/living-agency-rules.mjs';
import {independentCallDialogue} from '../lib/colleague-calls.mjs';
import {buildActivityFeed} from '../frontend/src/activity-feed.js';
test('urgent instructions, business evidence, and bounded coordination',()=>{
 assert.ok(agencyPriority('chairman-message')>agencyPriority('business-event',{source_type:'open-investigation'}));
 assert.ok(agencyPriority('business-event',{source_type:'open-investigation'})>agencyPriority('colleague-message'));
 assert.ok(coordinationAllowed({depth:2,recipient:'b',actor:'a',choice:'consult'}));
 assert.equal(coordinationAllowed({depth:3,recipient:'b',actor:'a',choice:'consult'}),false);
 assert.equal(coordinationAllowed({depth:0,recipient:'a',actor:'a',choice:'consult'}),false);
 assert.deepEqual(validateAutonomyPolicy({dailyAttemptLimit:0,paused:false}),{dailyAttemptLimit:0,paused:false});
 assert.equal(validateAutonomyPolicy({dailyAttemptLimit:-1,paused:false}),null);
});
test('call speakers receive distinct private context and may decline',async()=>{
 const caller={id:'a',name:'Alice'},recipient={id:'b',name:'Bob'},context={reason:'Review',history:[],matter:{title:'Review'}};
 const loadContext=async(u,id)=>({psychology:{privateMarker:id+'-private'},memories:[],goals:[],relationships:[]});
 const outputs=[];
 const result=await independentCallDialogue({caller,recipient,context,userId:'test',externalContext:{},loadContext,provider:async(system,input)=>{
  const x=JSON.parse(input);outputs.push(x);
  assert.equal(x.ownPsychology.privateMarker,(x.speaker.name==='Alice'?'a':'b')+'-private');
  assert.ok(!input.includes(x.speaker.name==='Alice'?'b-private':'a-private'));
  if(x.speaker.name==='Bob')assert.equal(x.spokenTurns[0].body,'Review the issue.');
  return {choice:'speak',body:x.speaker.name==='Alice'?'Review the issue.':'I disagree with that proposal.',continue:false};
 }});
 assert.equal(result.outcome,'completed');assert.equal(outputs.length,2);assert.equal(result.turns[1].body,'I disagree with that proposal.');
 const declined=await independentCallDialogue({caller,recipient,context,userId:'test',externalContext:{},loadContext,provider:async(s,i)=>JSON.parse(i).speaker.name==='Bob'?{choice:'decline'}:{choice:'speak',body:'Request discussion'}});
 assert.deepEqual(declined,{outcome:'declined',turns:[]});
});
test('timeline retains deliberate inaction and consequences',()=>{
 const now=new Date().toISOString(),items=buildActivityFeed({contacts:[{id:'a',name:'Alice'}],characterDecisions:[{id:'decision',contact_id:'a',created_at:now,status:'decided',decision:{choice:'inaction',title:'Hold position',reason:'No actionable evidence'}}],characterConsequences:[{id:'effect',contact_id:'a',occurred_at:now,outcome:'report-delivered',stage:'delayed',reason:'Document exists'}]});
 assert.equal(items.length,2);assert.ok(items.some(x=>x.target==='approvals'&&x.body.includes('inaction')));assert.ok(items.some(x=>x.target==='employees'));
});
