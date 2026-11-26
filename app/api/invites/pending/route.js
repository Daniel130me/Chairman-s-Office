import {requireUser} from '../../../../lib/profile.mjs';
import {pendingInvites} from '../../../../backend/src/world.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=10;

export async function GET(){
  try{
    const user=await requireUser();
    const invites=await pendingInvites(user.id);
    return Response.json({invites},{headers:{'Cache-Control':'private, no-store'}});
  }catch(error){
    const status=Number(error?.status)||401;
    return Response.json({error:status===401?'Please sign in.':'Unable to check incoming calls.'},{status,headers:{'Cache-Control':'private, no-store'}});
  }
}
