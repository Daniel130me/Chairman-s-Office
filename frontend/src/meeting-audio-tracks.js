// Keep the local microphone track live for speech detection while gating
// the cloned track that is actually sent over WebRTC.
export function createMeetingAudioTracks(microphoneTrack){
 if(!microphoneTrack||typeof microphoneTrack.clone!=='function')throw new Error('Microphone track cannot be cloned safely.');
 const sendTrack=microphoneTrack.clone();
 sendTrack.enabled=false;
 return {monitorTrack:microphoneTrack,sendTrack};
}
