import {sql} from '../backend/src/db.mjs';

// Lightweight endpoint used by the phone while it is open.
export async function pendingInvites(userId){
  return sql("SELECT * FROM invites WHERE user_id=$1 AND status='pending' AND due_at<=now() AND due_at>now()-CASE WHEN kind='welcome' THEN interval '1 hour' ELSE interval '15 minutes' END ORDER BY due_at ASC LIMIT 10",[userId]);
}
