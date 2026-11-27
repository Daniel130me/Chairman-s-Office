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
CREATE TABLE IF NOT EXISTS travel_provider_reviews (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,booking_id uuid PRIMARY KEY REFERENCES travel_bookings(id) ON DELETE CASCADE,
 outcome text NOT NULL CHECK(outcome IN ('none','delay','cancellation','provider-change')),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS travel_rebookings (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,disruption_id uuid NOT NULL REFERENCES travel_disruptions(id) ON DELETE CASCADE,
 old_booking_id uuid NOT NULL REFERENCES travel_bookings(id) ON DELETE CASCADE,new_booking_id uuid REFERENCES travel_bookings(id) ON DELETE SET NULL,
 provider text NOT NULL,description text NOT NULL,amount numeric(20,2) NOT NULL CHECK(amount>0),fee numeric(20,2) NOT NULL DEFAULT 0 CHECK(fee>=0),
 status text NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','approved','declined')),reason text NOT NULL,
 operation_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),decided_at timestamptz,UNIQUE(user_id,operation_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS travel_rebooking_open ON travel_rebookings(user_id,disruption_id) WHERE status='proposed';
CREATE TABLE IF NOT EXISTS push_device_receipts (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 subscription_id uuid NOT NULL REFERENCES push_subscriptions(id) ON DELETE CASCADE,
 item_key text NOT NULL,sent_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(subscription_id,item_key)
);
`;
