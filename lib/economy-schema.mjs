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
ALTER TABLE economy_journal DROP CONSTRAINT IF EXISTS economy_journal_kind_check;
ALTER TABLE economy_journal ADD CONSTRAINT economy_journal_kind_check CHECK(kind IN ('opening','sale','expense','capital','invoice','invoice-payment','purchase','supplier-payment','payroll','asset-purchase','loan-draw','loan-payment','tax-accrual','tax-payment','cogs','dividend','depreciation','interest-payment','investment-purchase','investment-sale','interest-accrual','accrued-interest-payment','expense-refund','investment-impairment','investment-gain','intercompany-advance','intercompany-receipt','intercompany-repayment','intercompany-collection','stock-count-loss','stock-count-gain','customer-refund','customer-return-cost','supplier-refund','supplier-return-gain','supplier-return-loss','invoice-credit','supplier-credit','supplier-credit-gain'));
ALTER TABLE economy_journal DROP CONSTRAINT IF EXISTS economy_journal_debit_check;
ALTER TABLE economy_journal ADD CONSTRAINT economy_journal_debit_check CHECK(debit IN ('cash','accounts_receivable','inventory','fixed_assets','accounts_payable','tax_payable','loans_payable','equity','retained_earnings','expense','payroll_expense','cost_of_goods_sold','tax_expense','depreciation_expense','interest_expense','investments','revenue','interest_payable'));
ALTER TABLE economy_journal DROP CONSTRAINT IF EXISTS economy_journal_credit_check;
ALTER TABLE economy_journal ADD CONSTRAINT economy_journal_credit_check CHECK(credit IN ('cash','accounts_receivable','inventory','fixed_assets','accounts_payable','tax_payable','loans_payable','equity','retained_earnings','expense','payroll_expense','cost_of_goods_sold','tax_expense','depreciation_expense','revenue','investments','interest_expense','interest_payable'));
CREATE TABLE IF NOT EXISTS company_chart_accounts (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 code text NOT NULL,name text NOT NULL,account_type text NOT NULL CHECK(account_type IN ('asset','liability','equity','revenue','expense')),
 normal_balance text NOT NULL CHECK(normal_balance IN ('debit','credit')),
 UNIQUE(user_id,company_id,code)
);

