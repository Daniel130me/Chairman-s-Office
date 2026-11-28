import test from 'node:test';
import assert from 'node:assert/strict';
import {acceptedMeetingSlot} from '../lib/colleague-calls.mjs';
import {isMeetingProposalText} from '../lib/calendar-actions.mjs';
const proposal={chairman_preferred_start_at:'2026-12-01T09:00:00.000Z',chairman_preferred_timezone:'Etc/GMT-1',chairman_preferred_timezone_label:'CET',proposal_text:'Omar offered tomorrow morning.'};
test('only creates an invitation when the recipient accepts the Chairman-selected slot and the caller confirms it',()=>{
 const turns=[
  {speaker:'caller',body:'The Chairman prefers Tuesday at 10am CET. Can you confirm?'},
  {speaker:'recipient',body:'Tuesday at 10am CET works for me.'},
  {speaker:'caller',body:"Excellent. I'll confirm Tuesday at 10am CET."}
 ];
 assert.equal(acceptedMeetingSlot(turns,'The Chairman selected 2026-12-01T09:00:00.000Z CET.',proposal,'Africa/Lagos').startAt,'2026-12-01T09:00:00.000Z');
});
test('does not book an alternative time or a slot without Chairman approval',()=>{
 const alternative=[
  {speaker:'recipient',body:'Wednesday at 2pm CET works for me.'},
  {speaker:'caller',body:"I'll confirm Wednesday at 2pm CET."}
 ];
 assert.equal(acceptedMeetingSlot(alternative,'',proposal,'Africa/Lagos'),null);
 assert.equal(acceptedMeetingSlot([{speaker:'recipient',body:'Tuesday at 10am CET works for me.'},{speaker:'caller',body:"I'll confirm Tuesday at 10am CET."}],'',{},'Africa/Lagos'),null);
});
test('recognises Omar-style meeting availability messages as proposals',()=>{
 assert.equal(isMeetingProposalText('I can make time later this afternoon or first thing tomorrow morning. We need to act quickly before those Berlin offers turn into signed contracts. Let me know what works best for your schedule and I’ll make sure my calendar is clear.'),true);
 assert.equal(isMeetingProposalText('The quarterly report is attached for your review.'),false);
});
