# Increment 28 — Business event push notifications
- Add durable, retryable event notification delivery for selected high-value business events; incoming calls continue to use their invitation path.
- Notifications use privacy-safe generic text and carry a specific event ID. Opening a notification takes the Chairman into Activity and highlights the exact recorded event.
- Ordinary ledger entries are excluded to avoid notification flooding. Failed endpoints are removed; transient failures retry.
- Live device delivery, closed-PWA wake-up, iOS Home Screen and Android installation tests remain required.
