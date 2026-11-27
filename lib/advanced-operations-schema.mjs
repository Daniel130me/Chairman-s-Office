export const advancedOperationsSchema=`
CREATE TABLE IF NOT EXISTS inventory_stocktakes (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,inventory_item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
 expected_quantity numeric(20,4) NOT NULL,actual_quantity numeric(20,4) NOT NULL CHECK(actual_quantity>=0),
 expected_value numeric(20,2) NOT NULL,adjustment_value numeric(20,2) NOT NULL CHECK(adjustment_value>=0),
 direction text NOT NULL CHECK(direction IN ('in','out','none')),reason text NOT NULL,operation_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,operation_key)
);
CREATE TABLE IF NOT EXISTS inventory_returns (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,inventory_item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
 sale_id uuid REFERENCES procurement_transactions(id) ON DELETE RESTRICT,purchase_order_line_id uuid REFERENCES purchase_order_lines(id) ON DELETE RESTRICT,
 kind text NOT NULL CHECK(kind IN ('customer','supplier')),quantity numeric(20,4) NOT NULL CHECK(quantity>0),
 stock_value numeric(20,2) NOT NULL CHECK(stock_value>=0),settlement_value numeric(20,2) NOT NULL CHECK(settlement_value>=0),
 reason text NOT NULL,operation_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,operation_key),
 CHECK((kind='customer' AND sale_id IS NOT NULL AND purchase_order_line_id IS NULL) OR (kind='supplier' AND sale_id IS NULL AND purchase_order_line_id IS NOT NULL))
);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS returned_total numeric(20,2) NOT NULL DEFAULT 0 CHECK(returned_total>=0 AND returned_total<=paid_total);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS credited_total numeric(20,2) NOT NULL DEFAULT 0 CHECK(credited_total>=0);
ALTER TABLE inventory_returns ADD COLUMN IF NOT EXISTS restockable boolean NOT NULL DEFAULT true;
ALTER TABLE inventory_returns ADD COLUMN IF NOT EXISTS credit_value numeric(20,2) NOT NULL DEFAULT 0 CHECK(credit_value>=0 AND credit_value<=settlement_value);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS overdue_reported_at timestamptz;
CREATE TABLE IF NOT EXISTS supplier_rfqs (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
 baseline jsonb NOT NULL,status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','awarded','cancelled')),
 operation_key text NOT NULL,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,operation_key),UNIQUE(user_id,purchase_order_id)
);
CREATE TABLE IF NOT EXISTS supplier_rfq_rounds (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,rfq_id uuid NOT NULL REFERENCES supplier_rfqs(id) ON DELETE CASCADE,
 supplier_contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,round_number integer NOT NULL CHECK(round_number BETWEEN 1 AND 4),
 requested_markup integer CHECK(requested_markup BETWEEN -1000 AND 1000),status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','quoted','declined','failed')),
 response jsonb,attempts integer NOT NULL DEFAULT 0,attempted_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(rfq_id,supplier_contact_id,round_number)
);
CREATE INDEX IF NOT EXISTS supplier_rfq_pending ON supplier_rfq_rounds(user_id,created_at) WHERE status='pending';
ALTER TABLE supplier_rfqs ADD COLUMN IF NOT EXISTS awarded_round_id uuid REFERENCES supplier_rfq_rounds(id) ON DELETE SET NULL;
CREATE TABLE IF NOT EXISTS supplier_reviews (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
 quality text NOT NULL CHECK(quality IN ('accepted','defective','mixed')),evidence text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,purchase_order_id)
);
CREATE TABLE IF NOT EXISTS contract_obligations (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,contract_id uuid NOT NULL REFERENCES business_contracts(id) ON DELETE CASCADE,
 title text NOT NULL,description text NOT NULL,responsible_party text NOT NULL CHECK(responsible_party IN ('company','counterparty')),
 due_at timestamptz NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','fulfilled','breached','waived')),
 evidence text,operation_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,operation_key)
);
CREATE INDEX IF NOT EXISTS contract_obligations_due ON contract_obligations(user_id,due_at) WHERE status='pending';
CREATE TABLE IF NOT EXISTS commercial_disputes (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,contract_id uuid NOT NULL REFERENCES business_contracts(id) ON DELETE CASCADE,
 invoice_id uuid REFERENCES business_invoices(id) ON DELETE RESTRICT,reason text NOT NULL,status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
 resolution text CHECK(resolution IN ('resume','settle','terminate')),resolution_reason text,settled_amount numeric(20,2),credited_amount numeric(20,2),
 operation_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),resolved_at timestamptz,UNIQUE(user_id,operation_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS commercial_disputes_open_contract ON commercial_disputes(user_id,contract_id) WHERE status='open';
CREATE UNIQUE INDEX IF NOT EXISTS commercial_disputes_open_invoice ON commercial_disputes(user_id,invoice_id) WHERE status='open' AND invoice_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS commercial_dispute_evidence (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,dispute_id uuid NOT NULL REFERENCES commercial_disputes(id) ON DELETE CASCADE,
 source text NOT NULL,description text NOT NULL,operation_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,operation_key)
);
CREATE TABLE IF NOT EXISTS dispute_payment_plans (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,dispute_id uuid NOT NULL REFERENCES commercial_disputes(id) ON DELETE CASCADE,
 invoice_id uuid NOT NULL REFERENCES business_invoices(id) ON DELETE CASCADE,agreed_amount numeric(20,2) NOT NULL CHECK(agreed_amount>0),
 agreed_credit numeric(20,2) NOT NULL CHECK(agreed_credit>=0),status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','cancelled')),
 agreement text NOT NULL,operation_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 UNIQUE(user_id,operation_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS dispute_payment_plan_active ON dispute_payment_plans(user_id,dispute_id) WHERE status='active';
CREATE TABLE IF NOT EXISTS dispute_payment_installments (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,plan_id uuid NOT NULL REFERENCES dispute_payment_plans(id) ON DELETE CASCADE,
 installment_number integer NOT NULL CHECK(installment_number>0),amount numeric(20,2) NOT NULL CHECK(amount>0),due_at timestamptz NOT NULL,
 paid_at timestamptz,payment_evidence text,overdue_reported_at timestamptz,UNIQUE(plan_id,installment_number)
);
ALTER TABLE dispute_payment_plans ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0 CHECK(revision>=0);
CREATE TABLE IF NOT EXISTS dispute_plan_revisions (
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,plan_id uuid NOT NULL REFERENCES dispute_payment_plans(id) ON DELETE CASCADE,
 revision integer NOT NULL CHECK(revision>0),prior_agreement jsonb NOT NULL,new_schedule jsonb NOT NULL,confirmed_paid numeric(20,2) NOT NULL CHECK(confirmed_paid>=0),
 agreement text NOT NULL,operation_key text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(user_id,operation_key),UNIQUE(plan_id,revision)
);
ALTER TABLE business_invoices ADD COLUMN IF NOT EXISTS settlement_paid numeric(20,2) CHECK(settlement_paid>=0 AND settlement_paid<=amount);
ALTER TABLE business_invoices ADD COLUMN IF NOT EXISTS settlement_credit numeric(20,2) CHECK(settlement_credit>=0 AND settlement_credit<=amount);
`;
