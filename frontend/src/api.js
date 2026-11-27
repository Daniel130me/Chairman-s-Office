export class ApiError extends Error{constructor(message,status=0){super(message);this.name='ApiError';this.status=status;}}
export async function api(route,options={}){
 const method=options.method||'GET';if(typeof navigator!=='undefined'&&navigator.onLine===false)throw new ApiError('Offline. Reconnect before sending requests.');
 let r;try{r=await fetch('/api'+route,{method,credentials:'include',cache:'no-store',signal:options.signal,headers:{'Content-Type':'application/json','X-CO-Request':'1',...options.headers},body:options.body===undefined?undefined:JSON.stringify(options.body)});}catch(e){if(e.name==='AbortError')throw e;throw new ApiError(method==='GET'?'Unable to connect to your office. Reconnect and retry.':'Connection interrupted. The outcome is unknown; check the latest records before retrying.');}
 const data=await r.json().catch(()=>null);if(!r.ok)throw new ApiError(data?.error||'Request failed ('+r.status+')',r.status);if(!data)throw new ApiError('Unexpected response from your office.',r.status);return data;
}
export const usd=n=>new Intl.NumberFormat('en-US',{notation:'compact',style:'currency',currency:'USD',maximumFractionDigits:1}).format(Number(n||0));
export const shortDate=x=>x?new Date(x).toLocaleDateString(undefined,{month:'short',day:'numeric'}):'';
export const shortTime=x=>x?new Date(x).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}):'';
export function toUint8(base64){const s=atob((base64+'='.repeat((4-base64.length%4)%4)).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from(s,c=>c.charCodeAt(0));}
