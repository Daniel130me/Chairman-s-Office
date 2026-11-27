# Increment 06 — Hardening business operations
- Serialize invoice numbering and other company-level operations using company row locks.
- Correct payroll month validation and ensure payroll line-item totals reconcile to the journal posting.
- Correct database month constraint.
- Remove an invalid uniqueness constraint on missed-call messages: a missed-call conversation must allow multiple follow-up messages.
- Prevent historical missed calls from generating a wave of new follow-up messages when this migration first runs.
- Add unit tests for payroll period validation and allowed contract transitions.
- Remaining: live database migration verification and end-to-end invoice/payroll tests.
