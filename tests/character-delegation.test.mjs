import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDelegatedCallRequest} from '../lib/character-delegation.mjs';
test('extracts a named colleague call and the requested callback',()=>{
 const intent=parseDelegatedCallRequest('Please call Amara and explain the Berlin offers to her. She should call me and tell me properly.');
 assert.equal(intent.recipient,'Amara');
 assert.equal(intent.reportToChairman,true);
 assert.match(intent.reason,/Berlin offers/);
});
test('supports full three-part names and unique role references',()=>{
 assert.equal(parseDelegatedCallRequest('Call Dr. Elena Kovacs and ask about the safety review.').recipient,'Dr. Elena Kovacs');
 assert.equal(parseDelegatedCallRequest('Please call the CFO about the cash position.').recipient,'CFO');
});
test('does not misclassify a request for the character to call the Chairman',()=>{
 assert.equal(parseDelegatedCallRequest('Please call me back.'),null);
 assert.equal(parseDelegatedCallRequest('Call the Chairman when you are ready.'),null);
});
