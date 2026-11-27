import test from 'node:test';
import assert from 'node:assert/strict';
import {failedCallSummary} from '../lib/call-summary-rules.mjs';
test('a failed call with no transcript receives a truthful deterministic summary',()=>{
 const summary=failedCallSummary('microphone-preflight — NotAllowedError');
 assert.match(summary,/failed before the conversation began/i);
 assert.match(summary,/microphone-preflight/);
 assert.match(summary,/No transcript was captured/);
 assert.match(summary,/no decisions, commitments or follow-ups/i);
});
test('empty failure details do not invent a cause',()=>{
 const summary=failedCallSummary('');
 assert.match(summary,/No transcript was captured/);
 assert.doesNotMatch(summary,/microphone|network|assistant ID/i);
});
