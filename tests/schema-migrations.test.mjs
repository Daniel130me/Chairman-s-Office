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
