# Chairman's Office — Living World master backlog
Approved scope: 26 November 2026. Target: Next.js / Vercel / Neon / Vapi; installable full PWA first, no native app required. Every unchecked item is required scope, not a promise of completion. Check only after implementation and acceptance tests pass. Preserve existing users and worlds; no destructive migration. Never sacrifice immersion to free-tier limits.

## 0. Audit and delivery
- [ ] Inventory all existing routes, screens, DB tables, workflows, placeholder content, tests, provider integrations and deployment configuration; distinguish working vs scaffolded.
- [ ] Baseline existing tests, build and preview deployment; maintain migration compatibility, reversible releases, branch protection, backups and restore test.
- [ ] Maintain requirement-to-code-to-test traceability and release gates; validate Android and installed iOS PWA; test multi-user isolation.
- [ ] Rotate any exposed API keys; no credentials in code, logs, or client bundles; monitor provider budgets and failures.
- [ ] Retain multi-provider AI fallback, Vapi voice, durable workflows and existing auth; confirm real provider health.
## 1. World integrity and persistence
- [ ] Single authoritative tenant-scoped world with stable IDs for companies, characters, accounts, transactions, relationships, events, tasks and conversations.
- [ ] Custom onboarding: holding group, sectors, regions, timezone, style, chief identity, starting wealth, businesses and unique histories; no fixed industry assumptions.
- [ ] Versioned additive migrations; transactional commands, idempotency keys, concurrency locks, outbox, retry/backoff, dead-letter recovery, scheduling and downtime catch-up.
- [ ] Separate objective world facts from character beliefs, forecasts, rumors and secrets; provenance, knowledge permissions, corrections and durable character memory.
- [ ] Ground all AI responses in authorized facts, prior interactions and tool results; no fabricated claims of executed actions, no decorative numbers or generic filler when provider fails.
- [ ] Every consequential action persists actor, authority, motivation, timestamp, affected entities, prior/new state, outcome and causal event; administrative audit versus Chairman-visible history with disclosure rules.
- [ ] Reconcile data across all phone apps, live updates, account switching, pagination, access controls and cross-user isolation.
## 2. Characters and social network
- [ ] Distinct persistent identity, voice, personality, expertise, intelligence, goals, ambition, loyalty, trust, tension, reputation, flaws, relationship history, calendar, location/timezone, employment and knowledge.
- [ ] Group and subsidiary CEOs, CFOs, COOs, CTOs, managers, accountants, engineers, sales, HR, legal, auditors, board, staff, chief of staff, assistant, security; investors, bankers, shareholders, fund managers, partners, vendors, contractors, consultants, advisers, business friends, mentors, competitors, regulators, officials, media, clients, prospects, adversaries and fraudsters.
- [ ] Dynamic introduction, discovery, relationship changes, confidential knowledge and independent agendas; trust and reputation evolve from actual outcomes, not every chat.
- [ ] Autonomous internal/external character-to-character communication and actions, even when Chairman is offline; believable schedules, travel, meetings, availability, disagreements and delayed replies.
- [ ] Chairman can contact any known character; character identity consistent across calls, chat, meetings and documents.
## 3. Phone, calls, messages, email and continuity
- [ ] Real live inbound/outbound voice for every eligible character, natural voice diversity, speaker identity, Vapi tool permissions, reasons, context, call histories, transcripts and follow-up actions.
- [ ] Characters can call each other, Chairman or external contacts; Chairman can initiate calls; availability, busy, declined, missed, failed, completed, call waiting, conference, callback, no-answer timeout and deduplicated call states.
- [ ] ANY caller (Chairman or character) may leave a text message or voice note/voicemail if ANY recipient is unavailable or declines; missed call links to the exact message/thread, continuation and callback; preserve original reason, participant IDs and timestamps.
- [ ] Durable automatic *decision* to leave a message based on character context, not canned replies; AI-generated voicemail or text grounded in actual call reason; safe explicit failure if provider unavailable, retry without duplicate messages.
- [ ] Unified conversation memory across voice, messages, voicemail, emails, meetings, documents and tasks; messages may continue the call, calls may continue messages; transcripts/summaries visible and accessible according to permissions.
- [ ] Genuine AI conversations; group threads, character-to-character messages, attachments, voice notes, read receipts, typing, unread counts, search, delayed response, email, notification history, missed call recovery.
- [ ] Action-capable messaging and voice: delegation, call scheduling, callbacks (including 30 seconds), appointment negotiation, approvals, HR, finance, contracts, reporting; backend validated and confirmed only on success.
- [ ] Event-driven calls at any hour, grounded in business state and urgency; international time zones, emergencies, ordinary calls, user-controlled quiet hours/emergency overrides and optional rate limits; no fixed timetable as sole source.
## 4. Full PWA and virtual smartphone
- [ ] Samsung-like original interface (no Samsung logo), installable manifest/icons, home screen, lock screen, status bar, quick settings, notification center, recent apps, wallpapers, light/dark, responsive layouts, accessibility.
- [ ] Phone, Messages, Contacts, Calendar, Mail, Banking, Companies, Documents, Meetings, Markets, News, Approvals, Security, Travel, Employees, Settings, Investments, Tasks, Legal, Activity.
- [ ] All apps have actual persistent functionality, not mock UI. Shared state and navigation, search, deep links, online/offline state and secure caching; no private data leakage.
- [ ] Service worker, VAPID configuration, permission onboarding, push subscriptions per device, background delivery, retries, expiry, deduplication, notification click into exact call; ring on foreground/open where browser allows; user gesture to unlock audio, accept/decline, missed call fallback.
- [ ] Push for messages, voicemail, tasks, urgent approvals, meeting reminders and business events. Multi-device synchronization, logout unsubscribe, redacted lock-screen content and expired call handling.
- [ ] Test Android, installed iOS PWA, foreground/background/closed, permission denied, connectivity interruption, silent mode, reboot, stale notifications; document OS/browser constraints (no universal native ringing when closed).
## 5. Financial and economic engine
- [ ] Double-entry journal, accounts, opening balances, currencies, transactions, invoices, receivables/payables, cash, revenue, COGS, operating expenses, payroll, taxes, assets, liabilities, debt and interest.
- [ ] P&L, balance sheet, cash flow, budgets, forecasts, valuations, group consolidation, intercompany eliminations, period close, audit and reconciliation; all UI metrics derived from records with as-of timestamps.
- [ ] Sector-specific sales, demand, inventory, costs, capacity, logistics, projects, client retention, contract performance, pricing and productivity; time-based operations and real business consequences.
- [ ] Banking, investment portfolios, capital allocation, loans, acquisitions and financial alerts; no real-world money or payments.
- [ ] Explicit risk/uncertainty; reports can contain character mistakes or fraud but distinguish reported vs true underlying figures and preserve evidence.
## 6. Autonomous work and authority
- [ ] Role- and entity-scoped permissions, delegated limits, approvals, escalation, budgets, segregation of duties, conflicts of interest, governance and emergency authority.
- [ ] Persistent tasks with assignee, dependencies, deadlines, progress, outcomes, evidence, retry, escalation and reminders; autonomous executive planning and action selection from actual world context.
- [ ] Validated action tool catalog: create tasks, delegate, schedule, call/message, finance, procurement, contracts, HR, investigations, meetings, reports, investments and company changes.
- [ ] Agent loop: observe authorized facts, reason from goals, propose action, validate, execute transaction, emit event, propagate consequences; no unbounded agent loops or invented completion.
- [ ] Activity feed and traceable decisions, pending approval inbox, override/deny/reassign, cancellation and reversals; users can inspect business effects, authorized records and rationale.
## 7. HR and organizational life
- [ ] Organizational chart, roles, vacancies, headcount, contracts, candidates, interviews (voice/chat), salary negotiation, offers, onboarding, payroll, hiring, firing, promotion, transfer, suspension, restructuring and board appointments.
- [ ] Performance, morale, productivity, incentives, culture, loyalty, resignations, retirement, succession and replacement; fired employees remain independent characters and may become competitors/consultants.
- [ ] HR director autonomously recruits within authority and budget; employee decisions have downstream financial, operational and reputational consequences.
## 8. Contracts, clients and opportunities
- [ ] Leads, proposals, bids, tenders, negotiation, diligence, legal review, approval, signature, milestones, invoice/payment, delivery, renewal, disputes, breach and termination; counterparties pursue independent interests.
- [ ] Opportunities emerge from market signals, relationships and company needs; record hypotheses, risk, expected return, evidence and outcomes.
- [ ] Procurement, vendor selection, ongoing client relationships and major account risk; actions affect revenue, cost, reputation and future relationships.
## 9. External world, competition and threats
- [ ] Persistent rival companies with finances, goals, strategies and market share; price changes, hiring rivals, competitive offers, innovation, partnerships, alliances and acquisitions.
- [ ] Independent investors, associates, advisers, clients, suppliers, regulators, media and business friends who contact and negotiate with Chairman and each other.
- [ ] Fictional threats and fraud attempts: suspicious invoices, embezzlement, bribery allegations, conflicts, leaked information, corporate espionage, scams, manipulated reports, executive misconduct; no real targeting or actionable wrongdoing instructions.
- [ ] Whistleblower reporting, security, internal audit and legal investigations with cases, evidence, uncertainty, timeline, interviews, findings, false suspicions, remediation and consequences.
- [ ] Corporate reputation, public image, fictional journalism, stakeholder confidence, regulatory oversight and legal disputes.
## 10. Reality-to-world bridge
- [ ] Real-world time/calendar/holidays and regional business hours, currencies/exchange rates, oil/fuel, inflation, interest rates, economic news, weather, technology, government policy and supply shocks from sourced data.
- [ ] Record source, time, freshness, geographic/sector relevance and distinguish external facts from fictional consequences; deterministic economic mapping plus grounded character reasoning.
- [ ] Graceful stale/unavailable feed behavior; avoid false real-world news, impersonation, real financial execution or external unsolicited contact.
## 11. Board and governance
- [ ] Multi-character live online board meetings with distinct voices, discussion, disagreement, interruption/turn taking, independent positions, documents and prior context.
- [ ] Meeting invitations, availability, scheduling, reminders, minutes, resolutions, voting, quorum, shareholder influence, confidential sessions and follow-up tasks/actions.
- [ ] Board challenges, leadership changes, investor pressure, governance, voting and long-term accountability.
## 12. Empire expansion and consequences
- [ ] Create/acquire/sell/merge subsidiaries, joint ventures, international expansion, capital raising, startup investments, portfolio strategy, due diligence and approvals.
- [ ] Persistent history and long-horizon effects; market share, profitability, cash constraints, client loss, restructuring, insolvency and fictional bankruptcy; success not guaranteed.
- [ ] Reversible corrections as explicit events; time continues while offline, catch up without duplicate activity.
## 13. Personal wealth and lifestyle
- [ ] Family office, personal accounts, investment portfolio, personal spending and net worth, real estate, private aviation, travel, security, concierge, philanthropy, social/business clubs, summits, dinners and reputation.
- [ ] Real fictional cost, upkeep, staff, schedules and impact on wealth; personal/business funds distinct and appropriate approvals.
## 14. Acceptance and production readiness
- [ ] Test every UI number reconciles to records and updates after an actual action; no placeholder KPIs.
- [ ] Test identity customization (Daniella vs Amara), all contact types inbound/outbound, 30-second callback and delegated call, no-answer in both directions, character-to-character missed calls, message/voicemail continuation and push deep links.
- [ ] Test autonomous events 24/7, urgent override, meaningful overnight progression, availability, three-day offline catch-up, retries, duplicate protection and provider outage.
- [ ] Test hires/fires, authority limits, approvals, ledger balancing, payroll, contract payments, fraud investigations, secrets, board voting, acquisition and downstream consequences.
- [ ] Test all phone apps, cross-app consistency, live meeting participation, character memory, source-grounded real events, multi-user tenancy and permissions; no real-world actions.
- [ ] Load, cost, observability, job liveness, security, privacy, data retention/deletion, backup/restore, disaster recovery, build, migrations, preview, end-to-end device testing and release verification.
- [ ] Final immersion test: leave world untouched three days, return to coherent independent activity, accurate balances, meaningful communications, decisions, appointments, people changes and explainable consequences; verify against stored records.

