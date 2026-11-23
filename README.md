# Expert eSIM

Expert eSIM is a global, sponsor-funded mobile-data/eSIM platform. The intended model is that Expert eSIM pays its contracted connectivity provider, while eligible users receive an individual eSIM profile for each registered device. The customer app is not designed as a data-package shop and does not ask users to purchase data.

## Customer experience

- One account per customer, with a secure HttpOnly session cookie.
- The Android app automatically reads the phone manufacturer, model, Android version and eSIM hardware/enabled state; users do not type device details. A random app-install identifier is used instead of IMEI/EID.
- Each detected device is registered to the subscriber automatically; a separate profile can then be requested for that device.
- The app can show profile requested, awaiting partners, provisioning, profile issued, active, provider error and partner-review states.
- An activation code is released only to the owning subscriber after the provider confirms that the profile carries the contracted unlimited-data and global-roaming attributes.
- Identity checks are routed through a generic authorised provider when required by the connectivity partner or applicable market rules.
- Users can request support and privacy actions and export their account data.
- Preferred Network and Speed Test remain separate features. A speed test measures the connection currently active on the phone; it does not prove that the Expert eSIM profile is supplying connectivity.

## Global coverage and unlimited-data boundary

“Global” means the platform is designed to use a global roaming/connectivity partner. It does **not** mean every country, territory, network, device or radio band is automatically covered. The live provider's country/territory coverage, local restrictions, permanent-roaming rules, fair-use policy, traffic management, tethering policy and supported radio technologies must be confirmed in the signed agreement.

The backend will only issue a profile after all these production conditions are confirmed:
- Global connectivity provider name and active agreement.
- Authorised consumer eSIM / SM-DP+ provisioning partner.
- Global coverage confirmation.
- Contractual unlimited-data confirmation.
- Profile API credentials and signed profile callback.
- Profile encryption key.
- Configured identity verification partner.
- Privacy governance and customer-support readiness.
- Explicit service launch switch.

A provider response must independently confirm `unlimitedData: true` (or `dataPolicy: "unlimited"`) and `coverageScope: "global"` (or `roamingScope: "global"`) before activation details are released. A label in the app or an environment flag cannot create unlimited service or expand a provider's real coverage.

## API routes

- `GET /health` and `GET /api/v1/status` — health and global connectivity readiness.
- `POST /api/v1/auth/register`, `/login`, `/logout`, `/verification/send` — account access.
- `GET /api/v1/auth/verify-email` — one-time email verification.
- `GET /api/v1/me` — authenticated account and registered devices.
- `POST /api/v1/kyc/start` and `POST /api/v1/kyc/webhook` — generic market/partner identity verification.
- `GET /api/v1/devices` and `POST /api/v1/devices` — list/register the subscriber's devices.
- `POST /api/v1/devices/:id/profile` — request or resume that device's individual sponsored eSIM profile.
- `GET /api/v1/devices/:id/profile` — retrieve activation details only after provider-confirmed issuance.
- `POST /api/v1/global-esim/webhook` — signed global profile lifecycle callback.
- `POST /api/v1/support/tickets` and `POST /api/v1/privacy/requests` — customer support and privacy workflow.
- `GET /api/v1/privacy/export` — authenticated personal-data export.
- `/admin` — protected operations dashboard.

The older package/payment endpoints remain in the backend for compatibility with prior records, but they are not part of the current sponsored customer workflow. The My eSIM drawer-menu entry and customer-side package checkout have been removed.

## Global provider integration contract

Required Railway variables (do not paste secrets into chat or commit them):
- `GLOBAL_ESIM_PROFILE_API_URL`
- `GLOBAL_ESIM_PROFILE_API_KEY`
- `ESIM_PROVIDER_WEBHOOK_SECRET`
- `GLOBAL_CONNECTIVITY_PROVIDER_NAME`
- `GLOBAL_CONNECTIVITY_AGREEMENT_ACTIVE=true` only after the agreement is signed and effective
- `GLOBAL_ESIM_GLOBAL_COVERAGE_CONFIRMED=true` only after the provider's coverage matrix has been checked
- `GLOBAL_ESIM_UNLIMITED_DATA_CONFIRMED=true` only after the commercial agreement explicitly provides sponsored unlimited data and its fair-use conditions are documented
- `SMDP_PARTNER_ACTIVE=true` only after the authorised consumer profile provider is operational
- `GLOBAL_IDENTITY_PROVIDER_START_URL`, `GLOBAL_IDENTITY_PROVIDER_API_KEY`, `GLOBAL_IDENTITY_PROVIDER_WEBHOOK_SECRET` where partner or market rules require checks
- `RESEND_API_KEY`, `EXPERT_ESIM_EMAIL_FROM` for account email verification
- `ESIM_PROFILE_ENCRYPTION_KEY` (32-byte base64url key)
- `PRIVACY_GOVERNANCE_READY=true`, `CONSUMER_SUPPORT_READY=true`, `EXPERT_ESIM_SERVICE_ENABLED=true` only after the actual controls and service readiness have been approved

