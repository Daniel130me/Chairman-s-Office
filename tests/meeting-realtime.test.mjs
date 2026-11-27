import test from 'node:test';
import assert from 'node:assert/strict';
import {transcriptionSession,realtimeMeetingAvailable,createMeetingRealtimeSecret} from '../lib/meeting-realtime.mjs';
test('streaming microphone is transcription-only and uses explicit turn commits',()=>{
 const session=transcriptionSession();
 assert.equal(session.type,'transcription');
 assert.equal(session.audio.input.transcription.model,'gpt-live-transcribe');
 assert.equal(session.audio.input.format.rate,24000);
 assert.equal(session.audio.input.turn_detection,null);
 assert.equal(session.audio.output,undefined);
 assert.equal(session.tools,undefined);
});
test('streaming microphone requires deployment opt-in',async()=>{
 const flag=process.env.MEETING_REALTIME_ENABLED;
 try{
  process.env.MEETING_REALTIME_ENABLED='0';
  assert.equal(realtimeMeetingAvailable(),false);
  await assert.rejects(()=>createMeetingRealtimeSecret({id:'fixture'},'fixture',{consent:true}),/not configured/);
 }finally{if(flag===undefined)delete process.env.MEETING_REALTIME_ENABLED;else process.env.MEETING_REALTIME_ENABLED=flag;}
});
