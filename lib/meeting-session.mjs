import {sql,one,transaction,uid} from '../backend/src/db.mjs';
export const terminalRound=status=>['completed','partial','failed','interrupted'].includes(status);
export function selectParticipants(contacts,requestedId){
 if(!requestedId)return contacts;
 const member=contacts.find(c=>c.id===requestedId);
 if(!member)throw new Error('Requested executive is not a participant.');
 return [member];
}
export async function lockMeetingRound(q,userId,meetingId,roundId){
 const [meeting]=await q('SELECT * FROM meetings WHERE id=$1 AND user_id=$2 FOR UPDATE',[meetingId,userId]);
 if(!meeting||meeting.status==='concluded')return null;
 const [round]=await q('SELECT * FROM meeting_rounds WHERE id=$1 AND meeting_id=$2 AND user_id=$3 FOR UPDATE',[roundId,meetingId,userId]);
 return round&&!terminalRound(round.status)?round:null;
}
export async function appendMeetingResponse(userId,meetingId,roundId,person,message,workerToken=null,deliveryStyle='normal'){
 return transaction(async q=>{
  const round=await lockMeetingRound(q,userId,meetingId,roundId);if(!round||round.worker_token!==workerToken||(workerToken&&Date.parse(round.worker_lease_until)<=Date.now()))return {stopped:true};
  if(round.requested_contact_id&&round.requested_contact_id!==person.id)return {stopped:true};
  const [member]=await q('SELECT c.id,c.name FROM contacts c JOIN meetings m ON m.user_id=c.user_id AND m.world_id=c.world_id WHERE c.id=$1 AND c.user_id=$2 AND m.id=$3 AND m.attendees @> $4::jsonb',[person.id,userId,meetingId,JSON.stringify([person.id])]);if(!member)return {stopped:true};
  const [earlier]=deliveryStyle==='interjection'&&!round.requested_contact_id&&message.length<=100?await q('SELECT id FROM meeting_turns WHERE user_id=$1 AND round_id=$2 AND contact_id IS NOT NULL LIMIT 1',[userId,roundId]):[];
  const delivery=earlier?'interjection':'normal';
  const [turn]=await q('INSERT INTO meeting_turns(id,user_id,meeting_id,contact_id,speaker,message,round_id,delivery_style) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(round_id,contact_id) WHERE round_id IS NOT NULL AND contact_id IS NOT NULL DO NOTHING RETURNING *',[uid(),userId,meetingId,member.id,member.name,message,roundId,delivery]);
  const [existing]=turn?[turn]:await q('SELECT * FROM meeting_turns WHERE round_id=$1 AND user_id=$2 AND contact_id=$3',[roundId,userId,person.id]);
  const [count]=await q('SELECT count(*)::int n FROM meeting_turns WHERE round_id=$1 AND user_id=$2 AND contact_id IS NOT NULL',[roundId,userId]);
  await q('UPDATE meeting_rounds SET responses_saved=$1 WHERE id=$2 AND user_id=$3',[count.n,roundId,userId]);return {turn:existing,saved:count.n};
 });
}
export async function finishMeetingRound(userId,meetingId,roundId,error=null,workerToken=null){
 return transaction(async q=>{
  const round=await lockMeetingRound(q,userId,meetingId,roundId);if(!round||round.worker_token!==workerToken||(workerToken&&Date.parse(round.worker_lease_until)<=Date.now()))return null;
  const [count]=await q('SELECT count(*)::int n FROM meeting_turns WHERE round_id=$1 AND user_id=$2 AND contact_id IS NOT NULL',[roundId,userId]);
  const status=error?'failed':count.n>=round.expected_responses?'completed':'partial';
  const [row]=await q('UPDATE meeting_rounds SET status=$1,responses_saved=$2,error=$3,completed_at=now(),worker_token=NULL,worker_lease_until=NULL WHERE id=$4 AND user_id=$5 RETURNING *',[status,count.n,error,roundId,userId]);
  return row;
 });
}
export async function interruptMeeting(user,meetingId,roundId){
 return transaction(async q=>{
  const [m]=await q('SELECT * FROM meetings WHERE id=$1 AND user_id=$2 FOR UPDATE',[meetingId,user.id]);if(!m)throw Error('Meeting unavailable');
  const [r]=await q('SELECT * FROM meeting_rounds WHERE id=$1 AND user_id=$2 AND meeting_id=$3 FOR UPDATE',[roundId,user.id,meetingId]);if(!r)throw Error('Meeting round unavailable');
  if(terminalRound(r.status))return r;
  const [row]=await q("UPDATE meeting_rounds SET status='interrupted',interrupted_at=now(),completed_at=now(),worker_token=NULL,worker_lease_until=NULL WHERE id=$1 AND user_id=$2 RETURNING *",[roundId,user.id]);
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,m.world_id,'meeting-interrupted',m.title,'Chairman took the floor. '+row.responses_saved+' executive responses were preserved; remaining responses cancelled.']);return row;
 });
}

