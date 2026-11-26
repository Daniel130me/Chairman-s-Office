# Increment 26 — Inventory and procurement lifecycle
- Added inventory items, purchase orders, purchase-order lines and stock movements.
- Purchase order drafting has no accounting or inventory side effect. Chairman approval is explicit.
- Receiving approved goods increases stock and posts Dr Inventory / Cr Accounts Payable.
- Paying a received order posts Dr Accounts Payable / Cr Cash with available-cash validation.
- Inventory valuation uses weighted average cost on receipts. All movements and purchase-order transitions are persisted and audited.
- UI includes Inventory & Procurement application. Current interface creates one line per order; multi-line order editing, supplier master data, partial receipts/payments, returns and COGS at sale remain future work.
