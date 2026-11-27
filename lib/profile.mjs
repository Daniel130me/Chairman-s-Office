import { one, uid } from '../backend/src/db.mjs';
import { getAuth } from './auth/server.js';
import { HttpError } from './validation.mjs';

// Keep the old application UUIDs; never link accounts by email alone.
export async function requireUser() {
  const result=await getAuth().getSession();
  const account=result.data?.user;
  if(!account?.id) {
    if(result.error && ![401,403].includes(Number(result.error.status)))throw new HttpError(503,'Authentication temporarily unavailable.');
    throw new HttpError(401,'Please sign in.');
  }
  if(!account.emailVerified)throw new HttpError(403,'Verify your email before entering your office.');
  const found=await one('SELECT id,name,email FROM users WHERE auth_user_id=$1',[account.id]);
  if(found)return found;
  const email=String(account.email||'').trim().toLowerCase();
  if(!email)throw new HttpError(403,'Your account needs a valid email.');
  const created=await one("INSERT INTO users(id,name,email,pass_hash,auth_user_id) VALUES($1,$2,$3,'managed-auth',$4) ON CONFLICT DO NOTHING RETURNING id,name,email",[uid(),String(account.name||'Chairman').slice(0,80),email,account.id]);
  if(created)return created;
  const concurrent=await one('SELECT id,name,email FROM users WHERE auth_user_id=$1',[account.id]);
  if(concurrent)return concurrent;
  throw new HttpError(409,'Existing executive account needs administrator-assisted migration. No records changed.');
}
