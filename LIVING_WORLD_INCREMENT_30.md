# Increment 30 — Sourced real-world news
- Adds a low-frequency GDELT DOC 2.0 feed scoped to the world's primary region and company sectors, with article URL, publisher domain, source country, language, publication time, retrieval time and search query persisted.
- Adds a News application and exposes the latest reports to executive reasoning with an explicit rule that headlines are reports, not verified business facts.
- Adds one digest event for newly stored articles, not one push per article. News refresh is throttled separately from numeric indicators; failures retry after a cooldown.
- GDELT is rate-limited and coverage is not exhaustive. Real-world news must be verified at its original publisher before consequential business decisions.