ALTER TABLE economy_journal DROP CONSTRAINT IF EXISTS economy_journal_check;
ALTER TABLE economy_journal DROP CONSTRAINT IF EXISTS economy_journal_balanced_kind_check;
ALTER TABLE economy_journal ADD CONSTRAINT economy_journal_balanced_kind_check CHECK(
 (kind='sale' AND debit='cash' AND credit='revenue') OR
 (kind='expense' AND debit='expense' AND credit='cash') OR
 (kind IN ('opening','capital') AND debit='cash' AND credit='equity') OR
 (kind='invoice' AND debit='accounts_receivable' AND credit='revenue') OR
 (kind='invoice-payment' AND debit='cash' AND credit='accounts_receivable') OR
 (kind='purchase' AND debit='inventory' AND credit='accounts_payable') OR
 (kind='supplier-payment' AND debit='accounts_payable' AND credit='cash') OR
 (kind='payroll' AND debit='payroll_expense' AND credit='cash') OR
 (kind='asset-purchase' AND debit='fixed_assets' AND credit='cash') OR
 (kind='loan-draw' AND debit='cash' AND credit='loans_payable') OR
 (kind='loan-payment' AND debit='loans_payable' AND credit='cash') OR
 (kind='tax-accrual' AND debit='tax_expense' AND credit='tax_payable') OR
 (kind='tax-payment' AND debit='tax_payable' AND credit='cash') OR
 (kind='cogs' AND debit='cost_of_goods_sold' AND credit='inventory') OR
 (kind='dividend' AND debit='retained_earnings' AND credit='cash') OR
 (kind='depreciation' AND debit='depreciation_expense' AND credit='fixed_assets') OR
 (kind='interest-payment' AND debit='interest_expense' AND credit='cash') OR
 (kind='investment-purchase' AND debit='investments' AND credit='cash') OR
 (kind='investment-sale' AND debit='cash' AND credit='investments') OR
 (kind='interest-accrual' AND debit='interest_expense' AND credit='interest_payable') OR
 (kind='accrued-interest-payment' AND debit='interest_payable' AND credit='cash') OR
 (kind='expense-refund' AND debit='cash' AND credit='expense') OR
 (kind='investment-impairment' AND debit='expense' AND credit='investments') OR
 (kind='investment-gain' AND debit='cash' AND credit='revenue') OR
 (kind='intercompany-advance' AND debit='accounts_receivable' AND credit='cash') OR
 (kind='intercompany-receipt' AND debit='cash' AND credit='loans_payable') OR
 (kind='intercompany-repayment' AND debit='loans_payable' AND credit='cash') OR
 (kind='intercompany-collection' AND debit='cash' AND credit='accounts_receivable') OR
 (kind='stock-count-loss' AND debit='expense' AND credit='inventory') OR
 (kind='stock-count-gain' AND debit='inventory' AND credit='revenue') OR
 (kind='customer-refund' AND debit='revenue' AND credit='cash') OR
 (kind='customer-return-cost' AND debit='inventory' AND credit='cost_of_goods_sold') OR
 (kind='supplier-refund' AND debit='cash' AND credit='inventory') OR
 (kind='supplier-return-gain' AND debit='cash' AND credit='revenue') OR
 (kind='supplier-return-loss' AND debit='expense' AND credit='inventory') OR
 (kind='invoice-credit' AND debit='revenue' AND credit='accounts_receivable') OR
 (kind='supplier-credit' AND debit='accounts_payable' AND credit='inventory') OR
 (kind='supplier-credit-gain' AND debit='accounts_payable' AND credit='revenue')
);

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
ALTER TABLE business_tasks ADD COLUMN IF NOT EXISTS assigned_by_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL;
ALTER TABLE business_tasks ADD COLUMN IF NOT EXISTS source_evidence jsonb;
CREATE TABLE IF NOT EXISTS executive_work_cycles (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 actor_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
 cycle_key text NOT NULL,evidence jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','executed','deferred','failed')),
 decision jsonb,task_id uuid REFERENCES business_tasks(id) ON DELETE SET NULL,
 approval_id uuid,attempts integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),attempted_at timestamptz,completed_at timestamptz,
 UNIQUE(user_id,cycle_key)
);
CREATE INDEX IF NOT EXISTS executive_work_cycles_pending ON executive_work_cycles(user_id,created_at) WHERE status='pending';
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
CREATE TABLE IF NOT EXISTS commercial_opportunities (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,customer_contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
 executive_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,operation_key text NOT NULL,
 stage text NOT NULL DEFAULT 'lead' CHECK(stage IN ('lead','negotiating','drafted','lost','deferred','failed')),
 proposed_value numeric(20,2) CHECK(proposed_value>0),proposal jsonb,negotiation jsonb,
 contract_id uuid REFERENCES business_contracts(id) ON DELETE SET NULL,
 attempts integer NOT NULL DEFAULT 0,attempted_at timestamptz,next_action_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,operation_key)
);
CREATE INDEX IF NOT EXISTS commercial_opportunities_due ON commercial_opportunities(user_id,next_action_at) WHERE stage IN ('lead','negotiating');
CREATE TABLE IF NOT EXISTS commercial_milestones (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 opportunity_id uuid NOT NULL UNIQUE REFERENCES commercial_opportunities(id) ON DELETE CASCADE,contract_id uuid NOT NULL UNIQUE REFERENCES business_contracts(id) ON DELETE CASCADE,
 company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,amount numeric(20,2) NOT NULL CHECK(amount>0),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','delivered','invoiced','paid','blocked')),
 due_at timestamptz NOT NULL,delivery_journal_id uuid REFERENCES economy_journal(id),invoice_id uuid REFERENCES business_invoices(id),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE commercial_milestones ADD COLUMN IF NOT EXISTS payment_attempt_at timestamptz;
ALTER TABLE commercial_milestones ADD COLUMN IF NOT EXISTS payment_decision jsonb;
CREATE INDEX IF NOT EXISTS commercial_milestones_due ON commercial_milestones(user_id,due_at) WHERE status IN ('pending','delivered','invoiced');
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
ALTER TABLE business_invoices ADD COLUMN IF NOT EXISTS risk_level text NOT NULL DEFAULT 'none' CHECK(risk_level IN ('none','review','high'));
ALTER TABLE business_invoices ADD COLUMN IF NOT EXISTS risk_reason text;
CREATE TABLE IF NOT EXISTS investigation_cases (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
 source_invoice_id uuid REFERENCES business_invoices(id) ON DELETE SET NULL,
 title text NOT NULL,allegation text NOT NULL,severity text NOT NULL DEFAULT 'moderate' CHECK(severity IN ('low','moderate','high','critical')),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','in-review','substantiated','unsubstantiated','closed')),
 finding text,opened_by text NOT NULL,opened_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS investigation_evidence (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 case_id uuid NOT NULL REFERENCES investigation_cases(id) ON DELETE CASCADE,
 evidence_type text NOT NULL,description text NOT NULL,source_reference text,confidence numeric(4,3) CHECK(confidence BETWEEN 0 AND 1),
 collected_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS investigations_recent ON investigation_cases(user_id,status,opened_at DESC);
ALTER TABLE employment_records ADD COLUMN IF NOT EXISTS salary_basis text NOT NULL DEFAULT 'chairman-entered';
ALTER TABLE employment_records ADD COLUMN IF NOT EXISTS separation_type text CHECK(separation_type IN ('termination','resignation'));
CREATE TABLE IF NOT EXISTS employment_terms (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 employment_id uuid NOT NULL REFERENCES employment_records(id) ON DELETE CASCADE,
 effective_on date NOT NULL,job_title text NOT NULL,annual_salary numeric(20,2) NOT NULL CHECK(annual_salary>0),
 reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(employment_id,effective_on)
);
INSERT INTO employment_terms(id,user_id,employment_id,effective_on,job_title,annual_salary,reason)
 SELECT gen_random_uuid(),user_id,id,(hired_at AT TIME ZONE 'UTC')::date,job_title,annual_salary,'Opening recorded employment terms'
 FROM employment_records ON CONFLICT(employment_id,effective_on) DO NOTHING;
CREATE TABLE IF NOT EXISTS hr_cases (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 employment_id uuid REFERENCES employment_records(id) ON DELETE SET NULL,
 actor_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
 kind text NOT NULL CHECK(kind IN ('recruitment','review','promotion','resignation')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready','approved','rejected','executed','deferred')),
 title text NOT NULL,evidence jsonb NOT NULL,proposal jsonb,decision_reason text,
 source_key text NOT NULL,attempts integer NOT NULL DEFAULT 0,attempted_at timestamptz,effective_on date,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,source_key)
);
CREATE INDEX IF NOT EXISTS hr_cases_due ON hr_cases(user_id,status,created_at);

ALTER TABLE worlds ADD COLUMN IF NOT EXISTS last_real_signal_at timestamptz;
CREATE TABLE IF NOT EXISTS real_world_signals (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 signal_key text NOT NULL,signal_type text NOT NULL,label text NOT NULL,
 value numeric(24,8) NOT NULL,unit text NOT NULL,source_name text NOT NULL,
 source_url text NOT NULL,observed_at timestamptz NOT NULL,fetched_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,signal_key,observed_at)
);
CREATE INDEX IF NOT EXISTS real_world_signals_recent ON real_world_signals(user_id,observed_at DESC);
ALTER TABLE worlds ADD COLUMN IF NOT EXISTS last_market_move_at timestamptz;
CREATE TABLE IF NOT EXISTS external_organizations (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 name text NOT NULL,sector text NOT NULL,organization_type text NOT NULL,
 strategy text NOT NULL,market_position text NOT NULL DEFAULT 'established',
 reputation integer NOT NULL DEFAULT 55 CHECK(reputation BETWEEN 0 AND 100),
 competitive_pressure integer NOT NULL DEFAULT 35 CHECK(competitive_pressure BETWEEN 0 AND 100),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
 created_at timestamptz NOT NULL DEFAULT now(),last_move_at timestamptz,
 UNIQUE(user_id,world_id,name)
);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES external_organizations(id) ON DELETE SET NULL;

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS loyalty integer NOT NULL DEFAULT 55 CHECK(loyalty BETWEEN 0 AND 100);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ambition integer NOT NULL DEFAULT 50 CHECK(ambition BETWEEN 0 AND 100);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS reputation integer NOT NULL DEFAULT 55 CHECK(reputation BETWEEN 0 AND 100);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS expertise jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS personality_profile jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS next_agenda_at timestamptz;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_development_at timestamptz;

CREATE TABLE IF NOT EXISTS character_memories (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
 memory_type text NOT NULL CHECK(memory_type IN ('interaction','commitment','preference','observation','belief','rumor','lesson','relationship','agenda')),
 epistemic_status text NOT NULL CHECK(epistemic_status IN ('confirmed','reported','belief','rumor','forecast')),
 sensitivity text NOT NULL DEFAULT 'internal' CHECK(sensitivity IN ('public','internal','confidential','restricted')),
 content text NOT NULL,source_type text NOT NULL,source_id text,source_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
 confidence numeric(4,3) NOT NULL DEFAULT 0.7 CHECK(confidence BETWEEN 0 AND 1),
 importance smallint NOT NULL DEFAULT 3 CHECK(importance BETWEEN 1 AND 5),
 operation_key text NOT NULL,occurred_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(),last_recalled_at timestamptz,
 UNIQUE(user_id,operation_key)
);
CREATE INDEX IF NOT EXISTS character_memories_context ON character_memories(user_id,contact_id,importance DESC,occurred_at DESC);
CREATE TABLE IF NOT EXISTS character_memory_jobs (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
 source_type text NOT NULL,source_id text NOT NULL,source_context jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','failed')),
 attempts integer NOT NULL DEFAULT 0,attempted_at timestamptz,next_attempt_at timestamptz NOT NULL DEFAULT now(),
 last_error_code text,created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 operation_key text NOT NULL,UNIQUE(user_id,operation_key)
);
CREATE INDEX IF NOT EXISTS character_memory_jobs_due ON character_memory_jobs(user_id,status,next_attempt_at,created_at);

CREATE TABLE IF NOT EXISTS character_goals (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
 goal_type text NOT NULL CHECK(goal_type IN ('business','career','relationship','personal','risk','leadership')),
 title text NOT NULL,description text NOT NULL,priority text NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high')),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused','completed','abandoned')),
 target_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
 target_company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
 rationale text NOT NULL,progress smallint NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
 evidence jsonb NOT NULL DEFAULT '[]'::jsonb,source_key text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,source_key)
);
CREATE INDEX IF NOT EXISTS character_goals_active ON character_goals(user_id,contact_id,status,priority);