## 15. Additional approved implementation scope (26 November 2026)

The following systems were added after the original backlog was committed. "Code present" means implementation exists on the development branch; it does **not** mean end-to-end acceptance has passed.

### Code present — acceptance still required
- [ ] Company chart of accounts and expanded double-entry transaction types: cash, receivables, inventory, fixed assets, investments, payables, tax, loans, equity, revenue, operating expense, payroll, COGS, depreciation and interest.
- [ ] Accrual invoice lifecycle: invoice issuance records receivable/revenue; payment records cash/receivable; financial statement balance check.
- [ ] Company financial statement summaries: assets, liabilities, equity, revenue, expenses and net income.
- [ ] Inventory items, weighted-average cost, stock movements, purchase orders, approval, goods receipt and supplier payment.
- [ ] Company loan proposals, approval, disbursement, principal repayment and separate interest expense.
- [ ] Acquisition proposals, approval, completion, investment ledger posting, portfolio holding and majority-owned subsidiary creation.
- [ ] Family Office: personal accounts, personal ledger, assets, investment holdings, valuations and net-worth calculation, separate from company funds.
- [ ] Travel & Lifestyle: personal/business trips, flight/hotel/ground/experience/private-aviation/security booking records; booking confirmation posts to the appropriate personal or company ledger.
- [ ] Security & Risk: incident register, categories, severity, assignments, evidence, findings, false-alarm and resolution.
- [ ] Philanthropy: personal/company grant proposal, approval and disbursement with corresponding ledger entries.
- [ ] Unified Activity & Catch-up timeline: a Samsung-style chronological history across world events, audit records, direct and group messages, calls, voicemail records, meetings and transcripts, decisions, approvals, documents, ledger transactions, payroll, contracts, procurement, inventory movements, people, travel, security, philanthropy, investments and external intelligence. Include a since-last-visit briefing, participation/absence labels, action-needed flags, search, date/category filters and deep links into the relevant phone apps. The timeline must be based on persisted records and must not invent events.
- [ ] Authenticated PWA launch starts the durable world workflow with database-based duplicate-run protection.
- [ ] Approval-gated action proposals from internal executive text conversations; supported actions are persisted for Chairman approval rather than executed directly by the model.
- [ ] Valid P-256 VAPID key pair configured on the Living World preview environment; service worker, manifest and offline shell served by preview.

