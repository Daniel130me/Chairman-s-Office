# Living World — batch completion and verification

Release scope: PWA only. Native Android/iOS applications are deferred by the Chairman; physical PWA/browser acceptance remains required.

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
- [x] Multiple named trade creditors within a single acquisition allocation, individual payment histories and disposal transfer evidence.
- [x] Forward-only immutable daily group-account observations, captured by the world engine and displayed in Corporate Finance; automated integration regression passed (run 45989742110).
- [ ] Transfer of external intercompany facilities, contracts, purchase orders, employees and other unresolved operating obligations (currently blocked safely); true period-specific consolidated income reporting; bargain purchases; richer ownership/covenant mechanisms.
- [x] Approved monthly acquired-intangible schedules, impairment-aware remaining charges, bounded missed-period catch-up, cancellation and manual-charge fencing; isolated finance transaction tests passed (run 46000432557), full workflow blocked by backup restore tool mismatch.
- [x] Evidence-backed acquired intangible amortization and impairment, posted as non-cash charges with carrying-value limits, immutable opening allocation, history and reconciliation; CI passed (run 46000081746).
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
- [x] Natural clause segmentation, bounded session audio caching, late-arriving speaker prefetch, immediate microphone floor interruption, and first-audio timing display implemented on Batch 5; CI passed (run 45990199787).
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
- [x] Added isolated PostgreSQL regression for four due operating days (simulated 72-hour absence), bounded catch-up, concurrent retry, tenant isolation, reconciled ledger and immutable daily observation; CI verification pending.
- [ ] Test live autonomous offline progression (including multi-day absence and duplicate prevention), activity history and every phone app.
- [ ] Verify Android/iPhone PWA, notifications, deep links, offline recovery, multi-user isolation, security, backups, performance and monitoring.
- [ ] Close all deferred scope above or explicitly obtain scope approval before declaring the application complete.

- [x] Explicitly reviewed negative opening net assets, signed ownership rounding and consolidation; active acquired-intangible schedules cancelled when control transfers. Added cross-origin private audio protection and hidden-page playback cancellation; verification pending.

- [x] Progressive WAV audio relay and cancellation tests passed (run 46000081746); live provider/device acceptance and full-duplex voice remain outstanding.
- [x] Corrected SQL concatenation defect in disposal cancellation discovered in run 46000849877; new complete verification required.

- [x] Reviewed bargain purchases with immutable acquisition-date group-only gain, zero goodwill, disposal and impairment floor handling, plus UTC date-range ledger reporting including disposed entities, control-sale and disposal adjustments. Historical NCI allocation and full period-close standards remain outside this implementation. Verification pending.

- [x] Evidence-backed externalization of cross-boundary intercompany facilities on disposal, exact balance and consent fences, active-side-only receipts/payments, idempotent settlement and reconciliation; CI pending. Previously externalized facilities must be settled before another transfer; unresolved contracts/employment and other obligations remain blocked.

- [x] Executive-led follow-up debates (up to two additional rounds per Chairman remark), alternate speaker order, idempotent continuation, no fabricated Chairman speech, persistent and interruptible recorded responses. CI and live provider checks pending.

- [x] PWA lifecycle: installation controls and standalone shortcuts, explicit update activation, public offline fallback, reconnect and freshness indicators, no persistence of private records, foreground-only polling, expired invitation protection and cross-tab sign-out synchronization. Automated verification pending for the new implementation.
- [x] Device-specific push test routing, shared atomic immediate/scheduled call delivery, per-device acceptance diagnostics, expiration-aware TTL and explicit subscription repair/disable controls. Browser/device display remains subject to physical acceptance.
- [ ] PWA physical acceptance: fresh and upgraded installs; denied/revoked notifications; airplane mode during startup and while signed in; logout in two tabs; device-specific test and callback; update during call and after call; browser/installed audio permissions; iOS Safari and Android Chrome. No native closed-app ringtone promise.

