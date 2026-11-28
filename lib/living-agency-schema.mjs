export const livingAgencySchema=`
ALTER TABLE world_conversation_messages ADD COLUMN IF NOT EXISTS call_turn_index smallint;
ALTER TABLE threads ADD COLUMN IF NOT EXISTS agency_managed boolean NOT NULL DEFAULT false;
ALTER TABLE colleague_calls ADD COLUMN IF NOT EXISTS followup_processed_at timestamptz;
ALTER TABLE colleague_calls ADD COLUMN IF NOT EXISTS followup_attempt_at timestamptz;
ALTER TABLE colleague_calls ADD COLUMN IF NOT EXISTS followup_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE character_decision_records ADD COLUMN IF NOT EXISTS priority smallint NOT NULL DEFAULT 50;
ALTER TABLE character_decision_records ADD COLUMN IF NOT EXISTS parent_decision_id uuid REFERENCES character_decision_records(id) ON DELETE SET NULL;
ALTER TABLE character_decision_records ADD COLUMN IF NOT EXISTS coordination_depth smallint NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS agency_queue_priority ON character_decision_records(user_id,status,priority DESC,next_attempt_at);
CREATE TABLE IF NOT EXISTS autonomous_ai_usage (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,day date NOT NULL,
 provider text NOT NULL,stage text NOT NULL,attempts integer NOT NULL DEFAULT 0,
 input_characters bigint NOT NULL DEFAULT 0,output_characters bigint NOT NULL DEFAULT 0,
 successes integer NOT NULL DEFAULT 0,PRIMARY KEY(user_id,day,provider,stage)
);
CREATE TABLE IF NOT EXISTS autonomous_ai_policy (
 user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 daily_attempt_limit integer NOT NULL DEFAULT 0 CHECK(daily_attempt_limit BETWEEN 0 AND 100000),
 paused boolean NOT NULL DEFAULT false,updated_at timestamptz NOT NULL DEFAULT now()
);
`;
