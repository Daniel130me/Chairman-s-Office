import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const now = () => new Date().toISOString();
export { now };
export const id = () => crypto.randomUUID();
export const decode = (s, otherwise = null) => { try { return JSON.parse(s); } catch { return otherwise; } };

export function createDatabase(file = process.env.DB_PATH || './data/chairmans-office.sqlite') {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, pass_hash TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS worlds (id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, region TEXT NOT NULL, timezone TEXT NOT NULL, sectors TEXT NOT NULL, chief TEXT NOT NULL, valuation INTEGER NOT NULL, last_tick TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS companies (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, world_id TEXT NOT NULL, name TEXT NOT NULL, sector TEXT NOT NULL, valuation INTEGER NOT NULL, cash INTEGER NOT NULL, revenue INTEGER NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS contacts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, world_id TEXT NOT NULL, name TEXT NOT NULL, title TEXT NOT NULL, company TEXT NOT NULL, kind TEXT NOT NULL, relationship TEXT NOT NULL, temperament TEXT NOT NULL, agenda TEXT NOT NULL, trust INTEGER NOT NULL DEFAULT 60, availability TEXT NOT NULL DEFAULT 'available', voice_id TEXT, vapi_assistant_id TEXT, last_contact_at TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS threads (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, world_id TEXT NOT NULL, company_id TEXT, contact_id TEXT, title TEXT NOT NULL, category TEXT NOT NULL, summary TEXT NOT NULL, stage INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'open', priority TEXT NOT NULL DEFAULT 'normal', next_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, world_id TEXT NOT NULL, thread_id TEXT, contact_id TEXT, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, world_id TEXT NOT NULL, contact_id TEXT NOT NULL, direction TEXT NOT NULL, channel TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS meetings (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, world_id TEXT NOT NULL, thread_id TEXT, title TEXT NOT NULL, start_at TEXT NOT NULL, duration_minutes INTEGER NOT NULL, attendees TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'scheduled', minutes TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS meeting_turns (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, meeting_id TEXT NOT NULL, contact_id TEXT, speaker TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, world_id TEXT NOT NULL, thread_id TEXT, contact_id TEXT, title TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS tenders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, world_id TEXT NOT NULL, company_id TEXT, thread_id TEXT, title TEXT NOT NULL, budget INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS bids (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, tender_id TEXT NOT NULL, contact_id TEXT NOT NULL, amount INTEGER NOT NULL, weeks INTEGER NOT NULL, quality INTEGER NOT NULL, risk TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'submitted');
    CREATE TABLE IF NOT EXISTS decisions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, world_id TEXT NOT NULL, thread_id TEXT, contact_id TEXT, content TEXT NOT NULL, source TEXT NOT NULL, outcome TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS invites (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, world_id TEXT NOT NULL, contact_id TEXT NOT NULL, thread_id TEXT, kind TEXT NOT NULL, subject TEXT NOT NULL, preview TEXT NOT NULL, due_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS calls (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, world_id TEXT NOT NULL, contact_id TEXT NOT NULL, invite_id TEXT, status TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, transcript TEXT NOT NULL DEFAULT '[]', summary TEXT);
    CREATE TABLE IF NOT EXISTS push_subscriptions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, endpoint TEXT NOT NULL, subscription TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(user_id,endpoint));
    CREATE TABLE IF NOT EXISTS settings (user_id TEXT PRIMARY KEY, morning TEXT NOT NULL DEFAULT '07:30', evening TEXT NOT NULL DEFAULT '19:00', quiet_start TEXT NOT NULL DEFAULT '21:00', quiet_end TEXT NOT NULL DEFAULT '07:00', max_daily INTEGER NOT NULL DEFAULT 3, urgent INTEGER NOT NULL DEFAULT 1, notifications INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS audit (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,action TEXT NOT NULL,details TEXT,created_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id);
    CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id,created_at);
    CREATE INDEX IF NOT EXISTS idx_invites_due ON invites(due_at,status);
    CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(user_id,contact_id,created_at);
    CREATE INDEX IF NOT EXISTS idx_threads_user ON threads(user_id,status);
  `);
  return db;
}
export function run(db, sql, ...params) { return db.prepare(sql).run(...params); }
export function all(db, sql, ...params) { return db.prepare(sql).all(...params); }
export function get(db, sql, ...params) { return db.prepare(sql).get(...params); }
export function insert(db, table, object) {
  const keys = Object.keys(object);
  const q = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`;
  return run(db, q, ...keys.map(k=>object[k]));
}
export function audit(db,userId,action,details={}) { insert(db,'audit',{id:id(),user_id:userId,action,details:JSON.stringify(details),created_at:now()}); }
