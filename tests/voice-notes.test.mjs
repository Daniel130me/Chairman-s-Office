import test from 'node:test';
import assert from 'node:assert/strict';
import {audioMime,validAudio,voiceForContact,MAX_AUDIO_BYTES} from '../lib/voice-notes.mjs';
import {normalizeWavForPlayback} from '../lib/wav-audio.mjs';
test('recordings accept only approved audio containers and bounded size',()=>{
 assert.equal(audioMime('audio/webm;codecs=opus'),'audio/webm');
 assert.equal(audioMime('text/html'),null);
 const wav=Buffer.alloc(32);wav.write('RIFF');wav.write('WAVE',8);
 assert.equal(validAudio(wav,'audio/wav'),true);
 assert.equal(validAudio(wav,'audio/webm'),false);
 assert.equal(validAudio(Buffer.alloc(MAX_AUDIO_BYTES+1),'audio/wav'),false);
});
test('synthetic voice assignment is stable, gender-aware and respects an explicit voice',()=>{
 assert.equal(voiceForContact('character-1','hannah','Daniella','Chief of Staff'),'hannah');
 assert.equal(voiceForContact('character-1','troy','Amara Okafor','Chief of Staff'),'autumn');
 assert.ok(['austin','daniel','troy'].includes(voiceForContact('character-2','autumn','Victor Sloane','CEO')));
 assert.equal(voiceForContact('character-1',null,'Daniella','Chief of Staff'),'autumn');
 assert.ok(['autumn','diana','hannah'].includes(voiceForContact('character-2',null,'Nadia Mensah','Chief Operating Officer')));
 assert.ok(['austin','daniel','troy'].includes(voiceForContact('character-3',null,'Victor Sloane','CEO')));
 assert.equal(voiceForContact('character-1'),voiceForContact('character-1'));
});

test('Orpheus streaming WAV headers are normalized for standard browser playback',()=>{
 const fmt=Buffer.alloc(24);fmt.write('fmt ',0);fmt.writeUInt32LE(16,4);fmt.writeUInt16LE(1,8);fmt.writeUInt16LE(1,10);fmt.writeUInt32LE(24000,12);fmt.writeUInt32LE(48000,16);fmt.writeUInt16LE(2,20);fmt.writeUInt16LE(16,22);
 const list=Buffer.alloc(34);list.write('LIST',0);list.writeUInt32LE(26,4);list.write('INFO',8);list.write('ISFT',12);list.writeUInt32LE(13,16);list.write('Lavf61.7.100',20,'ascii');
 const data=Buffer.alloc(108);data.write('data',0);data.writeUInt32LE(0xffffffff,4);
 const wav=Buffer.concat([Buffer.from('RIFF'),Buffer.from([255,255,255,255]),Buffer.from('WAVE'),fmt,list,data]);
 const normalized=normalizeWavForPlayback(wav);
 assert.ok(normalized);
 assert.equal(normalized.readUInt32LE(4),normalized.length-8);
 const dataOffset=normalized.indexOf(Buffer.from('data'));
 assert.ok(dataOffset>0);
 assert.equal(normalized.readUInt32LE(dataOffset+4),normalized.length-(dataOffset+8));
 assert.equal(normalized.readUInt32LE(24),24000);
});
test('WAV normalization rejects truncated or non-PCM audio',()=>{
 assert.equal(normalizeWavForPlayback(Buffer.alloc(20)),null);
 const wav=Buffer.alloc(64);wav.write('RIFF');wav.write('WAVE',8);wav.write('fmt ',12);wav.writeUInt32LE(16,16);wav.writeUInt16LE(3,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(20,40);
 assert.equal(normalizeWavForPlayback(wav),null);
});
