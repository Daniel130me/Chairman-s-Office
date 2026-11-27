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
- [x] Documented identifiable intangible assets, assumed trade payable for a named creditor, and evidence-backed payable settlement; acquisition net assets and goodwill extended accordingly.
- [x] Loss-of-control disposal for a direct standalone subsidiary: complete exit or retained minority interest, closing financial statement, modeled disposal-date group gain/loss, archive protection and active operations filters.
- [x] Disposal of nested controlled groups and of a subsidiary owned by another subsidiary; consolidated closing statements, group gain/loss and NCI/goodwill treatment, internal intercompany elimination and historical cumulative earnings through the disposal date.
- [x] Buyer assumption of multiple disbursed loan facilities and acquired trade payables; accrued interest through disposal, creditor-by-creditor evidence, preserved loan/payment history and seller-side servicing fences.
- [ ] Multiple trade creditors within a single acquisition allocation (currently one payable creditor per allocation); transfer of external intercompany facilities, contracts, purchase orders, employees and other unresolved operating obligations (currently blocked safely); period-by-period consolidated history; negative net assets/bargain purchases; intangible amortization/impairment; richer ownership/covenant mechanisms.
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
- [x] Renegotiation after partial payment: preserve confirmed receipts, archive the previous agreement, recalculate remaining installments and conditional credit, fence stale amendments.
- [ ] Other commercial remedies beyond installments/settlement/credit.
- [ ] Final merge, deployment and acceptance of operational outcomes.

## Batch 4 — Executive Experience
- [x] Multi-character turn-based executive voice sessions, per-character synthesis, browser fallback, speaker indication, interruption/replay, spoken input.
- [x] Travel concierge briefs, itinerary checks, calendar conflicts, recorded disruptions and resolutions, notification links; no automatic spending.
- [x] Call transcript checkpoints and abandoned call recovery; per-device push delivery receipts, generic lock-screen alerts and notification diagnostics.
- [x] Unit tests and isolated database lifecycle tests authored.
- [x] Interruptible meeting rounds with atomic stale-response fencing, directed executive questions, idempotent Chairman turns, resumable polling and stable final minutes.
- [x] Opt-in conversational microphone with local voice activity detection, requested acoustic echo cancellation, utterance-level transcription and playback interruption; microphone stops when hidden or closed.
- [x] Renewable meeting worker leases, bounded missing-response retry, stale-worker fencing and bounded audio prefetch.
- [x] Optional WebRTC streaming microphone with live captions, short-lived transcription credentials, explicit consent, separate local VAD/outbound tracks, ICE gathering gate, abortable teardown and recorded speech fallback. Off by default pending provider acceptance.
- [x] Automated regression tests for microphone track isolation and WebRTC ICE readiness, timeout and cancellation.
- [ ] Verify live streaming input and low-latency continuous speech-to-speech output, overlapping speech, and real-device echo/latency. Executive synthesis remains segmented; see `meeting-voice-acceptance.md`.
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
- [x] GitHub Actions run 45947711299 passed for control-retaining sales and installment settlements.
- [x] GitHub Actions run 45948300427 passed for settlement renegotiation, acquired intangibles and assumed creditor balances.
- [x] GitHub Actions run 45950465110 passed corrected disposal migrations, corporate finance, advanced operations, executive experience database tests and production build, including interruptible meeting implementation.
- [x] Automated regression coverage for meeting worker leases/recovery, audio prefetch and opt-in WebRTC microphone/ICE handling.
- [ ] Verify live transcription provider connectivity, low-latency continuous speech-to-speech output, overlapping speech and real-device echo/latency. Executive synthesis remains segmented; see `meeting-voice-acceptance.md`.
- [ ] Run all automated tests, verify Neon migrations and deployment, reconcile financial state.
- [ ] Test inbound/outbound calls, callbacks, missed/declined calls, voicemail, voice notes, cross-channel memory and boardroom outcomes.
- [ ] Test autonomous offline progression (including multi-day absence and duplicate prevention), activity history and every phone app.
- [ ] Verify Android/iPhone PWA, notifications, deep links, offline recovery, multi-user isolation, security, backups, performance and monitoring.
- [ ] Close all deferred scope above or explicitly obtain scope approval before declaring the application complete.
