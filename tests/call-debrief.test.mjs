import test from 'node:test';
import assert from 'node:assert/strict';
import {requestsCallDebrief,formatCallDebrief} from '../lib/call-debrief.mjs';
test('detects a clear spoken request to send a written debrief to Messages',()=>{
 const transcript=[
  {role:'user',text:'Please send me a written debrief of everything we discussed in this call.'},
  {role:'user',text:'Include decisions and actions required.'},
  {role:'user',text:'Send it to my message app before we end.'}
 ];
 assert.equal(requestsCallDebrief(transcript),true);
});
test('detects requests split across separate speech transcript segments',()=>{
 assert.equal(requestsCallDebrief([
  {role:'user',text:'Send me a summary'},
  {role:'user',text:'as a text message'}
 ]),true);
});
test('does not treat a spoken request for information as a delivery instruction',()=>{
 assert.equal(requestsCallDebrief([{role:'user',text:'Can you give me a quick summary of the agenda?'}]),false);
 assert.equal(requestsCallDebrief([{role:'assistant',text:'Please send me a debrief.'}]),false);
});
test('formats a debrief from the saved call summary without inventing new decisions',()=>{
 const body=formatCallDebrief({contactName:'Amara Okafor',summary:'Decisions: None recorded. Outstanding matters: None identified.'});
 assert.match(body,/Amara Okafor — Call debrief/);
 assert.match(body,/Decisions: None recorded/);
 assert.match(body,/saved to your Chairman’s Office Messages app/);
});
test('uses the recorded exchange when no call summary exists',()=>{
 const body=formatCallDebrief({contactName:'Amara Okafor',transcript:[{role:'user',text:'Send the summary.'}]});
 assert.match(body,/Recorded exchange/);
 assert.match(body,/Chairman: Send the summary/);
});
