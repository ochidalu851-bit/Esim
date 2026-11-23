# Expert eSIM — Partner and Launch Readiness Register

**Scope:** Nigeria-first branded mobile-data / eSIM service.  
**Status date:** 23 November 2026.  
**Purpose:** identify what is implemented in the software and what still needs an authorised operator, regulator, commercial partner or company decision. This register is not a licence or legal opinion.

## Current software state

| Area | State | Notes |
|---|---|---|
| Subscriber accounts | Implemented | Password hashing, secure session cookie, rate limits and persistent subscriber records. |
| Consent record | Implemented | Terms/Privacy version and timestamp stored; final policy owner/legal entity still needs to be inserted. |
| Email verification | Adapter implemented | Resend integration exists; sender domain and API secret are not configured. |
| Telecom KYC | Hosted-provider adapter implemented | Requires a suitable authorised/NIMC-connected provider, commercial agreement and credentials. The app does not collect raw NIN/biometric data itself. |
| Data plans | Implemented | Plans are drafts; publication is blocked by launch-readiness checks. |
| Order lifecycle | Implemented | awaiting_payment, awaiting_partner, provisioning, profile_issued, active, provider_error. |
| Paystack | Adapter implemented | Payment initialization, webhook signature check and server-side transaction verification. Live/test credentials and webhook setup are absent. |
| eSIM provider API | Generic adapter implemented | Vendor-specific adapter and credentials are still needed. |
| SM-DP+ profile receipt | Implemented | Signed provider callbacks; AES-256-GCM encrypted activation material at rest. No profile is issued in production today. |
| Android profile installation | Implemented in native APK | EuiccManager path and Android approval resolution. Needs testing on a compatible eUICC handset and partner-issued profiles. |
| Support & complaints | Implemented | Customer can open support cases; admins can inspect/update status. Contact details and service targets are not configured. |
| Privacy requests | Implemented | Customer can file access/correction/deletion/portability/objection requests; admin review process exists. |
| Operations dashboard | Implemented | Subscribers, plans, orders, partner readiness, support cases and privacy requests. |
| Persistent storage | Basic production persistence | Railway volume at /data; JSON store suitable only for current single-instance, early pilot. Use managed PostgreSQL and automated backups before scaling. |

## 1. Nigerian company and regulatory authorisation

- [ ] Confirm the registered contracting company, CAC registration, registered address, directors and beneficial owners.
- [ ] Select the intended NCC MVNO licence tier/service model with Nigerian telecom counsel and NCC.
- [ ] Confirm the current NCC application window, application checklist, fees, technical-partner requirements and exact licence scope directly with NCC. Do not rely on older fee summaries or an old advertisement.
- [ ] Identify and appoint the competent technical partner required for the selected model.
- [ ] Obtain the required MVNO licence/authorisation before offering regulated communications services.
- [ ] File/complete the Commercial Wholesale Agreement with the Host MNO before the MVNO licence application where required by the NCC MVNO framework.
- [ ] Agree whether Expert eSIM is data-only or will later include voice, SMS, numbering, portability or emergency services. Do not imply features the host model does not support.

**NCC framework finding:** the published MVNO framework says a completed commercial wholesale agreement with a host MNO must be filed with NCC before an MVNO licence application. NCC currently lists the MVNO Business Rules under Drafts, distinct from the final framework. The draft must not be treated as a final binding rule.

## 2. Host mobile-network partnership

- [ ] Select host MNO and obtain written commercial proposal.
- [ ] Agree wholesale data pricing, minimum commitments, deposits, credit terms, settlement cycles, taxes and price revision mechanism.
- [ ] Agree coverage, 4G/5G availability, supported radio bands, roaming restrictions and network priority.
- [ ] Agree APN/private APN, routing, DNS, IP addressing, CGNAT/static-IP options, IPv4/IPv6 and traffic policy.
- [ ] Agree subscriber provisioning interfaces, SIM/eSIM identifiers, subscriber lifecycle and service suspension/resume.
- [ ] Agree online/offline charging, usage records, data quotas, balance exhaustion, renewal, top-ups and out-of-bundle behaviour.
- [ ] Agree SLA/KPI reporting, availability, throughput, latency, planned maintenance and outage notification.
- [ ] Agree fraud management, abnormal usage handling, abuse reports, lawful regulatory requests and incident response.
- [ ] Define end-to-end responsibilities for customer KYC, SIM registration, eSIM profile download, activation approval, failed install, profile replacement, deactivation and complaint escalation.
- [ ] Sign and test the integration specification, sandbox credentials and commercial acceptance criteria.

