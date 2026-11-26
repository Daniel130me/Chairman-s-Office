# Increment 29 — Weather in the reality-to-world bridge
- Adds Open-Meteo geocoding and current conditions/precipitation probability for the configured world region, with source URL and observation time.
- Weather is stored as sourced external signals, not company transactions; characters receive the signal snapshot as external context.
- Signal refresh cadence is six hours. If every source fails, the refresh timestamp is not advanced, allowing the next engine tick to retry.
- Weather API availability and relevance for multiple operating regions still need acceptance testing; current implementation uses the world’s primary region.