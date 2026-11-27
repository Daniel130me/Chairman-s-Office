import test from 'node:test';
import assert from 'node:assert/strict';
import {audioMime,validAudio,voiceForContact,MAX_AUDIO_BYTES} from '../lib/voice-notes.mjs';
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
 assert.equal(voiceForContact('character-1',null,'Daniella','Chief of Staff'),'autumn');
 assert.ok(['autumn','diana','hannah'].includes(voiceForContact('character-2',null,'Nadia Mensah','Chief Operating Officer')));
 assert.ok(['austin','daniel','troy'].includes(voiceForContact('character-3',null,'Victor Sloane','CEO')));
 assert.equal(voiceForContact('character-1'),voiceForContact('character-1'));
});
