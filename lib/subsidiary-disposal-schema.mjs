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
ALTER TABLE subsidiary_disposals ADD COLUMN IF NOT EXISTS disposed_company_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE subsidiary_disposals ADD COLUMN IF NOT EXISTS debt_assumption_evidence text NOT NULL DEFAULT '';
DO $ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='intercompany_facilities'::regclass AND conname='intercompany_facilities_external_disposal_id_fkey') THEN ALTER TABLE intercompany_facilities ADD CONSTRAINT intercompany_facilities_external_disposal_id_fkey FOREIGN KEY(external_disposal_id) REFERENCES subsidiary_disposals(id) ON DELETE SET NULL; END IF; END $;
ALTER TABLE company_loans ADD COLUMN IF NOT EXISTS transferred_at timestamptz;
ALTER TABLE company_loans ADD COLUMN IF NOT EXISTS transferred_to text;
ALTER TABLE company_loans ADD COLUMN IF NOT EXISTS transferred_disposal_id uuid REFERENCES subsidiary_disposals(id) ON DELETE SET NULL;
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
CREATE OR REPLACE FUNCTION protect_facility_archive() RETURNS trigger LANGUAGE plpgsql AS $
DECLARE lender_retired timestamptz; borrower_retired timestamptz;
BEGIN
 SELECT disposed_at INTO lender_retired FROM companies WHERE id=NEW.lender_company_id AND user_id=NEW.user_id FOR SHARE;
 SELECT disposed_at INTO borrower_retired FROM companies WHERE id=NEW.borrower_company_id AND user_id=NEW.user_id FOR SHARE;
 IF lender_retired IS NULL AND borrower_retired IS NULL THEN RETURN NEW; END IF;
 -- Only a decrease in the external balance on the one remaining active entity
 -- can modify a transferred facility. The historical counterpart stays frozen.
 IF TG_OP='UPDATE' THEN
  IF OLD.external_direction IS NOT NULL AND OLD.transferred_at IS NOT NULL
    AND NEW.outstanding<OLD.outstanding AND NEW.outstanding>=0
    AND (to_jsonb(NEW)-'outstanding')=(to_jsonb(OLD)-'outstanding')
    AND ((OLD.external_direction='receivable' AND OLD.external_active_company_id=OLD.lender_company_id AND lender_retired IS NULL AND borrower_retired IS NOT NULL)
      OR (OLD.external_direction='payable' AND OLD.external_active_company_id=OLD.borrower_company_id AND borrower_retired IS NULL AND lender_retired IS NOT NULL))
  THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Disposed company facility is read-only except confirmed remaining-side external settlement.' USING ERRCODE='23514';
END; $;
DROP TRIGGER IF EXISTS disposed_facility_guard ON intercompany_facilities;
DROP TRIGGER IF EXISTS disposed_lender_guard ON intercompany_facilities;
DROP TRIGGER IF EXISTS disposed_borrower_guard ON intercompany_facilities;
CREATE TRIGGER disposed_facility_guard BEFORE INSERT OR UPDATE ON intercompany_facilities FOR EACH ROW EXECUTE FUNCTION protect_facility_archive();
`;
