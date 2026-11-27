# Demo guide

Use this when you show the kiosk to other people. The scene: a customer walks up to the Helios Telecom kiosk and wants help choosing a mobile plan.

## Voice Live avatar

Use this when the Voice Live endpoint, model and key are configured.

1. Open the kiosk URL. Select **Fullscreen** if it runs on a kiosk screen.
2. Select **Tap to talk** and allow the microphone.
3. Wait for the avatar to appear in the frame and greet you.
4. Say: "I need a mobile plan for my daughter."
5. While the avatar answers, interrupt: "Stop, I meant prepaid." It should stop and change course.
6. Point to the **Conversation** panel, where both sides of the conversation appear.
7. Select **Reset** and start again without reloading the page.

**Interrupt** stops the avatar's current answer from the screen. **Mute mic** stops listening without ending the session.

## Speech avatar fallback

Use this when only Speech is configured. Open **Demo controls & diagnostics**, then **Fallback & manual controls**.

1. Select **Enable browser audio meter**.
2. Select **Connect Speech Avatar fallback**.
3. Select **Start Track A half-duplex loop** and say: "I need a mobile plan for my daughter."
4. Follow up with: "She travels a lot in Europe."
5. Show the answer, the product cards and the **Guardrails** and **Product knowledge** sections.

This path takes turns. It doesn't listen while the avatar speaks, so interruptions don't work here.

## Typed questions

If the microphone or the avatar won't cooperate, use **Manual text question**. Type a question, or select **Transcribe once into text box**, then select **Ask manual assistant**.

## Tips when you show it

- Say what's real: the microphone, the Azure avatar, the token broker and the guardrails.
- Say what's mocked: the Helios catalogue is fictional, and the assistant is a mock unless you've connected your own.
- The noise meter shows raw browser microphone levels. Use it to compare rooms and devices. It isn't a certified measurement.
- If the browser blocks audio or a session fails, **Reset** usually fixes it.
