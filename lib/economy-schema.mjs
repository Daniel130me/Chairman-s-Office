export const economySchema = `
CREATE TABLE IF NOT EXISTS company_economy (
 company_id uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 annual_sales_assumption numeric(20,2) NOT NULL CHECK (annual_sales_assumption>=0),
 cost_ratio numeric(5,4) NOT NULL DEFAULT 0.65 CHECK(cost_ratio BETWEEN 0 AND 1),
 started_at timestamptz NOT NULL DEFAULT now(),
 next_day date NOT NULL DEFAULT ((now() AT TIME ZONE 'UTC')::date + 1)
);
CREATE TABLE IF NOT EXISTS economy_journal (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 operation_key text NOT NULL, kind text NOT NULL CHECK(kind IN ('opening','sale','expense','capital')),
 debit text NOT NULL CHECK(debit IN ('cash','expense')),
 credit text NOT NULL CHECK(credit IN ('cash','revenue','equity')),
 amount numeric(20,2) NOT NULL CHECK(amount>0),
 description text NOT NULL, actor text NOT NULL, effective_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,operation_key),
 CHECK((kind='sale' AND debit='cash' AND credit='revenue') OR
 (kind='expense' AND debit='expense' AND credit='cash') OR
 (kind IN ('opening','capital') AND debit='cash' AND credit='equity'))
);
CREATE INDEX IF NOT EXISTS economy_journal_company ON economy_journal(user_id,company_id,effective_at);
CREATE TABLE IF NOT EXISTS business_tasks (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
 assignee_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
 title text NOT NULL, detail text NOT NULL, status text NOT NULL DEFAULT 'assigned'
 CHECK(status IN ('assigned','completed','cancelled')),
 outcome text, operation_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 completed_at timestamptz, UNIQUE(user_id,operation_key)
);
ALTER TABLE business_tasks ADD COLUMN IF NOT EXISTS task_type text NOT NULL DEFAULT 'general';
ALTER TABLE business_tasks ADD COLUMN IF NOT EXISTS outcome_document_id uuid REFERENCES documents(id) ON DELETE SET NULL;
CREATE TABLE IF NOT EXISTS employment_records (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
 job_title text NOT NULL, annual_salary numeric(20,2) NOT NULL CHECK(annual_salary>0),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','terminated')),
 hired_at timestamptz NOT NULL DEFAULT now(), terminated_at timestamptz, termination_reason text,
 operation_key text NOT NULL, UNIQUE(user_id,operation_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS employment_active_contact ON employment_records(user_id,contact_id) WHERE status='active';
`;
