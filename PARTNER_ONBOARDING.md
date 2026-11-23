# Expert eSIM — Global Sponsored Connectivity Readiness Register

**Scope:** global, sponsor-funded consumer eSIM/mobile-data service.  
**Status date:** 23 November 2026.  
**Purpose:** separate software that is implemented from the carrier, roaming, eSIM, legal, identity and operating arrangements that must be supplied by real partners. This is a technical/business work register, not legal advice or a claim of network ownership.

## Product model

Expert eSIM is intended to fund eligible users' mobile-data access. The customer application does not sell data packages. A subscriber registers each device separately; the backend records a device and requests a unique eSIM profile for that device. Expert eSIM pays the contracted global connectivity provider under a wholesale/sponsored-use agreement.

A profile is not a mobile network. The provider and visited networks must supply real roaming access, subscriber authentication, data routing, charging policy and activation. The product must never show a profile as issued or active until the authorised provider confirms it.

## Current software state

| Area | State | Notes |
|---|---|---|
| Subscriber accounts | Implemented | Password hashing, secure session cookie, rate limits and persistent subscriber records. |
| Email verification | Adapter implemented | Requires a verified sending domain and email API credentials. |
| Device registry | Implemented | Separate device record per app installation, linked to the subscriber. |
| Device profile request | Implemented | Creates one profile request for each device and prevents repeat requests while a profile is pending or active. |
| Global provider adapter | Implemented as a generic contract | Requires vendor-specific API mapping, endpoint, credentials and signed commercial terms. |
| Sponsored unlimited-data policy | Software gate implemented | Profile is withheld unless provider confirms unlimited data in its API response or signed callback. Contract must define any fair-use limits, speed management, tethering and permanent-roaming rules. |
| Global coverage gate | Software gate implemented | Profile is withheld unless provider confirms global roaming scope. Actual country/territory coverage must be checked against the provider's current matrix. |
| SM-DP+ profile receipt | Implemented as a generic integration | Signed callbacks and AES-256-GCM encrypted activation material at rest. No profile is issued in production today. |
| Identity verification | Generic hosted-provider adapter | Use only where required by a connectivity provider or the laws of a market; provider and country-specific review still required. |
| Android profile installation | Native integration present | Needs testing with partner-issued profiles on compatible devices. Other platforms need their supported installation flow. |
| Support and privacy workflow | Implemented | Intake and admin review exist; actual staff, contacts, service levels and legal notices are not finalised. |
| Operations dashboard | Implemented | Subscriber, device, profile, partner-readiness, support and privacy status. |
| Storage | Early production persistence | Railway volume JSON store is for a single instance. Move to managed PostgreSQL and tested backups before scaling. |

## 1. Global connectivity provider / wholesale agreement

- [ ] Select a global connectivity provider or roaming aggregator willing to contract with the Expert eSIM operating company.
- [ ] Obtain a written offer that permits sponsor-funded end-user access (not only direct-to-consumer resale).
- [ ] Confirm the commercial model: minimum commitment, deposits, platform fees, per-subscriber charges, usage settlement, taxes, overage and credit limits.
- [ ] Obtain a current country/territory matrix, underlying visited operators, supported radio technologies and access restrictions.
- [ ] Confirm whether service may be used in the subscriber's home country and whether permanent roaming is allowed.
- [ ] Agree multi-network selection, roaming steering, fallback, preferred network, 4G/5G availability and network-priority rules.
- [ ] Agree APN, private APN where available, IP addressing, local breakout, home routing, DNS, IPv4/IPv6, CGNAT, VPN compatibility and traffic management.
- [ ] Obtain subscriber provisioning APIs for create, activate, suspend, resume, replace and terminate.
- [ ] Obtain data-session and usage APIs: bytes used, session start/end, quota/policy status, network, country, IMSI profile association and last-seen state.
- [ ] Agree charging model for the sponsored service and confirm how unlimited access is metered and reconciled by the provider.
- [ ] Define uptime, throughput, latency, incident response, maintenance, outage notices, support escalation and service credits.
- [ ] Sign the agreement and obtain sandbox plus production API access. Do not set readiness flags before the agreement is effective.

## 2. Unlimited-data contract requirements

“Unlimited” must be an explicit contractual service attribute, not a marketing label or an application flag.

- [ ] Confirm whether each subscriber/device receives unlimited data or shares a pooled allowance.
- [ ] State whether the service has a fair-use policy, speed reduction threshold, traffic-management rule or network priority change.
- [ ] State whether tethering/mobile hotspot is permitted and whether video, peer-to-peer, VPN or other traffic is restricted.
- [ ] State whether permanent roaming, extended stays, home-country use or commercial/industrial use is restricted.
- [ ] Define whether the unlimited entitlement is per profile, per user, per month or continuous until suspension.
- [ ] Define acceptable-use limits, fraud controls, abuse response and suspension/reinstatement procedures.
- [ ] Define the commercial payment structure Expert eSIM will use to fund all eligible users, including high usage and unexpected cost scenarios.
- [ ] Obtain a written list of exclusions and service conditions. The app must display material limitations and must not claim access in excluded destinations.

