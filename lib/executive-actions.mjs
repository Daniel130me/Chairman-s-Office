import {sql,one,transaction,uid} from '../backend/src/db.mjs';
import {deliverInvitePush} from './push.mjs';

const MAX_DELAY_SECONDS=24*60*60;

async function findRecipient(userId,recipient,defaultContactId){
  if(!recipient){
    const current=await one('SELECT id,name,title,company FROM contacts WHERE id=$1 AND user_id=$2',[defaultContactId,userId]);
    if(!current)throw new Error('I could not identify the executive who is speaking.');
    return current;
  }

  const requested=String(recipient).trim().replace(/^(?:the|our|group)\s+/i,'').slice(0,100);
  if(!requested)throw new Error('Please specify which executive should call you.');
  const roleAliases={
    'chief financial officer':'CFO',
    'chief executive officer':'CEO',
    'chief operating officer':'COO',
    'chief technology officer':'CTO',
    'chief information officer':'CIO'
  };
  const name=roleAliases[requested.toLowerCase()]||requested;

  const exact=await sql(
    'SELECT id,name,title,company FROM contacts WHERE user_id=$1 AND (lower(name)=lower($2) OR lower(title)=lower($2)) ORDER BY name LIMIT 3',
    [userId,name]
  );
  if(exact.length===1)return exact[0];
  if(exact.length>1)throw new Error('I found more than one matching executive. Please use a full name.');

  const matches=await sql(
    'SELECT id,name,title,company FROM contacts WHERE user_id=$1 AND (name ILIKE $2 OR title ILIKE $2) ORDER BY CASE WHEN kind=\'internal\' THEN 0 ELSE 1 END,name LIMIT 4',
    [userId,'%'+name+'%']
  );
  if(matches.length===1)return matches[0];
  if(matches.length===0)throw new Error('I could not find '+name+' in your executive directory.');
  throw new Error('I found several matches for '+name+': '+matches.map(x=>x.name+' ('+x.title+')').join(', ')+'. Please specify one.');
}

function inviteCopy(contact,kind){
  return {
    subject:'Incoming call · '+contact.name,
    preview:kind==='assistant-callback'
      ?contact.name+' is calling you back as requested.'
      :contact.name+', '+contact.title+', would like to speak with you.'
  };
}

export async function arrangeExecutiveCall(options){
  const {
    userId,worldId,recipient,defaultContactId,delaySeconds=0,
    kind=recipient?'delegated-call':'assistant-callback',actionKey=null,reason=''
  }=options||{};

  const delay=Number(delaySeconds);
  if(!Number.isInteger(delay)||delay<0||delay>MAX_DELAY_SECONDS){
    throw new Error('Choose a call time between now and 24 hours from now.');
  }

  const contact=await findRecipient(userId,recipient,defaultContactId);
  const copy=inviteCopy(contact,kind);
  const stableKey=actionKey
    ?(delay===0?'immediate:':'scheduled:')+actionKey+':'+contact.id+':'+delay
    :null;

  if(delay===0){
    let invite=await one(
      'INSERT INTO invites(id,user_id,world_id,contact_id,kind,subject,preview,due_at,schedule_key) '+
      'VALUES($1,$2,$3,$4,$5,$6,$7,now(),$8) '+
      'ON CONFLICT(user_id,schedule_key) DO NOTHING RETURNING *',
      [uid(),userId,worldId,contact.id,kind,copy.subject,copy.preview,stableKey]
    );
    const alreadyScheduled=!invite;
    if(!invite&&stableKey)invite=await one('SELECT * FROM invites WHERE user_id=$1 AND schedule_key=$2',[userId,stableKey]);
    if(!invite)throw new Error('I could not create the incoming call. Please try again.');
    if(!alreadyScheduled)await deliverInvitePush(invite.id).catch(()=>{});
    return {contact,invite,dueAt:invite.due_at,delaySeconds:0,alreadyScheduled};
  }

  if(stableKey){
    const existingInvite=await one('SELECT * FROM invites WHERE user_id=$1 AND schedule_key=$2',[userId,stableKey]);
    if(existingInvite)return {contact,invite:existingInvite,dueAt:existingInvite.due_at,delaySeconds:delay,alreadyScheduled:true};

    const existingJob=await one(
      'SELECT id,due_at FROM scheduler_jobs WHERE user_id=$1 AND payload->>\'actionKey\'=$2 AND done_at IS NULL',
      [userId,stableKey]
    );
    if(existingJob)return {contact,jobId:existingJob.id,dueAt:existingJob.due_at,delaySeconds:delay,alreadyScheduled:true};
  }

  const jobId=uid();
  const payload={
    worldId,
    contactId:contact.id,
    inviteKind:kind,
    actionKey:stableKey||'job:'+jobId,
    reason:String(reason||'').slice(0,240)
  };
  const job=await one(
    'INSERT INTO scheduler_jobs(id,user_id,kind,payload,due_at) '+
    'VALUES($1,$2,$3,$4,now()+($5::int*interval \'1 second\')) '+
    'ON CONFLICT DO NOTHING RETURNING id,due_at',
    [jobId,userId,'scheduled-call:'+jobId,JSON.stringify(payload),delay]
  );
  if(!job&&stableKey){
    const existing=await one(
      'SELECT id,due_at FROM scheduler_jobs WHERE user_id=$1 AND payload->>\'actionKey\'=$2 AND done_at IS NULL',
      [userId,stableKey]
    );
    if(existing)return {contact,jobId:existing.id,dueAt:existing.due_at,delaySeconds:delay,alreadyScheduled:true};
  }
  if(!job)throw new Error('I could not schedule that call. Please try again.');

  return {contact,jobId:job.id,dueAt:job.due_at,delaySeconds:delay,alreadyScheduled:false};
}

