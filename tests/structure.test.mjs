import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('legacy API domains remain available',()=>{const routes=read('lib/routes.mjs');for(const name of ['health','me','state','providers','world','messages','contacts','calls/start','invites','meetings','decisions','tenders','settings','push/public','push/subscribe'])assert.ok(routes.includes("'"+name+"'"),name);});
test('auth does not grant access based on email alone',()=>{const code=read('lib/profile.mjs');assert.match(code,/emailVerified/);assert.match(code,/WHERE auth_user_id=\$1/);assert.match(code,/ON CONFLICT DO NOTHING/);assert.doesNotMatch(code,/WHERE email=/);});
test('workflow uses durable sleep instead of process polling',()=>{const code=read('workflows/world-engine.js');assert.match(code,/"use workflow"/);assert.match(code,/"use step"/);assert.match(code,/await sleep/);assert.doesNotMatch(code,/setInterval/);});
test('service worker limits caching to public Next assets',()=>assert.match(read('public/sw.js'),/\/_next\/static\//));
test('accepting an invitation checks owner, contact, due time and status',()=>assert.match(read('backend/src/world.mjs'),/contact_id=\$3 AND status='pending' AND due_at<=now\(\)/));
