// Keep the local microphone track live for speech detection while gating
// the cloned track that is actually sent over WebRTC.
export function createMeetingAudioTracks(microphoneTrack){
 if(!microphoneTrack||typeof microphoneTrack.clone!=='function')throw new Error('Microphone track cannot be cloned safely.');
 const sendTrack=microphoneTrack.clone();
 sendTrack.enabled=false;
 return {monitorTrack:microphoneTrack,sendTrack};
}

export function waitForIceGathering(peer,timeoutMs=10000,signal){
 if(peer.iceGatheringState==='complete')return Promise.resolve();
 return new Promise((resolve,reject)=>{
  const cleanup=()=>{clearTimeout(timer);peer.removeEventListener('icegatheringstatechange',changed);signal?.removeEventListener('abort',aborted);};
  const changed=()=>{if(peer.iceGatheringState==='complete'){cleanup();resolve();}};
  const aborted=()=>{cleanup();const error=new Error('ICE gathering cancelled.');error.name='AbortError';reject(error);};
  const timer=setTimeout(()=>{cleanup();reject(new Error('Network route discovery timed out.'));},timeoutMs);
  signal?.addEventListener('abort',aborted,{once:true});
  peer.addEventListener('icegatheringstatechange',changed);if(signal?.aborted)aborted();else changed();
 });
}