ALTER TABLE threads ADD COLUMN IF NOT EXISTS character_goal_id uuid REFERENCES character_goals(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS threads_character_goal_unique ON threads(user_id,character_goal_id) WHERE character_goal_id IS NOT NULL;


CREATE TABLE IF NOT EXISTS character_agenda_jobs (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','failed')),
 attempts integer NOT NULL DEFAULT 0,attempted_at timestamptz,next_attempt_at timestamptz NOT NULL DEFAULT now(),
 last_error_code text,operation_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 UNIQUE(user_id,operation_key)
);
CREATE INDEX IF NOT EXISTS character_agenda_jobs_due ON character_agenda_jobs(user_id,status,next_attempt_at,created_at);

CREATE TABLE IF NOT EXISTS character_relationships (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 from_contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
 to_contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
 relationship_label text NOT NULL DEFAULT 'colleague',
 trust integer NOT NULL DEFAULT 50 CHECK(trust BETWEEN 0 AND 100),
 respect integer NOT NULL DEFAULT 50 CHECK(respect BETWEEN 0 AND 100),
 loyalty integer NOT NULL DEFAULT 45 CHECK(loyalty BETWEEN 0 AND 100),
 tension integer NOT NULL DEFAULT 10 CHECK(tension BETWEEN 0 AND 100),
 familiarity integer NOT NULL DEFAULT 5 CHECK(familiarity BETWEEN 0 AND 100),
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(from_contact_id<>to_contact_id),UNIQUE(user_id,from_contact_id,to_contact_id)
);
CREATE INDEX IF NOT EXISTS character_relationships_from ON character_relationships(user_id,from_contact_id,updated_at DESC);

UPDATE contacts SET expertise=jsonb_build_array(title,company) WHERE expertise='[]'::jsonb;
UPDATE contacts SET personality_profile=jsonb_build_object('communicationStyle',temperament,'motivators',agenda,'independentAgency',true) WHERE personality_profile='{}'::jsonb;
INSERT INTO character_relationships(id,user_id,world_id,from_contact_id,to_contact_id,relationship_label,trust,respect,loyalty,tension,familiarity)
SELECT gen_random_uuid(),a.user_id,a.world_id,a.id,b.id,'colleague',50,55,48,10,20
FROM contacts a JOIN contacts b ON b.user_id=a.user_id AND b.world_id=a.world_id
WHERE a.kind='internal' AND b.kind='internal' AND a.id<>b.id
ON CONFLICT(user_id,from_contact_id,to_contact_id) DO NOTHING;
INSERT INTO character_relationships(id,user_id,world_id,from_contact_id,to_contact_id,relationship_label,trust,respect,loyalty,tension,familiarity)
SELECT gen_random_uuid(),c.user_id,c.world_id,i.id,c.id,
 CASE WHEN c.kind IN ('rival','competitor') THEN 'rival' WHEN c.kind='friend' THEN 'business-friend' ELSE 'professional-counterparty' END,
 45,50,28,15,12
FROM contacts c JOIN contacts i ON i.user_id=c.user_id AND i.world_id=c.world_id AND i.kind='internal'
 AND i.title=CASE
  WHEN c.kind IN ('investor','banker') THEN 'Group CFO'
  WHEN c.kind IN ('rival','competitor') THEN 'Group Strategy Director'
  WHEN c.kind IN ('friend','adviser') THEN 'Chief of Staff'
  WHEN c.kind='client' THEN 'Chief Commercial Officer'
  WHEN c.kind IN ('supplier','vendor','partner') THEN 'Chief Operating Officer'
  WHEN c.kind IN ('regulator','journalist') THEN 'General Counsel'
  ELSE 'Chief of Staff' END
WHERE c.kind<>'internal'
ON CONFLICT(user_id,from_contact_id,to_contact_id) DO NOTHING;
INSERT INTO character_relationships(id,user_id,world_id,from_contact_id,to_contact_id,relationship_label,trust,respect,loyalty,tension,familiarity)
SELECT gen_random_uuid(),c.user_id,c.world_id,c.id,i.id,
 CASE WHEN c.kind IN ('rival','competitor') THEN 'rival' WHEN c.kind='friend' THEN 'business-friend' ELSE 'professional-counterparty' END,
 45,50,28,15,12
FROM contacts c JOIN contacts i ON i.user_id=c.user_id AND i.world_id=c.world_id AND i.kind='internal'
 AND i.title=CASE
  WHEN c.kind IN ('investor','banker') THEN 'Group CFO'
  WHEN c.kind IN ('rival','competitor') THEN 'Group Strategy Director'
  WHEN c.kind IN ('friend','adviser') THEN 'Chief of Staff'
  WHEN c.kind='client' THEN 'Chief Commercial Officer'
  WHEN c.kind IN ('supplier','vendor','partner') THEN 'Chief Operating Officer'
  WHEN c.kind IN ('regulator','journalist') THEN 'General Counsel'
  ELSE 'Chief of Staff' END
WHERE c.kind<>'internal'
ON CONFLICT(user_id,from_contact_id,to_contact_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS character_relationship_events (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 relationship_id uuid NOT NULL REFERENCES character_relationships(id) ON DELETE CASCADE,
 source_key text NOT NULL,event_type text NOT NULL,reason text NOT NULL,delta jsonb NOT NULL,
 before_state jsonb NOT NULL,after_state jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,source_key)
);

CREATE TABLE IF NOT EXISTS market_moves (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 organization_id uuid NOT NULL REFERENCES external_organizations(id) ON DELETE CASCADE,
 contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
 company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
 move_type text NOT NULL,title text NOT NULL,description text NOT NULL,
 impact text NOT NULL,requires_attention boolean NOT NULL DEFAULT false,
 operation_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,operation_key)
);
CREATE INDEX IF NOT EXISTS market_moves_recent ON market_moves(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS action_requests (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 requested_by_contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
 company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
 action_type text NOT NULL CHECK(action_type IN ('expense','hire','fire','activate-contract','assign-task')),
 title text NOT NULL,reason text NOT NULL,payload jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','executing','executed','failed')),
 operation_key text NOT NULL,decision_reason text,last_error text,result jsonb,
 attempts integer NOT NULL DEFAULT 0,execution_attempt_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),decided_at timestamptz,executed_at timestamptz,
 UNIQUE(user_id,operation_key)
);
CREATE INDEX IF NOT EXISTS action_requests_queue ON action_requests(user_id,status,created_at DESC);
CREATE TABLE IF NOT EXISTS personal_accounts (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 name text NOT NULL,account_type text NOT NULL CHECK(account_type IN ('cash','bank','brokerage','other')),
 currency text NOT NULL DEFAULT 'USD' CHECK(currency='USD'),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','closed')),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,name)
);
CREATE TABLE IF NOT EXISTS personal_transactions (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 account_id uuid NOT NULL REFERENCES personal_accounts(id) ON DELETE CASCADE,
 direction text NOT NULL CHECK(direction IN ('credit','debit')),
 amount numeric(20,2) NOT NULL CHECK(amount>0),description text NOT NULL,
 source_type text NOT NULL DEFAULT 'manual',source_id uuid,
 operation_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,operation_key)
);
CREATE TABLE IF NOT EXISTS personal_assets (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 account_id uuid NOT NULL REFERENCES personal_accounts(id) ON DELETE RESTRICT,
 name text NOT NULL,category text NOT NULL,purchase_cost numeric(20,2) NOT NULL CHECK(purchase_cost>0),
 estimated_value numeric(20,2) NOT NULL CHECK(estimated_value>=0),
 status text NOT NULL DEFAULT 'owned' CHECK(status IN ('owned','sold')),
 notes text,acquired_at timestamptz NOT NULL DEFAULT now(),sold_at timestamptz,
 operation_key text NOT NULL,UNIQUE(user_id,operation_key)
);
CREATE TABLE IF NOT EXISTS personal_investments (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 account_id uuid NOT NULL REFERENCES personal_accounts(id) ON DELETE RESTRICT,
 name text NOT NULL,asset_class text NOT NULL,quantity numeric(24,8) NOT NULL CHECK(quantity>0),
 cost_basis numeric(20,2) NOT NULL CHECK(cost_basis>0),current_value numeric(20,2) NOT NULL CHECK(current_value>=0),
 risk_level text NOT NULL DEFAULT 'unrated' CHECK(risk_level IN ('low','moderate','high','speculative','unrated')),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','sold')),
 purchased_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 operation_key text NOT NULL,UNIQUE(user_id,operation_key)
);
CREATE INDEX IF NOT EXISTS personal_transactions_recent ON personal_transactions(user_id,account_id,created_at DESC);
CREATE TABLE IF NOT EXISTS personal_debts (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 account_id uuid NOT NULL REFERENCES personal_accounts(id) ON DELETE RESTRICT,
 lender text NOT NULL,purpose text NOT NULL,principal numeric(20,2) NOT NULL CHECK(principal>0),
 outstanding numeric(20,2) NOT NULL CHECK(outstanding>=0 AND outstanding<=principal),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','paid')),
 operation_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,operation_key)
);
CREATE TABLE IF NOT EXISTS personal_debt_payments (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 debt_id uuid NOT NULL REFERENCES personal_debts(id) ON DELETE CASCADE,
 principal numeric(20,2) NOT NULL CHECK(principal>=0),interest numeric(20,2) NOT NULL CHECK(interest>=0),
 operation_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,operation_key),CHECK(principal+interest>0)
);
ALTER TABLE personal_assets ADD COLUMN IF NOT EXISTS monthly_upkeep numeric(20,2) NOT NULL DEFAULT 0 CHECK(monthly_upkeep>=0);
ALTER TABLE personal_assets ADD COLUMN IF NOT EXISTS next_upkeep_on date;
CREATE TABLE IF NOT EXISTS personal_upkeep_runs (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 asset_id uuid NOT NULL REFERENCES personal_assets(id) ON DELETE CASCADE,
 due_on date NOT NULL,amount numeric(20,2) NOT NULL CHECK(amount>0),
 status text NOT NULL CHECK(status IN ('unpaid','paid')),created_at timestamptz NOT NULL DEFAULT now(),paid_at timestamptz,
 UNIQUE(asset_id,due_on)
);
CREATE TABLE IF NOT EXISTS company_loans (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 lender_name text NOT NULL,principal numeric(20,2) NOT NULL CHECK(principal>0),
 outstanding_principal numeric(20,2) NOT NULL CHECK(outstanding_principal>=0),
 annual_interest_rate numeric(8,4) NOT NULL CHECK(annual_interest_rate>=0 AND annual_interest_rate<=100),
 term_months integer NOT NULL CHECK(term_months BETWEEN 1 AND 360),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','disbursed','closed','cancelled')),
 purpose text NOT NULL,operation_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 approved_at timestamptz,disbursed_at timestamptz,UNIQUE(user_id,operation_key)
);
CREATE TABLE IF NOT EXISTS company_loan_payments (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 loan_id uuid NOT NULL REFERENCES company_loans(id) ON DELETE CASCADE,
 principal_paid numeric(20,2) NOT NULL CHECK(principal_paid>0),
 interest_paid numeric(20,2) NOT NULL DEFAULT 0 CHECK(interest_paid>=0),
 total_paid numeric(20,2) NOT NULL CHECK(total_paid>0),
 reason text NOT NULL,operation_key text NOT NULL,paid_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,operation_key)
);

