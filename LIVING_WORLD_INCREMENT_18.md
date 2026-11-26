# Increment 18 — PWA offline shell and system ledger initialization
- The service worker now caches a privacy-safe static offline shell and serves it for failed navigation requests. It does not cache authenticated HTML, API responses or private records.
- Service worker cache version advanced to v3.
- System-generated receipts and expenses now initialize company opening positions before posting, making invoice payment and payroll independent of whether a dashboard read happened first.
- Offline mode is an honest launch fallback; calling, messaging and live financial actions require connectivity.