### Still required to finish these systems
- [ ] Reconcile every balance-sheet account and verify the balance-check remains zero across every supported transaction type, including legacy opening balances.
- [ ] Complete COGS on sales, supplier master records, multi-line purchase order editing, partial receipts/payments, returns, inventory adjustments and stocktakes.
- [ ] Loan amortization schedules, accrued interest, covenants, collateral, refinancing and overdue-payment handling.
- [ ] Acquisition due diligence, regulatory conditions, negotiation, partial consolidation, impairment, disposals and sale proceeds.
- [ ] Personal inter-account transfers, liabilities, debts, asset upkeep, real-estate operating expenses and portfolio revaluation.
- [ ] Travel booking refunds, itinerary changes, travel disruption, concierge and security workflows; no external airline/hotel integration is assumed.
- [ ] Autonomous security/threat detection, assignment to security/legal staff, investigations and evidence-led escalation.
- [ ] Foundation governance, charity verification, recurring grants and measurable impact reporting.
- [ ] Push for all approved event categories (messages, voicemail, tasks, approvals, meetings and urgent events), per-device subscription management and real Android/iOS installed-PWA tests.
- [ ] Audio voicemail/voice notes, recording consent, storage limits, playback, transcription and two-way continuation after missed calls.
- [ ] Character-to-character calls and missed-call messages must be tested in both directions, not inferred from text-message support.
- [ ] Executive action proposals must be verified end-to-end from natural-language intent through approval, execution, event propagation, phone update and subsequent character awareness.