ALTER TABLE company_loans ADD COLUMN IF NOT EXISTS schedule_version integer NOT NULL DEFAULT 0;
ALTER TABLE company_loan_payments DROP CONSTRAINT IF EXISTS company_loan_payments_principal_paid_check;
ALTER TABLE company_loan_payments ADD CONSTRAINT company_loan_payments_principal_paid_check CHECK(principal_paid>=0);
CREATE TABLE IF NOT EXISTS company_loan_installments (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 loan_id uuid NOT NULL REFERENCES company_loans(id) ON DELETE CASCADE,
 installment integer NOT NULL CHECK(installment>0),due_date date NOT NULL,
 principal_due numeric(20,2) NOT NULL CHECK(principal_due>=0),
 principal_paid numeric(20,2) NOT NULL DEFAULT 0 CHECK(principal_paid>=0 AND principal_paid<=principal_due),
 estimated_interest numeric(20,2) NOT NULL CHECK(estimated_interest>=0),
 interest_due numeric(20,2) NOT NULL DEFAULT 0 CHECK(interest_due>=0),
 interest_paid numeric(20,2) NOT NULL DEFAULT 0 CHECK(interest_paid>=0 AND interest_paid<=interest_due),
 accrued_at timestamptz,overdue_notified_at timestamptz,
 UNIQUE(loan_id,installment)
);
CREATE INDEX IF NOT EXISTS company_loan_installments_due ON company_loan_installments(user_id,due_date,loan_id);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS parent_company_id uuid REFERENCES companies(id) ON DELETE SET NULL;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS ownership_percentage numeric(5,2) NOT NULL DEFAULT 100 CHECK(ownership_percentage>0 AND ownership_percentage<=100);
CREATE TABLE IF NOT EXISTS company_investments (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 investor_company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 target_company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
 acquisition_id uuid UNIQUE,
 target_name text NOT NULL,sector text NOT NULL,ownership_percentage numeric(5,2) NOT NULL CHECK(ownership_percentage>0 AND ownership_percentage<=100),
 cost_basis numeric(20,2) NOT NULL CHECK(cost_basis>0),current_value numeric(20,2) NOT NULL CHECK(current_value>=0),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','exited')),
 acquired_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS company_acquisitions (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 buyer_company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 target_company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
 target_name text NOT NULL,target_sector text NOT NULL,seller_name text NOT NULL,
 purchase_price numeric(20,2) NOT NULL CHECK(purchase_price>0),
 target_valuation numeric(20,2) NOT NULL CHECK(target_valuation>=0),
 ownership_percentage numeric(5,2) NOT NULL CHECK(ownership_percentage>0 AND ownership_percentage<=100),
 description text NOT NULL,status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','completed','cancelled')),
 operation_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),approved_at timestamptz,completed_at timestamptz,
 UNIQUE(user_id,operation_key)
);

