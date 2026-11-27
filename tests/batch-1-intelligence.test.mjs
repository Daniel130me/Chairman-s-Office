import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMemoryExtraction,parseAgendaDecision,parseRelationshipReview} from '../lib/character-intelligence.mjs';
import {parseSecurityScenario,parseSecurityReview,parseInterviewStatement} from '../lib/security-world.mjs';

const allowed={goalIds:['goal-1'],goalProgress:{'goal-1':75},taskIds:['task-1'],threadIds:['thread-1'],threadGoals:{'thread-1':'goal-1'},contactIds:['contact-1'],companyIds:['company-1']};

test('character memory preserves epistemic status and sensitivity',()=>{
 const result=parseMemoryExtraction({memories:[{memoryType:'belief',epistemicStatus:'rumor',sensitivity:'confidential',content:'A colleague said the supplier may be changing its terms.',confidence:0.4,importance:3}]});
 assert.equal(result.memories[0].epistemicStatus,'rumor');
 assert.equal(result.memories[0].sensitivity,'confidential');
 assert.equal(parseMemoryExtraction({memories:[{memoryType:'fact',epistemicStatus:'confirmed',sensitivity:'internal',content:'Invalid type',confidence:1,importance:5}]}),null);
 assert.deepEqual(parseMemoryExtraction({memories:[]}),{memories:[]});
 assert.equal(parseMemoryExtraction({memories:[{memoryType:'observation',epistemicStatus:'confirmed',sensitivity:'restricted',content:'API key: sk-123456789012345678901234567890',confidence:1,importance:5}]}),null);
});

test('independent goals require valid targets and recorded evidence for progress',()=>{
 const created=parseAgendaDecision({decision:'create',goalType:'business',title:'Strengthen supplier reliability',description:'Review the delivery history and improve agreed lead times.',priority:'normal',targetContactId:'contact-1',targetCompanyId:'company-1',rationale:'Two recorded deliveries were late.'},allowed);
 assert.equal(created.targetContactId,'contact-1');
 assert.equal(parseAgendaDecision({decision:'create',goalType:'business',title:'Goal',description:'Description',priority:'normal',targetContactId:'other',rationale:'Evidence'},allowed).targetContactId,null);
 assert.equal(parseAgendaDecision({decision:'update',goalId:'goal-1',evidenceTaskId:'task-1',progressDelta:15,evidence:'Completed supplier review',rationale:'Recorded task supports progress.'},allowed).decision,'update');
 assert.equal(parseAgendaDecision({decision:'complete',goalId:'goal-1',evidenceTaskId:'task-1',progressDelta:10,evidence:'Completed final task',rationale:'All milestones are evidenced.'},allowed),null);
 assert.equal(parseAgendaDecision({decision:'update',goalId:'goal-1',evidenceTaskId:'unknown',progressDelta:15,evidence:'Claimed completion',rationale:'No source.'},allowed),null);
 assert.equal(parseAgendaDecision({decision:'update',goalId:'goal-1',evidenceThreadId:'thread-1',progressDelta:10,evidence:'Resolved supplier discussion',rationale:'Conversation was completed.'},allowed).evidenceThreadId,'thread-1');
 assert.equal(parseAgendaDecision({decision:'update',goalId:'goal-1',evidenceThreadId:'thread-1',progressDelta:10,evidence:'Wrong goal',rationale:'Conversation was completed.'},{...allowed,threadGoals:{'thread-1':'another-goal'}}),null);
});

test('relationship changes are directional, bounded and never infer familiarity from negative deltas',()=>{
 const valid=parseRelationshipReview({decision:'apply',reason:'A clear commitment was kept.',changes:[
  {direction:'first-to-second',trustDelta:2,respectDelta:1,loyaltyDelta:1,tensionDelta:-1,familiarityDelta:1},
  {direction:'second-to-first',trustDelta:0,respectDelta:1,loyaltyDelta:0,tensionDelta:0,familiarityDelta:1}
 ]});
 assert.equal(valid.changes.length,2);
 assert.equal(parseRelationshipReview({decision:'apply',reason:'Bad familiarity',changes:[
  {direction:'first-to-second',trustDelta:0,respectDelta:0,loyaltyDelta:0,tensionDelta:0,familiarityDelta:-1},
  {direction:'second-to-first',trustDelta:0,respectDelta:0,loyaltyDelta:0,tensionDelta:0,familiarityDelta:0}
 ]}),null);
 assert.equal(parseRelationshipReview({decision:'no-change',reason:'No meaningful shift.'}).decision,'no-change');
});

test('security scenarios are clearly unverified and cannot name an accused person',()=>{
 assert.equal(parseSecurityScenario({decision:'defer',reason:'No meaningful scenario.'}).decision,'defer');
 const lead=parseSecurityScenario({decision:'report',title:'Unusual procurement request',description:'A fictional source claims a supplier requested a change to payment instructions.',category:'fraud',severity:'medium',trigger:'An active supplier relationship exists.',confidence:0.45,reason:'A proportionate review can verify the claim.'});
 assert.equal(lead.severity,'medium');
 assert.equal(parseSecurityScenario({decision:'report',title:'Incident',description:'Description',category:'fraud',severity:'high',trigger:'Context',confidence:0.6,reason:'Review',accusedContactId:'contact-1'}),null);
 assert.equal(parseSecurityScenario({decision:'report',title:'Incident',description:'Description',category:'fraud',severity:'critical',trigger:'Context',confidence:0.6,reason:'Review'}),null);
});

test('security review recommendations are evidence-led and interviews need a source contact',()=>{
 const result=parseSecurityReview({assessment:'preliminary',confidence:0.45,summary:'The report is plausible but not corroborated.',reason:'Only one unverified report exists.',steps:[
  {type:'document_review',title:'Review the purchase order',instructions:'Compare the approved order with the supplier communication.'},
  {type:'interview',title:'Clarify the original report',instructions:'Ask the reporter what they personally observed.',targetContactId:'contact-1'}
 ]},['contact-1']);
 assert.equal(result.steps.length,2);
 assert.equal(parseSecurityReview({assessment:'corroborated',confidence:0.9,summary:'Claim supported.',reason:'Review',steps:[{type:'interview',title:'Interview',instructions:'Ask a neutral question.',targetContactId:'unknown'}]},['contact-1']),null);
});

test('interview statements distinguish memory from lack of knowledge',()=>{
 assert.equal(parseInterviewStatement({statement:'I remember receiving the request.',knowledgeBasis:'memory',confidence:0.8}).knowledgeBasis,'memory');
 assert.equal(parseInterviewStatement({statement:'I do not have first-hand information.',knowledgeBasis:'not-aware',confidence:0.2}).knowledgeBasis,'not-aware');
 assert.equal(parseInterviewStatement({statement:'I know everything.',knowledgeBasis:'not-aware',confidence:0.9}),null);
});


test('malformed provider memory entries are rejected instead of throwing',()=>{
 for(const invalid of [null,[],true,17,'invalid']){
  assert.equal(parseMemoryExtraction({memories:[invalid]}),null);
 }
});