## 3. Consumer eSIM / SM-DP+ provider

- [ ] Select an authorised consumer eSIM remote-provisioning provider with appropriate GSMA compliance and security assurance for its role.
- [ ] Confirm supported consumer RSP architecture and active GSMA SGP.22/compatible device flows.
- [ ] Agree whether the global connectivity provider supplies the SM-DP+ or whether a separate provider is required.
- [ ] Obtain the production API for profile allocation, profile download, status, enable/disable, suspend/resume, replacement and deletion.
- [ ] Confirm per-device profile allocation and whether the provider can bind the profile to an EID/eUICC where required.
- [ ] Agree how the provider handles EID, ICCID, IMSI, activation code, matching ID and confirmation code; minimise what Expert eSIM stores.
- [ ] Define activation-code delivery, QR/one-tap installation, expiry, re-download, interrupted installation and replacement.
- [ ] Agree signed webhooks, event IDs, replay protection, retries and idempotency.
- [ ] Test profile issuance, device installation, activation, data-session establishment, suspension, replacement and deletion on a supported device matrix.
- [ ] Obtain provider test profiles. Never invent activation strings or mark test profiles as live.

## 4. Device-by-device profile lifecycle

Current software records a separate device record for each app installation and a separate profile request for each device.

- [ ] Confirm if the provider requires an EID to bind a profile to the physical eUICC. If required, implement a secure collection/attestation route and do not store EIDs in plaintext.
- [ ] If the provider supports secure in-device installation without manually collecting an EID, use its SDK/LPA workflow.
- [ ] Ensure one profile reference cannot be assigned to multiple subscriber devices.
- [ ] Define transfer/replacement rules when a user changes or loses a device.
- [ ] Verify that profile retrieval is restricted to the owning subscriber account.
- [ ] Test the difference between profile issued, downloaded, installed, enabled, selected for mobile data and provider-confirmed active.
- [ ] Keep failed and cancelled profile states auditable and allow controlled retries without duplicate billing or duplicate profiles.

## 5. Identity and eligibility checks across markets

- [ ] Obtain a market-by-market matrix from the global connectivity provider showing when identity checks, age checks, address checks or additional subscriber information are required.
- [ ] Select an authorised identity-verification provider capable of the countries where the service is actually offered.
- [ ] Determine which checks are performed by the host/roaming provider and which by Expert eSIM.
- [ ] Use hosted verification or provider SDKs where possible; avoid collecting raw identity documents or biometric data unless a documented lawful process requires it.
- [ ] Agree failed checks, mismatch handling, retries, manual review, appeals and retention.
- [ ] Pass verification status and minimum necessary customer references through the API.
- [ ] Do not enable profile issuance in a market where required identity or eligibility checks are not available.

## 6. Legal and regulatory readiness by market

A global roaming agreement does not automatically authorise every service model in every country.

- [ ] Identify the actual contracting company, its registration location, beneficial owners and operating jurisdictions.
- [ ] Obtain qualified telecommunications advice for each market in which Expert eSIM will market, distribute, or actively provide mobile service.
- [ ] Confirm whether the intended arrangement is a hosted travel/roaming eSIM, connectivity-as-a-service, reseller, MVNO or another regulated model in each target market.
- [ ] Confirm local telecom authorisation, roaming, spectrum, subscriber registration, numbering and lawful-assistance requirements as applicable.
- [ ] Confirm local consumer, advertising, tax, sanctions, export-control and payment requirements.
- [ ] Confirm whether permanent roaming or domestic use is restricted by visited-network rules.
- [ ] Maintain a country/territory availability policy and block destinations not covered by signed agreements or legally cleared.
- [ ] Do not state “available in every country” unless the current partner coverage and legal analysis actually support that claim.

## 7. Privacy, security and international transfers

- [ ] Identify the controller and processor roles of Expert eSIM, connectivity provider, visited operators, SM-DP+, identity provider, email provider and cloud host.
- [ ] Appoint a responsible privacy contact/DPO where required.
- [ ] Complete a global data inventory and privacy impact assessment for subscriber, device, profile, usage, location and identity data.
- [ ] Publish an accurate Privacy Notice and Terms identifying data categories, purposes, lawful bases, recipients, retention and user rights.
- [ ] Sign data-processing and data-sharing agreements with each partner.
- [ ] Map data locations and international transfers; implement applicable transfer safeguards and user disclosures.
- [ ] Set data minimisation, access control, logging, encryption, key rotation, secret storage and retention schedules.
- [ ] Define incident response, breach assessment, notification timelines and partner escalation for every applicable market.
- [ ] Test encrypted backups and restore procedures.

