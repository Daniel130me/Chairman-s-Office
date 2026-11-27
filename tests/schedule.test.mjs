import test from 'node:test';
import assert from 'node:assert/strict';
import {localTime,isQuiet,inWindow,intervalSeconds} from '../lib/schedule.mjs';
import {uuid,clock,pushEndpoint,readBody,checkOrigin} from '../lib/validation.mjs';
test('Lagos time and date rollover',()=>assert.deepEqual(localTime('Africa/Lagos',new Date('2026-11-25T23:30:00Z')),{day:'2026-11-26',minute:30}));
test('quiet hours cross midnight',()=>{assert.equal(isQuiet(1380,'22:00','07:00'),true);assert.equal(isQuiet(360,'22:00','07:00'),true);assert.equal(isQuiet(420,'22:00','07:00'),false);});
test('briefing window crosses midnight',()=>{assert.equal(inWindow(20,'23:45'),true);assert.equal(inWindow(60,'23:45'),false);});
test('interval rejects invalid values',()=>{assert.equal(intervalSeconds('0'),120);assert.equal(intervalSeconds('600'),600);assert.equal(intervalSeconds('oops'),120);});
test('malformed UUID and clock are rejected',()=>{assert.throws(()=>uuid('abc'));assert.throws(()=>clock('24:00'));assert.equal(clock('23:59'),'23:59');});
test('push endpoints cannot target arbitrary hosts',()=>{for(const url of ['http://fcm.googleapis.com','https://localhost','https://169.254.169.254','https://fcm.googleapis.com.evil.test','https://user@fcm.googleapis.com','https://fcm.googleapis.com:444'])assert.throws(()=>pushEndpoint(url));assert.equal(pushEndpoint('https://fcm.googleapis.com/fcm/send/token'),'https://fcm.googleapis.com/fcm/send/token');});
test('mutations require same origin and explicit request header',()=>{assert.throws(()=>checkOrigin(new Request('https://example.com/api/world',{method:'POST'})));assert.throws(()=>checkOrigin(new Request('https://example.com/api/world',{method:'POST',headers:{origin:'https://evil.example','x-co-request':'1'}})));assert.doesNotThrow(()=>checkOrigin(new Request('https://example.com/api/world',{method:'POST',headers:{origin:'https://example.com','x-co-request':'1'}})));});
test('JSON parser rejects arrays, malformed JSON and excessive body',async()=>{for(const body of ['[]','null','not JSON','{"data":"'+ 'x'.repeat(100000)+'"}'])await assert.rejects(()=>readBody(new Request('https://example.com',{method:'POST',body})));assert.deepEqual(await readBody(new Request('https://example.com',{method:'POST',body:'{"a":1}'})),{a:1});});

import {checkPrivateAudioRequest} from '../lib/validation.mjs';
test('private audio rejects cross-site browser embeds before paid synthesis',()=>{
 for(const site of ['cross-site','same-site'])assert.throws(()=>checkPrivateAudioRequest(new Request('https://office.example/api/meeting-voice/test/0',{headers:{'Sec-Fetch-Site':site}})),/Cross-origin/);
 assert.throws(()=>checkPrivateAudioRequest(new Request('https://office.example/api/meeting-voice/test/0',{headers:{origin:'https://other.example'}})),/Cross-origin/);
 assert.doesNotThrow(()=>checkPrivateAudioRequest(new Request('https://office.example/api/meeting-voice/test/0',{headers:{'Sec-Fetch-Site':'same-origin'}})));
 assert.doesNotThrow(()=>checkPrivateAudioRequest(new Request('https://office.example/api/meeting-voice/test/0')));
});
