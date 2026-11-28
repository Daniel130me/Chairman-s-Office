import { init, sql } from '../backend/src/db.mjs';
import {executiveExperienceSchema} from './executive-experience-schema.mjs';
import {advancedOperationsSchema} from './advanced-operations-schema.mjs';
import {subsidiaryDisposalSchema} from './subsidiary-disposal-schema.mjs';
import {corporateFinanceSchema} from './corporate-finance-schema.mjs';
import {economySchema} from './economy-schema.mjs';
import {characterPsychologySchema} from './character-psychology-schema.mjs';
export async function migrate() {
  await init();
  // Additive only. Original data, UUIDs, and relationships remain intact.
  await sql(`
    ALTER TABLE worlds ADD COLUMN IF NOT EXISTS scheduler_checked_at timestamptz;
    ALTER TABLE worlds ADD COLUMN IF NOT EXISTS last_communication_attempt_at timestamptz;
    ALTER TABLE worlds ADD COLUMN IF NOT EXISTS last_market_attempt_at timestamptz;
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
    DROP INDEX IF EXISTS messages_missed_call_unique;
    CREATE UNIQUE INDEX IF NOT EXISTS messages_missed_call_incoming_unique ON messages(source_call_id) WHERE source_call_id IS NOT NULL AND direction='incoming';
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS audio_available boolean NOT NULL DEFAULT false;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS transcription_status text;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS client_message_key uuid;
    CREATE UNIQUE INDEX IF NOT EXISTS messages_client_key_unique ON messages(user_id,client_message_key) WHERE client_message_key IS NOT NULL;
    CREATE TABLE IF NOT EXISTS voice_notes (
      message_id uuid PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      mime_type text NOT NULL CHECK(mime_type IN ('audio/webm','audio/ogg','audio/mp4','audio/wav','audio/mpeg')),
      audio bytea NOT NULL CHECK(octet_length(audio) BETWEEN 16 AND 2097152),
      created_at timestamptz NOT NULL DEFAULT now(),
      transcript_status text NOT NULL DEFAULT 'pending' CHECK(transcript_status IN ('pending','ready')),
      reply_status text NOT NULL DEFAULT 'pending' CHECK(reply_status IN ('pending','sent','skipped')),
      attempted_at timestamptz,
      synthetic boolean NOT NULL DEFAULT false
    );
    CREATE INDEX IF NOT EXISTS voice_notes_pending ON voice_notes(created_at) WHERE reply_status='pending';
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS subject text;
    ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at timestamptz;
    CREATE UNIQUE INDEX IF NOT EXISTS messages_missed_invite_unique ON messages(source_invite_id) WHERE source_invite_id IS NOT NULL;
    CREATE TABLE IF NOT EXISTS request_limits (user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,bucket timestamptz NOT NULL,count integer NOT NULL DEFAULT 0,PRIMARY KEY(user_id,bucket));
    CREATE TABLE IF NOT EXISTS engine_runs (day date PRIMARY KEY,token text NOT NULL,started_at timestamptz NOT NULL DEFAULT now(),heartbeat_at timestamptz NOT NULL DEFAULT now(),run_id text);
    ALTER TABLE engine_runs ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0;
    CREATE TABLE IF NOT EXISTS activity_visits (user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,last_seen_at timestamptz,previous_seen_at timestamptz,visit_id uuid);
    CREATE TABLE IF NOT EXISTS engine_stage_status (
      world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
      stage text NOT NULL,last_attempt_at timestamptz NOT NULL DEFAULT now(),
      last_success_at timestamptz,last_error_code text,consecutive_failures integer NOT NULL DEFAULT 0,
      PRIMARY KEY(world_id,stage)
    );
    CREATE TABLE IF NOT EXISTS engine_control (name text PRIMARY KEY,last_tick timestamptz NOT NULL DEFAULT '-infinity',lease_until timestamptz NOT NULL DEFAULT '-infinity',lease_token text);
    ALTER TABLE engine_control ADD COLUMN IF NOT EXISTS last_tick timestamptz;
    ALTER TABLE engine_control ADD COLUMN IF NOT EXISTS lease_until timestamptz;
    ALTER TABLE engine_control ADD COLUMN IF NOT EXISTS lease_token text;
    ALTER TABLE engine_control ALTER COLUMN last_tick SET DEFAULT '-infinity';
    ALTER TABLE engine_control ALTER COLUMN lease_until SET DEFAULT '-infinity';
    UPDATE engine_control SET last_tick='-infinity' WHERE last_tick IS NULL;
    UPDATE engine_control SET lease_until='-infinity' WHERE lease_until IS NULL;
    ALTER TABLE engine_control ALTER COLUMN last_tick SET NOT NULL;
    ALTER TABLE engine_control ALTER COLUMN lease_until SET NOT NULL;
    INSERT INTO engine_control(name) VALUES('world') ON CONFLICT DO NOTHING;
    CREATE UNIQUE INDEX IF NOT EXISTS scheduler_jobs_action_key_unique ON scheduler_jobs(user_id,(payload->>'actionKey')) WHERE payload ? 'actionKey' AND done_at IS NULL;
  `);
  await sql(economySchema);
  await sql(corporateFinanceSchema);
  await sql(advancedOperationsSchema);
  await sql(executiveExperienceSchema);
  await sql(subsidiaryDisposalSchema);
  await sql(characterPsychologySchema);
}
