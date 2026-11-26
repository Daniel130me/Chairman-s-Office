# Increment 13 — Real-world economic signals
- Server-side adapters ingest USD FX rates for NGN, EUR, GBP and AED from ExchangeRate-API and latest available inflation observations for Nigeria, US, UK and UAE from World Bank API.
- Every signal records provider, source URL, observation date and fetch time. Delayed World Bank observation years are visible rather than presented as current.
- Intelligence app displays source-linked facts separately from fictional competitor moves.
- Executive conversations and competitor reasoning can receive sourced signals as context; no automatic financial journal posting is made from an external signal.
- Refresh is rate-limited to 12 hours per world; provider failures do not fabricate values.
- Remaining real-world data: commodity prices, sector-specific news, official policy announcements, weather/supply-chain signals and independent impact assessments.