## 8. Payments, funding and financial controls

- [ ] Open a corporate account/credit facility with the global connectivity provider.
- [ ] Agree prepaid wallet, monthly invoice, minimum commitment, credit ceiling and suspension behaviour.
- [ ] Forecast data usage per subscriber/device and stress-test high-usage scenarios.
- [ ] Reconcile provider invoices against per-profile usage, country, network and policy status.
- [ ] Define internal abuse controls and fair-use notifications without asking users to pay for ordinary data access.
- [ ] Confirm tax, invoicing and cross-border settlement obligations with qualified advisers.
- [ ] Keep user checkout and retail data-plan sales disabled in the customer app unless the business model is deliberately changed.

## 9. Customer support and operations

- [ ] Publish a monitored support email/chat/phone channel and staffed operating hours.
- [ ] Define support acknowledgement and resolution targets.
- [ ] Define activation-failure, no-service, slow-speed, roaming, lost-device, replacement and profile-deletion playbooks.
- [ ] Agree escalation contacts and incident severity with global provider and SM-DP+ partner.
- [ ] Monitor profile request success, download completion, activation time, data-session establishment, network attachment and usage.
- [ ] Maintain a live coverage status source from the provider rather than a static list created by the app.
- [ ] Notify users of coverage exclusions, planned changes, outages and fair-use restrictions.

## 10. Security and production engineering

- [ ] Move JSON storage to managed PostgreSQL with migrations and transaction semantics.
- [ ] Add unique constraints for subscriber/device/profile references and provider event IDs.
- [ ] Add queue-based provisioning, bounded retries, timeouts, circuit breakers and dead-letter review.
- [ ] Move rate limits to a shared store for multi-instance deployment.
- [ ] Configure encrypted backups, key rotation, monitoring, alerts and audit retention.
- [ ] Complete dependency scanning, penetration testing and independent security review.
- [ ] Configure separate sandbox and production credentials.
- [ ] Build signed production releases and test Android/iOS installation flows supported by the chosen provider.

## 11. Current integration configuration

| Integration | Railway variables |
|---|---|
| Global eSIM profile API | GLOBAL_ESIM_PROFILE_API_URL, GLOBAL_ESIM_PROFILE_API_KEY |
| Global roaming connectivity | GLOBAL_CONNECTIVITY_PROVIDER_NAME, GLOBAL_CONNECTIVITY_AGREEMENT_ACTIVE=true only after signed agreement |
| Provider coverage | GLOBAL_ESIM_GLOBAL_COVERAGE_CONFIRMED=true only after checking the actual coverage matrix |
| Sponsored unlimited-data entitlement | GLOBAL_ESIM_UNLIMITED_DATA_CONFIRMED=true only after signed commercial confirmation |
| SM-DP+ profile partner | SMDP_PARTNER_ACTIVE=true only after authorised provider is operational |
| eSIM lifecycle webhook | ESIM_PROVIDER_WEBHOOK_SECRET |
| Identity provider where required | GLOBAL_IDENTITY_PROVIDER_START_URL, GLOBAL_IDENTITY_PROVIDER_API_KEY, GLOBAL_IDENTITY_PROVIDER_WEBHOOK_SECRET |
| Email verification | RESEND_API_KEY, EXPERT_ESIM_EMAIL_FROM |
| Profile encryption | ESIM_PROFILE_ENCRYPTION_KEY |
| Governance and operating controls | PRIVACY_GOVERNANCE_READY=true, CONSUMER_SUPPORT_READY=true, EXPERT_ESIM_SERVICE_ENABLED=true only after the underlying controls and partner tests are complete |

## 12. Potential global connectivity providers to approach

These are prospects for due diligence, not confirmed Expert eSIM partners:
- 1GLOBAL Connect API: https://docs.connect-api.1global.com/getting-started/
- Telna global connectivity/network: https://www.telna.com/network and https://www.telna.com/api
- GSMA eSIM specification status: https://www.gsma.com/solutions-and-impact/technologies/esim/esim-specification/

A provider's public country-count or API description does not prove unlimited data in every country. Request a written coverage matrix, sponsor-funded wholesale terms, permanent-roaming rules, fair-use schedule and production API access before implementation is treated as live.

**Do not set readiness flags to true merely to make the app appear ready.** They represent real contracts, credentials, coverage and tested service. The application intentionally withholds profile activation details until the provider confirms the required service attributes.
