export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function uuid(value, label='ID') {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new HttpError(400, 'Invalid '+label);
  return value;
}
export function clock(value) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new HttpError(400, 'Invalid time');
  return value;
}
export function pushEndpoint(value) {
  let url;
  try { url=new URL(value); } catch { throw new HttpError(400,'Invalid push endpoint'); }
  const hosts=['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com','wns.windows.com','notify.windows.com'];
  if(url.protocol!=='https:'||url.port||url.username||url.password||!hosts.some(h=>url.hostname===h||(h.endsWith('windows.com')&&url.hostname.endsWith('.'+h)))) throw new HttpError(400,'Unsupported browser push endpoint');
  return url.href;
}
export async function readBody(request) {
  if(Number(request.headers.get('content-length')||0)>98304) throw new HttpError(413,'Request too large');
  const reader=request.body?.getReader();
  if(!reader)return {};
  let size=0;const chunks=[];
  try{
    for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>98304){await reader.cancel();throw new HttpError(413,'Request too large');}chunks.push(value);}
    const body=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');
    if(!body||Array.isArray(body)||typeof body!=='object')throw Error('object required');
    return body;
  }catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,'Invalid JSON request');}
}
export function checkOrigin(request) {
  if(request.headers.get('x-co-request')!=='1')throw new HttpError(403,'Invalid request header');
  const origin=request.headers.get('origin');
  if(origin&&origin!==(process.env.APP_ORIGIN||new URL(request.url).origin))throw new HttpError(403,'Origin not allowed');
}
