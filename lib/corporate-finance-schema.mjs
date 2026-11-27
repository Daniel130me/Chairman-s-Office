export const corporateFinanceSchema=`
CREATE TABLE IF NOT EXISTS group_account_history (
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 observed_day date NOT NULL, observed_at timestamptz NOT NULL,
 statement jsonb NOT NULL, perimeter jsonb NOT NULL,
 PRIMARY KEY(world_id,observed_day)
);
CREATE INDEX IF NOT EXISTS group_account_history_user_day ON group_account_history(user_id,observed_day DESC);
ALTER TABLE company_acquisitions ADD COLUMN IF NOT EXISTS diligence_required boolean NOT NULL DEFAULT false;
ALTER TABLE company_acquisitions ALTER COLUMN diligence_required SET DEFAULT true;
ALTER TABLE company_investments ADD COLUMN IF NOT EXISTS carrying_amount numeric(20,2) CHECK(carrying_amount>=0);
UPDATE company_investments SET carrying_amount=cost_basis WHERE carrying_amount IS NULL;
ALTER TABLE company_investments ADD COLUMN IF NOT EXISTS original_ownership_percentage numeric(5,2) CHECK(original_ownership_percentage>0 AND original_ownership_percentage<=100);
CREATE TABLE IF NOT EXISTS acquisition_allocations (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,acquisition_id uuid NOT NULL REFERENCES company_acquisitions(id) ON DELETE CASCADE,
 acquired_cash numeric(20,2) NOT NULL CHECK(acquired_cash>=0),acquired_fixed_assets numeric(20,2) NOT NULL CHECK(acquired_fixed_assets>=0),
 evidence text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,acquisition_id)
);
ALTER TABLE acquisition_allocations ADD COLUMN IF NOT EXISTS acquired_intangibles numeric(20,2) NOT NULL DEFAULT 0 CHECK(acquired_intangibles>=0);
ALTER TABLE acquisition_allocations ADD COLUMN IF NOT EXISTS acquired_payables numeric(20,2) NOT NULL DEFAULT 0 CHECK(acquired_payables>=0);
ALTER TABLE acquisition_allocations ADD COLUMN IF NOT EXISTS intangible_evidence text;
ALTER TABLE acquisition_allocations ADD COLUMN IF NOT EXISTS payable_creditor text;
ALTER TABLE acquisition_allocations ADD COLUMN IF NOT EXISTS negative_net_assets_review text;
ALTER TABLE acquisition_allocations ADD COLUMN IF NOT EXISTS bargain_purchase_review text;
ALTER TABLE acquisition_allocations ADD COLUMN IF NOT EXISTS bargain_gain numeric(20,2) NOT NULL DEFAULT 0 CHECK(bargain_gain>=0);
CREATE TABLE IF NOT EXISTS acquisition_intangible_adjustments (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 allocation_id uuid NOT NULL REFERENCES acquisition_allocations(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('intangible-amortization','intangible-impairment')),
 amount numeric(20,2) NOT NULL CHECK(amount>0),evidence text NOT NULL,
 operation_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,operation_key)
);
CREATE INDEX IF NOT EXISTS acquisition_intangible_adjustments_allocation ON acquisition_intangible_adjustments(user_id,allocation_id);
CREATE TABLE IF NOT EXISTS acquisition_amortization_schedules (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 allocation_id uuid NOT NULL REFERENCES acquisition_allocations(id) ON DELETE CASCADE,
 months_total integer NOT NULL CHECK(months_total BETWEEN 1 AND 240),
 months_remaining integer NOT NULL CHECK(months_remaining BETWEEN 0 AND months_total),
 next_due_day date NOT NULL CHECK(extract(day FROM next_due_day)=1),
 evidence text NOT NULL, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(),cancelled_at timestamptz,cancellation_reason text
);
CREATE UNIQUE INDEX IF NOT EXISTS acquisition_amortization_active ON acquisition_amortization_schedules(user_id,allocation_id) WHERE status='active';
CREATE INDEX IF NOT EXISTS acquisition_amortization_due ON acquisition_amortization_schedules(user_id,next_due_day) WHERE status='active';
CREATE TABLE IF NOT EXISTS acquisition_payable_payments (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,allocation_id uuid NOT NULL REFERENCES acquisition_allocations(id) ON DELETE CASCADE,
 amount numeric(20,2) NOT NULL CHECK(amount>0),evidence text NOT NULL,operation_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,operation_key)
);
CREATE TABLE IF NOT EXISTS acquisition_payable_creditors (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 allocation_id uuid NOT NULL REFERENCES acquisition_allocations(id) ON DELETE CASCADE,
 creditor text NOT NULL,amount numeric(20,2) NOT NULL CHECK(amount>0),evidence text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS acquisition_payable_creditors_allocation ON acquisition_payable_creditors(user_id,allocation_id,created_at);
ALTER TABLE acquisition_payable_payments ADD COLUMN IF NOT EXISTS creditor_id uuid REFERENCES acquisition_payable_creditors(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS acquisition_payable_payments_creditor ON acquisition_payable_payments(user_id,creditor_id);
INSERT INTO acquisition_payable_creditors(id,user_id,allocation_id,creditor,amount,evidence)
SELECT gen_random_uuid(),a.user_id,a.id,coalesce(nullif(a.payable_creditor,''),'Legacy creditor'),a.acquired_payables,coalesce(nullif(a.evidence,''),'Migrated from existing acquisition allocation evidence')
FROM acquisition_allocations a
WHERE a.acquired_payables>0 AND NOT EXISTS(
 SELECT 1 FROM acquisition_payable_creditors c WHERE c.user_id=a.user_id AND c.allocation_id=a.id
);
UPDATE acquisition_payable_payments p SET creditor_id=(
 SELECT c.id FROM acquisition_payable_creditors c WHERE c.user_id=p.user_id AND c.allocation_id=p.allocation_id ORDER BY c.created_at,c.id LIMIT 1
) WHERE p.creditor_id IS NULL;
CREATE TABLE IF NOT EXISTS acquisition_diligence (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 acquisition_id uuid NOT NULL REFERENCES company_acquisitions(id) ON DELETE CASCADE,
 area text NOT NULL CHECK(area IN ('financial','legal','commercial','operational')),
 status text NOT NULL CHECK(status IN ('pending','cleared','blocked')),
 evidence text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,acquisition_id,area)
);
CREATE TABLE IF NOT EXISTS loan_collateral (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 loan_id uuid NOT NULL REFERENCES company_loans(id) ON DELETE CASCADE,
 pledged_amount numeric(20,2) NOT NULL CHECK(pledged_amount>0),
 description text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,loan_id)
);
CREATE TABLE IF NOT EXISTS loan_covenants (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 loan_id uuid NOT NULL REFERENCES company_loans(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('minimum-cash','maximum-debt')),
 threshold numeric(20,2) NOT NULL CHECK(threshold>=0),
 last_actual numeric(20,2),last_status text CHECK(last_status IN ('compliant','breached')),
 checked_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,loan_id,kind)
);
CREATE TABLE IF NOT EXISTS loan_refinancings (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 old_loan_id uuid NOT NULL REFERENCES company_loans(id) ON DELETE CASCADE,
 new_loan_id uuid NOT NULL REFERENCES company_loans(id) ON DELETE CASCADE,
 principal_paid numeric(20,2) NOT NULL,interest_paid numeric(20,2) NOT NULL,
 reason text NOT NULL,operation_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,operation_key),UNIQUE(old_loan_id),UNIQUE(new_loan_id)
);
ALTER TABLE loan_refinancings ADD COLUMN IF NOT EXISTS replacement_terms jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE IF NOT EXISTS investment_adjustments (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 investment_id uuid NOT NULL REFERENCES company_investments(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('impairment','disposal')),
 amount numeric(20,2) NOT NULL CHECK(amount>=0),proceeds numeric(20,2),
 stake_sold numeric(5,2),reason text NOT NULL,operation_key text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,operation_key)
);
CREATE TABLE IF NOT EXISTS control_retaining_sales (
 adjustment_id uuid PRIMARY KEY REFERENCES investment_adjustments(id) ON DELETE CASCADE,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 subsidiary_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,previous_ownership numeric(5,2) NOT NULL,remaining_ownership numeric(5,2) NOT NULL CHECK(remaining_ownership>50),
 carrying_basis numeric(20,2) NOT NULL CHECK(carrying_basis>=0),gain numeric(20,2) NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS intercompany_facilities (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 world_id uuid NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
 lender_company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
 borrower_company_id uuid NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
 principal numeric(20,2) NOT NULL CHECK(principal>0),
 outstanding numeric(20,2) NOT NULL CHECK(outstanding>=0 AND outstanding<=principal),
 purpose text NOT NULL,operation_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(lender_company_id<>borrower_company_id),UNIQUE(user_id,operation_key)
);
ALTER TABLE intercompany_facilities ADD COLUMN IF NOT EXISTS transferred_at timestamptz;
ALTER TABLE intercompany_facilities ADD COLUMN IF NOT EXISTS transferred_to text;
CREATE TABLE IF NOT EXISTS intercompany_repayments (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 facility_id uuid NOT NULL REFERENCES intercompany_facilities(id) ON DELETE CASCADE,
 amount numeric(20,2) NOT NULL CHECK(amount>0),reason text NOT NULL,
 operation_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,operation_key)
);
`;
