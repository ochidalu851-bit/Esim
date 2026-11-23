# Expert eSIM

Expert eSIM is a mobile-first customer app and technical foundation for a Nigeria-first branded mobile-data/eSIM service.

## Customer experience

- Create an account once; after a valid session, My eSIM opens the subscriber dashboard rather than showing the registration/sign-in panel.
- Secure sign-in sessions use an HttpOnly, Secure, SameSite cookie.
- Subscriber email verification is available through the configured email provider.
- Telecom identity verification is handed off to a configured authorised provider; Expert eSIM does not collect raw NIN or biometric images in its own form.
- Customer data packages, eSIM orders, payment status and profile installation are shown in My eSIM.
- Payments use Paystack server-side initialization and signed webhook/transaction verification.
- My eSIM includes support cases, privacy-rights requests and a personal-data export.
- Preferred Network supports Automatic, 4G LTE and 5G preferences, targeted to the saved eSIM subscription where Android and carrier privileges permit.
- Speed testing measures the phone's active internet connection.

## Backend and operations

The Node.js API stores subscriber, consent, session, plan, order, payment-event, support and privacy-request records in a persistent Railway volume mounted at /data.

Important routes:

- GET /health and GET /api/v1/status — health and launch readiness.
- POST /api/v1/auth/register, /login, /logout, /verification/send — customer access.
- GET /api/v1/auth/verify-email — one-time email verification.
- GET /api/v1/me — authenticated customer dashboard data.
- POST /api/v1/kyc/start and POST /api/v1/kyc/webhook — hosted identity verification.
- GET /api/v1/plans — packages that passed the publication gate.
- POST and GET /api/v1/esim/orders — customer subscription orders.
- POST /api/v1/esim/orders/:id/pay and POST /api/v1/payments/paystack/webhook — payments.
- GET /api/v1/esim/orders/:id/profile — profile details only for the owning subscriber after payment and provider issuance.
- POST /api/v1/provider/webhook — signed SM-DP+/eSIM-provider lifecycle callback.
- POST /api/v1/support/tickets and POST /api/v1/privacy/requests — customer service and data-rights workflow.
- GET /api/v1/privacy/export — authenticated subscriber data export.
- /admin — protected operations dashboard.

Passwords are scrypt-hashed, session tokens are stored as SHA-256 hashes, profile activation material is AES-256-GCM encrypted at rest, provider callbacks are signature-checked, mutating browser APIs enforce same-origin requests, and login/registration/admin requests are rate-limited.

## Railway secrets and partner readiness

Already provisioned:
- DATA_DIR=/data
- EXPERT_ESIM_ADMIN_KEY
- ESIM_PROFILE_ENCRYPTION_KEY (32-byte base64url key)
- ESIM_PROVIDER_WEBHOOK_SECRET

Required after selecting and contracting partners:
- ESIM_PROVIDER_CREATE_ORDER_URL and ESIM_PROVIDER_API_KEY
- HOST_NETWORK_NAME and HOST_NETWORK_AGREEMENT_ACTIVE=true, only after the signed wholesale agreement is effective
- SMDP_PARTNER_ACTIVE=true, only after the authorised SM-DP+ partner is operational
- KYC_PROVIDER_START_URL, KYC_PROVIDER_API_KEY and KYC_PROVIDER_WEBHOOK_SECRET for an authorised identity-verification route
- PAYSTACK_SECRET_KEY and PAYSTACK_WEBHOOK_SECRET
- RESEND_API_KEY and EXPERT_ESIM_EMAIL_FROM
- NCC_MVNO_LICENCE_CONFIRMED=true, PRIVACY_GOVERNANCE_READY=true, CONSUMER_SUPPORT_READY=true and EXPERT_ESIM_SERVICE_ENABLED=true only after the actual licence, privacy and operating controls are in place

The service will not publish data plans or issue profiles merely because a variable is set. The company officer must only set the launch flags after the underlying documents, partner integrations and controls have been verified.

## Provider integration contracts

The eSIM order adapter sends order reference, subscriber reference, plan details, network preference and the minimum customer fields required by the provider. The provider may return a profile in its synchronous result or later send signed lifecycle events:
- esim.profile.issued
- esim.profile.activated
- esim.profile.failed

The Paystack adapter checks the raw webhook payload, timestamp/signature, reference, amount and currency, then verifies the transaction through Paystack before marking an order paid and starting provisioning.

The KYC adapter sends the subscriber to a hosted verification URL and accepts signed partner status callbacks. It does not request raw NIN, fingerprint or facial images inside the Expert eSIM application.

These are integration adapters. No host MNO, SM-DP+, KYC or payment partner is represented as live until their credentials and commercial agreements are supplied and tested.

## Regulatory and operational launch requirements

See PARTNER_ONBOARDING.md for the detailed work register. The key external prerequisites are:
1. Registered Nigerian operating company and the appropriate NCC MVNO authorisation.
2. Completed host-network wholesale agreement and network/APN/data-plan integration.
3. Authorised consumer SM-DP+ profile provisioning and end-to-end device testing.
4. NIMC-connected telecom subscriber identity verification, audit and retention.
5. NDPC privacy governance, DPO contact, DPIA and processor agreements where applicable.
6. Live payment merchant account, refunds, billing reconciliation and customer support.
7. Production database, backups, observability, independent security review and signed Android release.

The public Terms and Privacy Notice at /legal.html is an interim pre-launch draft with explicit placeholders. It must be completed and reviewed by Nigerian telecom and data-protection counsel before commercial use.

## Critical service boundary

The app does not generate valid mobile-network subscriber credentials by itself. Live internet access over an Expert eSIM requires an authorised host network, a real subscriber provisioning record, a valid SM-DP+ profile, successful NIMC/telecom identity checks, a compatible eUICC phone, a paid data plan and host-network confirmation. These conditions are not yet complete, so the product does not claim to provide live Expert eSIM mobile data.

The current JSON store on a 500 MB Railway volume is an early single-instance implementation. It must move to managed PostgreSQL with tested encrypted backups and a shared rate-limit store before multi-replica or commercial-scale operation.

## Run locally

Requires Node.js 20 or later.

    npm start
    npm test
