# Chairman's Office v0.5 — HTTP API overview

Base URL: `/api`. Frontend runs on Vite port 5173 in development and proxies these requests to Express port 3002. With the frontend built, Express serves both on port 3002.

Every state-changing request includes `Content-Type: application/json` and `X-CO-Request: 1`. Authentication uses an HTTP-only `co_session` cookie.

Public:
- `GET /api/health`
- `POST /api/auth/register` `{name,email,password}`
- `POST /api/auth/login` `{email,password}`
- `POST /api/auth/logout`

Signed-in:
- `GET /api/me` — current identity
- `POST /api/world` — create personal fictional world `{name,region,timezone,sectors,companies,chief}`
- `GET /api/state` — user's own world snapshot and all executive apps' records
- `GET /api/providers` — configured provider names and statuses, no keys
- `POST /api/messages/:contactId` `{body,channel}` — role-specific text reply and retained history
- `PUT /api/contacts/:contactId/voice` `{voiceId,vapiAssistantId}` — configure an executive's acoustic identity
- `POST /api/decisions` `{threadId,content}` — record an instruction against an active matter
- `POST /api/tenders/:id/prefer` `{bidId}` — select preferred bid pending contract review
- `POST /api/tenders/:id/negotiate` `{bidId,amount}` — initiate a counteroffer and record the outcome
- `POST /api/contacts/:id/request-call` — create a pending incoming-call invitation
- `POST /api/calls/start` `{contactId,inviteId?}` — start authenticated in-app call record and get current persona/world context
- `POST /api/calls/:id/end` `{transcript:[{role,text}]}` — save transcript and attempt explicit decision extraction
- `POST /api/invites/:id/decline` — decline a user's invitation
- `POST /api/meetings` `{title,start_at,attendees,duration_minutes?}` — create a meeting
- `GET /api/meetings/:id/turns` — read historical turns
- `POST /api/meetings/:id/speak` `{message}` — Chairman addresses board or hears next person
- `POST /api/meetings/:id/end` — end, persist minutes, create document
- `PUT /api/settings` — update morning, evening, quiet hours, call caps
- `GET /api/push/public` — VAPID public key
- `POST /api/push/subscribe` — save Web Push subscription (own account)
- `POST /api/engine/advance` `{steps}` — **development-only** fast-forward to test autonomy

All user-supplied contact/meeting/tender IDs are checked against the current signed-in user. This API does not initiate PSTN cellular calls, run payments, or connect to actual financial accounts.
