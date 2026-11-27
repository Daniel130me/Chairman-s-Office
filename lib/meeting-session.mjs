import {transaction,uid} from '../backend/src/db.mjs';
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
export async function appendMeetingResponse(userId,meetingId,roundId,person,message){
 return transaction(async q=>{
  const round=await lockMeetingRound(q,userId,meetingId,roundId);if(!round)return {stopped:true};
  if(round.requested_contact_id&&round.requested_contact_id!==person.id)return {stopped:true};
  const [member]=await q('SELECT c.id,c.name FROM contacts c JOIN meetings m ON m.user_id=c.user_id AND m.world_id=c.world_id WHERE c.id=$1 AND c.user_id=$2 AND m.id=$3 AND m.attendees @> $4::jsonb',[person.id,userId,meetingId,JSON.stringify([person.id])]);if(!member)return {stopped:true};
  const [turn]=await q('INSERT INTO meeting_turns(id,user_id,meeting_id,contact_id,speaker,message,round_id) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(round_id,contact_id) WHERE round_id IS NOT NULL AND contact_id IS NOT NULL DO NOTHING RETURNING *',[uid(),userId,meetingId,member.id,member.name,message,roundId]);
  const [existing]=turn?[turn]:await q('SELECT * FROM meeting_turns WHERE round_id=$1 AND user_id=$2 AND contact_id=$3',[roundId,userId,person.id]);
  const [count]=await q('SELECT count(*)::int n FROM meeting_turns WHERE round_id=$1 AND user_id=$2 AND contact_id IS NOT NULL',[roundId,userId]);
  await q('UPDATE meeting_rounds SET responses_saved=$1 WHERE id=$2 AND user_id=$3',[count.n,roundId,userId]);return {turn:existing,saved:count.n};
 });
}
export async function finishMeetingRound(userId,meetingId,roundId,error=null){
 return transaction(async q=>{
  const round=await lockMeetingRound(q,userId,meetingId,roundId);if(!round)return null;
  const [count]=await q('SELECT count(*)::int n FROM meeting_turns WHERE round_id=$1 AND user_id=$2 AND contact_id IS NOT NULL',[roundId,userId]);
  const status=error?'failed':count.n>=round.expected_responses?'completed':'partial';
  const [row]=await q('UPDATE meeting_rounds SET status=$1,responses_saved=$2,error=$3,completed_at=now() WHERE id=$4 AND user_id=$5 RETURNING *',[status,count.n,error,roundId,userId]);
  return row;
 });
}
export async function interruptMeeting(user,meetingId,roundId){
 return transaction(async q=>{
  const [m]=await q('SELECT * FROM meetings WHERE id=$1 AND user_id=$2 FOR UPDATE',[meetingId,user.id]);if(!m)throw Error('Meeting unavailable');
  const [r]=await q('SELECT * FROM meeting_rounds WHERE id=$1 AND user_id=$2 AND meeting_id=$3 FOR UPDATE',[roundId,user.id,meetingId]);if(!r)throw Error('Meeting round unavailable');
  if(terminalRound(r.status))return r;
  const [row]=await q("UPDATE meeting_rounds SET status='interrupted',interrupted_at=now(),completed_at=now() WHERE id=$1 AND user_id=$2 RETURNING *",[roundId,user.id]);
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,m.world_id,'meeting-interrupted',m.title,'Chairman took the floor. '+row.responses_saved+' executive responses were preserved; remaining responses cancelled.']);return row;
 });
}
