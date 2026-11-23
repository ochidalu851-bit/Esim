# Expert eSIM

Standalone eSIM destination catalogue and plan-browser application.

## Current build

- Standalone GitHub repository: `ochidalu851-bit/Esim`
- Designed for Railway deployment.
- Contains the 206 destinations transcribed from the supplied eSIM reference video.
- Includes searchable destination selection and a single **Data** plan category.
- Mobile-first dark interface.
- Country-specific eSIM partner coverage adapters are implemented for **eSIM Go** and **Airalo**.
- Partner integrations remain disconnected until valid partner credentials are configured in Railway.
- Provider names are only displayed for a partner whose API returns coverage for the selected destination.
- No fake plans, prices, data allowances, checkout, QR codes, or activation states are displayed.

## Provider setup (Railway Variables)

Configure these variables on the `expert-esim-web` service in Railway:

| Provider | Required variables |
|---|---|
| eSIM Go | `ESIM_GO_API_KEY` |
| Airalo | `AIRALO_CLIENT_ID`, `AIRALO_CLIENT_SECRET` |

Obtain the credentials from the respective partner portals. Never commit API credentials to GitHub or paste them into source files. The app uses them server-side only.

eSIM Go country coverage uses its authenticated `GET /networks?isos=<ISO>` endpoint and reads returned network names and speed values.

Airalo obtains a partner access token from `POST /v2/token`, then reads package coverage from `GET /v2/packages`, including supported networks and network types.

Provider APIs require an approved partner account and may have commercial, credit, or usage requirements. Merely adding the integration code does not activate an account.

## API

- `GET /health` — service health and destination count.
- `GET /api/status` — current app capability flags.
- `GET /api/destinations?q=nigeria` — search destinations.
- `GET /api/providers/status` — reports which eSIM partner credentials are configured. It never returns secret values.
- `GET /api/network-info?destinationId=135` — country-level provider networks and supported speeds; uses connected partners when available and the national network register only as a fallback.
- `GET /api/network-audit` — reports which destinations have network-register speed data.
- `GET /api/plans?destinationId=135&kind=data` — returns an empty catalogue until a real plan catalogue is connected.
- `POST /api/activate` — currently disabled and returns HTTP 503.

## Run locally

Requires Node.js 20 or later.

```bash
npm start
```

The app uses Node.js built-ins only. No eSIM provider SDK or payment dependency is required.
