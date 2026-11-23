# Expert eSIM

Standalone eSIM destination catalogue and plan-browser application.

## Current build

- Standalone GitHub repository: `ochidalu851-bit/Esim`
- Designed for Railway deployment.
- Contains the 206 destinations transcribed from the supplied eSIM reference video.
- Includes searchable destination selection and a single **Data** plan category.
- Mobile-first dark interface.
- No third-party mobile/eSIM provider has been integrated.
- No fake plans, prices, data allowances, checkout, QR codes, or activation states are displayed.

## API

- `GET /health` — service health and destination count.
- `GET /api/status` — current app capability flags.
- `GET /api/destinations?q=nigeria` — search destinations.
- `GET /api/plans?destinationId=135&kind=data` — returns an empty catalogue until a real plan source is connected.
- `POST /api/activate` — currently disabled and returns HTTP 503.

## Run locally

Requires Node.js 20 or later.

```bash
npm start
```

The app uses Node.js built-ins only. There is no provider SDK or payment dependency in this first-stage build.
