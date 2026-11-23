# Expert eSIM

Expert eSIM is a mobile-first app and software foundation for a future branded mobile-data/eSIM service.

## Customer app

- Subscriber registration and sign-in.
- Account and data-package catalogue.
- My eSIM order list and secure native profile installation UI.
- Preferred Network: Automatic, 4G LTE or 5G, targeted to the saved eSIM subscription where Android and carrier privileges permit.
- Live speed test through the phone's active internet connection.

## Backend API

The API uses Node.js built-ins and a persistent store mounted at \`/data\`.

- \`GET /health\` — health and storage check.
- \`GET /api/v1/status\` — provisioning readiness.
- \`POST /api/v1/auth/register\`, \`POST /api/v1/auth/login\`, \`POST /api/v1/auth/logout\`.
- \`GET /api/v1/me\` — authenticated subscriber.
- \`GET /api/v1/plans\` — packages published by an administrator.
- \`POST /api/v1/esim/orders\`, \`GET /api/v1/esim/orders\` — customer order lifecycle.
- \`GET /api/v1/esim/orders/:id/profile\` — returns a provider-issued activation code only to the owning subscriber.
- \`POST /api/v1/provider/webhook\` — HMAC-signed provisioning callbacks.
- \`GET /api/v1/admin/dashboard\`, \`POST /api/v1/admin/plans\` — protected operations API.
- \`/admin\` — protected operator dashboard.

Passwords are scrypt-hashed; bearer tokens are stored as SHA-256 hashes; profile activation strings are AES-256-GCM encrypted at rest. Provider callbacks require HMAC-SHA256 signatures.

## Railway configuration

Required storage and security variables are already provisioned in production:

- \`DATA_DIR=/data\`
- \`EXPERT_ESIM_ADMIN_KEY\`
- \`ESIM_PROFILE_ENCRYPTION_KEY\` (32-byte base64url key)
- \`ESIM_PROVIDER_WEBHOOK_SECRET\`

To activate live eSIM provisioning after partner onboarding, configure:

- \`ESIM_PROVIDER_CREATE_ORDER_URL\` — HTTPS endpoint implementing the Expert eSIM provider adapter contract.
- \`ESIM_PROVIDER_API_KEY\` — provider-issued API key.
- \`HOST_NETWORK_AGREEMENT_ACTIVE=true\` — only after a signed, effective host-network agreement exists.
- \`SMDP_PARTNER_ACTIVE=true\` — only after the authorised SM-DP+ partner is operational.
- \`EXPERT_ESIM_SERVICE_ENABLED=true\` — only after launch approval.

Provider order API contract:

- Expert eSIM submits \`reference\`, \`customer\`, \`plan\`, and \`preferredNetwork\`.
- Provider may respond with \`providerOrderId\`, \`status\`, and when issued, \`activationCode\` plus optional \`confirmationCode\`.
- For asynchronous issuance, provider sends a signed callback to \`POST /api/v1/provider/webhook\` with event \`esim.profile.issued\`, \`esim.profile.activated\`, or \`esim.profile.failed\`.
- Signature header is \`x-expert-signature: sha256=<hex HMAC-SHA256>\`.

This is an adapter contract, not a claim that an external carrier has implemented it. A vendor-specific adapter may be needed for the selected partner.

## Critical service boundary

The app does not create valid carrier SIM credentials by itself. Live data requires a licensed host-network arrangement, authorised SM-DP+ profile issuance, subscriber provisioning, a compatible eSIM device, applicable identity checks and a paid/active data subscription. These live switches are deliberately off until those conditions exist. The app must not display a profile as issued or a subscription as connected without the corresponding provider/Android confirmation.

## Run locally

Requires Node.js 20 or later.

\`\`\`bash
npm start
npm test
\`\`\`
