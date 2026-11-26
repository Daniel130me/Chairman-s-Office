import test from 'node:test';
import assert from 'node:assert/strict';
import {parseExecutiveDecision} from '../lib/autonomous-executives.mjs';
test('executives can review or defer but not invent authority',()=>{assert.deepEqual(parseExecutiveDecision({action:'review',reason:'Invoice is overdue'},{approvalAllowed:false}),{action:'review',reason:'Invoice is overdue'});assert.equal(parseExecutiveDecision({action:'approval',reason:'Sign contract'},{approvalAllowed:false}),null);assert.equal(parseExecutiveDecision({action:'pay',reason:'pay invoice'},{}),null);assert.equal(parseExecutiveDecision({action:'review',reason:''},{}),null);});
