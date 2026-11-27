# Copilot instructions: avatar kiosk starter

This repo is a talking avatar kiosk prototype. The browser streams the microphone to an Express broker. The broker runs an Azure Voice Live session and the avatar video comes back to the browser over WebRTC. Azure keys stay on the server.

## Where things live

| Layer | Where | Notes |
|---|---|---|
| Infra | `infra/main.bicep` | App Service, Speech, Voice Live (Azure AI Services), Application Insights |
| Broker | `src/server/` | Express routes, Voice Live session, guardrails, mock assistant |
| Kiosk UI | `src/web/` | Browser UI, Voice Live and Speech avatar clients, noise harness |
| Catalogue | `src/server/kioskKnowledge.ts` | Fictional Helios Telecom products. Replace with your own |
| Brand | `branding/<store>.json` | Store name, greetings, accent colour |

## Commands

```powershell
npm install
npm run typecheck
npm run dev                  # local server with the kiosk UI
npm run build
npm start                    # serves the built app on port 3000
.\scripts\smoke-test.ps1 -BaseUrl http://localhost:3000
.\scripts\deploy.ps1 -SubscriptionId <id>
```

## Rules

- Never send Azure or assistant keys to the browser. Locally they live in `.env`, in Azure in the App Service settings.
- Keep the catalogue and brand files fictional or your own. Don't copy another company's product pages.
- The kiosk must not collect account, payment or identity details. The guardrails hand those questions to a person.
- Run `npm run build` and the smoke test before you open a pull request.
