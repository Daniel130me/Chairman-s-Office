import { timingSafeEqual } from 'node:crypto';

/** Only Nigerian mobile destinations in international E.164 format. */
export function isNigerianMobile(value) {
  return typeof value === 'string' && /^\+234[0-9]{10}$/.test(value);
}

export function safelyMatchesToken(received, expected) {
  if (typeof received !== 'string' || typeof expected !== 'string' || expected.length < 32) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function missingSettings(env) {
  return ['VAPI_API_KEY', 'VAPI_ASSISTANT_ID', 'VAPI_PHONE_NUMBER_ID', 'TEST_DESTINATION_NUMBER', 'ADMIN_API_TOKEN']
    .filter(key => !env[key] || (key === 'ADMIN_API_TOKEN' && env[key].length < 32));
}

export function maskPhone(value) {
  if (!isNigerianMobile(value)) return '(not configured)';
  return `+234******${value.slice(-4)}`;
}
