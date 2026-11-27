import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTranscript,mergeTranscript,parseConcierge,meetingConflict,speechChunks} from '../lib/executive-experience-rules.mjs';
import {notificationForEvent} from '../lib/event-notifications.mjs';
test('call recovery is append-only and a stale hangup cannot erase a checkpoint',()=>{
 const a=[{role:'assistant',text:'Welcome'}],b=[...a,{role:'user',text:'Proceed'}];
 assert.deepEqual(mergeTranscript(a,b),b);
 assert.deepEqual(mergeTranscript(b,[]),b);
 assert.deepEqual(mergeTranscript(b,a),b);
 assert.deepEqual(mergeTranscript(b,[{role:'user',text:'Other conversation'}]),b);
 assert.deepEqual(normalizeTranscript([null,{text:''},{text:'valid'}]),[{role:'speaker',text:'valid'}]);
});
test('concierge recommendations are bounded and reference known bookings',()=>{
 assert.equal(parseConcierge({summary:'Review',actions:[{type:'purchase',detail:'Pay now'}]},[]),null);
 assert.equal(parseConcierge({summary:'Review',actions:[{type:'review',detail:'Review booking',bookingId:'unknown'}]},[]),null);
 assert.equal(parseConcierge({summary:'Review',actions:[{type:'review',detail:'Review booking',bookingId:'a'}]},['a']).actions.length,1);
});
test('travel conflicts include calendar buffer and ignore unrelated dates',()=>{
 const t={depart_at:'2026-11-30T12:00:00Z'};
 assert.equal(meetingConflict(t,{start_at:'2026-11-30T09:30:00Z',duration_minutes:45}),true);
 assert.equal(meetingConflict(t,{start_at:'2026-12-01T12:00:00Z',duration_minutes:45}),false);
});
test('speech segments respect provider length and preserve words',()=>{
 const text='A detailed executive statement '.repeat(40).trim(),parts=speechChunks(text);
 assert.ok(parts.every(s=>s.length<=180));
 assert.equal(parts.join(' '),text);
});
test('new executive events have private actionable notification destinations',()=>{
 assert.equal(notificationForEvent('travel-disruption').target,'travel');
 assert.equal(notificationForEvent('call-recovered').target,'phone');
});

import {parseReplacementQuote} from '../lib/travel-rebooking.mjs';
test('fictional concierge quotes use recorded provider and bounded recorded price',()=>{
 const b={provider:'Recorded carrier',amount:'100.00'},r={decision:'offer',description:'Replacement flight',reason:'Provider offers an alternative',markupBasisPoints:1500,feeBasisPoints:500};
 assert.deepEqual(parseReplacementQuote(r,b),{decision:'offer',provider:b.provider,description:r.description,amount:'115.00',fee:'5.00',reason:r.reason});
 assert.equal(parseReplacementQuote({...r,markupBasisPoints:5001},b),null);
 assert.equal(parseReplacementQuote({...r,feeBasisPoints:-1},b),null);
});
