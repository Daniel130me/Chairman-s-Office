import test from 'node:test';
import assert from 'node:assert/strict';
import {describeVapiFailure,formatVapiStage} from '../lib/vapi-client-errors.mjs';
test('microphone preflight failure gives a precise permission instruction',()=>{
 const result=describeVapiFailure({type:'call-start-failed',stage:'microphone-preflight',error:'microphone-preflight-NotAllowedError'});
 assert.match(result.userMessage,/Microphone access is blocked/i);
 assert.equal(result.stage,'microphone-preflight');
 assert.equal(result.recoverable,false);
});
test('assistant and public-key configuration errors are distinguished',()=>{
 assert.match(describeVapiFailure({type:'call-start-failed',stage:'web-call-creation',error:'assistant-not-found'}).userMessage,/assistant ID/i);
 assert.match(describeVapiFailure({type:'error',error:{message:'401 unauthorized invalid public key'}}).userMessage,/public API key/i);
});
test('network join failures explain that audio did not connect',()=>{
 const result=describeVapiFailure({type:'connection-timeout',stage:'daily-call-join',error:'Vapi did not confirm a live audio connection.'});
 assert.match(result.userMessage,/internet connection/i);
 assert.equal(formatVapiStage('daily-call-join'),'Connecting live audio');
});
test('non-fatal audio observer errors do not terminate a connected call',()=>{
 const result=describeVapiFailure({type:'audio-processing-setup-error',stage:'audio-processing-setup',error:'Local audio observer unavailable'});
 assert.equal(result.recoverable,true);
 assert.match(result.userMessage,/non-fatal/i);
});
test('diagnostic summaries redact credentials and URLs',()=>{
 const result=describeVapiFailure({type:'error',stage:'web-call-creation',error:'Authorization: Bearer abc123 https://secret.example/token'});
 assert.doesNotMatch(result.summary,/abc123|secret\.example/);
});
