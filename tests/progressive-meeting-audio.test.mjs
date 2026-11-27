import test from 'node:test';
import assert from 'node:assert/strict';
import {boundedWavStream,progressiveMeetingAudioAvailable} from '../lib/progressive-meeting-audio.mjs';
const bytes=s=>new TextEncoder().encode(s);
const source=chunks=>new ReadableStream({start(c){for(const x of chunks)c.enqueue(bytes(x));c.close();}});
test('progressive audio accepts split WAV headers and preserves bytes',async()=>{
 const output=await boundedWavStream(source(['RI','FF1234WA','VE','payload']));
 assert.equal(await new Response(output).text(),'RIFF1234WAVEpayload');
});
test('progressive audio rejects invalid and truncated headers',async()=>{
 await assert.rejects(()=>boundedWavStream(source(['ERROR1234567'])),/Invalid WAV/);
 await assert.rejects(()=>boundedWavStream(source(['RIFF'])),/Incomplete/);
});
test('progressive audio enforces total byte ceiling',async()=>{
 const stream=await boundedWavStream(source(['RIFF1234WAVE','payload']),15);
 await assert.rejects(()=>new Response(stream).arrayBuffer(),/limit exceeded/);
});
test('progressive audio cancels the upstream reader',async()=>{
 let cancelled=false;const body=new ReadableStream({start(c){c.enqueue(bytes('RIFF1234WAVE'));},cancel(){cancelled=true;}});
 const stream=await boundedWavStream(body);await stream.cancel();assert.equal(cancelled,true);
});
test('progressive audio defaults to disabled',()=>{const old=process.env.MEETING_PROGRESSIVE_AUDIO;delete process.env.MEETING_PROGRESSIVE_AUDIO;try{assert.equal(progressiveMeetingAudioAvailable(),false);}finally{if(old!==undefined)process.env.MEETING_PROGRESSIVE_AUDIO=old;}});
