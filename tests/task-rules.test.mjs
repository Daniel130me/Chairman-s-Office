import test from 'node:test';
import assert from 'node:assert/strict';
import {validTaskType,canAssignTask} from '../lib/task-rules.mjs';
test('task types are explicit',()=>{
 for(const t of ['general','financial-review','contract-review','investigation-review','employee-review','portfolio-review','meeting-preparation','prepare-briefing'])assert.equal(validTaskType(t),true);
 assert.equal(validTaskType('fire-employee'),false);
});
test('sensitive work is assigned only to appropriate roles',()=>{
 assert.equal(canAssignTask('financial-review','Group CFO'),true);
 assert.equal(canAssignTask('financial-review','Sales Manager'),false);
 assert.equal(canAssignTask('investigation-review','Internal Audit Director'),true);
 assert.equal(canAssignTask('employee-review','General Counsel'),false);
 assert.equal(canAssignTask('general','Sales Manager'),true);
});
