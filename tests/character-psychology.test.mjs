import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveConstitution,initialPsychologicalState,validateConstitution,appraiseInfluences,publicBehavioralCues} from '../lib/character-psychology-rules.mjs';
const contact={id:'fictional-a',title:'Group CFO',company:'Example',kind:'internal',temperament:'careful and calm',agenda:'Protect liquidity',ambition:67};
test('stable individual constitution retains existing temperament, agenda and ambition',()=>{
 const a=deriveConstitution(contact),b=deriveConstitution({...contact,id:'fictional-b'});
 assert.deepEqual(a,deriveConstitution(contact));assert.notDeepEqual(a.traits,b.traits);assert.equal(a.traits.ambition,67);assert.ok(a.traits.caution>=72);assert.ok(a.motivations.includes(contact.agenda));assert.ok(validateConstitution(a));
});
test('religion and moral worth are not inferred from demographic information',()=>{
 const a=deriveConstitution(contact);
 assert.deepEqual(a,deriveConstitution({...contact,name:'Different name',nationality:'Different',religion:'Christian'}));
 assert.equal(typeof a.worldview.type,'string');assert.ok(Array.isArray(a.worldview.convictions));
 const samples=Array.from({length:40},(_,i)=>deriveConstitution({...contact,id:'sample-'+i}));assert.ok(new Set(samples.map(p=>p.worldview.type)).size>2);assert.match(a.professionalIdentity.responsibility,/liquidity/);
});
test('context changes temporary appraisal without rewriting constitution or baseline',()=>{
 const constitution=deriveConstitution(contact),baseline=initialPsychologicalState(constitution);
 const a=appraiseInfluences({constitution,baseline});
 const b=appraiseInfluences({constitution,baseline,tasks:[{id:'task1',status:'pending'}],relationships:[{contact_id:'x',trust:80,respect:70,familiarity:80,tension:75}],memories:[{epistemic_status:'rumor',confidence:0.2,access_scope:'private'}]});
 assert.ok(b.currentAppraisal.stress>a.currentAppraisal.stress);assert.ok(b.currentAppraisal.frustration>a.currentAppraisal.frustration);assert.deepEqual(b.baselineState,baseline);assert.deepEqual(b.constitution,constitution);assert.equal(b.memoryContext[0].epistemicStatus,'rumor');assert.deepEqual(b.pressures[0].sourceIds,['task1']);assert.equal(b.socialInfluences[0].contactId,'x');
});
test('private constitution details are excluded from shared cues',()=>{
 const constitution=deriveConstitution(contact);const p=publicBehavioralCues({constitution});
 assert.equal(p.temperament,constitution.temperament);for(const key of ['values','worldview','motivations','vulnerabilities','baselineState'])assert.equal(Object.hasOwn(p,key),false);
});
test('rejects invalid baseline or malformed profile',()=>{
 const constitution=deriveConstitution(contact);
 assert.throws(()=>appraiseInfluences({constitution,baseline:{stress:101}}));assert.equal(validateConstitution({version:1}),false);
});
