import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFollowup,fallbackFollowup,outgoingFollowupStatuses} from '../lib/missed-call-messages.mjs';
test('no provider result remains retryable',()=>{assert.equal(parseFollowup(null),null);assert.equal(parseFollowup({leaveMessage:true,body:' '}),null);assert.equal(parseFollowup({leaveMessage:'true',body:'hello'}),null);});
test('caller can elect not to leave a message',()=>assert.deepEqual(parseFollowup({leaveMessage:false}),{leaveMessage:false}));
test('valid message is preserved and bounded',()=>{
 assert.deepEqual(parseFollowup({leaveMessage:true,body:' Please call me back. '}),{leaveMessage:true,body:'Please call me back.',mode:'text'});
 assert.equal(parseFollowup({leaveMessage:true,body:'a'.repeat(2001)}),null);
});
test('rejects a voicemail that greets the caller instead of the recipient',()=>{
 assert.equal(parseFollowup({leaveMessage:true,mode:'voicemail',body:'Hi Daniella, sorry I missed your call.'},{callerName:'Daniella'}),null);
});
test('rejects fabricated phone numbers and a different caller identity',()=>{
 assert.equal(parseFollowup({leaveMessage:true,mode:'voicemail',body:'Hi Chairman, call me back at 555-1234.'},{callerName:'Victor'}),null);
 assert.equal(parseFollowup({leaveMessage:true,mode:'voicemail',body:'Hi Chairman, this is Alex. I missed your call.'},{callerName:'Victor'}),null);
});
test('keeps a correctly addressed first-person voicemail',()=>{
 assert.deepEqual(parseFollowup({leaveMessage:true,mode:'voicemail',body:'Chairman Oluwagbenga, I was calling to review the priorities.'},{callerName:'Daniella'}),{leaveMessage:true,body:'Chairman Oluwagbenga, I was calling to review the priorities.',mode:'voicemail'});
});
test('fallback voicemail preserves caller and recipient roles',()=>{
 assert.equal(fallbackFollowup({recipientName:'Oluwagbenga',recipientTitle:'Chairman',reason:'Daniella would like to review your priorities and outstanding decisions.'}).body,'Chairman Oluwagbenga, I was calling to review your priorities and outstanding decisions. Please let me know when you are available.');
 assert.equal(fallbackFollowup({recipientName:'Oluwagbenga',recipientTitle:'Chairman',reason:'Daniel Mercer needs your direction on Strategic acquisition opportunity.'}).body,'Chairman Oluwagbenga, I was calling to get your direction on Strategic acquisition opportunity. Please let me know when you are available.');
 assert.match(fallbackFollowup({recipientName:'Oluwagbenga',recipientTitle:'Chairman',callDirection:'outgoing'}).body,/I saw your call but could not answer/);
});

test('both missed and declined outgoing calls may receive a follow-up message',()=>{assert.deepEqual(outgoingFollowupStatuses,['missed','declined']);});
