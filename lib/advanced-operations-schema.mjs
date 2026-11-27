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
ALTER TABLE business_invoices ADD COLUMN IF NOT EXISTS settlement_paid numeric(20,2) CHECK(settlement_paid>=0 AND settlement_paid<=amount);
ALTER TABLE business_invoices ADD COLUMN IF NOT EXISTS settlement_credit numeric(20,2) CHECK(settlement_credit>=0 AND settlement_credit<=amount);
`;