export async function claimMeetingWorker(userId,roundId){
 const token=uid();
 return one("UPDATE meeting_rounds SET status='running',started_at=coalesce(started_at,now()),worker_token=$1,worker_lease_until=now()+interval '3 minutes',worker_attempts=worker_attempts+1 WHERE id=$2 AND user_id=$3 AND status='pending' AND worker_attempts<3 RETURNING *",[token,roundId,userId]);
}
export async function renewMeetingWorker(userId,roundId,token){
 return !!await one("UPDATE meeting_rounds SET worker_lease_until=now()+interval '3 minutes' WHERE id=$1 AND user_id=$2 AND worker_token=$3 AND status='running' AND worker_lease_until>now() RETURNING id",[roundId,userId,token]);
}
export async function recoverMeetingRounds(userId){
 const rows=await sql("SELECT id,meeting_id FROM meeting_rounds WHERE user_id=$1 AND ((status='pending' AND coalesce(worker_lease_until,created_at+interval '3 minutes')<now()) OR (status='running' AND coalesce(worker_lease_until,started_at+interval '3 minutes',created_at+interval '3 minutes')<now())) ORDER BY created_at LIMIT 20",[userId]);
 for(const r of rows)await transaction(async q=>{
  const [m]=await q('SELECT * FROM meetings WHERE id=$1 AND user_id=$2 FOR UPDATE',[r.meeting_id,userId]);if(!m)return;
  const [row]=await q("UPDATE meeting_rounds SET status='failed',error='Discussion connection expired. Saved responses are available; retry to resume.',completed_at=now(),worker_token=NULL,worker_lease_until=NULL WHERE id=$1 AND user_id=$2 AND ((status='pending' AND coalesce(worker_lease_until,created_at+interval '3 minutes')<now()) OR (status='running' AND coalesce(worker_lease_until,started_at+interval '3 minutes',created_at+interval '3 minutes')<now())) RETURNING id",[r.id,userId]);if(row)await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),userId,m.world_id,'meeting-recovery',m.title,'Discussion connection expired. Previously saved statements were preserved.']);
 });
}
export async function retryMeetingRound(user,meetingId,roundId){
 return transaction(async q=>{
  const [m]=await q('SELECT * FROM meetings WHERE id=$1 AND user_id=$2 FOR UPDATE',[meetingId,user.id]);if(!m||m.status==='concluded')throw Error('Meeting unavailable');
  const [r]=await q('SELECT * FROM meeting_rounds WHERE id=$1 AND meeting_id=$2 AND user_id=$3 FOR UPDATE',[roundId,meetingId,user.id]);if(!r)throw Error('Meeting round unavailable');
  if(r.status==='pending'||r.status==='running')return {...r,replayed:true};
  if(!['failed','partial'].includes(r.status)||r.worker_attempts>=3)throw Error('This discussion cannot be retried; address the board again.');
  if((await q("SELECT id FROM meeting_rounds WHERE user_id=$1 AND meeting_id=$2 AND id<>$3 AND (created_at>$4 OR status IN ('pending','running')) LIMIT 1",[user.id,meetingId,r.id,r.created_at])).length)throw Error('Only the latest inactive discussion can be resumed.');
  const [row]=await q("UPDATE meeting_rounds SET status='pending',error=NULL,completed_at=NULL,worker_token=NULL,worker_lease_until=now()+interval '3 minutes' WHERE id=$1 AND user_id=$2 RETURNING *",[roundId,user.id]);return row;
 });
}
