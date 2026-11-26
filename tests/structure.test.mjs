import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('legacy API domains remain available',()=>{const routes=read('lib/routes.mjs');for(const name of ['health','me','state','providers','world','messages','contacts','calls/start','invites','meetings','decisions','tenders','settings','push/public','push/subscribe'])assert.ok(routes.includes("'"+name+"'"),name);});
test('auth does not grant access based on email alone',()=>{const code=read('lib/profile.mjs');assert.match(code,/emailVerified/);assert.match(code,/WHERE auth_user_id=\$1/);assert.match(code,/ON CONFLICT DO NOTHING/);assert.doesNotMatch(code,/WHERE email=/);});
test('workflow uses durable sleep instead of process polling',()=>{const code=read('workflows/world-engine.js');assert.match(code,/"use workflow"/);assert.match(code,/"use step"/);assert.match(code,/await sleep/);assert.doesNotMatch(code,/setInterval/);});
test('service worker limits caching to public Next assets',()=>assert.match(read('public/sw.js'),/\/_next\/static\//));
test('accepting an invitation checks owner, contact, due time and status',()=>assert.match(read('backend/src/world.mjs'),/contact_id=\$3 AND status='pending' AND due_at<=now\(\)/));

test('voice calls use the saved executive identity and an in-world action tool',()=>{
  const app=read('frontend/src/App.jsx');
  const world=read('backend/src/world.mjs');
  const tools=read('lib/vapi-tools.mjs');
  assert.match(app,/name:c\.name/);
  assert.match(app,/type:'add-message'/);
  assert.match(app,/\'tools:append\'/);
  assert.match(app,/arrange_internal_call/);
  assert.match(app,/action_token/);
  assert.match(world,/Your name and identity are exactly/);
  assert.match(world,/createVapiActionToken/);
  assert.match(tools,/verifyVapiActionToken/);
  assert.match(tools,/parseCallIntent\(reason\)/);
});
test('delayed callbacks use durable workflows and prompt incoming-call polling',()=>{
  assert.match(read('workflows/scheduled-call.js'),/await sleep/);
  assert.match(read('lib/executive-actions.mjs'),/completeScheduledCall/);
  assert.match(read('lib/push.mjs'),/export async function deliverInvitePush/);
  assert.match(read('app/api/invites/pending/route.js'),/pendingInvites/);
  assert.match(read('frontend/src/App.jsx'),/api\('\/invites\/pending'\)/);
});
test('scheduled call actions have database-level idempotency protection',()=>{
  assert.match(read('lib/migrate.mjs'),/scheduler_jobs_action_key_unique/);
  assert.match(read('lib/executive-actions.mjs'),/ON CONFLICT DO NOTHING/);
});

test('direct messages and group conversations keep separate state keys',()=>{
  const communications=read('lib/autonomous-communications.mjs');
  const app=read('frontend/src/App.jsx');
  assert.match(communications,/return \{worldConversations:conversations,worldConversationMessages\}/);
  assert.match(app,/state\.worldConversations/);
  assert.match(app,/state\.worldConversationMessages/);
});
test('legacy null engine-lock timestamps do not block world ticks',()=>{
  const engine=read('lib/world-engine.mjs');
  const migration=read('lib/migrate.mjs');
  assert.match(engine,/COALESCE\(lease_until/);
  assert.match(engine,/COALESCE\(last_tick/);
  assert.match(engine,/INSERT INTO engine_control/);
  assert.match(migration,/UPDATE engine_control SET last_tick='-infinity' WHERE last_tick IS NULL/);
});
test('the Activity timeline is connected to the phone and its recorded sources',()=>{
  const app=read('frontend/src/App.jsx');
  const feed=read('frontend/src/activity-feed.js');
  assert.match(app,/buildActivityFeed/);
  assert.match(app,/View full Activity timeline/);
  for(const source of ['state.events','state.messages','state.calls','state.meetings','state.economy?.journal','state.operations?.auditLog','state.worldConversationMessages'])assert.ok(feed.includes(source),source);
});

test('Node-only database, push and token work is isolated in durable step functions',()=>{
  const worldWorkflow=read('workflows/world-engine.js');
  const callWorkflow=read('workflows/scheduled-call.js');
  const worldEngine=read('lib/world-engine.mjs');
  const executiveActions=read('lib/executive-actions.mjs');
  const packageJson=JSON.parse(read('package.json'));
  assert.equal(packageJson.dependencies.workflow,'5.8.0');
  assert.match(worldWorkflow,/import \{runWorldEngineTick\}/);
  assert.match(callWorkflow,/import \{completeScheduledCall\}/);
  assert.match(worldEngine,/export async function runWorldEngineTick[\s\S]*?"use step"/);
  assert.match(executiveActions,/export async function completeScheduledCall[\s\S]*?"use step"/);
});
