# Expert eSIM

A single, mobile-first **Expert eSIM** internet dashboard. The former 206-destination catalogue, country pages, provider list and country plan browser have been removed.

## Product features

- **Internet Browsing** — search the web or open a website in the device browser. Traffic uses the device's currently active Wi-Fi or mobile-data connection.
- **Preferred Network** — save the user's preference as Automatic, 4G LTE or 5G in the app on that device.
- **Speed Test** — measures latency, jitter, download and upload performance against Cloudflare's edge test endpoints. A full test transfers approximately 6 MB.

The web app deliberately does not claim to change the handset's radio mode. A web page can store a preference, but actual network-mode control is governed by the mobile operating system, modem and carrier privileges.

## Important: cellular service provisioning

This web app is **not yet an active mobile network or an issued eSIM subscription**. Browsing works through the internet connection already active on the phone. For Expert eSIM to supply its own cellular data, it needs a commercial mobile-network/wholesale connectivity partner and a real eSIM profile provisioning arrangement (including SM-DP+ / GSMA Remote SIM Provisioning). The carrier must issue a profile and the user must install/enable it on a compatible device.

An eSIM profile is not created by the website alone. No mobile data service, carrier contract, eSIM profile or activation is being represented as live in this build.

## API

- `GET /health` — service health.
- `GET /api/status` — current Expert eSIM feature and carrier-provisioning readiness. It does not expose or list destinations.

## Run locally

Requires Node.js 20 or later.

```bash
npm start
```

The app uses Node.js built-ins only. The browser opens external websites using the device browser; the speed test uses Cloudflare's public measurement service.
