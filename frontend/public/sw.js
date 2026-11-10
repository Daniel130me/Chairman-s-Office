self.addEventListener('install', e=>self.skipWaiting());
self.addEventListener('activate', e=>e.waitUntil(self.clients.claim()));
self.addEventListener('push', e=>{let d={};try{d=e.data?.json()||{}}catch{d={title:'Executive Office',body:e.data?.text()||''}};
 e.waitUntil(self.registration.showNotification(d.title||'Chairman\'s Office',{body:d.body||'Your attention is requested.',icon:'/icon.svg',badge:'/icon.svg',tag:d.inviteId||'office',renotify:true,data:{url:d.url||'/'},actions:[{action:'open',title:'View call'}]}));});
self.addEventListener('notificationclick',e=>{e.notification.close();const url=new URL(e.notification.data?.url||'/',self.location.origin).href;e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>{const open=clients.find(c=>new URL(c.url).origin===new URL(url).origin);if(open){open.navigate(url);return open.focus();}return self.clients.openWindow(url);}));});
