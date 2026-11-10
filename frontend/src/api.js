export async function api(route,options={}){
 const method=options.method||'GET';
 const r=await fetch('/api'+route,{method,credentials:'include',headers:{'Content-Type':'application/json','X-CO-Request':'1',...options.headers},...options,body:options.body===undefined?undefined:JSON.stringify(options.body)});
 const data=await r.json().catch(()=>({}));
 if(!r.ok)throw new Error(data.error||`Request failed (${r.status})`);
 return data;
}
export const money=n=>n===undefined||n===null?'—':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0,notation:'compact'}).format(n);
export const when=d=>{try{return new Date(d).toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}catch{return ''}};
export const dateLabel=d=>new Date(d).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric'});
export function urlBase64ToUint8Array(base64String){const padding='='.repeat((4-base64String.length%4)%4);const base64=(base64String+padding).replace(/-/g,'+').replace(/_/g,'/');const raw=atob(base64);return Uint8Array.from([...raw].map(x=>x.charCodeAt(0)));}
