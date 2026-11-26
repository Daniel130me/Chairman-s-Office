import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCallIntent} from '../lib/executive-intents.mjs';

test('asks the CFO to call the Chairman immediately',()=>{
  assert.deepEqual(parseCallIntent('Please ask the CFO to call me.'),{
    recipient:'CFO',delaySeconds:0,kind:'delegated-call'
  });
});

test('schedules a callback from the current executive in 30 seconds',()=>{
  assert.deepEqual(parseCallIntent('Please call me back in 30 seconds.'),{
    recipient:null,delaySeconds:30,kind:'assistant-callback'
  });
});

test('keeps the requested colleague when a delegated call has a delay',()=>{
  assert.deepEqual(parseCallIntent('Have the CFO call me in 2 minutes.'),{
    recipient:'CFO',delaySeconds:120,kind:'delegated-call'
  });
});

test('allows an explicitly immediate callback',()=>{
  assert.deepEqual(parseCallIntent('Please call me back right now.'),{
    recipient:null,delaySeconds:0,kind:'assistant-callback'
  });
});

test('asks one clarification when a callback has no time',()=>{
  assert.equal(
    parseCallIntent('Please call me back.').clarification,
    'Of course. When would you like me to call you back?'
  );
});

test('asks for a precise time instead of treating later as now',()=>{
  assert.match(parseCallIntent('Please ask the CFO to call me later.').clarification,/When should I ask the CFO to call you/);
});

test('rejects callback delays longer than one day',()=>{
  assert.match(parseCallIntent('Call me back in 48 hours.').clarification,/24 hours/);
});

test('does not treat an ordinary business message as a call request',()=>{
  assert.equal(parseCallIntent('Please review the acquisition numbers.'),null);
});
