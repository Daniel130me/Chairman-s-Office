import test from 'node:test';
import assert from 'node:assert/strict';
import {describeSchedule,normalizeChairmanMessage,deterministicMessageKey} from '../lib/vapi-tool-results.mjs';
const contact={name:'Amara Okafor',title:'Chief of Staff'};
test('an assistant callback is described as a call from me',()=>{
 const text=describeSchedule({contact,delaySeconds:0},{selfCallback:true});
 assert.match(text,/incoming call from me has been placed/i);
 assert.doesNotMatch(text,/Amara Okafor/);
 assert.match(text,/Please end the current call/i);
});
test('a delegated call names the executive who will call',()=>{
 const text=describeSchedule({contact:{name:'David Okoro',title:'Group CFO'},delaySeconds:0});
 assert.match(text,/incoming call from David Okoro \(Group CFO\)/i);
});
test('delayed callbacks distinguish self from delegated executives',()=>{
 assert.match(describeSchedule({contact,delaySeconds:30},{selfCallback:true}),/my callback for 30 seconds/i);
 assert.match(describeSchedule({contact,delaySeconds:30}),/callback from Amara Okafor/i);
});
test('Chairman messages are trimmed, bounded and reject unfinished placeholders',()=>{
 assert.equal(normalizeChairmanMessage('  Debrief\n\nPlease review.  '),'Debrief\n\nPlease review.');
 assert.throws(()=>normalizeChairmanMessage('  '),/empty/i);
 assert.throws(()=>normalizeChairmanMessage('Hello [Chairman’s Name]'),/placeholder/i);
 assert.throws(()=>normalizeChairmanMessage('x'.repeat(3501)),/too long/i);
});
test('message action keys are stable UUIDs and differ across tool calls',()=>{
 const a=deterministicMessageKey('call-1','tool-1');
 assert.match(a,/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
 assert.equal(a,deterministicMessageKey('call-1','tool-1'));
 assert.notEqual(a,deterministicMessageKey('call-1','tool-2'));
});
