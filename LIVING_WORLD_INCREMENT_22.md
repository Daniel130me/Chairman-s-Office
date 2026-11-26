# Increment 22 — Text-message action proposals
- Internal executive conversations can classify explicit Chairman instructions into supported action proposals (expense, hire, fire, activate draft contract, assign task).
- The classifier receives current company, employee, contract and executive identifiers; it cannot invent identifiers or directly execute actions.
- Missing details produce one clarification. Valid requests are persisted in Approvals and the executive confirms only that the request was submitted, never that the action was completed.
- External contacts cannot propose internal company actions.
- Live tests needed for ambiguous phrasing, provider JSON failures and end-to-end approval execution.
