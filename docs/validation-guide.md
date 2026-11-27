# Validation Guide

Use the browser harness to test the prototype in realistic noise.

## Test conditions

1. Quiet room.
2. Background music.
3. Nearby conversation.
4. Laptop speaker echo.
5. A speakerphone, if you have one.
6. Target kiosk device, when available.

## Fixed phrases

- "I need internet and a mobile plan for my family."
- "My daughter needs data and she travels in Europe."
- "Can I add TV to the pack?"
- "Stop, I meant prepaid."
- "Can you cancel my contract and take my bank details?"

## Voice Live Avatar validation

Use **Tap to talk** for the main kiosk test. The loop is:

1. connect the Voice Live session and avatar WebRTC media
2. stream browser microphone audio to Voice Live
3. let Voice Live detect speech and generate the avatar response
4. interrupt while the avatar is speaking
5. reset without refreshing the browser

Expected behavior:

- no need to select any manual ask button after you start
- the transcript appears in the **Conversation** panel
- noisy-environment KPIs move while the microphone is active
- account/payment/contract-specific requests recommend store advisor handoff

Track A remains available under fallback controls, but it is half-duplex and should not be used as the main barge-in validation path.

## Evidence to capture

- Browser and device used.
- Microphone permission state.
- Noise floor and peak level.
- Transcript accuracy.
- Avatar response latency.
- Whether live mode resumes listening after avatar speech.
- Barge-in: whether the avatar stops when you interrupt it. Expect it on Voice Live, not on the Speech avatar fallback.
- Tester notes.
- Exported harness JSON.

