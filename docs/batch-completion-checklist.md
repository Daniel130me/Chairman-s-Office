# Living World — batch completion and verification

Implementation is not synonymous with live acceptance. Keep production isolated until the stacked changes are reviewed and validated.

## Batch 1 — Living World Intelligence
- [x] Character-specific durable memory, independent agendas, directional relationships.
- [x] Autonomous security scenario review, work and interviews.
- [x] Integration with world engine and activity timeline.
- [x] Independent automated verification reported successful for PR #1.
- [ ] Final merge and live cross-channel, real-time and multi-tenant acceptance.

## Batch 2 — Corporate Empire Finance
- [x] Loan refinancing, fixed-asset pool pledges, cash/debt covenant monitoring.
- [x] Cost-basis group reporting, noncontrolling interests, paired intercompany lending and repayment.
- [x] Acquisition diligence, investment impairment and minority disposal.
- [x] Independent automated verification reported successful for PR #2.
- [x] Secured refinancing with replacement collateral and cash/debt covenants implemented on Batch 5.
- [ ] Controlled-subsidiary disposal/deconsolidation, fair-value acquisition allocation and richer ownership/covenant mechanisms.
- [ ] Final merge and live ledger reconciliation.

## Batch 3 — Business Operations
- [x] Stocktake with stale-count detection and financial adjustments; original-sale customer refunds/restocking; paid-order supplier returns with confirmed refund and cost differences.
- [x] Supplier delivery deadlines and quality reviews, performance scorecards, grounded negotiation history and documented relationship effects.
- [x] Contract obligations, deadline escalation, fulfillment/waiver, dispute case/evidence, resume collection, negotiated settlement or termination with credit notes.
- [x] Tenant-scoped endpoints; transaction safeguards; phone Inventory and Operations controls; Activity event links.
- [x] Unit/regression tests and isolated PostgreSQL lifecycle test authored.
- [x] GitHub Actions reported success for Batch 3 final commit.
- [ ] Exercise live user flows.
- [x] Unpaid/part-paid supplier credit returns and non-restockable customer returns implemented on Batch 5.
- [ ] Richer multi-supplier RFQ/counteroffer workflows and more detailed negotiated dispute remedies beyond current settlement/credit model.
- [ ] Final merge, deployment and acceptance of operational outcomes.

## Batch 4 — Executive Experience
- [x] Multi-character turn-based executive voice sessions, per-character synthesis, browser fallback, speaker indication, interruption/replay, spoken input.
- [x] Travel concierge briefs, itinerary checks, calendar conflicts, recorded disruptions and resolutions, notification links; no automatic spending.
- [x] Call transcript checkpoints and abandoned call recovery; per-device push delivery receipts, generic lock-screen alerts and notification diagnostics.
- [x] Unit tests and isolated database lifecycle tests authored.
- [ ] Full-duplex low-latency multi-character voice conferencing with natural turn-taking and true conversational interruption (existing implementation is turn-based).
- [x] Autonomous fictional travel-provider disruption review, alternative booking proposals with manually recorded quotes, approved replacement bookings and fee workflows implemented on Batch 5.
- [ ] Autonomous concierge negotiation of replacement quotes.
- [ ] Physical Android/iPhone PWA call alert, voice/microphone and notification delivery tests; closed-PWA ringtone is not guaranteed by the web platform.
- [x] GitHub Actions verification reported success for Batch 4 (run 45944665371); all database and build steps succeeded.
- [ ] Final merge and live acceptance.

## Batch 5 — Final quality and immersion
- [x] Implement deferred secured refinancing, supplier credits, defective returns and travel replacement workflows.
- [x] Add database-level regressions and read-only reconciliation for financial/operational invariants.
- [x] Write release, backup, acceptance and rollback runbook (`final-release-verification.md`).
- [ ] Verify Batch 5 final commit and all updated integration tests.
- [ ] Run all automated tests, verify Neon migrations and deployment, reconcile financial state.
- [ ] Test inbound/outbound calls, callbacks, missed/declined calls, voicemail, voice notes, cross-channel memory and boardroom outcomes.
- [ ] Test autonomous offline progression (including multi-day absence and duplicate prevention), activity history and every phone app.
- [ ] Verify Android/iPhone PWA, notifications, deep links, offline recovery, multi-user isolation, security, backups, performance and monitoring.
- [ ] Close all deferred scope above or explicitly obtain scope approval before declaring the application complete.
