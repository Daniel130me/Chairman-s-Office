export const characterPsychologySchema = `
CREATE TABLE IF NOT EXISTS character_psychology (
 contact_id uuid PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 constitution jsonb NOT NULL CHECK(jsonb_typeof(constitution)='object'),
 baseline_state jsonb NOT NULL CHECK(jsonb_typeof(baseline_state)='object'),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS character_psychology_scope ON character_psychology(user_id,world_id,contact_id);
`;