## 16. Current delivery rule
- The living-world branch is the development source of truth; production remains untouched until release approval.
- Preview database migrations are additive and have been applied incrementally. Production migrations must be backed up, reviewed and approved separately.
- Passing CI/build is necessary but not sufficient. No feature is complete until its acceptance tests, tenant isolation, error/retry behavior and relevant PWA/device checks pass.
- Do not mark the overall project complete while any required item in this master backlog remains unchecked.

## 17. Expanded Living World delivery record — 26 November 2026

Implementation present on development branch; acceptance checkboxes above deliberately remain open.

- Stakeholder outreach: persistent independently generated messages/call invitations with relationship-specific context, deferrals, retry and rate/quiet-hour handling.
- Procurement: multi-line orders, partial receipts/settlements, COGS, reorder proposals, matched fictional supplier quotes, bounded counteroffers and modeled approved delivery. Stocktakes and returns remain.
- Board: persistent advisory motions, individual AI ballots, quorum, resolutions and browser speech dictation. True simultaneous multi-party Vapi voice and real-device verification remain.
- Travel: itinerary changes, confirmed-booking cancellation, bounded refunds to original account, expense reversal and modeled calendar completion. Disruption/concierge/security orchestration remains.
- Wealth: personal debt draws and repayments, liability-adjusted exact net worth, configured monthly asset upkeep and unpaid upkeep obligations.
- Philanthropy: recipient verification evidence, new-grant approval gating, recurring proposals and user-recorded measured impact. Independent foundation governance and impact verification remain.
- Relationships: supplier delivery, customer settlement and dispute cause bounded, idempotent trust/respect/tension updates. Broader character knowledge permissions, dynamic introduction and rival financial consequences remain.
- HR: earlier implementation covers historical employment terms, prorated payroll, candidates, review, promotion approval and modeled notice. Interactive interviews and negotiated offers remain.
- Loan schedules and accrued interest: earlier implementation covers installments and overdue notices. Refinancing, collateral and covenants remain.
- Validation: 11 new tables, 20 validated CHECK constraints, refund fixture balanced, 17 direct rule assertions, 15 backend source syntax checks. Regression tests committed; full CI, JSX build, authenticated end-to-end behavior, cross-tenant and multi-device testing still unverified.
- Blocker: preview build-rate limit. Latest source has not been deployed and the durable workflow revision must be activated on a new validated preview. Production remains untouched. Do not mark complete until all acceptance gates pass.


## Callback and voicemail reliability — 28 November 2026
- [x] Typed chat and transcribed voice notes share one idempotent callback action path; common “Cal me now” typo is recognised; assistant confirmations are emitted only after the in-app invitation or scheduled job is successfully created.
- [x] Missed-call and colleague voicemail prompts explicitly define caller and recipient roles; reject self-greetings, wrong speaker identity and fabricated phone numbers; use a grounded safe fallback when model output is invalid.
- [x] Synthetic voicemail voice assignment respects explicit character voice preferences and uses gender-aware Orpheus voice mapping; the Chief of Staff voice is female and professionally directed.
- [ ] Re-issue or archive historical misaddressed voicemail audio; verify new audio quality with the Chairman on Android/iPhone; verify foreground/background call delivery and notification registration.
