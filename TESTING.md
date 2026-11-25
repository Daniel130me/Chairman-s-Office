# Migration release checklist

Run npm test and npm run build. Source tests check code structure, not actual database behavior. Use an isolated Neon branch and two independent test accounts for all live tests.

| Case | Expected |
| --- | --- |
| Register/verify/login; wrong password | Only verified accounts enter |
| Reset password, expired link | Reset works; errors understandable |
| Existing legacy email | No automatic account claim |
| Concurrent first login and onboarding | One stable profile and empire |
| Cross-account contact/call/meeting/tender IDs | No access or mutation of another user |
| Welcome call | Rings when due while app open |
| Answer twice, two devices, mismatched contact | Only one acceptance succeeds |
| Decline and missed call | Ring stops; history retained |
| Microphone denied, remote hangup, provider errors | Clear errors; transcript retained or retryable |
| AI fallback and timeout | Valid reply or fallback |
| Conclude meeting twice | Single minutes document |
| Schedule meeting in local time | Stored UTC and displayed local time correct |
| Midnight quiet hours, DST, max calls zero | Settings respected |
| Duplicate daily workflow, restart mid-tick | No duplicate scheduled invitations |
| Push while closed, tap notification | Correct office opens |
| Revoke permission, stale push, logout and second account | No signed-out user's alerts |
| Offline/online, reload, deployment restart | Safe errors and persistent world |
| Android/iOS install | Phone UI, navigation, audio, alerts verified |
| Concurrent users and larger histories | Monitor DB connections, latency and workflow usage |

Residual limitations: provider webhook reconciliation, per-device push delivery tracking, full AI operation idempotency, multi-voice board meetings, browser background limits and larger-world sharding require additional integration work.
