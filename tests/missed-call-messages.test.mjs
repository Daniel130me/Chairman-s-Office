import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFollowup,outgoingFollowupStatuses} from '../lib/missed-call-messages.mjs';
test('no provider result remains retryable',()=>{assert.equal(parseFollowup(null),null);assert.equal(parseFollowup({leaveMessage:true,body:' '}),null);assert.equal(parseFollowup({leaveMessage:'true',body:'hello'}),null);});
test('caller can elect not to leave a message',()=>assert.deepEqual(parseFollowup({leaveMessage:false}),{leaveMessage:false}));
test('valid message is preserved and bounded',()=>{assert.deepEqual(parseFollowup({leaveMessage:true,body:' Please call me back. '}),{leaveMessage:true,body:'Please call me back.'});assert.equal(parseFollowup({leaveMessage:true,body:'a'.repeat(2001)}),null);});

test('both missed and declined outgoing calls may receive a follow-up message',()=>{assert.deepEqual(outgoingFollowupStatuses,['missed','declined']);});
