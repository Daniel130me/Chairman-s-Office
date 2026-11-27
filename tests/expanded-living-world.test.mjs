import test from 'node:test';
import assert from 'node:assert/strict';
import {parseStakeholderDecision} from '../lib/stakeholder-world.mjs';
import {parseSupplierQuote} from '../lib/supplier-world.mjs';
import {parseBoardVote,boardRecommendation} from '../lib/board-governance.mjs';
import {relationshipAfter} from '../lib/relationship-world.mjs';
import {accounts,deriveFinancialStatement} from '../lib/economy-rules.mjs';
test('stakeholders may contact or defer, not execute arbitrary actions',()=>{
 assert.equal(parseStakeholderDecision({decision:'defer',reason:'No meaningful development'}).decision,'defer');
 assert.equal(parseStakeholderDecision({decision:'contact',reason:'Opportunity',title:'Meeting',message:'May we discuss a partnership?',channel:'message'}).channel,'message');
 assert.equal(parseStakeholderDecision({decision:'execute',reason:'Invalid'}),null);
});
test('supplier counteroffer is bounded and acceptance does not alter price',()=>{
 assert.equal(parseSupplierQuote({decision:'accept',reason:'Acceptable'}).markupBasisPoints,0);
 assert.equal(parseSupplierQuote({decision:'counter',reason:'Costs',markupBasisPoints:1000}).markupBasisPoints,1000);
 assert.equal(parseSupplierQuote({decision:'counter',reason:'Costs',markupBasisPoints:1001}),null);
});
test('advisory board requires quorum and records independent rationale',()=>{
 assert.equal(parseBoardVote({vote:'for',rationale:''}),null);
 assert.equal(boardRecommendation(4,['for','for','against']).status,'recommended');
 assert.equal(boardRecommendation(4,['for','for']).status,'no-quorum');
 assert.equal(boardRecommendation(4,['for','against','abstain']).status,'not-recommended');
 assert.equal(boardRecommendation(4,['for','abstain','abstain']).present,3);
});
test('relationship indicators follow recorded outcomes and are bounded',()=>{
 assert.deepEqual(relationshipAfter({trust:99,respect:100,tension:0},'supplier-delivery'),{trust:100,respect:100,tension:0,loyalty:56,reputation:56});
 assert.deepEqual(relationshipAfter({trust:50,respect:50,tension:10},'client-payment'),{trust:52,respect:51,tension:9,loyalty:56,reputation:56});
 assert.deepEqual(relationshipAfter({trust:1,respect:50,tension:99},'client-dispute'),{trust:0,respect:50,tension:100,loyalty:54,reputation:53});
});
test('expense refund restores cash and reverses original expense, not revenue',()=>{
 assert.deepEqual(accounts('expense-refund'),['cash','expense']);
 const f=deriveFinancialStatement({cash:'920.00',contributed_equity:'1000.00',expenses:'80.00'});
 assert.equal(f.balanceCheck,'0.00');assert.equal(f.netIncome,'-80.00');
});
