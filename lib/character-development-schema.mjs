export const characterDevelopmentSchema=`
CREATE TABLE IF NOT EXISTS character_consequences (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
 company_id uuid REFERENCES companies(id) ON DELETE SET NULL,decision_id uuid REFERENCES character_decision_records(id) ON DELETE SET NULL,
 parent_id uuid REFERENCES character_consequences(id) ON DELETE SET NULL,observer_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
 source_key text NOT NULL,source_type text NOT NULL,source_id text NOT NULL,
 stage text NOT NULL CHECK(stage IN ('immediate','delayed','indirect','review','career')),
 outcome text NOT NULL,role_at_event text NOT NULL,reason text NOT NULL,evidence jsonb NOT NULL,
 attribution text NOT NULL CHECK(attribution IN ('direct','shared','external','uncertain','none')),
 confidence numeric(4,3) NOT NULL CHECK(confidence BETWEEN 0 AND 1),
 impacts jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(impacts)='object'),
 relationship_delta jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(relationship_delta)='object'),
 supersedes_id uuid REFERENCES character_consequences(id) ON DELETE SET NULL,
 occurred_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,source_key),UNIQUE(supersedes_id),CHECK(observer_id IS NULL OR observer_id<>contact_id)
);
CREATE INDEX IF NOT EXISTS character_consequences_subject ON character_consequences(user_id,world_id,contact_id,occurred_at DESC);
CREATE INDEX IF NOT EXISTS character_consequences_decision ON character_consequences(user_id,decision_id);
CREATE TABLE IF NOT EXISTS character_outcome_watches (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,decision_id uuid NOT NULL REFERENCES character_decision_records(id) ON DELETE CASCADE,
 task_id uuid NOT NULL REFERENCES business_tasks(id) ON DELETE CASCADE, parent_id uuid NOT NULL REFERENCES character_consequences(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved')),next_check_at timestamptz NOT NULL DEFAULT now(),
 resolved_at timestamptz, UNIQUE(user_id,decision_id,task_id)
);
CREATE INDEX IF NOT EXISTS character_outcome_watches_due ON character_outcome_watches(user_id,status,next_check_at);
`;
