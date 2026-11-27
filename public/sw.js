const CACHE='chairmans-office-v4';
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.add('/offline.html')).catch(()=>{}).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE&&k.startsWith('chairmans-office')).map(k=>caches.delete(k))))]));});
// Immutable assets only: do not cache private responses, HTML or reset links.
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method==='GET'&&url.origin===self.location.origin&&event.request.mode==='navigate'){
    event.respondWith(fetch(event.request).catch(async()=>await caches.match('/offline.html')));
    return;
  }
  if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith('/_next/static/'))return;
  event.respondWith(caches.open(CACHE).then(async cache=>{const cached=await cache.match(event.request);if(cached)return cached;const response=await fetch(event.request);if(response.ok)await cache.put(event.request,response.clone());return response;}));
});
self.addEventListener('push',event=>{let data={};try{data=event.data?.json()||{}}catch{}event.waitUntil(self.registration.showNotification(data.title||"Chairman's Office",{body:data.body||'Your office requests your attention.',icon:'/icon-192.png',badge:'/icon-192.png',tag:data.inviteId||data.eventId||'executive',renotify:!!data.inviteId,requireInteraction:!!data.inviteId,actions:data.inviteId?[{action:'open',title:'Open to answer'}]:[{action:'open',title:'View update'}],data:{inviteId:data.inviteId,eventId:data.eventId,target:data.target}}));});
const safeTarget=value=>['activity','phone','messages','calendar','board','finance','documents','deals','intelligence','news','employees','operations','investigations','approvals','family','travel','security','giving','inventory','loans','acquisitions'].includes(value)?value:'activity';
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{if(clients.length){await clients[0].focus();clients[0].postMessage({type:'EXECUTIVE_REFRESH',inviteId:event.notification.data?.inviteId,eventId:event.notification.data?.eventId,target:safeTarget(event.notification.data?.target)});return;}const id=event.notification.data?.inviteId,eventId=event.notification.data?.eventId,target=safeTarget(event.notification.data?.target);return self.clients.openWindow(id?'/?invite='+encodeURIComponent(id):eventId?'/?event='+encodeURIComponent(eventId)+'&app='+encodeURIComponent(target||'activity'):'/');}));});
