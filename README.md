# Chairman's Office v0.5 — The Living Executive World

A **local-first, multi-account, immersive fictional executive environment**. Each signed-in user establishes a different holding company and enters a connected executive smartphone with real interactions: management messages, incoming invitations, internet voice calls, an independent professional network, boardroom deliberation, financial overviews, tenders and documents. Company matters advance while the local backend stays running.

This is working **source code** intended for local testing, not a deployed hosted service or a native Android/iOS app. The corporate world is fiction; no real-world asset, balance, staff member, appointment or contract is created.

## What's inside

```
chairmans-office-v0.5/
├── backend/                    Node.js 22 + Express API
│   ├── .env.example
│   ├── src/
│   │   ├── app.mjs            Authenticated API
│   │   ├── db.mjs             SQLite schema, data access
│   │   ├── security.mjs       Scrypt passwords + HTTP-only sessions
│   │   ├── world.mjs          Characters, worlds, meetings, calls, bidding
│   │   ├── scheduler.mjs      Autonomous updates and call invitations
│   │   ├── ai.mjs             Five-provider inference gateway and fallback
│   │   └── server.mjs         Express server
│   └── test/
├── frontend/                   Separate React 18 + Vite PWA
│   ├── .env.example
│   ├── src/
│   │   ├── App.jsx            Executive device + interconnected applications
│   │   ├── api.js             Authenticated HTTP API client
│   │   └── style.css          Mobile-first premium UI styling
│   └── public/                 PWA manifest + service worker
├── VAPI_VOICE_SETUP.md
├── TEST_SCENARIOS.md
└── API_REFERENCE.md
```

**Requires:** Node.js **22.13+** (tested with Node 22.16), npm, modern Chrome / Safari / Edge and an internet connection for real AI or Vapi calls. This release deliberately uses the built-in Node `node:sqlite` `DatabaseSync`, which may print an experimental warning on Node 22. You don't need to install SQLite separately.

## Quick local start in VS Code

### Terminal 1 — backend

```bash
cd chairmans-office-v0.5/backend
npm install
cp .env.example .env
npm run dev
```

The server uses `http://localhost:3002` by default (port 3000 and 3001 are often occupied on local machines, so the app now targets a free port). It automatically creates the SQLite database in `backend/data/chairmans-office.sqlite`.

### Terminal 2 — frontend

```bash
cd chairmans-office-v0.5/frontend
npm install
cp .env.example .env
```

Edit `frontend/.env` using the **Vapi Public API Key** and **Assistant ID** that worked in your earlier local demo:

```env
VITE_VAPI_PUBLIC_KEY=your_existing_public_key
VITE_VAPI_ASSISTANT_ID=your_existing_vapi_assistant_id
```

Run:

```bash
npm run dev
```

Open **http://localhost:5173** and register a new account. Passwords must be at least ten characters.

No Twilio or Render is required. The API and SQLite run locally. The external AI gateways and Vapi still require internet access and incur usage-based charges if used.

### Configure the AI providers (optional, highly recommended)

Edit `backend/.env` and set as many provider keys as desired:

```env
AI_ORDER=groq,gemini,zai,openrouter,openai
GROQ_API_KEY=
GEMINI_API_KEY=
ZAI_API_KEY=
OPENROUTER_API_KEY=
OPENAI_API_KEY=
```

No keys? The world, meetings, messages, scheduled invitations, negotiations and decisions **still function** using the built-in rule-based fallback. However, dialogue is more repetitive. To assess conversational and narrative realism, configure one or more model keys. The backend skips unconfigured providers, times out slow providers, and falls back on errors / invalid JSON. Keys never belong in the React `.env` file.

Provider models and URLs are adjustable in `backend/.env` / `backend/src/ai.mjs` because model availability changes.

### Voice personalization: crucial for realism

**Read `VAPI_VOICE_SETUP.md` before testing calls to people other than Amara.**

The existing Amara assistant may have a hard-coded Amara persona. For this multi-character app, update its Vapi dashboard System Prompt to use `{{character_name}}`, `{{character_title}}`, `{{character_company}}`, `{{chairman_name}}`, and `{{executive_context}}`.

For **different voice identities**, open each person's Contact screen → **Voice identity** and configure a dedicated Vapi Assistant ID (best), or a compatible ElevenLabs Voice ID. Without a separate identity, the app will use the default Vapi assistant voice for all characters, even if their text/personality differs. It will not pretend separate voices were produced.

### Tests

```bash
cd backend
npm test
```

The tests cover independent accounts, custom industries, company developments, decisions, tender governance, real-world / simulated state separation, persistent multi-speaker meeting turns, invitations and AI fallbacks.

## How the autonomous world functions

