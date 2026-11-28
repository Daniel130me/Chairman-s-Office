import {AsyncLocalStorage} from 'node:async_hooks';
import {sql,transaction} from '../backend/src/db.mjs';
import {EconomyError} from './economy-rules.mjs';
import {validateAutonomyPolicy} from './living-agency-rules.mjs';
const scope=new AsyncLocalStorage();
export function withAutonomousScope(userId,stage,fn){return scope.run({userId,stage},fn);}
export async function reserveProviderAttempt(provider,inputCharacters){
 const ctx=scope.getStore();if(!ctx)return null;
 return transaction(async q=>{
  const [world]=await q('SELECT id FROM worlds WHERE user_id=$1 FOR UPDATE',[ctx.userId]);if(!world)throw Error('Autonomous world unavailable');
  const [policy]=await q('SELECT * FROM autonomous_ai_policy WHERE user_id=$1',[ctx.userId]);
  const [used]=await q("SELECT coalesce(sum(attempts),0)::int n FROM autonomous_ai_usage WHERE user_id=$1 AND day=(now() AT TIME ZONE 'UTC')::date",[ctx.userId]);
  if(policy?.paused||policy?.daily_attempt_limit>0&&used.n>=policy.daily_attempt_limit){const err=Error('Autonomous AI policy limit reached');err.code='AUTONOMY_LIMIT';throw err;}
  const [row]=await q(`INSERT INTO autonomous_ai_usage(user_id,day,provider,stage,attempts,input_characters) VALUES($1,(now() AT TIME ZONE 'UTC')::date,$2,$3,1,$4)
  ON CONFLICT(user_id,day,provider,stage) DO UPDATE SET attempts=autonomous_ai_usage.attempts+1,input_characters=autonomous_ai_usage.input_characters+excluded.input_characters RETURNING day::text day`,[ctx.userId,provider,ctx.stage,inputCharacters]);
  return {...ctx,provider,day:row.day};
 });
}
export async function finishProviderAttempt(ticket,outputCharacters,success){
 if(!ticket)return;
 await sql('UPDATE autonomous_ai_usage SET output_characters=output_characters+$5,successes=successes+$6 WHERE user_id=$1 AND day=$2::date AND provider=$3 AND stage=$4',[ticket.userId,ticket.day,ticket.provider,ticket.stage,outputCharacters,success?1:0]);
}
export async function autonomyPolicy(userId){
 const [row]=await sql('SELECT daily_attempt_limit,paused FROM autonomous_ai_policy WHERE user_id=$1',[userId]);
 return {dailyAttemptLimit:row?.daily_attempt_limit||0,paused:row?.paused||false};
}
export async function autonomousAiAvailable(userId){
 const p=await autonomyPolicy(userId);if(p.paused)return false;if(!p.dailyAttemptLimit)return true;
 const [used]=await sql("SELECT coalesce(sum(attempts),0)::int n FROM autonomous_ai_usage WHERE user_id=$1 AND day=(now() AT TIME ZONE 'UTC')::date",[userId]);
 return used.n<p.dailyAttemptLimit;
}
export async function setAutonomyPolicy(userId,body){
 const p=validateAutonomyPolicy(body);if(!p)throw new EconomyError('Provide a valid daily provider attempt limit (0 = unlimited) and pause setting.');
 return transaction(async q=>{
  await q('SELECT id FROM worlds WHERE user_id=$1 FOR UPDATE',[userId]);
  await q('INSERT INTO autonomous_ai_policy(user_id,daily_attempt_limit,paused) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET daily_attempt_limit=excluded.daily_attempt_limit,paused=excluded.paused,updated_at=now()',[userId,p.dailyAttemptLimit,p.paused]);
  return p;
 });
}
export async function autonomousUsageSnapshot(userId){
 const [policy,usage]=await Promise.all([autonomyPolicy(userId),sql("SELECT day::text,provider,stage,attempts,successes,input_characters::text,output_characters::text FROM autonomous_ai_usage WHERE user_id=$1 AND day>=(now() AT TIME ZONE 'UTC')::date-6 ORDER BY day DESC,provider,stage",[userId])]);
 return {policy,usage,metric:'Actual provider dispatch attempts; character counts are not billed tokens or cost. Direct user-initiated interactions are not included.'};
}
