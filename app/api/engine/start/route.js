import {timingSafeEqual} from 'node:crypto';
import {activateWorldEngine} from '../../../../lib/engine-activation.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
function authorized(request){
  const secret=process.env.CRON_SECRET||'';
  const a=Buffer.from('Bearer '+secret),b=Buffer.from(request.headers.get('authorization')||'');
  return secret.length>=32&&a.length===b.length&&timingSafeEqual(a,b);
}
export async function GET(request){
  if(!authorized(request))return Response.json({error:'Unauthorized'},{status:401});
  try{return Response.json(await activateWorldEngine());}
  catch{return Response.json({error:'Unable to start world engine'},{status:503});}
}
export const POST=GET;
