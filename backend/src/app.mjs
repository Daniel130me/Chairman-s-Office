import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import webpush from 'web-push';
import { id, now, get, all, run, insert, audit } from './db.mjs';
import { auth, hashPassword, validPassword, tokenHash, newSession, setCookie, clearCookie } from './security.mjs';
import { setupWorld, snapshot, advanceWorld, decide, sendMessage, startCall, finishCall, meetingSpeak, meetingHistory, endMeeting, tenderDecision, updateSettings, makeInvite, setContactVoice, negotiateTender } from './world.mjs';
import { aiStatus } from './ai.mjs';
import { enrichLatestDevelopment } from './world.mjs';
import { scheduleForAll, pushDue } from './scheduler.mjs';
const safe = (handler) => (req, res, next) => Promise.resolve().then(() => handler(req, res, next)).catch(next);
const attempts = new Map();
function throttle(key) { const d = attempts.get(key) || { n: 0, exp: 0 }; if (d.exp < Date.now()) { d.n = 0; d.exp = Date.now() + 10 * 60000; } d.n++; attempts.set(key, d); return d.n <= 12; }
export function createApp(db, { staticDir = null } = {}) {
  const app = express(); app.disable('x-powered-by'); app.set('trust proxy', 1); app.use(express.json({ limit: '64kb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY'); if (req.path.startsWith('/api/') && req.method !== 'GET' && req.method !== 'HEAD') {
      if (req.headers['x-co-request'] !== '1') return res.status(403).json({ error: 'Invalid request header.' });
      if (req.headers.origin) {
        let origin, own; try { origin = new URL(req.headers.origin); own = new URL(`http://${req.headers.host}`); } catch { return res.status(403).json({ error: 'Invalid origin.' }); }
        const allowed = [process.env.FRONTEND_ORIGIN || 'http://localhost:5173', 'http://127.0.0.1:5173', 'http://10.191.143.134:5173']; if (origin.host !== own.host && !allowed.includes(origin.origin)) return res.status(403).json({ error: 'Origin not allowed.' });
      }
    } next();
  });
  app.get('/api/health', (req, res) => res.json({ ok: true, version: '0.5.0', time: now() }));
  app.post('/api/auth/register', safe((req, res) => { const name = String(req.body.name || '').trim().slice(0, 80), email = String(req.body.email || '').trim().toLowerCase(), password = String(req.body.password || ''); if (name.length < 2 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 10 || password.length > 200) return res.status(400).json({ error: 'Enter a name, valid email, and password of at least 10 characters.' }); if (!throttle(req.ip + ':register')) return res.status(429).json({ error: 'Too many attempts.' }); if (get(db, 'SELECT id FROM users WHERE email=?', email)) return res.status(409).json({ error: 'Account already exists.' }); const u = { id: id(), name, email, pass_hash: hashPassword(password), created_at: now() }; insert(db, 'users', u); const token = newSession(db, u.id); setCookie(res, token, req); res.status(201).json({ user: { id: u.id, name, email } }); }));
  app.post('/api/auth/login', safe((req, res) => { const email = String(req.body.email || '').trim().toLowerCase(), password = String(req.body.password || ''); if (!throttle(req.ip + ':login')) return res.status(429).json({ error: 'Too many login attempts.' }); const u = get(db, 'SELECT * FROM users WHERE email=?', email); if (!u || !validPassword(password, u.pass_hash)) return res.status(401).json({ error: 'Invalid credentials.' }); setCookie(res, newSession(db, u.id), req); res.json({ user: { id: u.id, name: u.name, email: u.email } }); }));
  app.post('/api/auth/logout', safe((req, res) => { const m = req.headers.cookie?.match(/(?:^|;\s*)co_session=([^;]+)/); if (m) run(db, 'DELETE FROM sessions WHERE token_hash=?', tokenHash(m[1])); clearCookie(res); res.json({ ok: true }); }));
  app.use('/api', (req, res, next) => auth(db, req, res, next));
  app.get('/api/me', (req, res) => res.json({ user: req.user }));
  app.post('/api/world', safe((req, res) => { const world = setupWorld(db, req.user, req.body || {}); res.status(201).json({ world }); }));
  app.get('/api/state', (req, res) => res.json({ user: req.user, state: snapshot(db, req.user.id) }));
  app.get('/api/providers', (req, res) => res.json({ providers: aiStatus().map(p => ({ ...p })), voice: 'Vapi Web SDK (separate transport)' }));
  app.post('/api/messages/:contactId', safe(async (req, res) => res.json(await sendMessage(db, req.user.id, req.params.contactId, req.body.body, req.body.channel))));
  app.put('/api/contacts/:id/voice', safe((req, res) => res.json(setContactVoice(db, req.user.id, req.params.id, req.body || {}))));
  app.post('/api/decisions', safe((req, res) => res.status(201).json({ decision: decide(db, req.user.id, req.body.threadId, req.body.content) })));
  app.post('/api/tenders/:id/negotiate', safe((req, res) => res.json(negotiateTender(db, req.user.id, req.params.id, req.body.bidId, req.body.amount))));
  app.post('/api/tenders/:id/prefer', safe((req, res) => res.json(tenderDecision(db, req.user.id, req.params.id, req.body.bidId))));
  app.post('/api/contacts/:id/request-call', safe((req, res) => res.json({ invite: makeInvite(db, req.user.id, req.params.id) })));
  app.post('/api/calls/start', safe((req, res) => res.status(201).json(startCall(db, req.user.id, req.body.contactId, req.body.inviteId || null))));
  app.post('/api/calls/:id/end', safe(async (req, res) => res.json(await finishCall(db, req.user.id, req.params.id, req.body.transcript))));
  app.post('/api/invites/:id/decline', safe((req, res) => { const i = get(db, 'SELECT id FROM invites WHERE id=? AND user_id=?', req.params.id, req.user.id); if (!i) return res.status(404).json({ error: 'Invitation not found.' }); run(db, "UPDATE invites SET status='declined' WHERE id=? AND user_id=?", i.id, req.user.id); res.json({ ok: true }); }));
  app.post('/api/meetings', safe((req, res) => { const w = get(db, 'SELECT * FROM worlds WHERE user_id=?', req.user.id); if (!w) throw new Error('Create an empire first.'); const title = String(req.body.title || '').trim().slice(0, 160), starts = new Date(req.body.start_at); if (title.length < 4 || isNaN(starts.getTime())) throw new Error('Enter a valid title and meeting time.'); const contacts = all(db, 'SELECT id FROM contacts WHERE user_id=?', req.user.id).map(x => x.id), attendees = Array.isArray(req.body.attendees) ? req.body.attendees.filter(x => contacts.includes(x)).slice(0, 10) : []; if (!attendees.length) throw new Error('Select at least one executive.'); const meeting = { id: id(), user_id: req.user.id, world_id: w.id, thread_id: null, title, start_at: starts.toISOString(), duration_minutes: Math.max(10, Math.min(120, Number(req.body.duration_minutes) || 30)), attendees: JSON.stringify(attendees), status: 'scheduled', minutes: null, created_at: now() }; insert(db, 'meetings', meeting); res.status(201).json({ meeting }); }));
  app.get('/api/meetings/:id/turns', safe((req, res) => res.json({ turns: meetingHistory(db, req.user.id, req.params.id) })));
  app.post('/api/meetings/:id/speak', safe(async (req, res) => res.json(await meetingSpeak(db, req.user.id, req.params.id, req.body.message || ''))));
  app.post('/api/meetings/:id/end', safe((req, res) => res.json(endMeeting(db, req.user.id, req.params.id))));
  app.put('/api/settings', safe((req, res) => res.json({ settings: updateSettings(db, req.user.id, req.body || {}) })));
  app.get('/api/push/public', (req, res) => res.json({ key: process.env.VAPID_PUBLIC_KEY || null }));
  app.post('/api/push/subscribe', safe((req, res) => { if (!req.body.endpoint || !req.body.keys?.p256dh || !req.body.keys?.auth) return res.status(400).json({ error: 'Invalid push subscription.' }); const s = JSON.stringify(req.body); if (s.length > 5000) return res.status(400).json({ error: 'Subscription too large.' }); run(db, 'INSERT OR REPLACE INTO push_subscriptions(id,user_id,endpoint,subscription,created_at) VALUES (?,?,?,?,?)', id(), req.user.id, String(req.body.endpoint), s, now()); res.json({ ok: true }); }));
  app.post('/api/engine/advance', safe((req, res) => { if (process.env.ENABLE_DEV_CONTROLS !== 'true') return res.status(404).json({ error: 'Not available.' }); res.json(advanceWorld(db, req.user.id, Math.max(1, Math.min(3, Number(req.body.steps) || 1)))); }));
  // All other /api routes return JSON 404, never the frontend SPA.
  app.use('/api', (req, res) => res.status(404).json({ error: 'Unknown API endpoint.' }));
  if (staticDir && fs.existsSync(staticDir)) { app.use(express.static(staticDir, { index: false })); app.get('*', (req, res) => res.sendFile(path.join(staticDir, 'index.html'))); }
  app.use((err, req, res, next) => { console.error(err); if (res.headersSent) return next(err); res.status(err.status || 400).json({ error: err.message || 'Request failed.' }); });
  return app;
}
export function createScheduler(db) {
  let wp = null; try { if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) { webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:developer@example.com', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY); wp = webpush; } } catch (e) { console.error('Invalid Web Push configuration:', e.message); }
  let running = false; async function poll() { if (running) return; running = true; try { const result = scheduleForAll(db); await pushDue(db, wp); for (const userId of result.advancedUsers || []) await enrichLatestDevelopment(db, userId); } catch (e) { console.error('scheduler', e); } finally { running = false; } }
  const timer = setInterval(poll, Math.max(10000, Number(process.env.SCHEDULER_POLL_MS) || 45000)); void poll(); return () => clearInterval(timer);
}
