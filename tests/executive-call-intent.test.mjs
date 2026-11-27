import test from 'node:test';
import assert from 'node:assert/strict';
import {handleCallIntent} from '../lib/executive-call-intent.mjs';

test('typed typo creates an immediate in-app callback only after scheduling succeeds',async()=>{
 const calls=[];
 const result=await handleCallIntent({
  userId:'user-1',worldId:'world-1',defaultContactId:'contact-1',
  text:'Cal me now!',actionKey:'message:1',
  schedule:async options=>{calls.push(options);return {contact:{name:'Amara',title:'Chief of Staff'},delaySeconds:0};}
 });
 assert.equal(result.scheduled,true);
 assert.match(result.reply,/Amara/);
 assert.equal(calls[0].recipient,null);
 assert.equal(calls[0].delaySeconds,0);
 assert.equal(calls[0].actionKey,'message:1');
});

test('transcribed voice-note callback uses the same action path',async()=>{
 const calls=[];
 const result=await handleCallIntent({
  userId:'user-1',worldId:'world-1',defaultContactId:'contact-1',
  text:'Hello, call me now.',actionKey:'voice-note:1',
  schedule:async options=>{calls.push(options);return {contact:{name:'Amara',title:'Chief of Staff'},delaySeconds:0};}
 });
 assert.equal(result.scheduled,true);
 assert.equal(calls[0].actionKey,'voice-note:1');
 assert.match(result.reply,/incoming call/i);
});

test('a failed scheduling attempt never returns a success promise',async()=>{
 const result=await handleCallIntent({text:'Call me now',schedule:async()=>{throw new Error('No call invitation could be created.');}});
 assert.equal(result.scheduled,false);
 assert.match(result.reply,/could not arrange/i);
});

test('vague callback requests ask for timing instead of scheduling',async()=>{
 let called=false;
 const result=await handleCallIntent({text:'Please call me back.',schedule:async()=>{called=true;}});
 assert.equal(called,false);
 assert.match(result.reply,/When would you like me/);
});

test('ordinary messages do not invoke call scheduling',async()=>{
 let called=false;
 assert.equal(await handleCallIntent({text:'Please review the acquisition.',schedule:async()=>{called=true;}}),null);
 assert.equal(called,false);
});
