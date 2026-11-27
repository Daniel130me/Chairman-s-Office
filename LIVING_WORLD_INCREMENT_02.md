# Increment 02 — Ledger and task foundation
Code delivery, not release acceptance. Requires additive migration before preview testing.
- Opening cash is carried forward; old annual revenue is an operating assumption, never fabricated historical receipts. Valuation remains an onboarding estimate.
- USD-only journal with one equal debit/credit pair per entry; supported actions: receipts, expenses, capital. No real money. Company locking, tenant checks and idempotency keys; manual transaction form and recent history.
- Daily modeled receipts and operating costs advance from the day after activation, capped at three catch-up days per company per tick. Initial cost ratio 65%; this is a modeling assumption, not sector research. More sophisticated sales, payroll, invoicing, debt and valuation are still required.
- Executive task assignment/cancellation and visibility to assignee in AI context; autonomous execution, deadlines, approvals and HR remain open.
- Migration must be run on an isolated preview database. Verify opening balance, reconciliation, double submission, cross-tenant rejection, insufficient funds, scheduler catch-up, and live chat/voice access. No production migration or deployment promotion in this increment.
- All unchecked master backlog items remain required. Pure rule tests included; integration tests and device verification pending.
