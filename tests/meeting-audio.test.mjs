import test from 'node:test';
import assert from 'node:assert/strict';
import {createMeetingAudioTracks} from '../frontend/src/meeting-audio-tracks.js';
test('local VAD track remains enabled while outbound WebRTC track is muted',()=>{
 const original={enabled:true,clone(){return {enabled:true,stop(){this.stopped=true;}}}};
 const {monitorTrack,sendTrack}=createMeetingAudioTracks(original);
 assert.equal(monitorTrack,original);
 assert.equal(monitorTrack.enabled,true);
 assert.notEqual(sendTrack,monitorTrack);
 assert.equal(sendTrack.enabled,false);
 sendTrack.enabled=true;
 assert.equal(monitorTrack.enabled,true);
 sendTrack.stop();
 assert.equal(sendTrack.stopped,true);
});
test('missing clone support fails closed rather than muting the local monitor',()=>{
 const original={enabled:true};
 assert.throws(()=>createMeetingAudioTracks(original),/cannot be cloned safely/);
 assert.equal(original.enabled,true);
});
