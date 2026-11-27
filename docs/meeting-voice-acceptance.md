# Boardroom voice acceptance

The boardroom keeps the application database as the source of truth for executive identities, statements, approvals and minutes. A transcription provider cannot create an executive response or perform an action.

## Supported paths
- Typed and browser-dictated remarks.
- Recorded utterance transcription (Groq) with local speech activity detection.
- Optional WebRTC live microphone transcription (OpenAI `gpt-live-transcribe`), local speech boundary detection and explicit commits; provisional live captions are not persisted.
- Generated executive replies are committed before voice playback; speech segments are prefetched one segment ahead. This is not native continuous speech-to-speech synthesis.

## Enable a separate test environment
Set `MEETING_REALTIME_ENABLED=1` and configure a server-only `OPENAI_API_KEY` with access to the live transcription model. Leave the flag off in production until provider and device acceptance. Never put the standard API key in the frontend. Explicit user consent is required for each streaming microphone session; audio streams directly to OpenAI and can incur usage costs. A short-lived client secret is returned to the authenticated browser; the server tracks credential issuance attempts (12 per user in a rolling day and a 15-second reconnect cooldown). The browser disconnects on navigation/hidden page and after 20 minutes. The client timeout is not a provider-side spending cap; set appropriate project limits and monitor usage independently.

Provider references:
- https://developers.openai.com/api/docs/guides/realtime-transcription
- https://developers.openai.com/api/docs/guides/realtime-vad
- https://developers.openai.com/api/docs/guides/voice-webrtc
- https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create

## Acceptance (record measured results, do not assume)
1. Sign in as independent test accounts; confirm one account cannot mint a session for another account's meeting or a concluded meeting.
2. With the flag disabled, verify the option is hidden and direct endpoint calls cannot mint a credential. With it enabled, decline the consent prompt and verify the microphone is not opened.
3. On Android Chrome, iPhone Safari PWA, and desktop Chrome: connect with headset and speakerphone. Verify interim captions, final transcripts, numbers, accents, silence, and permission denial.
4. Interrupt an executive mid-playback. Confirm output stops, old worker cannot append after the new remark, and the intended executive answers. Measure time from last voiced sound to first audible reply (target <= 3 seconds median, <= 6 seconds p95 under a healthy network; targets, not achieved results).
5. Simulate packet loss and network changes; verify recovery and absence of duplicate remarks. Restart a failed round; previously recorded statements must not be replaced. Test repeated retries and expired leases.
6. Verify switching to recorded speech and typed mode on provider failure. Confirm closing or hiding the page turns off the microphone and no raw meeting audio is persisted by this application.
7. Conclude the meeting and compare minutes against recorded statements, including interrupted discussions and explicit resolutions.

True full-duplex speech-to-speech output, overlapping participant audio and device-specific echo behavior remain unverified. Do not claim release acceptance without measuring them.
