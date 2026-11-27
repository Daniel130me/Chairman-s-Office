# Increment 27 — Company financing
- Added company loan proposals with lender, principal, annual interest rate, term and purpose.
- Approval does not create debt; disbursement posts cash against loans payable.
- Principal repayments reduce loans payable and cash; interest payments are separately recorded as interest expense.
- Loan payments are persisted, idempotent and audited. Cash availability is enforced.
- Added Company Financing app and loan history.
- Remaining: amortization schedules, accrued interest, variable rates, covenants, refinancing, collateral and lender communications.
