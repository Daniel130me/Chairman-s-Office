import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreObservations,classifyTask,reviewImpacts,developmentProjection,relationshipProjection,employmentRecommendation} from '../lib/character-development-rules.mjs';
const now=Date.now(),at=new Date(now-1000).toISOString();
const row=(id,impacts={},extras={})=>({id,source_key:id,source_type:'chairman-assessment',outcome:'review',occurred_at:at,confidence:1,attribution:'direct',impacts,reason:'Recorded evidence',...extras});
test('luck, external shocks, dissent and allegations do not change judgment or loyalty',()=>{
 const s=scoreObservations([row('a',{judgment:-5},{attribution:'external'}),row('b',{}, {outcome:'refuse'}),row('c',{}, {outcome:'allegation'}),row('d',{}, {outcome:'expense-posted'})],'Group CFO',{now});
 assert.equal(s.dimensions.judgment.score,null);assert.equal(s.dimensions.loyalty.score,null);assert.equal(s.score,null);
 assert.deepEqual(reviewImpacts('conduct','unsubstantiated','direct'),{});assert.deepEqual(reviewImpacts('judgment','unsound','external'),{});
 assert.deepEqual(classifyTask({status:'cancelled'}).impacts,{});assert.deepEqual(classifyTask({status:'completed',outcome_document_id:'x',document_verified:true}).impacts,{reliability:2});
});
test('role weights, uncertainty, sufficient evidence and repeated substantiated concerns',()=>{
 const records=[row('1',{integrity:-5,accountability:-3}),row('2',{integrity:-5,accountability:-3}),row('3',{competence:4,initiative:2})];
 const finance=scoreObservations(records,'Group CFO',{now}),operations=scoreObservations(records,'Chief Operating Officer',{now});
 assert.ok(finance.rankEligible);assert.notEqual(finance.score,operations.score);assert.equal(employmentRecommendation(finance).action,'investigate-or-disciplinary-review');
 assert.equal(scoreObservations(records.slice(0,1),'Group CFO',{now}).score,null);
 const shared=scoreObservations([row('x',{judgment:4},{attribution:'shared'})],'Group CFO',{now});assert.equal(shared.dimensions.judgment.score,52);
});
test('learning is bounded, gradual and reversible through append-only corrections',()=>{
 const a=Array.from({length:3},(_,i)=>row(String(i),{reliability:2},{outcome:'report-delivered'}));assert.deepEqual(developmentProjection(a.slice(0,2)).stateOffsets,{});assert.equal(developmentProjection(a).stateOffsets.confidence,2);
 const correction=row('undo',{}, {supersedes_id:'0',outcome:'withdrawn'});assert.deepEqual(developmentProjection([...a,correction]).stateOffsets,{});
 const b=Array.from({length:100},(_,i)=>row('b'+i,{judgment:-4,integrity:-5}));const change=developmentProjection(b);assert.equal(change.traitOffsets.caution,8);assert.equal(change.traitOffsets.susceptibilityToPressure,8);
});
test('trust is directional and independent from loyalty',()=>{
 const a=row('a',{}, {observer_id:'manager',relationship_delta:{trust:2,respect:1}});
 assert.equal(relationshipProjection([a],'manager').trust,2);assert.deepEqual(relationshipProjection([a],'other'),{});assert.equal(relationshipProjection([a],'manager').loyalty,0);
});
