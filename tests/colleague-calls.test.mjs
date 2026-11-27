import test from 'node:test';
import assert from 'node:assert/strict';
import {callAvailability,parseCallDialogue} from '../lib/colleague-calls.mjs';
test('unavailable recipients do not have a completed call',()=>{assert.equal(callAvailability('busy'),'missed');assert.equal(callAvailability('declined'),'declined');assert.equal(callAvailability('available'),'available');});
test('only alternating validated dialogue is accepted',()=>{assert.equal(parseCallDialogue({outcome:'completed',turns:[{speaker:'caller',body:'Hello'}]}),null);assert.equal(parseCallDialogue({outcome:'completed',turns:[{speaker:'caller',body:'Hello'},{speaker:'caller',body:'Again'}]}),null);assert.deepEqual(parseCallDialogue({outcome:'declined'}),{outcome:'declined',turns:[]});assert.equal(parseCallDialogue({outcome:'completed',turns:[{speaker:'caller',body:'Hello'},{speaker:'recipient',body:'Good morning'}]}).turns.length,2);});