CREATE TABLE IF NOT EXISTS inventory_items (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 sku text NOT NULL,name text NOT NULL,quantity numeric(20,4) NOT NULL DEFAULT 0 CHECK(quantity>=0),
 average_cost numeric(20,2) NOT NULL DEFAULT 0 CHECK(average_cost>=0),
 reorder_level numeric(20,4) NOT NULL DEFAULT 0 CHECK(reorder_level>=0),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','discontinued')),
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,company_id,sku)
);
CREATE TABLE IF NOT EXISTS purchase_orders (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 po_number text NOT NULL,vendor_name text NOT NULL,description text NOT NULL,
 total numeric(20,2) NOT NULL CHECK(total>0),status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','received','paid','cancelled')),
 due_at timestamptz,operation_key text NOT NULL,approval_reason text,
 created_at timestamptz NOT NULL DEFAULT now(),approved_at timestamptz,received_at timestamptz,paid_at timestamptz,
 UNIQUE(user_id,po_number),UNIQUE(user_id,operation_key)
);
CREATE TABLE IF NOT EXISTS purchase_order_lines (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
 inventory_item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
 item_name text NOT NULL,sku text NOT NULL,quantity numeric(20,4) NOT NULL CHECK(quantity>0),
 unit_cost numeric(20,2) NOT NULL CHECK(unit_cost>0),line_total numeric(20,2) NOT NULL CHECK(line_total>0)
);
CREATE TABLE IF NOT EXISTS inventory_movements (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 inventory_item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
 direction text NOT NULL CHECK(direction IN ('in','out')),quantity numeric(20,4) NOT NULL CHECK(quantity>0),
 unit_cost numeric(20,2) NOT NULL CHECK(unit_cost>=0),source_type text NOT NULL,source_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inventory_company_sku ON inventory_items(user_id,company_id,sku);
CREATE INDEX IF NOT EXISTS purchase_orders_recent ON purchase_orders(user_id,created_at DESC);
ALTER TABLE purchase_order_lines ADD COLUMN IF NOT EXISTS received_quantity numeric(20,4) NOT NULL DEFAULT 0 CHECK(received_quantity>=0 AND received_quantity<=quantity);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS received_total numeric(20,2) NOT NULL DEFAULT 0 CHECK(received_total>=0 AND received_total<=total);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS paid_total numeric(20,2) NOT NULL DEFAULT 0 CHECK(paid_total>=0 AND paid_total<=received_total);
UPDATE purchase_order_lines l SET received_quantity=l.quantity FROM purchase_orders p WHERE p.id=l.purchase_order_id AND p.user_id=l.user_id AND p.status IN ('received','paid') AND l.received_quantity=0;
UPDATE purchase_orders SET received_total=total WHERE status IN ('received','paid') AND received_total=0;
UPDATE purchase_orders SET paid_total=total WHERE status='paid' AND paid_total=0;
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS stock_value numeric(20,2) CHECK(stock_value>=0);
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS reorder_quantity numeric(20,4) NOT NULL DEFAULT 0 CHECK(reorder_quantity>=0);
ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS preferred_supplier text;
UPDATE inventory_items SET stock_value=round(quantity*average_cost,2) WHERE stock_value IS NULL;
ALTER TABLE inventory_items ALTER COLUMN stock_value SET DEFAULT 0;
ALTER TABLE inventory_items ALTER COLUMN stock_value SET NOT NULL;
CREATE TABLE IF NOT EXISTS procurement_transactions (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 purchase_order_id uuid REFERENCES purchase_orders(id) ON DELETE CASCADE,
 inventory_item_id uuid REFERENCES inventory_items(id) ON DELETE CASCADE,
 operation_key text NOT NULL,kind text NOT NULL CHECK(kind IN ('receipt','supplier-payment','stock-sale')),
 amount numeric(20,2) NOT NULL CHECK(amount>=0),payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,operation_key)
);
CREATE INDEX IF NOT EXISTS procurement_transactions_order ON procurement_transactions(user_id,purchase_order_id,created_at);

