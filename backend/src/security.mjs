import crypto from 'node:crypto';
import { get, run, insert, id, now } from './db.mjs';
export function hashPassword(password) { const salt=crypto.randomBytes(16).toString('hex');return `scrypt:${salt}:${crypto.scryptSync(password,salt,64).toString('hex')}`; }
export function validPassword(password, hash) { try {const [,salt,expected]=hash.split(':'); const a=crypto.scryptSync(password,salt,64);const b=Buffer.from(expected,'hex');return a.length===b.length&&crypto.timingSafeEqual(a,b);}catch{return false;} }
export function tokenHash(t){return crypto.createHash('sha256').update(t).digest('hex');}
export function newSession(db,userId) { const token=crypto.randomBytes(32).toString('base64url'); insert(db,'sessions',{token_hash:tokenHash(token),user_id:userId,expires_at:new Date(Date.now()+30*86400000).toISOString()}); return token; }
export function auth(db,req,res,next){const match=req.headers.cookie?.match(/(?:^|;\s*)co_session=([^;]+)/);const raw=match?.[1];const session=raw&&get(db,'SELECT * FROM sessions WHERE token_hash=?',tokenHash(raw)); if(!session||session.expires_at<now()) return res.status(401).json({error:'Please sign in.'}); req.user=get(db,'SELECT id,name,email FROM users WHERE id=?',session.user_id); if(!req.user)return res.status(401).json({error:'Session expired.'}); req.sessionHash=session.token_hash;next();}
export function setCookie(res,token,req){const secure=(req.secure||req.headers['x-forwarded-proto']==='https')?'; Secure':'';res.setHeader('Set-Cookie',`co_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000${secure}`);}
export function clearCookie(res){res.setHeader('Set-Cookie','co_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');}
