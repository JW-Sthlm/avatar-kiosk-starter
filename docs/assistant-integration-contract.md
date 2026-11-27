# Assistant integration contract

By default the kiosk answers with a mock assistant. To use your own backend, set `ASSISTANT_API_URL` (and `ASSISTANT_API_KEY` if it needs one). The broker then sends typed questions and questions from the Speech avatar fallback to that endpoint.

In Voice Live mode the realtime model answers directly. It follows the instructions built in `src/server/voiceLiveSession.ts` from the brand file and the catalogue, so change those to change what the Voice Live avatar says.

The broker sends:

```json
{
  "sessionId": "uuid",
  "utterance": "I need a mobile plan for my daughter."
}
```

Your endpoint answers with:

```json
{
  "text": "Spoken response for the avatar.",
  "cards": [
    {
      "title": "Plan title",
      "body": "Short UI card text",
      "tag": "Optional tag"
    }
  ],
  "handoffSuggested": false,
  "knowledgeSources": [
    {
      "title": "Mobile plans",
      "category": "Mobile",
      "sourceTitle": "Helios Telecom product guide (fictional)",
      "sourceUrl": "https://example.com/helios/products#mobile",
      "excerpt": "Short retrieved product context."
    }
  ],
  "guardrails": {
    "status": "allowed",
    "scope": "retail",
    "reasons": [],
    "safeCompletion": "The request is within the Helios telecom retail assistant scope.",
    "requiresHandoff": false
  }
}
```

## Catalogue retrieval

The mock assistant scores each question against a small fictional catalogue in `src/server/kioskKnowledge.ts`. The broker exposes it at:

```text
GET /api/knowledge
```

The categories are home packs, internet, TV, mobile plans, prepaid, smart home, phones and devices, and advisor handoff.

This is deliberately light. It shows the retrieval pattern without Azure AI Search or an extra model. For production, move the catalogue into Azure AI Search and let your assistant ground its answers in the retrieved chunks.

## Guardrails

The broker checks guardrails before the mock or your own assistant answers:

- Out-of-scope questions get a short message about what the kiosk can help with.
- Account, payment, identity, PIN, PUK, cancellation and contract questions go to a store advisor.
- Price, promotion and discount questions get product-family guidance only, and the customer is pointed to a store advisor for final terms.

The browser shows the guardrail status and the retrieved catalogue entries for each turn. In Voice Live mode the same rules are part of the model instructions.