CREATE TABLE IF NOT EXISTS relationship_outcomes (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
 source_key text NOT NULL,reason text NOT NULL,before_state jsonb NOT NULL,after_state jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,source_key)
);
CREATE INDEX IF NOT EXISTS relationship_outcomes_contact ON relationship_outcomes(user_id,contact_id,created_at);
CREATE TABLE IF NOT EXISTS stakeholder_engagements (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
 company_id uuid REFERENCES companies(id) ON DELETE SET NULL,
 thread_id uuid REFERENCES threads(id) ON DELETE SET NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sent','deferred','failed')),
 context jsonb NOT NULL,decision jsonb,operation_key text NOT NULL,
 attempted_at timestamptz,attempts integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,UNIQUE(user_id,operation_key)
);
CREATE INDEX IF NOT EXISTS stakeholder_engagements_pending ON stakeholder_engagements(user_id,status,created_at);
CREATE TABLE IF NOT EXISTS supplier_negotiations (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
 supplier_contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','deferred','failed','delivered')),
 decision jsonb,attempted_at timestamptz,attempts integer NOT NULL DEFAULT 0,
 delivery_due_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,purchase_order_id)
);
CREATE INDEX IF NOT EXISTS supplier_negotiations_due ON supplier_negotiations(user_id,status,delivery_due_at);
CREATE TABLE IF NOT EXISTS travel_trips (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 trip_type text NOT NULL CHECK(trip_type IN ('personal','business')),
 title text NOT NULL,origin text NOT NULL,destination text NOT NULL,purpose text NOT NULL,
 depart_at timestamptz NOT NULL,return_at timestamptz,
 status text NOT NULL DEFAULT 'planning' CHECK(status IN ('planning','booked','completed','cancelled')),
 operation_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,operation_key),
 CHECK(return_at IS NULL OR return_at>=depart_at)
);
CREATE TABLE IF NOT EXISTS travel_bookings (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 trip_id uuid NOT NULL REFERENCES travel_trips(id) ON DELETE CASCADE,
 booking_type text NOT NULL CHECK(booking_type IN ('flight','hotel','ground','experience','private-aviation','security')),
 provider text NOT NULL,description text NOT NULL,amount numeric(20,2) NOT NULL CHECK(amount>0),
 payment_source text NOT NULL CHECK(payment_source IN ('personal','company')),
 personal_account_id uuid REFERENCES personal_accounts(id) ON DELETE RESTRICT,
 company_id uuid REFERENCES companies(id) ON DELETE RESTRICT,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','booked','cancelled')),
 operation_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),booked_at timestamptz,
 UNIQUE(user_id,operation_key),
 CHECK((payment_source='personal' AND personal_account_id IS NOT NULL AND company_id IS NULL) OR (payment_source='company' AND company_id IS NOT NULL AND personal_account_id IS NULL))
);

ALTER TABLE travel_bookings ADD COLUMN IF NOT EXISTS refunded_total numeric(20,2) NOT NULL DEFAULT 0 CHECK(refunded_total>=0 AND refunded_total<=amount);
CREATE TABLE IF NOT EXISTS travel_refunds (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 booking_id uuid NOT NULL REFERENCES travel_bookings(id) ON DELETE CASCADE,
 amount numeric(20,2) NOT NULL CHECK(amount>0),reason text NOT NULL,operation_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,operation_key)
);
CREATE TABLE IF NOT EXISTS travel_changes (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 trip_id uuid NOT NULL REFERENCES travel_trips(id) ON DELETE CASCADE,
 before_state jsonb NOT NULL,after_state jsonb NOT NULL,reason text NOT NULL,operation_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,operation_key)
);
CREATE TABLE IF NOT EXISTS security_incidents (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 title text NOT NULL,category text NOT NULL CHECK(category IN ('personal','physical','cyber','fraud','corporate','travel')),
 severity text NOT NULL CHECK(severity IN ('low','medium','high','critical')),
 status text NOT NULL DEFAULT 'reported' CHECK(status IN ('reported','investigating','resolved','false-alarm')),
 description text NOT NULL,location text,reported_by_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
 assigned_to_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
 findings text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),resolved_at timestamptz
);
CREATE TABLE IF NOT EXISTS security_incident_evidence (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 incident_id uuid NOT NULL REFERENCES security_incidents(id) ON DELETE CASCADE,
 evidence_type text NOT NULL CHECK(evidence_type IN ('observation','document','message','transaction','witness','other')),
 description text NOT NULL,source_reference text,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS security_incidents_recent ON security_incidents(user_id,status,created_at DESC);

ALTER TABLE security_incidents ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'reported' CHECK(origin IN ('reported','detected','simulated'));
ALTER TABLE security_incidents ADD COLUMN IF NOT EXISTS source_context jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE security_incidents ADD COLUMN IF NOT EXISTS simulation_key text;
CREATE UNIQUE INDEX IF NOT EXISTS security_incident_simulation_unique ON security_incidents(user_id,simulation_key) WHERE simulation_key IS NOT NULL;
ALTER TABLE security_incident_evidence ADD COLUMN IF NOT EXISTS epistemic_status text NOT NULL DEFAULT 'unverified' CHECK(epistemic_status IN ('unverified','reported','corroborated','disputed'));
ALTER TABLE security_incident_evidence ADD COLUMN IF NOT EXISTS provenance jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE investigation_evidence ADD COLUMN IF NOT EXISTS epistemic_status text NOT NULL DEFAULT 'unverified' CHECK(epistemic_status IN ('unverified','reported','corroborated','disputed'));
ALTER TABLE investigation_evidence ADD COLUMN IF NOT EXISTS provenance jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS security_case_reviews (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 incident_id uuid NOT NULL REFERENCES security_incidents(id) ON DELETE CASCADE,
 case_id uuid REFERENCES investigation_cases(id) ON DELETE SET NULL,
 reviewer_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
 assessment text NOT NULL CHECK(assessment IN ('insufficient','preliminary','credible','corroborated','contradicted')),
 confidence numeric(4,3) NOT NULL CHECK(confidence BETWEEN 0 AND 1),
 summary text NOT NULL,recommended_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
 source_context jsonb NOT NULL DEFAULT '{}'::jsonb,review_key text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,review_key)
);
CREATE INDEX IF NOT EXISTS security_case_reviews_recent ON security_case_reviews(user_id,incident_id,created_at DESC);

