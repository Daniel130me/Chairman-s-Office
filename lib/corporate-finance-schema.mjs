export const corporateFinanceSchema=`
ALTER TABLE company_acquisitions ADD COLUMN IF NOT EXISTS diligence_required boolean NOT NULL DEFAULT false;
ALTER TABLE company_acquisitions ALTER COLUMN diligence_required SET DEFAULT true;
ALTER TABLE company_investments ADD COLUMN IF NOT EXISTS carrying_amount numeric(20,2) CHECK(carrying_amount>=0);
UPDATE company_investments SET carrying_amount=cost_basis WHERE carrying_amount IS NULL;
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
CREATE TABLE IF NOT EXISTS intercompany_repayments (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 facility_id uuid NOT NULL REFERENCES intercompany_facilities(id) ON DELETE CASCADE,
 amount numeric(20,2) NOT NULL CHECK(amount>0),reason text NOT NULL,
 operation_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,operation_key)
);
`;
