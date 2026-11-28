
export const characterAgencySchema=`
CREATE TABLE IF NOT EXISTS character_authority_grants(
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 action_type text NOT NULL CHECK(action_type IN ('assign-task','expense')),
 mode text NOT NULL CHECK(mode IN ('delegated','chairman','prohibited','coapproval')),
 reviewer_id uuid REFERENCES contacts(id) ON DELETE CASCADE,
 per_action_limit numeric(20,2),daily_limit numeric(20,2),reason text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,contact_id,company_id,action_type),
 CHECK(mode<>'coapproval' OR (reviewer_id IS NOT NULL AND reviewer_id<>contact_id)),
 CHECK(action_type<>'expense' OR mode NOT IN ('delegated','coapproval') OR (per_action_limit>0 AND daily_limit>=per_action_limit))
);
CREATE TABLE IF NOT EXISTS character_decision_records(
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
 source_type text NOT NULL,source_id text NOT NULL,operation_key text NOT NULL,evidence jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','decided','awaiting-review','awaiting-approval','executed','blocked','failed')),
 decision jsonb,authority jsonb,result jsonb,approval_id uuid REFERENCES action_requests(id) ON DELETE SET NULL,
 reviewer_id uuid REFERENCES contacts(id) ON DELETE SET NULL,review jsonb,
 attempts integer NOT NULL DEFAULT 0,attempted_at timestamptz,next_attempt_at timestamptz NOT NULL DEFAULT now(),last_error text,
 created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,UNIQUE(user_id,operation_key)
);
CREATE INDEX IF NOT EXISTS character_decisions_due ON character_decision_records(user_id,status,next_attempt_at);
CREATE INDEX IF NOT EXISTS character_decisions_actor ON character_decision_records(user_id,contact_id,created_at DESC);
`;
