# Chairman's Office — Next.js / Vercel migration

The original Render application stays on **main**. This branch is a migration candidate, not a production release. It preserves the existing executive phone, PWA assets, fictional world and Vapi voice calls.

## How it works

- app/: Next.js pages and API route handlers (no separate Express process).
- frontend/src/: existing React phone and apps. Loaded on the browser only.
- backend/src/db.mjs, world.mjs, ai.mjs: existing database and simulation logic.
- lib/auth/: Neon managed Better Auth; lib/profile.mjs links verified auth accounts to original application IDs.
- lib/routes.mjs: validated API requests, user isolation, shared database-backed rate limits.
- workflows/ and lib/world-engine.mjs: durable scheduling, calls, business developments and Web Push.
- public/: PWA assets and service worker. Private data is never cached.
- tests/: automated unit and structure checks.

## Local setup

Install Node.js 22 or newer.

```bash
git clone -b nextjs-vercel-migration https://github.com/Daniel130me/Chairman-s-Office.git
cd Chairman-s-Office
npm install
```

Copy .env.example to .env.local (PowerShell: Copy-Item .env.example .env.local).
Use a **separate Neon database branch** for tests. Enable Neon Auth email/password and email verification; configure your app origin as trusted. Use the database connection string and Auth base URL from that same environment. Set NEON_AUTH_COOKIE_SECRET and CRON_SECRET to separate random secrets of at least 32 characters. Generate each with node -e "console.log(require('crypto').randomBytes(32).toString('hex'))".

```bash
npm run db:migrate
npm test
npm run dev
```

Visit http://localhost:3000. Register, verify your email, sign in and create an empire. Add Vapi and AI keys as needed. Only public Vapi credentials may use NEXT_PUBLIC_.

## Vercel setup

1. Create a separate Vercel project and use nextjs-vercel-migration as its production branch for testing. Root directory: repository root. Framework: Next.js. Node.js 22 and Fluid Compute enabled.
2. Add environment variables from .env.example. Set APP_ORIGIN to the exact HTTPS origin. Add the same origin in Neon Auth and Vapi. Run the database migration on the test database first.
3. Keep WORLD_ENGINE_ENABLED=false until onboarding is tested and Render is not writing to the same database. Then set true and redeploy.
4. Vercel Cron starts a bounded 25-hour Workflow daily. To start immediately, send an authenticated GET to /api/engine/start with Authorization: Bearer <CRON_SECRET>. Keep the secret private. Check Workflow observability and Neon engine_runs for the run ID and heartbeat.
5. Install the PWA and enable notifications in Settings. On iPhone use Add to Home Screen.

The default 120-second scheduling interval preserves the old cadence but may exceed free workflow events or Neon compute allowances. WORLD_ENGINE_INTERVAL_SECONDS is configurable (60–900). Monitor usage rather than silently sacrificing the experience. Vercel Hobby is non-commercial. Vapi and AI providers have separate billing. Daily runs may overlap; a database lease prevents parallel sweeps. Batch size is ten worlds per tick; larger deployments need sharding.

## Existing accounts

The database migration adds auth_user_id without deleting data or changing existing UUIDs. Existing users need a verified managed-auth account. An administrator must independently verify ownership and explicitly map that account ID to the old user's auth_user_id. Never auto-link by email or copy password hashes. Test on a separate Neon branch and back up first.

## Release checks

Run npm test and npm run build. Generate and commit the root package-lock.json after a successful install, then use npm ci. See TESTING.md. Live Neon, Vapi, provider and phone tests must pass before replacing Render.

Browser push is not native VoIP: a closed PWA can display a notification but cannot reliably ring continuously or answer automatically. The current boardroom uses sequential text turns, not simultaneous executive voice. Those limitations remain. The old Render Express files are retained for comparison only; Next.js does not start them.

## Rollback

Keep main, the old deployment, and the Neon backup untouched. Disable the Vercel world engine before restoring Render. Never run both schedulers on the same active database.
