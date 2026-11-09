# Chairman's Office — Local Internet Call Test (No Twilio, No Render)

This project includes a **React/Vite browser app** for an internet-only voice conversation with Amara, using Vapi's Web SDK. It also retains the earlier **optional Express/Twilio telephone-testing backend** in the repository for future use. You do NOT need to configure, install, or run that backend for this browser demo.

## Run on your Mac in VS Code

**Prerequisites:** Node.js 20.19+ and a Vapi account with available voice credits. **No Twilio number required.**

### 1. Create Amara in Vapi

In [Vapi](https://dashboard.vapi.ai), choose Assistants → Create Assistant. Set her system prompt to the contents of [`AMARA_PROMPT.md`](./AMARA_PROMPT.md), configure the greeting and a natural voice, and set a five-minute maximum duration. Publish if prompted. Copy the **Assistant ID**.

For an even faster first test, use the `Talk` button next to Amara's assistant in the Vapi dashboard itself (web call; no number required).

### 2. Configure browser-only public credentials

In Vapi → API Keys, create a **Public API Key** restricted to the development origin `http://localhost:5173` and your Amara assistant. **Never use your private Vapi API key in the frontend.**

Open VS Code Terminal:

```bash
cd chairmans-office-local-internet/frontend
npm install
cp .env.example .env
```

Edit `frontend/.env`:

```dotenv
VITE_VAPI_PUBLIC_KEY=YOUR_VAPI_PUBLIC_KEY
VITE_VAPI_ASSISTANT_ID=YOUR_AMARA_ASSISTANT_ID
```

### 3. Run

```bash
npm run dev
```

Open `http://localhost:5173` on your Mac. Select **Simulate incoming call** → **Answer**. Allow microphone access. The call audio happens via the internet and uses your Vapi allowance or usage billing.

- **Ring in 30 seconds** is a visual/audio *local demonstration* and only works while this page stays open. It is not a true background incoming call.
- **Executive memory** is a demo of continuity: manually write a summary/directive, save, then answer the next call. The note is sent to Vapi at call start and saved in this browser's localStorage. It is *not* an automated world-state engine, transcription database, or reliable persistent simulation yet.
- The **call transcript** is shown live when Vapi emits final transcript events. Exact event behavior depends on your agent configuration.
- This demo does not implement autonomous simulation, scheduled push invitations, native background incoming call UI, or automated decision extraction. Those are next stages.

## Test from your phone while your computer runs VS Code

`http://localhost:5173` refers to the phone itself, so that URL will not reach your Mac from Android/iPhone. Also, mobile browsers require a secure HTTPS origin for microphone permission. Use an HTTPS development tunnel to port `5173` (e.g., Cloudflare Tunnel or ngrok), restrict access, then open its URL on the phone. When using a different origin, add the exact HTTPS tunnel origin to your Vapi **Public Key allowed origins**, and update the Vite dev `--host` option only if the tunnel configuration requires it. Do not expose your private Express admin API or `.env`.

For private testing, you can also run the frontend locally and first test Amara's voice on your Mac, then use the hosted or tunneled development URL on each mobile device.

## True incoming internet calls when the app is closed

A browser demo cannot guarantee phone-style ringing when the browser is closed. For that, build a **native mobile app** with app-specific VoIP notifications and system call UI: iOS PushKit/CallKit and Android's telecom/VoIP integration. This still does **not** require Twilio. You need a reachable backend for push notifications and a real native app installed on the devices. That is the milestone after validating the voice interaction.

## About the optional legacy telephone backend

`src/`, `scripts/`, and root `package.json` are retained from the earlier Twilio phone-call starter. Ignore them for internet calls. The separate `frontend/package.json` is all you need for the browser demo. Never put Vapi private API keys, Twilio secrets or numbers in frontend environment files.

## Official sources
- Web SDK quickstart: https://docs.vapi.ai/quickstart/web
- Vapi public keys: https://docs.vapi.ai/security-and-privacy/api-keys
- Browser microphone secure context: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- iOS VoIP notification flow: https://developer.apple.com/documentation/pushkit/responding-to-voip-notifications-from-pushkit
- Android Telecom: https://developer.android.com/reference/android/telecom/ConnectionService
