import {requireUser} from '../../../../lib/profile.mjs';
import {checkOrigin} from '../../../../lib/validation.mjs';
import {activateWorldEngine} from '../../../../lib/engine-activation.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function POST(request){
 try{
  checkOrigin(request);
  await requireUser();
  return Response.json(await activateWorldEngine());
 }catch(error){
  const status=error.status||503;
  return Response.json({error:status===401?'Unauthorized':'Unable to activate world engine'},{status});
 }
}
