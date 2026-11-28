import test from 'node:test';
import assert from 'node:assert/strict';
import {extractTimeCandidates,normaliseCalendarTimezone,parseMeetingTime,isMeetingAcceptance} from '../lib/calendar-intents.mjs';
const now=new Date('2026-11-28T11:00:00.000Z');
test('converts the agreed Tuesday CET slot into the correct UTC instant',()=>{
 const slot=parseMeetingTime('Tuesday at 10:00 AM CET','Next week Tuesday or Wednesday was proposed.','Africa/Lagos',now);
 assert.equal(slot.startAt,'2026-12-01T09:00:00.000Z');
 assert.equal(slot.timezoneLabel,'CET');
});
test('supports WAT, relative dates and explicit dates',()=>{
 assert.equal(parseMeetingTime('tomorrow at 10am WAT','','Africa/Lagos',now).startAt,'2026-11-29T09:00:00.000Z');
 assert.equal(parseMeetingTime('1 December 2026 at 10:00 CET','','Africa/Lagos',now).startAt,'2026-12-01T09:00:00.000Z');
});
test('refuses to choose among several proposed times or dates',()=>{
 assert.equal(extractTimeCandidates('Tuesday at 10am or Wednesday at 2pm').length,2);
 assert.equal(parseMeetingTime('10am','Tuesday or Wednesday','Africa/Lagos',now).error,'ambiguous-date');
 assert.equal(parseMeetingTime('Tuesday 10am or Wednesday 2pm','','Africa/Lagos',now).error,'ambiguous-time');
});
test('rejects past times and invalid timezones',()=>{
 assert.equal(parseMeetingTime('2026-11-27 at 10am','','Africa/Lagos',now).error,'past-date');
 assert.equal(parseMeetingTime('tomorrow at 10am','', 'not/a-zone',now).error,'invalid-timezone');
});
test('does not treat a rejected time as acceptance',()=>{
 assert.equal(isMeetingAcceptance('Tuesday at 10am works for me.'),true);
 assert.equal(isMeetingAcceptance('Tuesday at 10am will not work.'),false);
 assert.equal(normaliseCalendarTimezone('CET').timezone,'Etc/GMT-1');
});
