# Increment 32 — Durable asynchronous boardroom rounds
- Chairman turns are persisted immediately and each meeting round is queued as a Vercel Workflow, avoiding a long synchronous API request for multi-executive responses.
- Each participant responds sequentially using the latest saved discussion and authorised business context. Responses are persisted as they are generated.
- The phone polls durable round status and turns, can resume an active discussion after reopening, and reports partial or failed rounds honestly.
- A partial unique index prevents overlapping active rounds for one meeting. Completed/partial rounds retain their response counts and errors.
- Live Vapi group audio is still separate from the current device-native speech playback; real multi-party voice orchestration and device tests remain acceptance work.
