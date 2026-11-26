import {sql,transaction,uid} from '../backend/src/db.mjs';
import {ask} from '../backend/src/ai.mjs';
import {EconomyError,operationKey} from './economy-rules.mjs';
const clean=(v,n=1000)=>typeof v==='string'?v.trim().slice(0,n):'';
const votes=['for','against','abstain'];
export function parseBoardVote(raw){
 const rationale=clean(raw?.rationale,1000);
 return votes.includes(raw?.vote)&&rationale?{vote:raw.vote,rationale}:null;
}
export function boardRecommendation(electorate,cast){
 const quorum=Math.floor(electorate/2)+1;
 const counts={for:0,against:0,abstain:0};
 for(const vote of cast)if(votes.includes(vote))counts[vote]++;
 const present=counts.for+counts.against+counts.abstain;
 const status=present<quorum?'no-quorum':counts.for>counts.against&&counts.for+counts.against>0?'recommended':'not-recommended';
 return {...counts,present,quorum,status};
}
export async function createBoardMotion(user,meetingId,body){
 const title=clean(body.title,160),proposal=clean(body.proposal,3000),key='board:'+operationKey(body.operationKey);
 if(!title||!proposal)throw new EconomyError('Provide a motion and its proposed resolution.');
 return transaction(async q=>{
  const [meeting]=await q("SELECT * FROM meetings WHERE id=$1 AND user_id=$2 FOR UPDATE",[meetingId,user.id]);
  if(!meeting||meeting.status==='concluded')throw new EconomyError('Meeting unavailable.',404);
  const [prior]=await q('SELECT * FROM board_motions WHERE user_id=$1 AND operation_key=$2',[user.id,key]);
  if(prior){if(prior.meeting_id!==meetingId||prior.title!==title||prior.proposal!==proposal)throw new EconomyError('Operation reference already used.',409);return prior;}
  const members=await q("SELECT id,name,title FROM contacts WHERE user_id=$1 AND world_id=$2 AND id=ANY($3::uuid[]) AND kind='internal' ORDER BY id",[user.id,meeting.world_id,meeting.attendees]);
  if(members.length<2)throw new EconomyError('At least two internal meeting participants are needed for an advisory vote.',409);
  const [motion]=await q('INSERT INTO board_motions(id,user_id,world_id,meeting_id,title,proposal,electorate,operation_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',[uid(),user.id,meeting.world_id,meeting.id,title,proposal,JSON.stringify(members),key]);
  for(const c of members)await q('INSERT INTO board_motion_votes(id,user_id,motion_id,contact_id) VALUES($1,$2,$3,$4)',[uid(),user.id,motion.id,c.id]);
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,meeting.world_id,'board-motion-opened',title,'Advisory vote opened for '+members.length+' internal participants. '+proposal]);
  return motion;
 });
}
async function closeMotion(q,motion){
 const records=await q('SELECT vote FROM board_motion_votes WHERE user_id=$1 AND motion_id=$2 AND cast_at IS NOT NULL',[motion.user_id,motion.id]);
 const result=boardRecommendation(motion.electorate.length,records.map(r=>r.vote));
 const [updated]=await q("UPDATE board_motions SET status=$1,closed_at=now() WHERE id=$2 AND user_id=$3 AND status='open' RETURNING *",[result.status,motion.id,motion.user_id]);
 if(updated){
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),motion.user_id,motion.world_id,'board-vote-closed',motion.title,result.status+' · For '+result.for+' · Against '+result.against+' · Abstain '+result.abstain+' · Quorum '+result.quorum+' · Chairman decision pending.']);
 }
 return updated;
}
export async function processBoardVotes(userId){
 const expired=await sql("SELECT id FROM board_motions WHERE user_id=$1 AND status='open' AND deadline_at<=now() ORDER BY deadline_at LIMIT 5",[userId]);
 for(const item of expired)await transaction(async q=>{
  const [m]=await q("SELECT * FROM board_motions WHERE id=$1 AND user_id=$2 AND status='open' FOR UPDATE",[item.id,userId]);if(m)await closeMotion(q,m);
 });
 const [job]=await sql(`WITH due AS (SELECT v.id FROM board_motion_votes v JOIN board_motions m ON m.id=v.motion_id AND m.user_id=v.user_id
 WHERE v.user_id=$1 AND m.status='open' AND m.deadline_at>now() AND v.cast_at IS NULL AND v.attempts<5 AND (v.attempted_at IS NULL OR v.attempted_at<now()-interval '5 minutes') ORDER BY m.created_at,v.id LIMIT 1 FOR UPDATE OF v SKIP LOCKED)
 UPDATE board_motion_votes v SET attempted_at=now(),attempts=attempts+1 FROM due WHERE v.id=due.id RETURNING v.*`,[userId]);if(!job)return;
 const [m]=await sql("SELECT * FROM board_motions WHERE user_id=$1 AND id=$2 AND status='open'",[userId,job.motion_id]);if(!m)return;
 const [person]=await sql("SELECT id,name,title,agenda,temperament FROM contacts WHERE user_id=$1 AND world_id=$2 AND id=$3 AND kind='internal'",[userId,m.world_id,job.contact_id]);if(!person)return;
 const discussion=await sql('SELECT speaker,message FROM meeting_turns WHERE user_id=$1 AND meeting_id=$2 ORDER BY created_at DESC LIMIT 20',[userId,m.meeting_id]);
 const answer=await ask('Act as this fictional executive, exercising independent judgment in an advisory board vote. Consider the recorded discussion, your role and the motion. Do not invent financial data or claim a proposal has been implemented. Abstain if evidence is insufficient. Return JSON {vote:"for"|"against"|"abstain",rationale:"specific reason"}.',JSON.stringify({person,motion:{title:m.title,proposal:m.proposal},discussion:discussion.reverse()}),{json:true,fallback:null,validate:parseBoardVote});
 if(!answer){const err=Error('Board vote unavailable');err.code='AI_BOARD_VOTE_UNAVAILABLE';throw err;}
 await transaction(async q=>{
  const [motion]=await q("SELECT * FROM board_motions WHERE user_id=$1 AND id=$2 AND status='open' AND deadline_at>now() FOR UPDATE",[userId,m.id]);if(!motion)return;
  const [v]=await q('UPDATE board_motion_votes SET vote=$1,rationale=$2,cast_at=now() WHERE id=$3 AND user_id=$4 AND cast_at IS NULL AND attempts=$5 RETURNING id',[answer.vote,answer.rationale,job.id,userId,job.attempts]);if(!v)return;
  await q('INSERT INTO events(id,user_id,world_id,contact_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6,$7)',[uid(),userId,m.world_id,person.id,'board-vote-cast',motion.title,person.name+' voted '+answer.vote+': '+answer.rationale]);
  const [remaining]=await q('SELECT count(*)::int n FROM board_motion_votes WHERE user_id=$1 AND motion_id=$2 AND cast_at IS NULL',[userId,m.id]);
  if(!remaining.n)await closeMotion(q,motion);
 });
}
export async function decideBoardMotion(user,id,body){
 const decision=body.decision,reason=clean(body.reason);
 if(!['adopted','rejected'].includes(decision)||!reason)throw new EconomyError('Record the final decision and rationale.');
 return transaction(async q=>{
  const [m]=await q('SELECT * FROM board_motions WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]);if(!m)throw new EconomyError('Motion unavailable.',404);
  if(m.status===decision)return m;
  if(!['recommended','not-recommended','no-quorum'].includes(m.status))throw new EconomyError('Close the advisory vote before recording a decision.',409);
  if(decision==='adopted'&&m.status==='no-quorum')throw new EconomyError('A motion without quorum cannot be adopted.',409);
  const [row]=await q('UPDATE board_motions SET status=$1,chairman_vote=$2,chairman_reason=$3,decided_at=now() WHERE id=$4 AND user_id=$5 RETURNING *',[decision,decision==='adopted'?'for':'against',reason,id,user.id]);
  await q('INSERT INTO events(id,user_id,world_id,kind,title,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,m.world_id,'board-motion-decided',m.title,decision+' · '+reason+' · Separate authorized execution required for financial or personnel changes.']);
  await q('INSERT INTO documents(id,user_id,world_id,title,kind,body) VALUES($1,$2,$3,$4,$5,$6)',[uid(),user.id,m.world_id,'Resolution · '+m.title,'board-resolution',JSON.stringify({proposal:m.proposal,recommendation:m.status,decision,reason})]);
  return row;
 });
}
export async function boardSnapshot(userId){
 const [motions,ballots]=await Promise.all([
  sql('SELECT * FROM board_motions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[userId]),
  sql('SELECT v.*,c.name FROM board_motion_votes v JOIN contacts c ON c.id=v.contact_id AND c.user_id=v.user_id WHERE v.user_id=$1 ORDER BY v.cast_at DESC NULLS LAST LIMIT 800',[userId])]);
 return {boardMotions:motions,boardVotes:ballots};
}