The profile API receives a subscriber reference, a unique Expert eSIM device reference, device name/platform/model, a requested `unlimited` data policy, `sponsored-by-expert-esim` funding and a `global` roaming scope. The provider must return a profile activation code and explicitly confirm the service attributes, or send an equivalent signed callback. Vendor-specific APIs may need a dedicated adapter before production use.

Signed callbacks use HMAC-SHA256 over the raw JSON body in the `x-expert-signature` header. Supported lifecycle events are:
- `esim.profile.issued` — must include activation details plus explicit unlimited/global confirmation.
- `esim.profile.activated` — marks the device profile active only after confirmed issuance.
- `esim.profile.failed` — records a provisioning failure.

The API and callback contract is a generic integration boundary. No global connectivity provider, roaming footprint, unlimited-data entitlement or eSIM profile is represented as live until a real partner is selected, contracted, configured and tested.

## Global partner selection

Potential providers to approach for commercial discussions include 1GLOBAL Connect and Telna. Their public materials describe partner APIs and multi-country/global connectivity capabilities; this is not proof that either has accepted Expert eSIM, offers unlimited data in every territory, or has issued credentials. See:
- 1GLOBAL Connect: https://docs.connect-api.1global.com/getting-started/
- Telna global network: https://www.telna.com/network
- GSMA consumer eSIM specifications: https://www.gsma.com/solutions-and-impact/technologies/esim/esim-specification/

## Security and storage

Passwords are scrypt-hashed, session tokens are stored as SHA-256 hashes, profile activation material is AES-256-GCM encrypted at rest, provider callbacks are signature-checked, browser state-changing APIs enforce same-origin requests, and authentication/admin requests are rate-limited.

The JSON store on the persistent Railway volume is currently a single-instance early-stage store. Before scaling, move to managed PostgreSQL with migrations, unique indexes, transaction semantics, encrypted backups and restore drills, plus a shared rate-limit store, queues, monitoring and independent security review.

## Legal and operational launch requirements

See `PARTNER_ONBOARDING.md` for the global work register. Before enabling live service, the operating company must:
1. Select the intended connectivity business model and obtain required legal authorisations in the countries where the service will be offered.
2. Sign a wholesale/global roaming connectivity agreement that lists supported countries and partner networks.
3. Confirm the sponsored unlimited-data policy, including fair-use, speed, tethering and permanent-roaming conditions.
4. Contract an authorised consumer eSIM/SM-DP+ provider and test real profile issuance, download, activation, suspension and replacement.
5. Configure market-appropriate identity verification where required.
6. Complete privacy governance, data-processing agreements, cross-border transfer safeguards, incident response and customer support.
7. Run device, country, network and service acceptance tests before public launch.

The public Terms and Privacy Notice at `/legal.html` is a global pre-launch draft with legal-entity and contact placeholders. It must be completed and reviewed for each operating market before live customer onboarding.

## Critical service boundary

Software cannot create mobile spectrum, roaming access, subscriber authentication, an authorised eSIM profile or an unlimited-data contract. Live Expert eSIM internet requires a contracted global connectivity provider, real coverage in the user's location, an authorised profile provider, an issued and installed profile, provider-confirmed activation and a compatible device. These conditions are not yet complete in production, so the app does not claim to provide live Expert eSIM mobile data.

## Run locally

Requires Node.js 20 or later.

    npm start
    npm test


## Automatic device detection

The Android APK reads manufacturer, model, OS version and the public eUICC hardware/enabled state from Android. It uses a random persistent app-install identifier, not IMEI. EID is not read: Android restricts EID access to apps with carrier privileges. Browser sessions may identify platform and sometimes model, but cannot always verify eSIM hardware capability.
