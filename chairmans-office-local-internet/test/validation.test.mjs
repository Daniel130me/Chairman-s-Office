import test from 'node:test';
import assert from 'node:assert/strict';
import { isNigerianMobile, safelyMatchesToken, missingSettings, maskPhone } from '../src/validation.mjs';
import { createTestCall } from '../src/vapi.mjs';

test('Nigerian number in E.164 required', () => {
  assert.equal(isNigerianMobile('+2348012345678'), true);
  assert.equal(isNigerianMobile('08012345678'), false);
  assert.equal(isNigerianMobile('+447700900111'), false);
  assert.equal(isNigerianMobile('+234801234567'), false);
  assert.equal(maskPhone('+2348012345678'), '+234******5678');
});

test('admin token comparison checks length and value', () => {
  const secret = 'superlongsecretthatisatleast32characters!';
  assert.equal(safelyMatchesToken(secret, secret), true);
  assert.equal(safelyMatchesToken('wrong', secret), false);
  assert.equal(safelyMatchesToken('', secret), false);
  assert.equal(safelyMatchesToken(secret, 'short'), false);
});

test('missing settings are explicit', () => {
  assert.ok(missingSettings({}).includes('VAPI_API_KEY'));
});

test('outbound request uses allowlisted destination and documented Vapi payload', async () => {
  const env = {
    VAPI_API_KEY: 'secret',
    VAPI_ASSISTANT_ID: 'assistant-123',
    VAPI_PHONE_NUMBER_ID: 'phone-456',
    TEST_DESTINATION_NUMBER: '+2348012345678',
  };
  let payload;
  const mockFetch = async (url, opts) => {
    assert.equal(url, 'https://api.vapi.ai/call');
    assert.equal(opts.headers.Authorization, 'Bearer secret');
    payload = JSON.parse(opts.body);
    return { ok: true, status: 201, text: async () => JSON.stringify({id:'call-abc'}) };
  };
  const result = await createTestCall(env, mockFetch);
  assert.equal(result.id, 'call-abc');
  assert.equal(payload.customer.number, '+2348012345678');
  assert.equal(payload.assistantId, 'assistant-123');
  assert.equal(payload.phoneNumberId, 'phone-456');
});
