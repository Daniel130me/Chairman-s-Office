# Final release verification and rollback

Release scope: desktop and mobile PWA. Native Android/iOS application development is deferred; mobile browser and installed PWA acceptance remain in scope.

The simulation must not be called complete solely because compilation succeeds. The production branch and production Neon data remain separate from draft development.

## Before any migration or deployment
1. Identify the actual production deployment, branch, database and migration version. Do not copy production secrets to logs, issue comments or test fixtures.
2. Create a verified Neon branch/backup or equivalent recoverable database snapshot before changes. Record its identifier privately and exercise restoration in an isolated environment.
3. Deploy the final candidate against an isolated database and test with two independently created accounts.
4. Run the independent GitHub verification workflow. Check every unit, migration, isolated database and production-build step; record the exact commit SHA and run ID.
5. Run `npm run db:reconcile` with the intended environment (read-only, aggregate counts). Investigate any nonzero result; do not rewrite ledger entries to make the checks pass.
6. Only after acceptance and backup, promote the verified commit using the existing deployment configuration. Never switch the production database during a preview test.

## Live acceptance matrix
- Fresh onboarding with different sectors, Chief of Staff name, independent characters and timezone.
- Incoming/outgoing call, missed/declined call, voicemail, voice note, callback request, message continuation, network interruption and saved transcript.
- Multi-executive meeting, spoken input, responses, disagreement, minutes, resolutions, follow-up and character memory.
- 24-hour/multi-day absence, background progression, no duplicate financial or operational events, readable Activity history and notification links.
- Cash, company and personal ledgers, loan and secured refinance, inventory credits and defective returns, procurement, disputes, acquisitions and travel replacements; reconcile before/after. Verify daily observed group-account history is immutable, tenant scoped, and not backfilled; compare captured cash/assets/liabilities and ownership with the reconciled position.
- Two accounts cannot read each other's records, voice audio, calls, events or push subscriptions.
- Installed Android Chrome and iPhone Safari PWA: permissions, audio unlock, microphone, foreground alerts, closed-app push and reconnect. Browser push does not guarantee native telephone ringing or background media.
- Inspect errors, scheduler health and repeated provider failures. Verify data remains readable following a provider outage.

## Rollback
Stop further promotion if an invariant, authorization boundary, migration or required experience fails. Roll back application code to the last known-compatible deployment; restore data only using an approved recovery plan (a database restore can lose new records). Keep any failed candidate isolated and record the defect. Do not erase fictional history as a repair.
