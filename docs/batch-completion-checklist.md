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
- [x] Limited evidence-backed allocation of opening cash and fixed assets, with proportionate NCI and goodwill elimination.
- [x] Control-retaining partial subsidiary stake sale with ownership updates, goodwill preservation and group equity reclassification implemented.
- [ ] Loss-of-control disposal/deconsolidation, broader fair-value allocation (liabilities, intangible assets and bargain purchases), richer ownership/covenant mechanisms; date-weighted historical attribution of group earnings.
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
- [x] Competitive RFQ for manual draft orders (2–5 distinct supplier companies, independent quotes, up to four rounds, selection followed by separate approval).
- [x] Evidence-backed installment settlement agreements, confirmed receipts, deadline escalation and conditional final invoice credits implemented.
- [ ] Renegotiation after partial payment and other commercial remedies beyond installments/settlement/credit.
- [ ] Final merge, deployment and acceptance of operational outcomes.

## Batch 4 — Executive Experience
- [x] Multi-character turn-based executive voice sessions, per-character synthesis, browser fallback, speaker indication, interruption/replay, spoken input.
- [x] Travel concierge briefs, itinerary checks, calendar conflicts, recorded disruptions and resolutions, notification links; no automatic spending.
- [x] Call transcript checkpoints and abandoned call recovery; per-device push delivery receipts, generic lock-screen alerts and notification diagnostics.
- [x] Unit tests and isolated database lifecycle tests authored.
- [ ] Full-duplex low-latency multi-character voice conferencing with natural turn-taking and true conversational interruption (existing implementation is turn-based).
- [x] Autonomous fictional travel-provider disruption review, alternative booking proposals with manually recorded quotes, approved replacement bookings and fee workflows implemented on Batch 5.
- [x] Autonomous concierge replacement quote generation from the recorded fictional provider; bounded price and fees, separate Chairman approval.
- [ ] Physical Android/iPhone PWA call alert, voice/microphone and notification delivery tests; closed-PWA ringtone is not guaranteed by the web platform.
- [x] GitHub Actions verification reported success for Batch 4 (run 45944665371); all database and build steps succeeded.
- [ ] Final merge and live acceptance.

## Batch 5 — Final quality and immersion
- [x] Implement deferred secured refinancing, supplier credits, defective returns and travel replacement workflows.
- [x] Add database-level regressions and read-only reconciliation for financial/operational invariants.
- [x] Write release, backup, acceptance and rollback runbook (`final-release-verification.md`).
- [x] Initial Batch 5 GitHub Actions run 45945270170 passed every migration, transaction and production-build step.
- [x] GitHub Actions run 45946826729 passed for competitive sourcing, limited allocation and autonomous replacement quotes.
- [ ] Verify latest commit including control-retaining sales and installment settlements.
- [ ] Run all automated tests, verify Neon migrations and deployment, reconcile financial state.
- [ ] Test inbound/outbound calls, callbacks, missed/declined calls, voicemail, voice notes, cross-channel memory and boardroom outcomes.
- [ ] Test autonomous offline progression (including multi-day absence and duplicate prevention), activity history and every phone app.
- [ ] Verify Android/iPhone PWA, notifications, deep links, offline recovery, multi-user isolation, security, backups, performance and monitoring.
- [ ] Close all deferred scope above or explicitly obtain scope approval before declaring the application complete.
