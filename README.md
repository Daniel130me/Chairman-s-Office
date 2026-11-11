# Chairman's Office — Experience-first Neon/Render PWA rebuild

An immersive fictional executive smartphone experience. React/Vite frontend and Express backend run together on a **single Render Free Web Service**, with state persisted in **Neon PostgreSQL**. The user creates a fictional group, meets a chief of staff, develops distinct relationships with internal executives and external stakeholders, responds to incoming call invitations, conducts board discussions, and records strategic decisions. The interface is an original Samsung One UI–inspired phone experience without Samsung branding or proprietary assets.

**Development status:** This is a substantial replacement implementation, not a reviewed production release. Code has been statically checked; network-dependent npm install, React production build, Neon integration, Vapi audio and device push tests require a connected development environment and real credentials. The user must review and test before putting it into public service. Existing v0.5 code remains on GitHub; this package does not silently overwrite it.

## Structure

- `frontend/`: React 18, Vite 6, mobile PWA shell, onboarding, notification shade, lock screen, home apps, sound synthesizer, Vapi Web SDK, PWA service worker
- `backend/`: Express REST API, `pg`/Neon schema, session authentication, user-isolated fictional world, multiple AI providers, character dialogue, meetings, negotiations, call log, Web Push, autonomic scheduler
- `render.yaml`: one Render Free web service that compiles the frontend and serves it from Express

## Local setup (Node.js 22+)

1. Create a Neon PostgreSQL database and copy its **pooled** connection URL.
2. `cp backend/.env.example backend/.env` and set `DATABASE_URL`. Keep that file private; never commit it.
3. `cp frontend/.env.example frontend/.env` and set `VITE_VAPI_PUBLIC_KEY` and `VITE_VAPI_ASSISTANT_ID` for real internet calls. These are client-side public credentials; **never expose private Vapi/API tokens** through `VITE_` variables.
4. In terminal A: `cd backend && npm install && npm run dev`
5. In terminal B: `cd frontend && npm install && npm run dev`
6. Open `http://localhost:5173`. Register an account (10+ character password). The PostgreSQL schema is created automatically at backend startup.
7. To test the production combined-service layout, run `cd frontend && npm run build`, then restart backend and visit `http://localhost:3002`.

**Important:** The backend must access Neon; frontend is always same-origin `/api`, with Vite's development proxy in development and Express serving built frontend in production. Do not configure cross-site cookies unnecessarily.

## Deploy to Render Free

1. Push **this source** into your existing GitHub repository on a new branch after reviewing it; keep your existing implementation as a backup.
2. Connect the repository to Render and use the included `render.yaml` blueprint, or create a Node Web Service with root directory at repository root.
3. Build: `npm ci --prefix backend && npm ci --prefix frontend && npm run build --prefix frontend`
4. Start: `npm start --prefix backend`
5. Set environment variables in Render: `DATABASE_URL`, `NODE_ENV=production`, `VITE_VAPI_PUBLIC_KEY`, `VITE_VAPI_ASSISTANT_ID`, server-side AI keys, and optional `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. Values beginning `VITE_` are embedded at **build time**; redeploy after changing them.
6. Open `/api/health` on your assigned Render HTTPS URL; verify `ok: true`.
7. Register, complete onboarding, verify the 20-second initial call invitation, test each app, then install the PWA via Android Chrome or iPhone Safari **Add to Home Screen**.
8. Add the Render HTTPS origin to your Vapi allowed origins. Grant microphone access when testing a call.
9. Create Web Push VAPID keys through a trusted Web Push utility (e.g., `npx web-push generate-vapid-keys`) and add them to Render before enabling in-app alerts.
10. Optionally configure uptime monitoring to GET `/api/health` every ~10 minutes; this is **not** guaranteed to keep Render Free running. Render can still suspend or restart free services. Neon persists data across Render restarts; the scheduler catches up with missed opportunities when it runs again, but cannot deliver a phone call while the process is offline.

**Free-tier caveats:** Render Free is not reliable 24/7 infrastructure. The scheduler uses periodic polling, not durable hosted job execution. The service's filesystem is disposable, which is why application data is held in Neon. PWA push is a notification that opens the app, not native cellular VoIP ringing when the app is closed. A server uptime monitor cannot guarantee deliverability or avoid free-plan limits. For a commercial launch use an always-on service and production job runner, database monitoring, backups, metering, and a security review.

## Realism / experience

Distinct contacts have different agendas and relationships; messages and board dialogue call AI models where credentials are available, with deterministic fallback if a provider is unavailable. Full voice sessions require the Vapi public key and a compatible assistant. A locally generated melodic ringtone plays during an in-app call invitation where the browser allows audio; it uses no third-party copyrighted music. The PWA supplies an original lock screen, home screen, app drawer, quick shade and dedicated apps. Events, messages, discussions, bids and decisions persist in Neon. The user can install the experience, but offline access to logged-in data is intentionally limited (no insecure database snapshots in the service-worker cache).

## Known gaps before a public launch

- The original v0.5 repository contains additional scenario detail and workflow edge cases not all replicated in this rewrite. Compare both versions before replacing production code.
- The meeting interface uses sequential AI turns and device speech is not yet orchestrated into simultaneous multi-person voice conversation.
- Advanced phone gestures and accessibility audit need physical-device testing.
- Database migrations currently use idempotent `CREATE TABLE` statements at startup; adopt versioned SQL migration tooling before evolving schema in production.
- The scheduler runs only while Render is up and has no distributed lease; keep **one server instance** until a durable job queue is implemented.
- Important production hardening includes user-level quotas, durable audit logs, multi-factor auth, session cleanup, per-character structured long-term memory, AI cost metering, robust request validation and stronger security testing.

## Safety

This is an immersive **fictional simulation**. It must never falsely indicate that real contracts, company actions, wealth or regulatory activity happened outside the application. Keep all actual provider private keys server-side. Never commit `.env` files.
