import test from 'node:test';
import assert from 'node:assert/strict';
import {createMeetingAudioTracks,waitForIceGathering} from '../frontend/src/meeting-audio-tracks.js';
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

test('WebRTC SDP exchange waits until ICE candidates are gathered',async()=>{
 const listeners=new Set(),peer={iceGatheringState:'gathering',addEventListener(_name,fn){listeners.add(fn);},removeEventListener(_name,fn){listeners.delete(fn);}};
 const waiting=waitForIceGathering(peer,100);
 assert.equal(listeners.size,1);
 peer.iceGatheringState='complete';for(const fn of [...listeners])fn();
 await waiting;assert.equal(listeners.size,0);
});
test('WebRTC ICE gathering fails with a bounded timeout',async()=>{
 const listeners=new Set(),peer={iceGatheringState:'gathering',addEventListener(_name,fn){listeners.add(fn);},removeEventListener(_name,fn){listeners.delete(fn);}};
 await assert.rejects(()=>waitForIceGathering(peer,5),/timed out/);
 assert.equal(listeners.size,0);
});