1. A new account creates its own holding company, industries, subsidiaries and chief of staff.
2. SQLite seeds company financial assumptions, management executives, independent investors/friends/rivals/bidders, active strategic matters, board engagements, messages, tenders, and management documents.
3. The backend periodically advances current storylines (45 minutes between world ticks by default), sometimes producing a new external message, and can enrich developments with a configured AI provider.
4. The scheduler autonomously creates morning and evening briefing invitations and occasional urgent / professional-network calls, subject to daily caps and quiet hours.
5. Web Push can deliver invitations to supported installed PWAs. In an open browser, the app also polls the backend and displays an incoming-call screen. Tap **Answer** to connect to an actual Vapi Web SDK voice session.
6. Completed voice transcripts are stored in the current user's SQLite world. Explicit directives can become recorded decisions and later influence events. For high-stakes board instructions, also use the visible decision ledger to confirm accuracy.
7. Online boardroom supports interactive AI discussion turns with distinct character roles and optional device text-to-speech plus microphone dictation where supported. The board meeting can be concluded to produce recorded minutes and a document.
8. External contacts have independent business interests; they can reach out via calls and messages. The Chairman can call or message them for advice, collaboration or negotiations.

## Incoming push notifications on Android/iPhone

Browser voice calling works on your laptop immediately after configuring Vapi. **Background phone notifications require HTTPS**, a continuously running backend, and Web Push credentials.

Generate VAPID keys:

```bash
cd backend
npm run vapid
```

Copy both values into `backend/.env` as `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`, and set `VAPID_SUBJECT=mailto:you@example.com`. Restart the backend.

Build the frontend so Express can serve both UI and API from **the same origin**:

```bash
cd ../frontend
npm run build
```

Restart the backend if needed. Local combined app: `http://127.0.0.1:3002`.

To open on phones without Render, run a temporary HTTPS tunnel from another terminal:

```bash
cloudflared tunnel --url http://127.0.0.1:3002
```

Open the generated HTTPS URL on Android Chrome and iOS Safari. On iPhone, use **Share → Add to Home Screen** and open the installed Home Screen web app. In Chairman's Office → Settings, tap **Enable incoming alerts**. Approve the notification request. A new user receives an automatic initial briefing invitation shortly after their empire is created; **the user does not need to schedule it**. Later, external contacts can call too.

If the generated tunnel URL changes, add its new HTTPS origin to your Vapi public-key allowed origins. Cloudflare quick tunnels are temporary development endpoints, not durable infrastructure. Keep your laptop awake and connected.

### Important calling constraints

- **Browser/PWA:** scheduled Web Push + in-app invitation, followed by a real two-way Vapi internet conversation. It does **not** reliably show a native WhatsApp-style full-screen ringing interface when closed.
- **Native phone calls:** not included in this source; require a React Native/Capacitor native call integration and platform-specific push/telecom permissions, or a telephone provider for calls to a normal Nigerian mobile number.
- **Multi-speaker meeting:** interactive role-based turns with speech synthesis and optional dictation. **Not** a simultaneous multi-user video-conferencing SDK with separately generated audiovisual streams.
- **Real AI provider failover:** applies to generated text/narratives/meeting turns/extraction. Vapi outages are not automatically covered.
- **Infrastructure:** SQLite and the worker are on the laptop. When the computer sleeps or shuts down, autonomous advancement and notification delivery stop. Next time the engine is running, it resumes from stored timestamps with bounded catch-up.
- **Privacy:** external voice and LLM providers may process supplied conversations and context. Recording is requested off for Vapi web calls, but consult your provider retention settings. Never use real banking credentials, real contracts or private third-party data in your fictional world.

## Private/local implementation notes

- Each endpoint authenticates via a random HTTP-only session cookie; passwords are salted and hashed with scrypt.
- Every mutable/read world operation checks the signed-in user. Attempts to access another user's calls, contacts or meetings fail.
- The frontend and backend have independent `package.json` files and communicate only via HTTP `/api` routes. Vite proxies `/api` to Express during development.
- The gateway is server-side and supports OpenAI-compatible calls (Groq, Z.ai, OpenRouter, OpenAI) plus Gemini `generateContent`.
- `ENABLE_DEV_CONTROLS=true` enables Settings → **Advance simulation activity**, useful for rapidly evaluating different industries and accounts. Set `false` in any shared deployment.
- This isn't a production-hardened multi-tenant SaaS. Add robust monitoring, backups, migration handling, provider metering, request quotas, per-account notification delivery policies, audit tooling, email confirmation and security review before a public launch.

## Current testing status

The core backend logic and SQLite tests run locally in the build environment. Frontend JSX was syntax-checked with the TypeScript parser, and backend `.mjs` files passed Node syntax checks. The build environment could not access npm's registry, so **`npm install`, Vite production build, Express integration and a real Vapi call have not been verified here**. See `TEST_SCENARIOS.md` for how to verify those on your machine.
