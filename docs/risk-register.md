# Risk Register

| Risk | Mitigation |
|---|---|
| Noisy environment reduces recognition quality | Use harness tests across repeatable noise conditions and compare Voice Live when available |
| Browser mic/autoplay blocked | Use Touch to begin and explicit permission flow |
| Azure or assistant keys leak to the browser | Keep all service keys in server-side environment variables only |
| Kiosk behaves differently than a laptop browser | Validate the same URL on the target kiosk device after the browser tests |
| Assistant backend isn't ready | Mock mode works without one |
| Demo fails live | Reset button, text fallback, and browser speech fallback are available |
| Prototype is mistaken for production | Keep limitations and production hardening backlog visible |

