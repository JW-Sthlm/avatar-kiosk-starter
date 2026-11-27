# Brand files

One JSON file per kiosk. It sets the store name on the screen, what the avatar says first and who gets the credit line. The default is `helios.json`: Helios Telecom, a fictional store, with a kiosk built by Aurora, a fictional company.

## How the kiosk picks a file

The server reads `BRAND_CONFIG_FILE` at startup. The default is `branding/helios.json`.

```powershell
$env:BRAND_CONFIG_FILE = "branding/my-store.json"
npm run dev
```

In Azure, set the same key in the App Service settings and restart the app. The deploy script includes the whole `branding` folder in the package.

## Fields

| Field | What it does |
|---|---|
| `customer.name`, `customer.shortName` | Store name on the kiosk and in the avatar's instructions |
| `customer.tagline` | One line under the title |
| `partner.name` | Shown as "Powered by ..." at the top of the kiosk |
| `partner.accentColor` | Accent colour for highlights |
| `voicePersona.greetingEn`, `greetingSv`, `greetingFr` | First line the avatar says, in the customer's language |
| `logoUrl` (optional) | An image logo instead of the text wordmark |

`partner.shortName`, `partner.credit`, `voicePersona.fallbackPrompt` and the `compliance` fields are in the file for your own changes. The current UI doesn't show them.

## Add your own

1. Copy `_template.json` to `<your-store>.json` and fill in every field.
2. Point `BRAND_CONFIG_FILE` at it.
3. Restart the app.

For an image logo, create `public/brand/`, put the image there and set `logoUrl` to `/brand/<file>`.

Products don't go in the brand file. They live in `src/server/kioskKnowledge.ts`.
