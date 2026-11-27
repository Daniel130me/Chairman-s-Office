const CACHE='chairmans-office-v5';
const PUBLIC_SHELL=['/offline.html','/icon-192.png','/icon-512.png','/apple-touch-icon.png','/manifest.webmanifest'];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const safeId=value=>typeof value==='string'&&UUID.test(value)?value:null;
const safeTarget=value=>['activity','phone','messages','calendar','board','finance','documents','deals','intelligence','news','employees','operations','investigations','approvals','security','family','travel','giving','inventory','loans','acquisitions','mail','contacts','companies','assistant','settings'].includes(value)?value:'activity';
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(PUBLIC_SHELL)));});
self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE_UPDATE'&&event.source?.url&&new URL(event.source.url).origin===self.location.origin)event.waitUntil(self.skipWaiting());});
self.addEventListener('activate',event=>{event.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE&&k.startsWith('chairmans-office-')).map(k=>caches.delete(k))))]));});
const offline=async()=>{const cache=await caches.open(CACHE);return await cache.match('/offline.html')||new Response('Your office is temporarily unreachable. Private records are not stored in this offline page. Reconnect to see the latest activity.',{status:503,headers:{'Content-Type':'text/html; charset=utf-8'}});};
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==self.location.origin)return;
 // Private API, auth, media and HTML are always network-only.
 if(event.request.mode==='navigate'){
  event.respondWith((async()=>{if(self.navigator.onLine===false)return offline();try{const response=await fetch(event.request.url,{cache:'no-store',credentials:'same-origin',headers:event.request.headers,redirect:'follow'});return [502,503,504].includes(response.status)?offline():response;}catch{return offline();}})());return;
 }
 if(!url.pathname.startsWith('/_next/static/')&&!PUBLIC_SHELL.includes(url.pathname))return;
 event.respondWith(caches.open(CACHE).then(async cache=>{const cached=await cache.match(event.request);if(cached)return cached;const response=await fetch(event.request);if(response.ok&&response.type==='basic'&&!/private|no-store/i.test(response.headers.get('Cache-Control')||''))try{await cache.put(event.request,response.clone());}catch{}return response;}).catch(()=>fetch(event.request)));
});
self.addEventListener('push',event=>{
 let data={};try{data=event.data?.json()||{};}catch{}
 const inviteId=safeId(data.inviteId),eventId=safeId(data.eventId),target=safeTarget(data.target);
 const expired=inviteId&&Number.isFinite(data.expiresAt)&&Date.now()>=data.expiresAt;
 // User-visible push is required by browsers; expired calls become generic activity notices.
 const title=inviteId&&!expired?'Incoming executive call':"Chairman's Office";
 const body=inviteId&&!expired?'Incoming business call. Open your office to answer.':expired?'A call invitation expired. Check your activity.':'Your office has an update. Open the app to review it.';
 event.waitUntil(self.registration.showNotification(title,{body,icon:'/icon-192.png',badge:'/icon-192.png',tag:inviteId||eventId||'executive',renotify:!!inviteId&&!expired,requireInteraction:!!inviteId&&!expired,actions:[{action:'open',title:inviteId&&!expired?'Open to answer':'View update'}],data:{inviteId:expired?null:inviteId,eventId,target:expired?'activity':target}}));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();const data=event.notification.data||{},inviteId=safeId(data.inviteId),eventId=safeId(data.eventId),target=safeTarget(data.target);
 const url=new URL('/',self.location.origin);if(inviteId)url.searchParams.set('invite',inviteId);else{if(eventId)url.searchParams.set('event',eventId);url.searchParams.set('app',target);}
 event.waitUntil((async()=>{const clients=await self.clients.matchAll({type:'window',includeUncontrolled:true});const client=clients.find(c=>{try{return new URL(c.url).origin===self.location.origin&&new URL(c.url).pathname==='/';}catch{return false;}});
 if(client){try{await client.focus();client.postMessage({type:'EXECUTIVE_REFRESH',inviteId,eventId,target});return;}catch{}}
 await self.clients.openWindow(url.href);})());
});
