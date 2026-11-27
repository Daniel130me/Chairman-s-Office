# Increment 20 — Voice-based action proposals
- Vapi voice calls now expose propose_business_action alongside arrange_internal_call.
- The action token binds requests to the active call, user and executive; only an internal executive in that call can request an action.
- The tool creates a pending approval request and explicitly tells the voice assistant that no action has been executed.
- The voice prompt instructs executives to collect missing details, submit requests for approval and never claim completion before the backend confirms it.
- Text-chat action proposals and live Vapi call verification remain outstanding.
