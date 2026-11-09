import express from 'express';
import helmet from 'helmet';
import { createTestCall, getCall } from './vapi.mjs';
import { isNigerianMobile, safelyMatchesToken, missingSettings, maskPhone } from './validation.mjs';

/**
 * Deliberately PRIVATE single-user control API.
 * Calls only TEST_DESTINATION_NUMBER: no arbitrary destination input.
 */
export function createApp(env = process.env, deps = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '8kb' }));

  app.get('/health', (_req, res) => res.json({ ok: true, app: 'chairmans-office-milestone-a' }));

  function requireAdmin(req, res, next) {
    const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!safelyMatchesToken(token, env.ADMIN_API_TOKEN)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  }

  app.get('/admin/config', requireAdmin, (_req, res) => {
    res.json({
      ready: missingSettings(env).length === 0 && isNigerianMobile(env.TEST_DESTINATION_NUMBER),
      missing: missingSettings(env),
      destinationMasked: maskPhone(env.TEST_DESTINATION_NUMBER),
      callLimitSeconds: 300, // Must also be set on the Vapi assistant.
    });
  });

  // Safety guard applies only to this process; Vapi/Twilio billing limits still matter.
  let lastAcceptedAt = 0;
  let inProgress = false;
  let acceptedToday = 0;
  let day = '';
  const START_COOLDOWN_MS = 2 * 60 * 1000;
  const DAILY_MAX = 3;

  app.post('/admin/test-call', requireAdmin, async (_req, res) => {
    if (missingSettings(env).length) return res.status(503).json({ error: 'Missing environment settings', missing: missingSettings(env) });
    if (!isNigerianMobile(env.TEST_DESTINATION_NUMBER)) {
      return res.status(400).json({ error: 'TEST_DESTINATION_NUMBER must be a Nigerian E.164 mobile number (+234 followed by 10 digits).' });
    }
    const now = Date.now();
    const today = new Date(now).toISOString().slice(0, 10);
    if (today !== day) { day = today; acceptedToday = 0; }
    if (inProgress || now - lastAcceptedAt < START_COOLDOWN_MS) return res.status(429).json({ error: 'Try again after 2 minutes.' });
    if (acceptedToday >= DAILY_MAX) return res.status(429).json({ error: 'Daily test-call limit reached (3).' });
    inProgress = true;
    try {
      const call = await (deps.createTestCall ?? createTestCall)(env);
      lastAcceptedAt = Date.now();
      acceptedToday += 1;
      return res.status(202).json({ accepted: true, callId: call.id ?? null, status: call.status ?? 'requested' });
    } catch (err) {
      // Avoid logging private credentials or the called number.
      console.error('Vapi outbound call request failed:', err.message);
      return res.status(502).json({ error: 'Outbound call request failed', detail: err.message });
    } finally { inProgress = false; }
  });

  app.get('/admin/calls/:id', requireAdmin, async (req, res) => {
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid call ID' });
    if (!env.VAPI_API_KEY) return res.status(503).json({ error: 'VAPI_API_KEY missing' });
    try {
      const call = await (deps.getCall ?? getCall)(env, req.params.id);
      return res.json({
        id: call.id,
        status: call.status,
        endedReason: call.endedReason ?? null,
        createdAt: call.createdAt ?? null,
        endedAt: call.endedAt ?? null,
        durationSeconds: call.costBreakdown?.transportMinutes != null ? Math.round(call.costBreakdown.transportMinutes * 60) : null,
        cost: call.cost ?? null,
      });
    } catch (err) {
      return res.status(502).json({ error: 'Unable to retrieve call', detail: err.message });
    }
  });

  return app;
}
