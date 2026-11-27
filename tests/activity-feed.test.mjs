import test from 'node:test';
import assert from 'node:assert/strict';
import {buildActivityFeed} from '../frontend/src/activity-feed.js';

const user={id:'chairman-1',name:'Oluwagbenga Kosoko'};
const state={
 contacts:[{id:'amara',name:'Amara Okafor'},{id:'cfo',name:'Daniel Mercer'}],
 events:[{id:'event-away',kind:'competitor-move',title:'Competitor entered a new market',body:'The rival announced an expansion.',created_at:'2026-11-26T08:00:00Z',contact_id:'cfo'}],
 messages:[
  {id:'message-out',contact_id:'amara',direction:'outgoing',channel:'chat',body:'Please ask the CFO to call me.',created_at:'2026-11-26T08:10:00Z'},
  {id:'message-in',contact_id:'cfo',direction:'incoming',channel:'chat',body:'I found a cash-flow discrepancy.',created_at:'2026-11-26T08:20:00Z',read_at:null}
 ],
 worldConversationMessages:[{id:'group-1',conversation_id:'conversation-1',sender_name:'Daniel Mercer',body:'I have started reconciling the transactions.',created_at:'2026-11-26T08:25:00Z'}],
 calls:[{id:'call-1',contact_id:'cfo',invite_id:'invite-1',started_at:'2026-11-26T08:30:00Z',status:'missed',summary:'Cash-flow discrepancy'}],
 invites:[{id:'invite-1',contact_id:'cfo',status:'missed',kind:'call',subject:'Urgent finance call',preview:'Please call back.',due_at:'2026-11-26T08:30:00Z'}],
 meetings:[{id:'meeting-1',title:'Executive finance review',status:'completed',start_at:'2026-11-26T08:40:00Z',created_at:'2026-11-26T08:35:00Z',attendees:['chairman-1','cfo'],minutes:'The CFO will provide a reconciled report.'}],
 meeting_turns:[{id:'turn-1',meeting_id:'meeting-1',speaker:'Oluwagbenga Kosoko',message:'Proceed with the reconciliation.',created_at:'2026-11-26T08:42:00Z'}],
 decisions:[{id:'decision-1',thread_id:'thread-1',content:'Reconcile the two disputed transactions.',created_at:'2026-11-26T08:45:00Z'}],
 operations:{
  auditLog:[{id:'audit-1',actor_type:'chairman',actor_name:'Oluwagbenga Kosoko',action:'approved',entity_type:'purchase_order',reason:'Approved after review.',created_at:'2026-11-26T08:50:00Z'}],
  investigations:[{id:'case-1',title:'Cash-flow discrepancy',status:'open',severity:'high',allegation:'Two transactions do not reconcile.',opened_at:'2026-11-26T08:55:00Z'}]
 },
 actionRequests:[{id:'approval-1',title:'Emergency audit access',status:'pending',reason:'The CFO needs access to supporting records.',requester_name:'Daniel Mercer',created_at:'2026-11-26T09:00:00Z'}],
 securityIncidents:[{id:'incident-1',title:'Suspicious payment instruction',severity:'critical',status:'reported',description:'A supplier reported an unexpected change request.',created_at:'2026-11-26T09:05:00Z'}],
 trips:[{id:'trip-1',title:'Lagos to London',origin:'Lagos',destination:'London',status:'planned',created_at:'2026-11-26T07:55:00Z'}],
 economy:{journal:[{id:'journal-1',company_name:'Chairman Group',kind:'expense',description:'Legal review',amount:'2500',actor:'Julian Hart',effective_at:'2026-11-26T09:10:00Z'}],tasks:[{id:'task-1',title:'Reconcile transactions',detail:'Match bank and ledger records.',status:'assigned',assignee_name:'Daniel Mercer',created_at:'2026-11-26T09:15:00Z'}]}
};

test('builds one chronological feed across personal, office and business records',()=>{
 const feed=buildActivityFeed(state,user);
 assert.ok(feed.some(item=>item.id==='event-away'));
 assert.ok(feed.some(item=>item.id==='message:message-out'));
 assert.ok(feed.some(item=>item.id==='group-message:group-1'));
 assert.ok(feed.some(item=>item.id==='meeting:meeting-1'));
 assert.ok(feed.some(item=>item.id==='audit:audit-1'));
 assert.ok(feed.some(item=>item.id==='ledger:journal-1'));
 assert.ok(feed.some(item=>item.id==='action-request:approval-1'));
 assert.ok(feed.some(item=>item.id==='security-incident:incident-1'));
 assert.ok(feed.some(item=>item.id==='trip:trip-1'));
 for(let i=1;i<feed.length;i++)assert.ok(new Date(feed[i-1].timestamp)>=new Date(feed[i].timestamp));
});

test('distinguishes chairman participation from activity that happened in the office',()=>{
 const feed=buildActivityFeed(state,user);
 assert.equal(feed.find(item=>item.id==='message:message-out').participation,'you');
 assert.equal(feed.find(item=>item.id==='message:message-in').participation,'addressed');
 assert.equal(feed.find(item=>item.id==='meeting-turn:turn-1').participation,'you');
 assert.equal(feed.find(item=>item.id==='event-away').participation,'away');
 assert.equal(feed.find(item=>item.id==='audit:audit-1').participation,'you');
});

test('flags missed contact, unread messages, pending approvals and active security incidents',()=>{
 const feed=buildActivityFeed(state,user);
 assert.equal(feed.find(item=>item.id==='message:message-in').requiresAttention,true);
 assert.equal(feed.find(item=>item.id==='call:call-1').requiresAttention,true);
 assert.equal(feed.find(item=>item.id==='action-request:approval-1').requiresAttention,true);
 assert.equal(feed.find(item=>item.id==='security-incident:incident-1').requiresAttention,true);
});

test('merges exact cross-source duplicates but preserves repeated messages',()=>{
 const duplicateState={
  events:[{id:'event-payment',kind:'financial-transaction',title:'Chairman Group · payment',body:'Invoice paid · Finance',created_at:'2026-11-26T10:00:00Z'}],
  economy:{journal:[{id:'ledger-payment',company_name:'Chairman Group',kind:'payment',description:'Invoice paid',effective_at:'2026-11-26T10:00:00Z'}]},
  messages:[
   {id:'same-1',contact_id:'amara',direction:'outgoing',body:'Thank you.',created_at:'2026-11-26T10:05:00Z'},
   {id:'same-2',contact_id:'amara',direction:'outgoing',body:'Thank you.',created_at:'2026-11-26T10:05:00Z'}
  ],
  contacts:[{id:'amara',name:'Amara Okafor'}]
 };
 const feed=buildActivityFeed(duplicateState,user);
 assert.equal(feed.filter(item=>item.title==='Chairman Group · payment').length,1);
 assert.equal(feed.filter(item=>item.body==='Thank you.').length,2);
});
