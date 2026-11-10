# Realism-first acceptance testing

Run from VS Code before inviting real external testers. Start backend and frontend according to README; configure a Vapi Public Key and Assistant ID. Where Vapi audio is involved, a provider account and active credits are required.

## Test A — Two different business patterns
1. Register `chairman-a@example.test`. Create a logistics, aviation and finance group.
2. Verify three subsidiaries, CFO/COO/Legal/Chief of Staff, three active company matters and contacts from outside the group.
3. Sign out; register `chairman-b@example.test` with agriculture and healthcare.
4. Ensure the group, matter titles, companies, messages and documents differ.
5. Sign back into A: B's information must not be visible.

## Test B — Realistic communication and business relationships
1. Open Contacts → Chief of Staff → Call; verify the actual Vapi conversation starts with appropriate greeting and correct company context.
2. From Contacts, call an external mentor for investment advice, then call the rival CEO regarding a joint venture.
3. Confirm each has a distinct motivation and refuses unhelpful or implausible proposals.
4. Configure a different Vapi Assistant ID (or compatible ElevenLabs voice ID) in Contacts → Voice identity, and test acoustic differentiation.
5. After ending, verify the call history contains the completed session and stored transcripts where available.

## Test C — Tender negotiations
1. Open Tenders and compare 3 bids by amount, duration, quality and risk.
2. Send a counteroffer; observe accepted/rejected response and Mail trail.
3. Select a preferred bidder; verify status and directive appear.
4. Confirm this does **not** pretend a real contract was signed or any real payment made.

## Test D — Live board meeting
1. Open Boardroom → Join first scheduled meeting.
2. Choose **Hear next executive**, listen to browser speech playback, then say "CFO, explain the downside scenario" using typed text or microphone dictation when available.
3. Verify CFO is chosen as next speaker where appropriate.
4. Hear another role's different position, then close the meeting.
5. Open Documents and verify the minutes have been created.

## Test E — Autonomy and continuity
1. After onboarding, allow the backend to run for several minutes. Amara's initial invitation should appear automatically after about 90 seconds (unless background scheduling/quiet-hours policy delays it).
2. Around eight minutes after onboarding, a business associate should request a call independently.
3. Issue a directive regarding an acquisition or expansion; open Intelligence and verify an audit record appears.
4. Settings → Development controls → Advance simulation activity. Confirm storylines evolve from the recorded directive and unrelated companies do not inherit it.
5. Leave the backend on across real-world time intervals; events and executive messages should continue appearing.

## Test F — Device notifications
1. Generate VAPID keys, set backend env, build frontend, expose backend by Cloudflare tunnel.
2. Android: open HTTPS URL; iPhone: open Safari, Add to Home Screen, then open installed app.
3. Settings → Enable incoming alerts, approve notification permission.
4. Keep backend/tunnel running; verify a Web Push invitation arrives and tapping it opens the app.
5. Distinguish a **real push invitation** from a native CallKit / Android Telecom ringing screen, which this web release does not implement.

## Test G — API gateway failure
1. Configure Groq and Gemini (or any two supported providers) in backend `.env`.
2. Temporarily set the first provider's key to an invalid value; make a character message or boardroom turn request.
3. Verify the next valid provider handles the text task and frontend remains operational.
4. Note that Vapi has its own voice processing and does not automatically fail over with this gateway.

## Report genuine defects
Record the browser/OS, relevant API route, screenshots or console errors (with tokens hidden), and whether the failure was audio, scheduling, state consistency, UX or AI behaviour. This helps distinguish model prompt issues from code defects.
