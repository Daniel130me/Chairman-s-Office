export const subsidiaryDisposalSchema=`
ALTER TABLE companies ADD COLUMN IF NOT EXISTS disposed_at timestamptz;
CREATE TABLE IF NOT EXISTS subsidiary_disposals (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 investment_id uuid NOT NULL REFERENCES company_investments(id) ON DELETE CASCADE,
 subsidiary_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 investor_company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 original_stake numeric(5,2) NOT NULL,stake_sold numeric(5,2) NOT NULL CHECK(stake_sold>0),retained_stake numeric(5,2) NOT NULL CHECK(retained_stake BETWEEN 0 AND 50),
 proceeds numeric(20,2) NOT NULL CHECK(proceeds>0),retained_value numeric(20,2) NOT NULL CHECK(retained_value>=0),
 previous_carrying numeric(20,2) NOT NULL,goodwill numeric(20,2) NOT NULL,net_assets numeric(20,2) NOT NULL,minority_interest numeric(20,2) NOT NULL,
 parent_gain numeric(20,2) NOT NULL,group_gain numeric(20,2) NOT NULL,prior_control_sale_gain numeric(20,2) NOT NULL DEFAULT 0,
 closing_statement jsonb NOT NULL,reason text NOT NULL,buyer text NOT NULL,valuation_evidence text NOT NULL,
 operation_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 disposed_company_ids uuid[] NOT NULL DEFAULT '{}',
 UNIQUE(user_id,operation_key),UNIQUE(subsidiary_id),
 CHECK(original_stake=stake_sold+retained_stake),CHECK(retained_stake>0 OR retained_value=0)
);
CREATE OR REPLACE FUNCTION reject_disposed_company_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE company_ref uuid; owner_ref uuid; retired timestamptz;
BEGIN
 company_ref := (to_jsonb(NEW)->>TG_ARGV[0])::uuid;
 owner_ref := (to_jsonb(NEW)->>'user_id')::uuid;
 IF company_ref IS NULL THEN RETURN NEW; END IF;
 SELECT disposed_at INTO retired FROM companies WHERE id=company_ref AND user_id=owner_ref FOR SHARE;
 IF retired IS NOT NULL THEN RAISE EXCEPTION 'Company has been disposed; its historical records are read-only.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION freeze_disposed_company() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.disposed_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Disposed company is read-only.' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS disposed_company_read_only ON companies;
CREATE TRIGGER disposed_company_read_only BEFORE UPDATE ON companies FOR EACH ROW EXECUTE FUNCTION freeze_disposed_company();
DO $$
DECLARE r record;
BEGIN
 FOR r IN SELECT * FROM (VALUES
 ('economy_journal','company_id'),('company_economy','company_id'),('company_chart_accounts','company_id'),
 ('business_tasks','company_id'),('employment_records','company_id'),('business_invoices','company_id'),('business_contracts','company_id'),
 ('commercial_opportunities','company_id'),('commercial_milestones','company_id'),('payroll_runs','company_id'),('investigation_cases','company_id'),
 ('hr_cases','company_id'),('market_moves','company_id'),('action_requests','company_id'),('company_loans','company_id'),
 ('company_investments','investor_company_id'),('company_acquisitions','buyer_company_id'),('inventory_items','company_id'),
 ('purchase_orders','company_id'),('inventory_movements','company_id'),('stakeholder_engagements','company_id'),
 ('travel_bookings','company_id'),('charitable_grants','company_id'),('threads','company_id'),('character_goals','target_company_id')
 ) AS t(table_name,column_name)
 LOOP
 EXECUTE format('DROP TRIGGER IF EXISTS disposed_company_guard ON %I',r.table_name);
 EXECUTE format('CREATE TRIGGER disposed_company_guard BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION reject_disposed_company_write(%L)',r.table_name,r.column_name);
 END LOOP;
END; $$;
DROP TRIGGER IF EXISTS disposed_lender_guard ON intercompany_facilities;
CREATE TRIGGER disposed_lender_guard BEFORE INSERT OR UPDATE ON intercompany_facilities FOR EACH ROW EXECUTE FUNCTION reject_disposed_company_write('lender_company_id');
DROP TRIGGER IF EXISTS disposed_borrower_guard ON intercompany_facilities;
CREATE TRIGGER disposed_borrower_guard BEFORE INSERT OR UPDATE ON intercompany_facilities FOR EACH ROW EXECUTE FUNCTION reject_disposed_company_write('borrower_company_id');
`;