export async function completeScheduledCall(jobId){
  "use step";
  const job=await one('SELECT id,user_id,payload,done_at FROM scheduler_jobs WHERE id=$1',[jobId]);
  if(!job)return null;
  const payload=typeof job.payload==='string'?JSON.parse(job.payload):job.payload;
  const scheduleKey=payload.actionKey||'job:'+jobId;

  if(job.done_at){
    return one('SELECT * FROM invites WHERE user_id=$1 AND schedule_key=$2',[job.user_id,scheduleKey]);
  }

  const invite=await transaction(async q=>{
    const locked=await q(
      'SELECT id FROM scheduler_jobs WHERE id=$1 AND done_at IS NULL AND due_at<=now() FOR UPDATE',
      [jobId]
    );
    if(!locked.length){
      const existing=await q('SELECT * FROM invites WHERE user_id=$1 AND schedule_key=$2',[job.user_id,scheduleKey]);
      return existing[0]||null;
    }

    const worldExists=await q('SELECT id FROM worlds WHERE id=$1 AND user_id=$2',[payload.worldId,job.user_id]);
    const contact=(await q(
      'SELECT id,name,title,company FROM contacts WHERE id=$1 AND user_id=$2',
      [payload.contactId,job.user_id]
    ))[0];

    if(!worldExists.length||!contact){
      await q('UPDATE scheduler_jobs SET done_at=now() WHERE id=$1',[jobId]);
      return null;
    }

    const copy=inviteCopy(contact,payload.inviteKind||'delegated-call');
    const created=await q(
      'INSERT INTO invites(id,user_id,world_id,contact_id,kind,subject,preview,due_at,schedule_key) '+
      'VALUES($1,$2,$3,$4,$5,$6,$7,now(),$8) '+
      'ON CONFLICT(user_id,schedule_key) DO NOTHING RETURNING *',
      [uid(),job.user_id,payload.worldId,contact.id,payload.inviteKind||'delegated-call',copy.subject,copy.preview,scheduleKey]
    );

    await q('UPDATE scheduler_jobs SET done_at=now() WHERE id=$1',[jobId]);
    if(created.length)return created[0];
    const existing=await q('SELECT * FROM invites WHERE user_id=$1 AND schedule_key=$2',[job.user_id,scheduleKey]);
    return existing[0]||null;
  });

  if(invite)await deliverInvitePush(invite.id).catch(()=>{});
  return invite;
}

export async function removeScheduledCallJob(jobId){
  await sql('DELETE FROM scheduler_jobs WHERE id=$1 AND done_at IS NULL',[jobId]);
}
