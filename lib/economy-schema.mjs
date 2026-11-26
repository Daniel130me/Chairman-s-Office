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
ALTER TABLE settings ADD COLUMN IF NOT EXISTS quiet_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE business_tasks ADD COLUMN IF NOT EXISTS report_call_invite_id uuid REFERENCES invites(id) ON DELETE SET NULL;
ALTER TABLE calls ADD COLUMN IF NOT EXISTS followup_state text DEFAULT 'pending';
UPDATE calls SET followup_state='skipped' WHERE status<>'missed' OR started_at<now()-interval '30 minutes';
ALTER TABLE calls ADD COLUMN IF NOT EXISTS followup_attempt_at timestamptz;
CREATE TABLE IF NOT EXISTS business_invoices (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 invoice_number text NOT NULL,customer_name text NOT NULL,description text NOT NULL,
 amount numeric(20,2) NOT NULL CHECK(amount>0),currency text NOT NULL DEFAULT 'USD' CHECK(currency='USD'),
 status text NOT NULL DEFAULT 'issued' CHECK(status IN ('issued','paid','void')),
 issued_at timestamptz NOT NULL DEFAULT now(),due_at timestamptz NOT NULL,
 paid_at timestamptz,operation_key text NOT NULL,UNIQUE(user_id,invoice_number),UNIQUE(user_id,operation_key)
);
CREATE TABLE IF NOT EXISTS business_contracts (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 title text NOT NULL,counterparty text NOT NULL,contract_type text NOT NULL,
 value numeric(20,2) NOT NULL CHECK(value>=0),currency text NOT NULL DEFAULT 'USD' CHECK(currency='USD'),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','completed','disputed','terminated')),
 terms text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 operation_key text NOT NULL,UNIQUE(user_id,operation_key)
);
CREATE TABLE IF NOT EXISTS payroll_runs (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 period_month text NOT NULL CHECK(period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
 total numeric(20,2) NOT NULL CHECK(total>=0),employee_count integer NOT NULL CHECK(employee_count>=0),
 status text NOT NULL DEFAULT 'paid' CHECK(status IN ('paid')),
 paid_at timestamptz NOT NULL DEFAULT now(),operation_key text NOT NULL,UNIQUE(user_id,company_id,period_month),UNIQUE(user_id,operation_key)
);
CREATE TABLE IF NOT EXISTS payroll_items (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 payroll_run_id uuid NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
 employment_id uuid NOT NULL REFERENCES employment_records(id) ON DELETE RESTRICT,
 employee_name text NOT NULL,job_title text NOT NULL,gross_pay numeric(20,2) NOT NULL CHECK(gross_pay>=0)
);
CREATE TABLE IF NOT EXISTS world_audit_log (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 actor_type text NOT NULL,actor_id uuid,actor_name text NOT NULL,
 action text NOT NULL,entity_type text NOT NULL,entity_id uuid,
 before_state jsonb,after_state jsonb,reason text,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS world_audit_recent ON world_audit_log(user_id,created_at DESC);
ALTER TABLE worlds ADD COLUMN IF NOT EXISTS last_communication_at timestamptz;
CREATE TABLE IF NOT EXISTS world_conversations (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 thread_id uuid NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
 title text NOT NULL,status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','archived')),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 last_message_at timestamptz,UNIQUE(user_id,thread_id)
);
CREATE TABLE IF NOT EXISTS world_conversation_participants (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL REFERENCES world_conversations(id) ON DELETE CASCADE,
 contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
 joined_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(conversation_id,contact_id)
);
CREATE TABLE IF NOT EXISTS world_conversation_messages (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL REFERENCES world_conversations(id) ON DELETE CASCADE,
 sender_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
 recipient_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
 sender_name text NOT NULL,body text NOT NULL,channel text NOT NULL DEFAULT 'text',
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS world_conversation_messages_recent ON world_conversation_messages(user_id,conversation_id,created_at DESC);
`;
