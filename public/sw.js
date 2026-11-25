const CACHE='chairmans-office-v2';
self.addEventListener('install',event=>{event.waitUntil(self.skipWaiting());});
self.addEventListener('activate',event=>{event.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE&&k.startsWith('chairmans-office')).map(k=>caches.delete(k))))]));});
// Immutable assets only: do not cache private responses, HTML or reset links.
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith('/_next/static/'))return;
  event.respondWith(caches.open(CACHE).then(async cache=>{const cached=await cache.match(event.request);if(cached)return cached;const response=await fetch(event.request);if(response.ok)await cache.put(event.request,response.clone());return response;}));
});
self.addEventListener('push',event=>{let data={};try{data=event.data?.json()||{}}catch{}event.waitUntil(self.registration.showNotification(data.title||"Chairman's Office",{body:data.body||'Your office requests your attention.',icon:'/icon-192.png',badge:'/icon-192.png',tag:data.inviteId||'executive',renotify:true,data:{inviteId:data.inviteId}}));});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{if(clients.length){await clients[0].focus();clients[0].postMessage({type:'EXECUTIVE_REFRESH'});return;}return self.clients.openWindow('/');}));});