CREATE TABLE IF NOT EXISTS security_review_jobs (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 incident_id uuid NOT NULL REFERENCES security_incidents(id) ON DELETE CASCADE,
 case_id uuid REFERENCES investigation_cases(id) ON DELETE SET NULL,
 review_key text NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','failed')),
 attempts integer NOT NULL DEFAULT 0,attempted_at timestamptz,next_attempt_at timestamptz NOT NULL DEFAULT now(),
 last_error_code text,created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 UNIQUE(user_id,review_key)
);
CREATE INDEX IF NOT EXISTS security_review_jobs_due ON security_review_jobs(user_id,status,next_attempt_at,created_at);


CREATE TABLE IF NOT EXISTS security_work_items (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 incident_id uuid NOT NULL REFERENCES security_incidents(id) ON DELETE CASCADE,
 case_id uuid REFERENCES investigation_cases(id) ON DELETE SET NULL,
 review_id uuid REFERENCES security_case_reviews(id) ON DELETE SET NULL,
 assigned_to_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
 target_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
 work_type text NOT NULL CHECK(work_type IN ('document_review','transaction_reconciliation','interview','control_check','legal_review','monitor')),
 title text NOT NULL,instructions text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','blocked','cancelled')),
 result text,source_key text NOT NULL,due_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 UNIQUE(user_id,source_key)
);
CREATE INDEX IF NOT EXISTS security_work_items_queue ON security_work_items(user_id,status,created_at);

CREATE TABLE IF NOT EXISTS security_interviews (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 incident_id uuid NOT NULL REFERENCES security_incidents(id) ON DELETE CASCADE,
 case_id uuid REFERENCES investigation_cases(id) ON DELETE SET NULL,
 work_item_id uuid NOT NULL REFERENCES security_work_items(id) ON DELETE CASCADE,
 interviewer_contact_id uuid REFERENCES contacts(id) ON DELETE SET NULL,
 interviewee_contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
 question text NOT NULL,response text,confidence numeric(4,3) CHECK(confidence BETWEEN 0 AND 1),
 knowledge_basis text CHECK(knowledge_basis IN ('memory','direct-observation','not-aware','unknown')),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','answered','unavailable')),
 attempts integer NOT NULL DEFAULT 0,attempted_at timestamptz,last_error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),answered_at timestamptz,UNIQUE(work_item_id)
);
CREATE INDEX IF NOT EXISTS security_interviews_queue ON security_interviews(user_id,status,created_at);

