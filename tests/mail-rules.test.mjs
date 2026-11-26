import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeMailSubject,replyMailSubject} from '../lib/mail-rules.mjs';
test('email subject is required and line breaks are removed',()=>{
 assert.equal(normalizeMailSubject('  Board'+String.fromCharCode(10)+' Update  '),'Board Update');
 assert.throws(()=>normalizeMailSubject('  '));
});
test('reply subject is prefixed once',()=>{
 assert.equal(replyMailSubject('Acquisition review'),'Re: Acquisition review');
 assert.equal(replyMailSubject('re: Acquisition review'),'re: Acquisition review');
});
