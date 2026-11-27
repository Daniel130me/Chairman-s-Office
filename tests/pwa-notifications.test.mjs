import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const worker=readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
const uuid='12345678-1234-1234-1234-123456789abc';
function harness(){
 const handlers={},notifications=[],opened=[];
 const self={location:{origin:'https://office.example'},registration:{showNotification:async(title,options)=>notifications.push({title,...options})},clients:{matchAll:async()=>[],openWindow:async url=>opened.push(url)},addEventListener:(name,fn)=>handlers[name]=fn};
 runInNewContext(worker,{self,URL,Date,Number,setTimeout,clearTimeout,MessageChannel});
 async function dispatch(type,event){let promise;handlers[type]({...event,waitUntil:p=>{promise=p;}});await promise;}
 return {notifications,opened,dispatch};
}
test('worker renders malformed push as a generic private alert',async()=>{const h=harness();await h.dispatch('push',{data:{json:()=>['invalid']}});assert.equal(h.notifications[0].title,"Chairman's Office");assert.equal(h.notifications[0].data.inviteId,null);});
test('worker never routes an expired notification into a call',async()=>{const h=harness();await h.dispatch('push',{data:{json:()=>({inviteId:uuid,expiresAt:Date.now()-100,target:'phone'})}});assert.equal(h.notifications[0].data.inviteId,null);await h.dispatch('notificationclick',{notification:{close(){},data:{inviteId:uuid,expiresAt:Date.now()-1,target:'phone'}}});assert.equal(new URL(h.opened[0]).searchParams.get('invite'),null);assert.equal(new URL(h.opened[0]).searchParams.get('app'),'activity');});
test('a live call notification preserves a valid invite deep link',async()=>{const h=harness();await h.dispatch('push',{data:{json:()=>({inviteId:uuid,expiresAt:Date.now()+60000,target:'phone'})}});assert.equal(h.notifications[0].title,'Incoming executive call');await h.dispatch('notificationclick',{notification:{close(){},data:h.notifications[0].data}});assert.equal(new URL(h.opened[0]).searchParams.get('invite'),uuid);});