## 3. eSIM remote provisioning partner

- [ ] Select an authorised consumer eSIM SM-DP+ provider with GSMA compliance and the required security assurance/certification for its role.
- [ ] Confirm its eSIM consumer RSP architecture and supported GSMA SGP.22/compatible device flows.
- [ ] Agree whether the host MNO or its aggregator supplies SM-DP+ profile generation, profile protection, profile download and lifecycle management.
- [ ] Agree subscription inventory, profile allocation, EID/ICCID/IMSI handling, Matching ID/activation method, expiry, recovery and replacement.
- [ ] Agree provider API: create subscription/order, query order/profile status, suspend, resume, release/delete, usage query and refund/cancel.
- [ ] Agree webhook signing and replay protection; event IDs must be idempotent.
- [ ] Test Android Local Profile Assistant / EuiccManager download and user-consent resolutions on approved eUICC phones.
- [ ] Confirm profile install, enable, disable, delete, active-data-SIM selection and error recovery.
- [ ] Obtain partner test profiles. Never create test activation strings that could be mistaken for a real issued profile.

## 4. Identity, subscriber registration and fraud

- [ ] Choose host-owned or authorised third-party NIMC identity verification path.
- [ ] Confirm whether host operator performs NIN verification directly or an approved service provider acts on its behalf.
- [ ] Agree data minimisation, live capture/biometric handling, liveness and duplicate identity checks.
- [ ] Agree foreign subscriber and NIN-exemption cases and any duration-limited SIM registration path with host and NCC rules.
- [ ] Confirm subscriber registration database write/access responsibilities and activation gate.
- [ ] Agree identity verification failure, retry, manual review, mismatch and appeals process.
- [ ] Configure KYC API, signed webhook, production credentials and partner contract.
- [ ] Test that only verified subscribers can place an eSIM order, receive a profile or activate the subscription.

**Software safeguard:** Expert eSIM currently does not collect raw NIN or biometric images in its own form. Live KYC stays blocked until the authorised verification provider and workflow are configured.

## 5. Payments, taxation and financial controls

- [ ] Open and verify the merchant/business account with the payment processor in the registered company name.
- [ ] Configure Paystack live secret key and dedicated webhook signing secret in Railway; keep test and live separately.
- [ ] Register the production webhook URL: https://expert-esim-web-production.up.railway.app/api/v1/payments/paystack/webhook.
- [ ] Subscribe to charge.success; test timestamp/signature validation, amount/currency/reference match, replay protection, retry and idempotency.
- [ ] Agree refunds, failed profile delivery, partial fulfilment, duplicate payments, chargebacks and payment dispute procedures.
- [ ] Confirm NGN pricing in kobo, invoices/receipts, tax/VAT treatment and accounting reconciliation with qualified Nigerian tax/accounting advice.
- [ ] Run a complete test-to-live acceptance with small controlled transactions before enabling any package.

## 6. Privacy and data protection

- [ ] Confirm the registered Data Controller/Processor entity and assess NDPC registration obligations as a Data Controller/Processor of Major Importance.
- [ ] Appoint a DPO/privacy contact and publish actual name/role, email, address and complaint route.
- [ ] Complete a Data Protection Impact Assessment for telecom subscriber onboarding, NIN/biometric verification, account, payment, usage and eSIM lifecycle data.
- [ ] Publish final Privacy Notice, Terms, cookies/session notice, data-processing purposes/lawful bases and retention schedule.
- [ ] Sign Data Processing Agreements with cloud, host MNO, SM-DP+, KYC, payment, email and support vendors.
- [ ] Assess cross-border transfers and adopt required safeguards before transmitting subscriber data internationally.
- [ ] Define data subject request handling, identity confirmation, access, correction, deletion, objection and portability. Apply statutory telecom, tax and payment retention exceptions.
- [ ] Finalise breach response and escalation: contain, investigate, record and notify NDPC/affected people within the applicable legal timeframe when required.
- [ ] Perform access review, encryption/key-rotation, secure backups, restoration and incident-response drills.

