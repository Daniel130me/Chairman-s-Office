import test from 'node:test';
import assert from 'node:assert/strict';
import {notificationForEvent,pushEventKinds} from '../lib/event-notifications.mjs';
test('important in-world developments have privacy-safe push notifications',()=>{
 for(const kind of ['colleague-message','news-digest','missed-call-message','approval-requested','investigation-opened','competitor-move','task-completed','travel-booking-confirmed'])assert.ok(notificationForEvent(kind));
 assert.equal(notificationForEvent('financial-transaction'),null);
});
test('notification text does not expose confidential event details',()=>{
 const item=notificationForEvent('investigation-opened');
 assert.equal(item.title,'Security or compliance alert');
 assert.equal(item.body,'A new investigation needs your attention.');
 assert.ok(pushEventKinds.includes('approval-requested'));
});

test('push notification targets open the relevant phone application',()=>{
 assert.equal(notificationForEvent('news-digest').target,'news');
 assert.equal(notificationForEvent('missed-call-message').target,'messages');
 assert.equal(notificationForEvent('approval-requested').target,'approvals');
});
