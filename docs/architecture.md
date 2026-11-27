# Architecture

This prototype is intentionally simple.

```text
Kiosk browser: microphone, avatar video, product cards, noise harness
  |
  v
Node/Express broker
  |-- Voice Live session: audio in, transcript and avatar WebRTC out
  |-- Azure Speech token and avatar relay token for the fallback path
  |-- Guardrails and catalogue retrieval
  |-- Mock or real assistant adapter
  |
  +--> Azure Voice Live
  +--> Azure AI Speech avatar and speech to text
  +--> Optional assistant endpoint
```

The first test is whether the avatar holds up in a noisy room, in the browser on the target device. Entra ID, API Management, managed identity and private networking come later, as production hardening.

## Security boundary

- The browser never receives Azure or assistant keys.
- Local secrets live in `.env`.
- In Azure, secrets live in the App Service settings.
- The broker returns only short-lived Speech tokens and relay credentials.

