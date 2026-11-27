export const executiveExperienceSchema=`
ALTER TABLE calls ADD COLUMN IF NOT EXISTS transcript_checkpoint_at timestamptz;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz;
CREATE TABLE IF NOT EXISTS travel_disruptions (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 trip_id uuid NOT NULL REFERENCES travel_trips(id) ON DELETE CASCADE,booking_id uuid REFERENCES travel_bookings(id) ON DELETE SET NULL,
 kind text NOT NULL CHECK(kind IN ('delay','cancellation','schedule-conflict','missing-booking','provider-change')),
 origin text NOT NULL CHECK(origin IN ('simulated','recorded')),description text NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
 proposed_action text NOT NULL,reason text,resolved_at timestamptz,
 operation_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,operation_key)
);
CREATE INDEX IF NOT EXISTS travel_disruptions_open ON travel_disruptions(user_id,trip_id) WHERE status='open';
CREATE TABLE IF NOT EXISTS travel_concierge_jobs (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,trip_id uuid NOT NULL REFERENCES travel_trips(id) ON DELETE CASCADE,
 operation_key text NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done','failed')),
 attempts integer NOT NULL DEFAULT 0,attempted_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,operation_key)
);
CREATE TABLE IF NOT EXISTS travel_concierge_briefs (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,trip_id uuid NOT NULL REFERENCES travel_trips(id) ON DELETE CASCADE,
 job_id uuid NOT NULL UNIQUE REFERENCES travel_concierge_jobs(id) ON DELETE CASCADE,
 body jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS push_device_receipts (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 subscription_id uuid NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
 item_key text NOT NULL,sent_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(subscription_id,item_key)
);
`;
