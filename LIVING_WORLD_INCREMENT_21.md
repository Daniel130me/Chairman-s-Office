# Increment 21 — Approval recovery
- Action payloads are bound to their idempotency keys; reusing a key for a different request is rejected.
- Firing proposals resolve and retain the correct company association.
- Failed approved actions can be retried by the Chairman with a recorded reason. Idempotent underlying services prevent duplicate expense, hire or task records.
- Approval UI now distinguishes execution failure from a queued or successful action.
