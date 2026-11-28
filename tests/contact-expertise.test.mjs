import test from 'node:test';
import assert from 'node:assert/strict';
import {normaliseContactExpertise} from '../lib/contact-expertise.mjs';
test('supplies role-specific expertise for executives with empty legacy fields',()=>{
 const skills=normaliseContactExpertise([],'Chief of Staff','Node 71 Limited');
 assert.ok(skills.includes('Executive coordination'));
 assert.ok(skills.includes('Crisis coordination'));
});
test('combines a specialist role and sector without losing the key disciplines',()=>{
 const skills=normaliseContactExpertise([],'Director of Autonomous Vehicle Safety Regulation','Continental Vehicle Safety Authority');
 assert.ok(skills.includes('Autonomous vehicle safety'));
 assert.ok(skills.includes('AI safety'));
 assert.ok(skills.length>=5);
});
