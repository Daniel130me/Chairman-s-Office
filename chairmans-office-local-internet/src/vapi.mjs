const BASE = 'https://api.vapi.ai';

export async function vapiRequest({ apiKey, path, method = 'GET', body, fetchImpl = fetch }) {
  const response = await fetchImpl(`${BASE}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000),
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { message: raw.slice(0, 300) }; }
  if (!response.ok) {
    const detail = typeof data?.message === 'string' ? data.message : JSON.stringify(data);
    const err = new Error(`Vapi request failed (${response.status}): ${detail.slice(0, 450)}`);
    err.status = response.status;
    throw err;
  }
  return data;
}

export async function createTestCall(env, fetchImpl = fetch) {
  return vapiRequest({
    apiKey: env.VAPI_API_KEY,
    path: '/call',
    method: 'POST',
    body: {
      assistantId: env.VAPI_ASSISTANT_ID,
      phoneNumberId: env.VAPI_PHONE_NUMBER_ID,
      customer: { number: env.TEST_DESTINATION_NUMBER },
      name: 'Chairmans Office - Amara First Call',
    },
    fetchImpl,
  });
}

export async function getCall(env, id, fetchImpl = fetch) {
  return vapiRequest({ apiKey: env.VAPI_API_KEY, path: `/call/${encodeURIComponent(id)}`, fetchImpl });
}
