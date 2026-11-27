import test from 'node:test';
import assert from 'node:assert/strict';
import {safeEngineDate,classifyEngineHealth} from '../lib/engine-health-rules.mjs';
const now=Date.parse('2026-11-27T12:00:00Z');
const base={enabled:true,engine:{revision:25,heartbeat_at:'2026-11-27T11:58:00Z'},world:{scheduler_checked_at:'2026-11-27T11:55:00Z'},expectedRevision:25,now};
test('uninitialized and invalid PostgreSQL timestamps are represented as missing',()=>{for(const value of [-Infinity,Infinity,'-infinity','invalid',null])assert.equal(safeEngineDate(value),null);assert.equal(safeEngineDate(new Date(now)),'2026-11-27T12:00:00.000Z');});
test('engine health distinguishes healthy, degraded, stale, disabled, and not started',()=>{assert.equal(classifyEngineHealth(base).health,'healthy');assert.equal(classifyEngineHealth({...base,stages:[{consecutive_failures:3}]}).health,'degraded');assert.equal(classifyEngineHealth({...base,engine:{revision:24,heartbeat_at:base.engine.heartbeat_at}}).health,'stale');assert.equal(classifyEngineHealth({...base,engine:{...base.engine,heartbeat_at:-Infinity}}).health,'stale');assert.equal(classifyEngineHealth({...base,world:{scheduler_checked_at:null}}).health,'stale');assert.equal(classifyEngineHealth({...base,enabled:false}).health,'disabled');assert.equal(classifyEngineHealth({...base,engine:null}).health,'not_started');});