## 7. Consumer protection and operations

- [ ] Publish packages only after the service can fulfil them. Show allowance, validity, taxes, coverage, 4G/5G support, restrictions and expiry clearly.
- [ ] Publish customer support phone/email, operating hours, case acknowledgement and resolution targets.
- [ ] Publish outage and planned-maintenance communication process.
- [ ] Define service credits/refunds and complaints escalation to host MNO and the regulator.
- [ ] Establish subscriber support and privacy-request monitoring (not just intake).
- [ ] Create fraud/abuse response runbooks, lost/stolen-device, profile reissue, SIM-swap and account takeover procedures.
- [ ] Define live service monitoring: order success, profile-download success, activation latency, data session establishment, usage, quota and provider outage.

## 8. Security, reliability and production engineering

- [ ] Rotate any secrets that have been exposed during development; keep production keys only in a secret manager.
- [ ] Move current JSON file store to managed PostgreSQL before multiple replicas or high-volume production. Add migrations, unique indexes and transaction semantics.
- [ ] Add automated encrypted backup, point-in-time recovery where available, retention policy and restore drills.
- [ ] Move login/admin rate limits to a shared store such as Redis when scaling beyond one instance.
- [ ] Add alerting, structured audit logs, retention controls, provider timeout/retry/circuit breaker and queue-based fulfilment.
- [ ] Add automated dependency/security scanning, vulnerability response and release signing.
- [ ] Configure separate development/staging/production environments and test/live provider keys.
- [ ] Complete penetration testing and independent security review before live subscriber data at scale.

## 9. Android app and distribution

- [ ] Test Android eSIM install on multiple supported eUICC devices and Android versions.
- [ ] Verify model, eUICC hardware, carrier lock, device region, eSIM enablement and host compatibility before allowing profile download.
- [ ] Verify successful download versus enabled profile versus selected data line; do not treat these as the same event.
- [ ] Test user approval, resolvable error, interrupted download, device reboot and profile replacement.
- [ ] Obtain production app signing key and build a release-signed bundle/APK. Existing APKs are debug-signed and are not Play Store production releases.
- [ ] Finish Google Play listing, privacy disclosures, app content declarations, support URL, data safety form and review before public distribution.

## 10. Exact integrations that can be configured after partner selection

| Integration | Environment keys (do not send secrets in chat) |
|---|---|
| eSIM provider | ESIM_PROVIDER_CREATE_ORDER_URL, ESIM_PROVIDER_API_KEY, ESIM_PROVIDER_WEBHOOK_SECRET |
| Host network | HOST_NETWORK_NAME, HOST_NETWORK_AGREEMENT_ACTIVE=true only after signed agreement |
| SM-DP+ | SMDP_PARTNER_ACTIVE=true only after live authorised service |
| NIMC/KYC provider | KYC_PROVIDER_START_URL, KYC_PROVIDER_API_KEY, KYC_PROVIDER_WEBHOOK_SECRET |
| Paystack | PAYSTACK_SECRET_KEY, PAYSTACK_WEBHOOK_SECRET |
| Email verification | RESEND_API_KEY, EXPERT_ESIM_EMAIL_FROM |
| Regulatory/operations gates | NCC_MVNO_LICENCE_CONFIRMED=true, PRIVACY_GOVERNANCE_READY=true, CONSUMER_SUPPORT_READY=true, EXPERT_ESIM_SERVICE_ENABLED=true |

**Do not set any launch flag to true just to make the app appear ready.** Only the authorised company officer should confirm that the underlying licence, signed agreements, operational integrations and procedures actually exist.
