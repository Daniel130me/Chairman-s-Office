import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const schema=await readFile(new URL('../lib/economy-schema.mjs',import.meta.url),'utf8');
const sql=schema.slice(schema.indexOf('`')+1,schema.lastIndexOf('`;'));
test('every primary-key table declaration has a CREATE TABLE statement',()=>{
 for(const statement of sql.split(';')){
  if(/\bid uuid PRIMARY KEY\b/.test(statement))assert.match(statement,/CREATE TABLE IF NOT EXISTS\s+[a-z_]+\s*\(/i,statement.slice(0,180));
 }
});
test('re-added accounting constraints are dropped first for repeatable migrations',()=>{
 for(const match of sql.matchAll(/ADD CONSTRAINT\s+([a-z_]+)/gi)){
  const name=match[1],prefix=sql.slice(0,match.index);
  assert.match(prefix,new RegExp('DROP CONSTRAINT IF EXISTS '+name+'\\b','i'));
 }
});
test('inventory and acquisition tables are explicitly declared',()=>{
 assert.match(sql,/CREATE TABLE IF NOT EXISTS inventory_items\s*\(/);
 assert.match(sql,/CREATE TABLE IF NOT EXISTS company_investments\s*\(/);
 assert.match(sql,/CREATE TABLE IF NOT EXISTS company_acquisitions\s*\(/);
});
test('schema template contains only complete SQL statements',()=>{
 const statements=sql.split(';').map(s=>s.trim()).filter(Boolean);
 for(const statement of statements)assert.match(statement,/^(CREATE|ALTER|DROP|UPDATE|INSERT|DELETE)\b/i,statement.slice(0,160));
});

test('event push delivery fields are included in the migration',()=>{
 assert.match(sql,/ALTER TABLE events ADD COLUMN IF NOT EXISTS push_sent_at/);
 assert.match(sql,/ALTER TABLE events ADD COLUMN IF NOT EXISTS push_attempt_at/);
 assert.match(sql,/ALTER TABLE events ADD COLUMN IF NOT EXISTS push_attempts/);
});

test('real-world news and independent refresh throttles are migrated',()=>{
 assert.match(sql,/CREATE TABLE IF NOT EXISTS real_world_news/);
 assert.match(sql,/last_real_signal_attempt_at/);
 assert.match(sql,/last_real_news_at/);
 assert.match(sql,/last_real_news_attempt_at/);
});

test('asynchronous boardroom rounds have durable status and response tracking',()=>{
 assert.match(sql,/CREATE TABLE IF NOT EXISTS meeting_rounds/);
 assert.match(sql,/meeting_rounds_one_active/);
 assert.match(sql,/responses_saved/);
});

test('meeting turns are linked to one durable round and unique per participant',()=>{assert.match(sql,/meeting_turns ADD COLUMN IF NOT EXISTS round_id/);assert.match(sql,/meeting_turns_round_contact_unique/);});
