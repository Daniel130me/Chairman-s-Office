import test from 'node:test';
import assert from 'node:assert/strict';
import {meetingProposalChoices} from '../frontend/src/calendar-proposals.mjs';
import {parseMeetingTime} from '../lib/calendar-intents.mjs';
const now=new Date('2026-11-28T11:00:00.000Z');
const proposal='Thank you for the confirmation. I’m available next week on **Tuesday 10 am CET** or **Wednesday 2 pm CET**—whichever suits your schedule best.';
test('extracts each offered slot separately despite Markdown and narrow spaces',()=>{
 const choices=meetingProposalChoices(proposal);
 assert.deepEqual(choices.map(choice=>choice.label),['Tuesday · 10 AM CET','Wednesday · 2 PM CET']);
 assert.deepEqual(choices.map(choice=>choice.optionText),['Tuesday 10 AM CET','Wednesday 2 PM CET']);
});
test('selected option resolves against the original next-week context, not the other alternative',()=>{
 const choices=meetingProposalChoices(proposal);
 assert.equal(parseMeetingTime(choices[0].optionText,proposal,'Africa/Lagos',now).startAt,'2026-12-01T09:00:00.000Z');
 assert.equal(parseMeetingTime(choices[1].optionText,proposal,'Africa/Lagos',now).startAt,'2026-12-02T13:00:00.000Z');
});
test('does not turn ordinary times or ambiguous time lists into meeting choices',()=>{
 assert.deepEqual(meetingProposalChoices('I will call at 10am tomorrow.'),[]);
 assert.equal(meetingProposalChoices('Tuesday 10am CET or Wednesday 2pm CET').length,2);
});
