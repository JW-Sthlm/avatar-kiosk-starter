# Voice Live Avatar Track B

This prototype supports Voice Live Avatar as Track B next to the existing Speech Avatar flow. The browser does **not** connect directly to Voice Live. The Node broker opens the Voice Live session server-side, keeps the API key out of browser code, forwards microphone chunks, and brokers the avatar WebRTC SDP exchange.

## Configure Track B

If you deploy with the template, these settings are created for you. For local development, add these server-side values to `.env`:

```text
AZURE_VOICE_LIVE_ENDPOINT=https://<resource>.services.ai.azure.com
AZURE_VOICE_LIVE_API_KEY=<server-side-only>
AZURE_VOICE_LIVE_MODEL=gpt-realtime
AZURE_VOICE_LIVE_API_VERSION=2025-10-01
AZURE_VOICE_LIVE_VOICE=en-US-Ava:DragonHDLatestNeural
AZURE_VOICE_LIVE_AVATAR_CHARACTER=lisa
AZURE_VOICE_LIVE_AVATAR_STYLE=casual-sitting
AZURE_VOICE_LIVE_REGION=westeurope
```

The app also accepts `AZURE_VOICELIVE_*` aliases for the same settings.

`AZURE_VOICE_LIVE_API_VERSION` defaults to `2025-10-01` when omitted.

## Why the browser does not connect directly

Voice Live is a WebSocket API. The intended URL shape is:

```text
wss://<resource>.services.ai.azure.com/voice-live/realtime?api-version=2025-10-01&model=<model>
```

Browsers cannot add pre-handshake API-key headers to a WebSocket request. Voice Live also supports API-key query authentication, but this prototype intentionally does not generate or expose such URLs because that would leak secrets to browser code.

Track B uses the safe prototype pattern instead:

```text
Browser mic -> local WebSocket -> Node broker -> Voice Live session
Browser WebRTC avatar media <-> Voice Live avatar
```

## What the app exposes

- `GET /api/voice-live/readiness` returns configured/unconfigured status, missing env vars, sanitized endpoint host/origin, model, API version, intended WebSocket URL without secrets, auth notes, and manual next steps.
- `POST /api/voice-live/session-plan` returns a safe preparation plan plus an initial `session.update` payload. It does not connect to Voice Live and does not return any key or token.
- `POST /api/voice-live/sessions` creates a server-side Voice Live session when endpoint, model, and API key are configured.
- `WS /api/voice-live/sessions/:id/ws` forwards browser PCM16 microphone chunks and returns transcript/status events.
- `POST /api/voice-live/sessions/:id/avatar-offer` sends the browser SDP offer through `session.avatar.connect` and returns the Voice Live SDP answer.
- `POST /api/voice-live/sessions/:id/text` provides a text fallback for demo recovery.
- `DELETE /api/voice-live/sessions/:id` disconnects and cleans up the server-side session.

The session plan includes:

- Azure deep noise suppression
- server echo cancellation
- Azure semantic VAD
- Azure standard voice
- prebuilt avatar output over WebRTC

## Region guidance

Voice Live avatars are available in a subset of Azure regions. Check the [Speech service region table](https://learn.microsoft.com/azure/ai-services/speech-service/regions) before you choose one. The template puts Voice Live in Sweden Central and the web app and Speech in West Europe.

If you want everything in one region, check first that your subscription can create a Linux App Service plan on Basic B1 there. Not every subscription has that capacity in every region.

## Validate Track B

1. Start the app.
2. Open **Demo controls & diagnostics** and select **Check Voice Live readiness**. Confirm that the endpoint, the model and the server-side key are present.
3. Select **Tap to talk**.
4. Allow the microphone.
5. Confirm that avatar video and audio appear in the avatar frame.
6. Say: "I need a mobile plan for my daughter."
7. Confirm that your words and the avatar's answer appear in the **Conversation** panel.
8. Interrupt while the avatar is speaking: "Stop, I meant prepaid."
9. Select **Reset** and start again without restarting the server.

Never paste Azure Speech, Voice Live or assistant keys into browser developer tools, query strings or exported evidence.
