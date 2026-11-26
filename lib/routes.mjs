import { one, sql, uid, transaction } from '../backend/src/db.mjs';
import * as world from '../backend/src/world.mjs';
import { aiStatus } from '../backend/src/ai.mjs';
import { requireUser } from './profile.mjs';
import { HttpError, uuid, clock, pushEndpoint, readBody, checkOrigin } from './validation.mjs';
import {EconomyError,recordTransaction,assignTask,cancelTask} from './economy.mjs';
const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function handle(request,context) {
  try {
    const {path}=await context.params;
    const route=path.join('/'), method=request.method;
    if(route==='health'&&method==='GET'){await sql('SELECT 1');return reply({ok:true,service:'chairmans-office'});}
    if(method!=='GET')checkOrigin(request);
    const user=await requireUser();
    let body={};
    if(method!=='GET'){
      const limit=await one(`INSERT INTO request_limits(user_id,bucket,count) VALUES($1,date_trunc('minute',now()),1)
        ON CONFLICT(user_id,bucket) DO UPDATE SET count=request_limits.count+1 RETURNING count`,[user.id]);
      if(limit.count>60)throw new HttpError(429,'Too many requests. Try again in a minute.');
      body=await readBody(request);
    }
    const [resource,id,action]=path;
    if(method==='GET'&&route==='me')return reply({user});
    if(method==='GET'&&route==='state')return reply({user,state:await world.state(user.id)});
    if(method==='POST'&&resource==='economy'&&action==='transaction'&&path.length===3)return reply({entry:await recordTransaction(user,uuid(id),body)},201);
    if(method==='POST'&&route==='tasks'){body.assigneeId=uuid(body.assigneeId);if(body.companyId)body.companyId=uuid(body.companyId);return reply({task:await assignTask(user,body)},201);}
    if(method==='POST'&&resource==='tasks'&&action==='cancel'&&path.length===3)return reply({task:await cancelTask(user,uuid(id))});
    if(method==='GET'&&route==='providers')return reply({providers:aiStatus(),voice:'Vapi Web SDK'});
    if(method==='POST'&&route==='world')return reply({world:await world.createWorld(user,body)},201);
    if(method==='POST'&&resource==='messages'&&path.length===2)return reply(await world.message(user,uuid(id),body.body,'chat',body.sourceCallId?uuid(body.sourceCallId):null));
    if(method==='PUT'&&resource==='contacts'&&action==='voice'&&path.length===3){
      const found=await one('UPDATE contacts SET voice_id=$1,vapi_assistant_id=$2 WHERE id=$3 AND user_id=$4 RETURNING id',[String(body.voiceId||'').slice(0,120)||null,String(body.vapiAssistantId||'').slice(0,120)||null,uuid(id),user.id]);
      if(!found)throw new HttpError(404,'Contact not found');return reply({ok:true});
    }
    if(method==='POST'&&resource==='contacts'&&action==='request-call'&&path.length===3)return reply({invite:await world.makeInvite(user,uuid(id))});
    if(method==='POST'&&route==='calls/start')return reply(await world.startCall(user,uuid(body.contactId),body.inviteId?uuid(body.inviteId):null),201);
    if(method==='POST'&&resource==='calls'&&action==='end'&&path.length===3)return reply(await world.finishCall(user,uuid(id),body.transcript,body.status==='failed'?'failed':'completed'));
    if(method==='POST'&&resource==='invites'&&action==='decline'&&path.length===3){
      await sql("UPDATE invites SET status='declined' WHERE id=$1 AND user_id=$2 AND status='pending'",[uuid(id),user.id]);return reply({ok:true});
    }
    if(method==='POST'&&route==='meetings'){
      if(!Array.isArray(body.attendees)||!body.attendees.length)throw new HttpError(400,'Select attendees');
      body.attendees.forEach(x=>uuid(x,'attendee'));
      if(body.start_at&&!Number.isFinite(Date.parse(body.start_at)))throw new HttpError(400,'Invalid meeting date');
      return reply({meeting:await world.createMeeting(user,body)},201);
    }
    if(resource==='meetings'&&path.length===3){
      uuid(id);
      if(method==='POST'&&action==='speak')return reply(await world.meetingSpeak(user,id,body.message));
      if(method==='POST'&&action==='end')return reply(await world.endMeeting(user,id));
      if(method==='GET'&&action==='turns'){
        if(!await one('SELECT id FROM meetings WHERE id=$1 AND user_id=$2',[id,user.id]))throw new HttpError(404,'Meeting unavailable');
        return reply({turns:await sql('SELECT * FROM meeting_turns WHERE meeting_id=$1 AND user_id=$2 ORDER BY created_at',[id,user.id])});
      }
    }
    if(method==='POST'&&route==='decisions'){
      if(typeof body.content!=='string'||!body.content.trim())throw new HttpError(400,'Write a decision first');
      return reply({decision:await world.recordDecision(user,uuid(body.threadId),body.content)},201);
    }
    if(method==='POST'&&resource==='tenders'&&path.length===3){
      if(action==='negotiate')return reply(await world.negotiate(user,uuid(id),uuid(body.bidId),body.amount));
      if(action==='prefer')return reply(await world.prefer(user,uuid(id),uuid(body.bidId)));
    }
    if(method==='PUT'&&route==='settings'){
      const changes=[];
      for(const key of ['morning','evening','quiet_start','quiet_end','max_daily','urgent','ringtone','theme']){
        if(body[key]===undefined)continue;let value=body[key];
        if(['morning','evening','quiet_start','quiet_end'].includes(key))value=clock(value);
        else if(key==='max_daily'){if(!Number.isInteger(Number(value))||Number(value)<0||Number(value)>8)throw new HttpError(400,'Maximum calls must be 0–8');value=Number(value);}
        else if(key==='urgent'){if(typeof value!=='boolean')throw new HttpError(400,'Invalid urgent setting');}
        else if(key==='theme'){if(!['dark','light'].includes(value))throw new HttpError(400,'Invalid theme');}
        else value=String(value).slice(0,32);
        changes.push([key,value]);
      }
      await transaction(async q=>{for(const [key,value] of changes)await q('UPDATE settings SET '+key+'=$1 WHERE user_id=$2',[value,user.id]);});
      return reply({settings:await one('SELECT * FROM settings WHERE user_id=$1',[user.id])});
    }
    if(method==='GET'&&route==='push/public')return reply({key:process.env.VAPID_PUBLIC_KEY||null});
    if(method==='POST'&&route==='push/subscribe'){
      const endpoint=pushEndpoint(body.endpoint);
      if(typeof body.keys?.p256dh!=='string'||typeof body.keys?.auth!=='string'||body.keys.p256dh.length>200||body.keys.auth.length>100)throw new HttpError(400,'Invalid push subscription');
      const row=await one(`INSERT INTO push_subscriptions(id,user_id,endpoint,subscription) VALUES($1,$2,$3,$4)
        ON CONFLICT(endpoint) DO UPDATE SET subscription=EXCLUDED.subscription WHERE push_subscriptions.user_id=EXCLUDED.user_id RETURNING id`,[uid(),user.id,endpoint,JSON.stringify({endpoint,keys:body.keys})]);
      if(!row)throw new HttpError(409,'This device is subscribed to another account.');
      return reply({ok:true});
    }
    if(method==='POST'&&route==='push/unsubscribe'){await sql('DELETE FROM push_subscriptions WHERE user_id=$1 AND endpoint=$2',[user.id,String(body.endpoint||'')]);return reply({ok:true});}
    throw new HttpError(404,'Unknown API route');
  }catch(e){
    if(e instanceof HttpError||e instanceof EconomyError)return reply({error:e.message},e.status);
    if(e.code==='23505')return reply({error:'This record already exists.'},409);
    if(/^(Contact unavailable|Meeting unavailable|No participants|Matter unavailable|Bid unavailable|Call unavailable|Your empire is already established|Set a holding company|Invalid time zone|Write a message|Select attendees|Empire unavailable|Enter a valid amount|Invitation unavailable)/.test(e.message||''))return reply({error:e.message},400);
    console.error('API error',e.code||e.name);return reply({error:'Request could not be completed. Try again.'},503);
  }
}
