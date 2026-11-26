import test from 'node:test';
import assert from 'node:assert/strict';
import {createVapiActionToken,verifyVapiActionToken} from '../lib/vapi-action-token.mjs';

test('signs and verifies a short-lived call action token',()=>{
  const previous=process.env.CRON_SECRET;
  process.env.CRON_SECRET='test-secret-that-is-long-enough-for-hmac-signing';
  try{
    const claims={userId:'user-1',callId:'call-1',sourceContactId:'contact-1'};
    const token=createVapiActionToken(claims);
    assert.deepEqual(verifyVapiActionToken(token).userId,claims.userId);
    assert.equal(verifyVapiActionToken(token).callId,claims.callId);
    assert.equal(verifyVapiActionToken(token).sourceContactId,claims.sourceContactId);
  }finally{
    if(previous===undefined)delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET=previous;
  }
});

test('rejects a modified action token',()=>{
  const previous=process.env.CRON_SECRET;
  process.env.CRON_SECRET='test-secret-that-is-long-enough-for-hmac-signing';
  try{
    const token=createVapiActionToken({userId:'user-1',callId:'call-1',sourceContactId:'contact-1'});
    assert.throws(()=>verifyVapiActionToken(token+'x'),/Invalid voice action token/);
  }finally{
    if(previous===undefined)delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET=previous;
  }
});
