
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseAgencyDecision,authorityFor} from '../lib/character-agency-rules.mjs';
const actor={id:'actor',kind:'internal',title:'Group CFO'},reviewer={id:'reviewer',kind:'internal',title:'General Counsel'};
const scope={actorId:actor.id,contactIds:[actor.id,reviewer.id],contacts:[actor,reviewer],companyIds:['company'],employees:[{id:'employee',company_id:'company'}],contracts:[{id:'contract',company_id:'company'}],evidenceIds:['source']};
const base={choice:'act',actionType:'expense',title:'Office supplies',reason:'Recorded business requirement',uncertainty:'None known',evidenceIds:['source'],payload:{companyId:'company',amount:'50',description:'Office supplies'}};
const grant={mode:'delegated',per_action_limit:'100.00',daily_limit:'200.00'};
test('validated decisions cannot invent evidence, entities, financial amounts or change a request',()=>{
 const decision=parseAgencyDecision(base,scope);assert.equal(decision.payload.amount,'50.00');
 assert.equal(parseAgencyDecision({...base,evidenceIds:['fabricated']},scope),null);
 assert.equal(parseAgencyDecision({...base,payload:{...base.payload,companyId:'other'}},scope),null);
 assert.equal(parseAgencyDecision({...base,payload:{...base.payload,amount:'51'}},{...scope,requestedAction:base}),null);
 assert.ok(parseAgencyDecision(base,{...scope,requestedAction:base}));
 assert.equal(parseAgencyDecision({...base,actionType:'hire',payload:{companyId:'company',name:'New',title:'Manager',salary:'500'}},{...scope,requestedAction:base}),null);
});
test('refusal, disagreement, delay and deliberate inaction do not execute anything',()=>{
 for(const choice of ['refuse','disagree','defer','inaction']){
  const d=parseAgencyDecision({...base,choice,actionType:'none',payload:{}},scope);
  assert.equal(d.choice,choice);assert.equal(authorityFor({actor,decision:d}).mode,'none');assert.equal(parseAgencyDecision({...base,choice},scope),null);
 }
});
test('scoped authority distinguishes routine, delegated, coapproval, prohibited and reserved',()=>{
 const decision=parseAgencyDecision(base,scope);
 assert.equal(authorityFor({actor,decision}).mode,'chairman');
 assert.equal(authorityFor({actor,decision,grant}).mode,'delegated');
 assert.equal(authorityFor({actor,decision,grant,spent:'151.00'}).mode,'chairman');
 assert.equal(authorityFor({actor,decision,grant:{mode:'prohibited'}}).mode,'prohibited');
 assert.equal(authorityFor({actor:{...actor,kind:'external'},decision,grant}).mode,'prohibited');
 assert.equal(authorityFor({actor,decision,grant:{...grant,mode:'coapproval',reviewer_id:actor.id},reviewer:actor}).mode,'chairman');
 assert.equal(authorityFor({actor,decision,grant:{...grant,mode:'coapproval',reviewer_id:reviewer.id},reviewer}).mode,'coapproval');
 const hire=parseAgencyDecision({...base,actionType:'hire',payload:{companyId:'company',name:'New',title:'Manager',salary:'500'}},scope);assert.equal(authorityFor({actor,decision:hire,grant}).mode,'chairman');
 assert.equal(authorityFor({actor,decision,grant,conflict:true}).mode,'chairman');
});
test('routine investigation and negotiation require the correct action and known recipient',()=>{
 const task=parseAgencyDecision({...base,choice:'investigate',actionType:'assign-task',payload:{companyId:'company',assigneeId:'actor',taskType:'financial-review',detail:'Review evidence'}},scope);
 assert.equal(authorityFor({actor,decision:task}).mode,'delegated');
 assert.equal(parseAgencyDecision({...base,choice:'investigate',actionType:'assign-task',payload:{companyId:'company',assigneeId:'reviewer',taskType:'financial-review',detail:'Review evidence'}},scope),null);
 const negotiate=parseAgencyDecision({...base,choice:'negotiate',actionType:'communicate',payload:{recipientId:'reviewer',body:'Can we discuss alternative terms?'}},scope);assert.equal(authorityFor({actor,decision:negotiate}).mode,'delegated');
 assert.equal(parseAgencyDecision({...base,choice:'negotiate',actionType:'communicate',payload:{recipientId:'unknown',body:'Offer'}},scope),null);
});
