import crypto from 'node:crypto';
import {one,sql,uid} from './db.mjs';
export function hashPassword(p){const salt=crypto.randomBytes(16).toString('hex');return `scrypt:${salt}:${crypto.scryptSync(p,salt,64).toString('hex')}`;}
export function validPassword(p,h){try{const [,salt,hash]=h.split(':');const a=crypto.scryptSync(p,salt,64),b=Buffer.from(hash,'hex');return a.length===b.length&&crypto.timingSafeEqual(a,b);}catch{return false;}}
const digest=t=>crypto.createHash('sha256').update(t).digest('hex');
export async function startSession(res,userId,req){const token=crypto.randomBytes(32).toString('base64url');await sql('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval \'30 days\')',[digest(token),userId]);res.cookie('co_session',token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',maxAge:30*86400000,path:'/'});}
export async function authenticate(req,res,next){try{const token=req.cookies?.co_session||req.headers.cookie?.match(/(?:^|;\s*)co_session=([^;]+)/)?.[1];if(!token)return res.status(401).json({error:'Please sign in.'});const u=await one('SELECT u.id,u.name,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()',[digest(token)]);if(!u)return res.status(401).json({error:'Session expired.'});req.user=u;req.sessionHash=digest(token);next();}catch(e){next(e);}}
export async function endSession(req){if(req.sessionHash)await sql('DELETE FROM sessions WHERE token_hash=$1',[req.sessionHash]);}
