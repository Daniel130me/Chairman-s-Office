import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('provider failures are logged without response bodies and not recorded as successful AI generation',()=>{
 const ai=read('backend/src/ai.mjs'),communications=read('lib/autonomous-communications.mjs'),market=read('lib/market-engine.mjs');
 assert.match(ai,/AI provider HTTP status/);assert.match(ai,/AI providers exhausted/);
 assert.match(communications,/last_communication_attempt_at/);assert.match(communications,/AI_COMMUNICATION_UNAVAILABLE/);
 assert.match(market,/last_market_attempt_at/);assert.match(market,/AI_MARKET_UNAVAILABLE/);
 assert.match(market,/if\(attention&&reason&&!quiet\)/);
});
