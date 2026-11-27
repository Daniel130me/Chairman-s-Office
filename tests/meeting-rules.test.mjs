import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMeetingPrompt} from '../lib/meeting-rules.mjs';
test('each board participant receives the evolving discussion history',()=>{
 const prompt=buildMeetingPrompt({meetingTitle:'Acquisition review',empireName:'Northstar Group',person:{id:'c',name:'CFO',title:'Group CFO',temperament:'cautious',agenda:'protect liquidity'},attendees:[{id:'c',name:'CFO',title:'Group CFO'},{id:'d',name:'CEO',title:'CEO'}],history:[{speaker:'Chairman',message:'Assess the acquisition.'},{speaker:'CEO',message:'I support it because the target adds distribution.'}]});
 assert.match(prompt,/CEO: I support it because the target adds distribution/);
 assert.match(prompt,/respectfully disagree/);
 assert.match(prompt,/protect liquidity/);
});
