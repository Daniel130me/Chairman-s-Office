import { init, sql } from '../backend/src/db.mjs';
import {economySchema} from './economy-schema.mjs';
export async function migrate() {
  await init();
  // Additive only. Original data, UUIDs, and relationships remain intact.
  await sql(`
    ALTER TABLE worlds ADD COLUMN IF NOT EXISTS scheduler_checked_at timestamptz;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_user_id text;
    CREATE UNIQUE INDEX IF NOT EXISTS users_auth_user_id_unique ON users(auth_user_id);
    ALTER TABLE invites ADD COLUMN IF NOT EXISTS push_sent_at timestamptz;
    ALTER TABLE invites ADD COLUMN IF NOT EXISTS push_attempt_at timestamptz;
    ALTER TABLE invites ADD COLUMN IF NOT EXISTS push_attempts integer NOT NULL DEFAULT 0;
    ALTER TABLE invites ADD COLUMN IF NOT EXISTS schedule_key text;
    CREATE UNIQUE INDEX IF NOT EXISTS invites_schedule_key_unique ON invites(user_id,schedule_key);
    ALTER TABLE invites ADD COLUMN IF NOT EXISTS followup_state text;
    ALTER TABLE invites ADD COLUMN IF NOT EXISTS followup_attempt_at timestamptz;
    ALTER TABLE invites ALTER COLUMN followup_state SET DEFAULT 'pending';
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS source_invite_id uuid REFERENCES invites(id) ON DELETE SET NULL;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS source_call_id uuid REFERENCES calls(id) ON DELETE SET NULL;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS subject text;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at timestamptz;
    CREATE UNIQUE INDEX IF NOT EXISTS messages_missed_invite_unique ON messages(source_invite_id) WHERE source_invite_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS request_limits (user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,bucket timestamptz NOT NULL,count integer NOT NULL DEFAULT 0,PRIMARY KEY(user_id,bucket));
    CREATE TABLE IF NOT EXISTS engine_runs (day date PRIMARY KEY,token text NOT NULL,started_at timestamptz NOT NULL DEFAULT now(),heartbeat_at timestamptz NOT NULL DEFAULT now(),run_id text);
    CREATE TABLE IF NOT EXISTS engine_control (name text PRIMARY KEY,last_tick timestamptz NOT NULL DEFAULT '-infinity',lease_until timestamptz NOT NULL DEFAULT '-infinity',lease_token text);
    INSERT INTO engine_control(name) VALUES('world') ON CONFLICT DO NOTHING;
    CREATE UNIQUE INDEX IF NOT EXISTS scheduler_jobs_action_key_unique ON scheduler_jobs(user_id,(payload->>'actionKey')) WHERE payload ? 'actionKey' AND done_at IS NULL;
  `);
  await sql(economySchema);
}