CREATE TABLE IF NOT EXISTS security_scenario_runs (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 cycle_key text NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','deferred','failed')),
 attempts integer NOT NULL DEFAULT 0,attempted_at timestamptz,next_attempt_at timestamptz NOT NULL DEFAULT now(),
 last_error_code text,incident_id uuid REFERENCES security_incidents(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,UNIQUE(user_id,cycle_key)
);
CREATE INDEX IF NOT EXISTS security_scenario_runs_due ON security_scenario_runs(user_id,status,next_attempt_at);

ALTER TABLE security_incidents ADD COLUMN IF NOT EXISTS source_investigation_id uuid REFERENCES investigation_cases(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS security_incident_investigation_unique ON security_incidents(user_id,source_investigation_id) WHERE source_investigation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS charitable_grants (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 funding_source text NOT NULL CHECK(funding_source IN ('personal','company')),
 personal_account_id uuid REFERENCES personal_accounts(id) ON DELETE RESTRICT,
 company_id uuid REFERENCES companies(id) ON DELETE RESTRICT,
 recipient text NOT NULL,program text NOT NULL,purpose text NOT NULL,
 amount numeric(20,2) NOT NULL CHECK(amount>0),
 status text NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','approved','paid','cancelled')),
 operation_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),approved_at timestamptz,paid_at timestamptz,
 CHECK((funding_source='personal' AND personal_account_id IS NOT NULL AND company_id IS NULL) OR (funding_source='company' AND company_id IS NOT NULL AND personal_account_id IS NULL)),
 UNIQUE(user_id,operation_key)
);
CREATE INDEX IF NOT EXISTS charitable_grants_recent ON charitable_grants(user_id,created_at DESC);
ALTER TABLE charitable_grants ADD COLUMN IF NOT EXISTS verification_required boolean NOT NULL DEFAULT false;
ALTER TABLE charitable_grants ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'unverified' CHECK(verification_status IN ('unverified','verified','rejected'));
ALTER TABLE charitable_grants ADD COLUMN IF NOT EXISTS verification_evidence text;
ALTER TABLE charitable_grants ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE charitable_grants ADD COLUMN IF NOT EXISTS recurring_monthly boolean NOT NULL DEFAULT false;
ALTER TABLE charitable_grants ADD COLUMN IF NOT EXISTS next_grant_on date;
ALTER TABLE charitable_grants ADD COLUMN IF NOT EXISTS parent_grant_id uuid REFERENCES charitable_grants(id) ON DELETE SET NULL;
CREATE TABLE IF NOT EXISTS grant_impact_reports (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 grant_id uuid NOT NULL REFERENCES charitable_grants(id) ON DELETE CASCADE,
 metric text NOT NULL,value numeric(20,4) NOT NULL CHECK(value>=0),unit text NOT NULL,evidence text NOT NULL,
 operation_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,operation_key)
);
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
CREATE TABLE IF NOT EXISTS character_relationship_review_jobs (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL REFERENCES world_conversations(id) ON DELETE CASCADE,
 latest_message_id uuid NOT NULL REFERENCES world_conversation_messages(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','failed')),
 attempts integer NOT NULL DEFAULT 0,attempted_at timestamptz,next_attempt_at timestamptz NOT NULL DEFAULT now(),
 last_error_code text,operation_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 UNIQUE(user_id,operation_key)
);
CREATE INDEX IF NOT EXISTS character_relationship_review_due ON character_relationship_review_jobs(user_id,status,next_attempt_at);

CREATE TABLE IF NOT EXISTS character_meeting_relationship_jobs (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
 from_contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
 to_contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','failed')),
 attempts integer NOT NULL DEFAULT 0,attempted_at timestamptz,next_attempt_at timestamptz NOT NULL DEFAULT now(),
 last_error_code text,operation_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 CHECK(from_contact_id<to_contact_id),UNIQUE(user_id,operation_key)
);
CREATE INDEX IF NOT EXISTS character_meeting_relationship_due ON character_meeting_relationship_jobs(user_id,status,next_attempt_at,created_at);


CREATE TABLE IF NOT EXISTS colleague_calls (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 conversation_id uuid NOT NULL REFERENCES world_conversations(id) ON DELETE CASCADE,
 caller_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
 recipient_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
 reason text NOT NULL,operation_key text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','missed','declined','failed')),
 started_at timestamptz NOT NULL DEFAULT now(),ended_at timestamptz,attempted_at timestamptz,
 attempts integer NOT NULL DEFAULT 0, CHECK(caller_id<>recipient_id),UNIQUE(user_id,operation_key)
);
CREATE INDEX IF NOT EXISTS colleague_calls_pending ON colleague_calls(user_id,started_at) WHERE status='pending';
ALTER TABLE world_conversation_messages ADD COLUMN IF NOT EXISTS source_colleague_call_id uuid REFERENCES colleague_calls(id) ON DELETE SET NULL;
ALTER TABLE world_conversation_messages ADD COLUMN IF NOT EXISTS audio_available boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS colleague_call_audio (
 message_id uuid PRIMARY KEY REFERENCES world_conversation_messages(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 audio bytea CHECK(audio IS NULL OR octet_length(audio) BETWEEN 16 AND 2097152),
 attempts integer NOT NULL DEFAULT 0,attempted_at timestamptz
);
CREATE INDEX IF NOT EXISTS colleague_call_audio_pending ON colleague_call_audio(user_id) WHERE audio IS NULL;
CREATE INDEX IF NOT EXISTS world_conversation_messages_recent ON world_conversation_messages(user_id,conversation_id,created_at DESC);
ALTER TABLE events ADD COLUMN IF NOT EXISTS push_sent_at timestamptz;
ALTER TABLE events ADD COLUMN IF NOT EXISTS push_attempt_at timestamptz;
ALTER TABLE events ADD COLUMN IF NOT EXISTS push_attempts integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS events_push_due ON events(created_at) WHERE push_sent_at IS NULL;
ALTER TABLE worlds ADD COLUMN IF NOT EXISTS last_real_signal_attempt_at timestamptz;
ALTER TABLE worlds ADD COLUMN IF NOT EXISTS last_real_news_at timestamptz;
ALTER TABLE worlds ADD COLUMN IF NOT EXISTS last_real_news_attempt_at timestamptz;
CREATE TABLE IF NOT EXISTS real_world_news (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 title text NOT NULL,url text NOT NULL,domain text NOT NULL,
 source_country text,language text,published_at timestamptz,
 retrieved_at timestamptz NOT NULL DEFAULT now(),search_query text NOT NULL,
 UNIQUE(user_id,url)
);
CREATE INDEX IF NOT EXISTS real_world_news_recent ON real_world_news(user_id,published_at DESC,retrieved_at DESC);
CREATE TABLE IF NOT EXISTS board_motions (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
 title text NOT NULL,proposal text NOT NULL,electorate jsonb NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','recommended','not-recommended','no-quorum','adopted','rejected')),
 operation_key text NOT NULL,chairman_vote text CHECK(chairman_vote IN ('for','against','abstain')),
 chairman_reason text,closed_at timestamptz,decided_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),deadline_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',UNIQUE(user_id,operation_key)
);
CREATE TABLE IF NOT EXISTS board_motion_votes (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 motion_id uuid NOT NULL REFERENCES board_motions(id) ON DELETE CASCADE,
 contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
 vote text CHECK(vote IN ('for','against','abstain')),
 rationale text,attempted_at timestamptz,attempts integer NOT NULL DEFAULT 0,cast_at timestamptz,
 UNIQUE(motion_id,contact_id)
);
CREATE INDEX IF NOT EXISTS board_motion_votes_due ON board_motion_votes(user_id,motion_id,cast_at);
CREATE TABLE IF NOT EXISTS meeting_rounds (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 meeting_id uuid NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
 chairman_turn_id uuid NOT NULL REFERENCES meeting_turns(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','partial','failed')),
 expected_responses integer NOT NULL CHECK(expected_responses>=0),
 responses_saved integer NOT NULL DEFAULT 0 CHECK(responses_saved>=0),
 error text,created_at timestamptz NOT NULL DEFAULT now(),started_at timestamptz,completed_at timestamptz,
 UNIQUE(user_id,chairman_turn_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS meeting_rounds_one_active ON meeting_rounds(meeting_id) WHERE status IN ('pending','running');
CREATE INDEX IF NOT EXISTS meeting_rounds_recent ON meeting_rounds(user_id,meeting_id,created_at DESC);
ALTER TABLE meeting_turns ADD COLUMN IF NOT EXISTS round_id uuid REFERENCES meeting_rounds(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS meeting_turns_round_contact_unique ON meeting_turns(round_id,contact_id) WHERE round_id IS NOT NULL AND contact_id IS NOT NULL;
`;
