# Increment 24 — Start the living world on authenticated app launch
- Added a session-authenticated, same-origin endpoint to start the durable world workflow.
- The PWA requests activation after login; database day/heartbeat claims prevent duplicate workflows across devices and the daily Vercel Cron.
- The endpoint does not expose CRON_SECRET. If workflow start fails, the claim is released for retry.
- This ensures a newly configured preview or production world can begin progressing after a Chairman signs in instead of waiting for the next midnight Cron.