- [x] Historical effective-date income allocation with acquisition/control-sale history and nested minority interests; warnings suppress unsupported allocations. Immutable reviewed period closes with exact report digest, explicit late-record revisions and economic catch-up gate. Modeled financial reporting, not full statutory IFRS certification. Verification pending.

- [x] Documented buyer assumption of active employment, draft/active contracts, outstanding invoices and open purchase orders on loss of control; exact preflight digest, explicit consent, archived underlying records, external employee contact relationships, seller automation fences. Open disputes, active settlement plans, open RFQs and remaining non-transferable obligations still require resolution. Verification pending.

- [x] Additional minimum net-assets and maximum net-debt lending covenants, including replacement financing, monitored against recorded accounts. Contractual cure/re-performance plans with explicit consent, evidence, deadlines, breach escalation and suspension of collection until resolution. Verification pending.

- [x] Optional automatic bounded executive debate and recorded short interjection style with experimental overlapping playback; existing durable voice/meeting source-of-truth and Chairman floor controls retained. Automated verification and actual provider/device acceptance pending; not full-duplex model-native speech-to-speech.

- [x] Scheduled real-world intelligence refresh wired into the durable world engine; atomic six-hour success / thirty-minute retry claims prevent duplicate provider calls. Latest per-indicator snapshots are now returned to the Intelligence app. Manual refresh is a durable workflow, not a long-running browser request. Settings now exposes engine heartbeat, world freshness, stage failures and recovery activation. Verification pending.

- [x] Evidence-backed contractual standstill/suspension with a review deadline, automatic expiry alert without forced termination, deadline pausing, and evidence-backed resumption. Outstanding obligation and milestone deadlines are extended by the actual suspended duration. Verification pending.
- [x] External intelligence changes are grouped into one privacy-safe push per refresh rather than notifying separately for every changed indicator. Verification pending.

- [x] Latest pre-hardening integration commit `e3b117f795230b31722ae9c4132131b210ba6b85`: GitHub Actions run 46030970211 succeeded, including migration, finance/operations/executive DB regressions, invariant checks, isolated PostgreSQL backup/restore, production build and Chromium PWA lifecycle smoke. This does not establish live device/provider or production acceptance.
- [x] Final autonomous contact hardening: transaction-scoped owning-world lock, stale provider attempt fencing, rechecked capacity and active-company ownership, and real PostgreSQL concurrent retry/tenant-isolation regression. Engine health safely handles uninitialized database timestamps and missing revisions; revision 25 hands off old workers. Fresh CI and live acceptance required.

- [x] Prior network/diagnostics hardening commit 65330aaa117dc8cf2e0ca5693c0328fd7da66a3e passed GitHub Actions runs 46070704981 and 46070698087.
- [x] Implemented reviewed transfer of open disputes, partial settlements, standstills and competitive sourcing requests as immutable historical records, with exact buyer assumption evidence and no ongoing seller collection. Inconsistent records remain blocked. Added PostgreSQL regressions, archived UI controls, read-only invoice retries and stale installment rejection; verification pending.

- [x] PWA v6: notification expiration rechecked on click, malformed payload fallback, acknowledged existing-window navigation with cold-window fallback, bounded/cancellable reconnect probes, and foreground-aware procurement/settlement polling. Added notification behavior tests. Fresh automated verification and physical-device acceptance remain required.

- Added shared safe rich-text rendering for business briefs, messages, group conversations, mail, activity, documents, boardroom replies and selected reports. Markdown tables, emphasis, lists and line breaks are formatted without interpreting HTML. Existing stored records remain unchanged.

- Shared form styling across business, authentication, onboarding, settings and meeting editors: stacked full-width select/input/textarea controls, mobile-friendly font and tap targets, correct checkbox sizing, consistent actions, focus and validation states. Investigations includes draft-preserving inline errors; Calendar uses native validation and explicit submit/cancel. Added Chromium tests for form geometry, required-field validation, failed-submission recovery and calendar attendee selection. Physical-device review remains pending.
