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

test('closing the microphone aborts a pending ICE wait immediately',async()=>{
 const listeners=new Set(),peer={iceGatheringState:'gathering',addEventListener(_name,fn){listeners.add(fn);},removeEventListener(_name,fn){listeners.delete(fn);}};
 const controller=new AbortController(),waiting=waitForIceGathering(peer,10000,controller.signal);
 controller.abort();await assert.rejects(waiting,{name:'AbortError'});assert.equal(listeners.size,0);
});

import {createVoiceAudioCache,nextVoiceSegment} from '../frontend/src/meeting-playback-cache.js';
test('executive audio cache is bounded and evicts least recently used audio',()=>{
 const c=createVoiceAudioCache({maxEntries:2,maxBytes:10}),a={size:4},b={size:4};c.set('a',a);c.set('b',b);assert.equal(c.get('a'),a);c.set('c',{size:4});assert.equal(c.get('b'),undefined);assert.equal(c.get('a'),a);c.set('oversize',{size:11});assert.equal(c.size(),2);c.clear();assert.equal(c.size(),0);
});
test('audio prefetch advances to the next executive only after final segment',()=>{
 const a={id:'a'},b={id:'b'};assert.deepEqual(nextVoiceSegment(a,0,2,[b]),{turn:a,index:1});assert.deepEqual(nextVoiceSegment(a,1,2,[b]),{turn:b,index:0});assert.equal(nextVoiceSegment(a,1,2,[]),null);
});
