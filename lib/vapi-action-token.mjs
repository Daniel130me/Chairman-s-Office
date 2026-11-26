"use step";

import {createHmac,timingSafeEqual} from 'node:crypto';

const TOKEN_LIFETIME_MS=2*60*60*1000;

export function createVapiActionToken({userId,callId,sourceContactId}){
  const secret=process.env.CRON_SECRET||process.env.VAPI_TOOL_SECRET||'';
  if(secret.length<32)throw new Error('Voice actions are not configured.');
  const claims={userId,callId,sourceContactId,expiresAt:Date.now()+TOKEN_LIFETIME_MS};
  const payload=Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature=createHmac('sha256',secret).update(payload).digest('base64url');
  return payload+'.'+signature;
}

export function verifyVapiActionToken(token){
  const secret=process.env.CRON_SECRET||process.env.VAPI_TOOL_SECRET||'';
  if(secret.length<32)throw new Error('Voice actions are not configured.');
  if(typeof token!=='string'||token.length>2048)throw new Error('Invalid voice action token.');

  const parts=token.split('.');
  if(parts.length!==2)throw new Error('Invalid voice action token.');
  const [payload,signature]=parts;
  const expected=createHmac('sha256',secret).update(payload).digest('base64url');
  const supplied=Buffer.from(signature);
  const wanted=Buffer.from(expected);
  if(supplied.length!==wanted.length||!timingSafeEqual(supplied,wanted)){
    throw new Error('Invalid voice action token.');
  }

  let claims;
  try{claims=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));}catch{
    throw new Error('Invalid voice action token.');
  }
  if(!claims.userId||!claims.callId||!claims.sourceContactId||!Number.isFinite(claims.expiresAt)||Date.now()>claims.expiresAt){
    throw new Error('This voice action has expired. Please start a new call.');
  }
  return claims;
}
