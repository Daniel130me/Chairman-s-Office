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
DO $facility_fk$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='intercompany_facilities'::regclass AND conname='intercompany_facilities_external_disposal_id_fkey') THEN ALTER TABLE intercompany_facilities ADD CONSTRAINT intercompany_facilities_external_disposal_id_fkey FOREIGN KEY(external_disposal_id) REFERENCES subsidiary_disposals(id) ON DELETE SET NULL; END IF; END $facility_fk$;
ALTER TABLE company_loans ADD COLUMN IF NOT EXISTS transferred_at timestamptz;
ALTER TABLE company_loans ADD COLUMN IF NOT EXISTS transferred_to text;
ALTER TABLE company_loans ADD COLUMN IF NOT EXISTS transferred_disposal_id uuid REFERENCES subsidiary_disposals(id) ON DELETE SET NULL;
CREATE OR REPLACE FUNCTION reject_disposed_company_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE company_ref uuid; owner_ref uuid; retired timestamptz;
BEGIN
 company_ref := (to_jsonb(NEW)->>TG_ARGV[0])::uuid;
 owner_ref := (to_jsonb(NEW)->>'user_id')::uuid;
 IF TG_OP='UPDATE' THEN
  SELECT disposed_at INTO retired FROM companies WHERE id=(to_jsonb(OLD)->>TG_ARGV[0])::uuid AND user_id=(to_jsonb(OLD)->>'user_id')::uuid FOR SHARE;
  IF retired IS NOT NULL THEN RAISE EXCEPTION 'Archived company records are read-only.' USING ERRCODE='23514'; END IF;
 END IF;
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
CREATE OR REPLACE FUNCTION protect_facility_archive() RETURNS trigger LANGUAGE plpgsql AS $facility_guard$
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
END; $facility_guard$;
DROP TRIGGER IF EXISTS disposed_facility_guard ON intercompany_facilities;
DROP TRIGGER IF EXISTS disposed_lender_guard ON intercompany_facilities;
DROP TRIGGER IF EXISTS disposed_borrower_guard ON intercompany_facilities;
CREATE TRIGGER disposed_facility_guard BEFORE INSERT OR UPDATE ON intercompany_facilities FOR EACH ROW EXECUTE FUNCTION protect_facility_archive();

-- Protect records whose company association is inherited through an operational parent.
CREATE OR REPLACE FUNCTION reject_disposed_child_write() RETURNS trigger LANGUAGE plpgsql AS $child_archive$
DECLARE payload jsonb; retired timestamptz; record_id uuid; tenant uuid; refs jsonb[];
BEGIN
 refs:=ARRAY[to_jsonb(NEW)];
 IF TG_OP='UPDATE' THEN refs:=array_append(refs,to_jsonb(OLD)); END IF;
 FOREACH payload IN ARRAY refs LOOP
  record_id:=(payload->>TG_ARGV[0])::uuid;tenant:=(payload->>'user_id')::uuid;
  IF record_id IS NULL THEN CONTINUE; END IF;
  retired:=NULL;
  -- The trigger definition below supplies only hard-coded trusted SQL.
  EXECUTE TG_ARGV[1] INTO retired USING record_id,tenant;
  IF retired IS NOT NULL THEN RAISE EXCEPTION 'Archived operating records are read-only.' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END; $child_archive$;
DO $child_triggers$
DECLARE r record; lookup text;
BEGIN
 FOR r IN SELECT * FROM (VALUES
 ('employment_terms','employment_id','employment_records'),
 ('purchase_order_lines','purchase_order_id','purchase_orders'),
 ('supplier_negotiations','purchase_order_id','purchase_orders'),
 ('supplier_reviews','purchase_order_id','purchase_orders'),
 ('supplier_rfqs','purchase_order_id','purchase_orders'),
 ('contract_obligations','contract_id','business_contracts'),
 ('commercial_disputes','contract_id','business_contracts'),
 ('dispute_payment_plans','invoice_id','business_invoices'),
 ('inventory_returns','inventory_item_id','inventory_items'),
 ('payroll_items','payroll_run_id','payroll_runs')
 ) AS t(table_name,column_name,parent_table)
 LOOP
 lookup:=format('SELECT c.disposed_at FROM %I p JOIN companies c ON c.id=p.company_id AND c.user_id=p.user_id WHERE p.id=$1 AND p.user_id=$2 FOR SHARE OF c',r.parent_table);
 EXECUTE format('DROP TRIGGER IF EXISTS disposed_child_guard ON %I',r.table_name);
 EXECUTE format('CREATE TRIGGER disposed_child_guard BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION reject_disposed_child_write(%L,%L)',r.table_name,r.column_name,lookup);
 END LOOP;
 FOR r IN SELECT * FROM (VALUES
 ('supplier_rfq_rounds','rfq_id','SELECT c.disposed_at FROM supplier_rfqs f JOIN purchase_orders p ON p.id=f.purchase_order_id AND p.user_id=f.user_id JOIN companies c ON c.id=p.company_id AND c.user_id=p.user_id WHERE f.id=$1 AND f.user_id=$2 FOR SHARE OF c'),
 ('commercial_dispute_evidence','dispute_id','SELECT c.disposed_at FROM commercial_disputes d JOIN business_contracts p ON p.id=d.contract_id AND p.user_id=d.user_id JOIN companies c ON c.id=p.company_id AND c.user_id=p.user_id WHERE d.id=$1 AND d.user_id=$2 FOR SHARE OF c'),
 ('dispute_payment_installments','plan_id','SELECT c.disposed_at FROM dispute_payment_plans d JOIN business_invoices p ON p.id=d.invoice_id AND p.user_id=d.user_id JOIN companies c ON c.id=p.company_id AND c.user_id=p.user_id WHERE d.id=$1 AND d.user_id=$2 FOR SHARE OF c'),
 ('dispute_plan_revisions','plan_id','SELECT c.disposed_at FROM dispute_payment_plans d JOIN business_invoices p ON p.id=d.invoice_id AND p.user_id=d.user_id JOIN companies c ON c.id=p.company_id AND c.user_id=p.user_id WHERE d.id=$1 AND d.user_id=$2 FOR SHARE OF c'),
 ('procurement_transactions','purchase_order_id','SELECT c.disposed_at FROM purchase_orders p JOIN companies c ON c.id=p.company_id AND c.user_id=p.user_id WHERE p.id=$1 AND p.user_id=$2 FOR SHARE OF c')
 ) AS t(table_name,column_name,lookup_sql)
 LOOP
 EXECUTE format('DROP TRIGGER IF EXISTS disposed_child_guard ON %I',r.table_name);
 EXECUTE format('CREATE TRIGGER disposed_child_guard BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION reject_disposed_child_write(%L,%L)',r.table_name,r.column_name,r.lookup_sql);
 END LOOP;
END; $child_triggers$;
`;
