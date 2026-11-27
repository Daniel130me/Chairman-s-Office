import {handleVapiTools} from '../../../../lib/vapi-tools.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=30;

export async function POST(request){
  return handleVapiTools(request);
}
