export async function api(route,options={}){const r=await fetch('/api'+route,{method:options.method||'GET',credentials:'include',headers:{'Content-Type':'application/json','X-CO-Request':'1',...options.headers},body:options.body===undefined?undefined:JSON.stringify(options.body)});const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||`Request failed (${r.status})`);return data;}
export const usd=n=>new Intl.NumberFormat('en-US',{notation:'compact',style:'currency',currency:'USD',maximumFractionDigits:1}).format(Number(n||0));
export const shortDate=x=>x?new Date(x).toLocaleDateString(undefined,{month:'short',day:'numeric'}):'';
export const shortTime=x=>x?new Date(x).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}):'';
export function toUint8(base64){const s=atob((base64+'='.repeat((4-base64.length%4)%4)).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(s,c=>c.charCodeAt(0));}
