# Increment 12 — External network migration safety
- Make the external organization foreign-key migration idempotent by defining it with the additive column.
- Existing empires lazily backfill external organizations from their existing contacts without creating fictional financial figures.
- This preserves existing contacts and prevents older users from seeing an empty external-organization directory.
