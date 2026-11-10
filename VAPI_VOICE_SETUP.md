# Dynamic voice identities in Vapi

## Why this matters

The prior version used **Amara** exclusively. In v0.5, the Chairman can call executives, business friends, competitors, investors and contractors. If your existing Vapi assistant has an Amara-only prompt, every contact may still behave like Amara unless you update it.

## Reuse your existing Assistant ID

Open the Vapi dashboard → **Assistants** → your earlier Amara assistant → **Model / System Prompt**. Replace the old Amara-only instructions with the following reusable character prompt and **Publish**:

```text
You are {{character_name}}, {{character_title}} at {{character_company}}.
You are speaking to {{chairman_name}}, the Chairman, during a private executive telephone conversation.

LIVE CHARACTER AND WORLD CONTEXT:
{{executive_context}}

This is an immersive fictional corporate leadership environment established during user onboarding. Treat its world seriously and remain in character, without suggesting real-world business actions, transfers, or meetings occurred outside this environment.

Speak naturally and concisely, as an experienced professional would. Your choices, advice, beliefs, risk tolerance, knowledge, and motives must match your own character context. You are not necessarily the Chairman's employee. If you are a rival, friend, investor or vendor, speak from your actual professional incentives rather than agreeing automatically.

Never address yourself as Amara unless your character_name is Amara. Do not claim to have performed an action, negotiated with a third party, made a payment, or filed a real-world document unless the supplied world record confirms that simulation event. Ask intelligent questions; be willing to disagree politely. When the Chairman gives you an important directive, repeat it back for confirmation.

You are on a telephone call. Avoid markdown, lists, long monologues and references to software prompts. Keep the roleplay flowing naturally.
```

The code passes dynamic variable values to the Vapi Web SDK's `start(assistantId, assistantOverrides)` call. The Assistant ID and Public Key come from your existing Vapi account. You may set the first message in the dashboard to a generic backup greeting; the application supplies character-specific `firstMessage` at call time.

## Distinct voices per person

Every contact has a **Voice identity** section. You can:

- Add a **dedicated Vapi Assistant ID** which has that person's unique voice and model configuration. This takes precedence over the global default Assistant ID. Recommended for your main Chief of Staff, CFO, COO and external rivals.
- Optionally add an **ElevenLabs Voice ID** that the application passes to Vapi as an assistant voice override when the contact does not have a dedicated Vapi assistant. Requires that provider/voice to be supported and enabled for your account.
- Leave both blank to use the global default voice. In this case *the character's dialogue changes, but the acoustic voice may be identical across contacts*.

There is no guarantee that any random Voice ID will be usable under your Vapi plan. Test each voice separately.

## Real call checklist

1. The Vapi Public Key is listed as an allowed key for your configured assistant.
2. Your local origin (`http://localhost:5173`) is allowed. Add the HTTPS tunnel domain as another allowed origin for phone tests.
3. Your Vapi System Prompt includes the dynamic variables above.
4. Microphone permission is approved by your browser.
5. Open Contacts → Amara → Call and talk naturally.
6. Open Contacts → CFO → Call; confirm he speaks as the CFO, not Amara.
7. Call an external investor and ask a question. Check the displayed transcript and subsequent stored call summary.

For system setup, see [Vapi Web SDK documentation](https://docs.vapi.ai/quickstart/web).
