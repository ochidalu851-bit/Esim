'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'expert-esim-test-'));
const port = 19000 + (process.pid % 10000);
const adminKey = 'test-admin-secret-please-change';
let child;
let subscriberCookie = '';
const base = 'http://127.0.0.1:' + port;

async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try {
      const response = await fetch(base + '/health');
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('Expert eSIM server did not start.');
}

before(async () => {
  child = spawn(process.execPath, [path.join(root, 'server.js')], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      EXPERT_ESIM_ADMIN_KEY: adminKey,
      ESIM_PROFILE_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64url'),
      ESIM_PROVIDER_WEBHOOK_SECRET: 'test-webhook-secret'
    },
    stdio: 'ignore'
  });
  await waitForServer();
});

after(async () => {
  if (child && !child.killed) child.kill('SIGTERM');
  fs.rmSync(dataDir, { recursive: true, force: true });
});

async function request(route, options = {}) {
  const response = await fetch(base + route, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body, headers: response.headers };
}
function cookieFrom(result) {
  const header = result.headers.get('set-cookie') || '';
  return header ? header.split(';')[0] : '';
}
const authHeaders = () => ({ cookie: subscriberCookie });

test('health and readiness show that no live eSIM provider is configured', async () => {
  const result = await request('/health');
  assert.equal(result.status, 200);
  assert.equal(result.body.persistentStoreReady, true);
  assert.equal(result.body.provider.profileProviderConfigured, false);
  assert.equal(result.body.provider.globalConnectivityPartnerConfigured, false);

  const status = await request('/api/v1/status');
  assert.equal(status.status, 200);
  assert.equal(status.body.providerProvisioning, 'awaiting-global-connectivity-and-esim-partners');
  assert.equal(status.body.cellularDataProvisioning, 'not-active-until-global-provider-confirms-profile-and-roaming');
});

test('subscriber must accept privacy and terms and receives a secure HttpOnly cookie', async () => {
  const noConsent = await request('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({ fullName: 'Test Subscriber', email: 'subscriber@example.com', password: 'strong-test-password-2026' })
  });
  assert.equal(noConsent.status, 400);

  const created = await request('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      fullName: 'Test Subscriber',
      email: 'subscriber@example.com',
      phone: '+12025550123',
      password: 'strong-test-password-2026',
      acceptedTerms: true,
      acceptedPrivacy: true
    })
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.user.email, 'subscriber@example.com');
  assert.equal(created.body.user.emailVerified, false);
  assert.equal(Object.hasOwn(created.body, 'token'), false);
  assert.equal(Object.hasOwn(created.body.user, 'passwordHash'), false);
  const setCookie = created.headers.get('set-cookie') || '';
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /Secure/);
  assert.match(setCookie, /SameSite=Strict/);
  subscriberCookie = cookieFrom(created);
  assert.ok(subscriberCookie.startsWith('expert_esim_session='));
});

test('existing subscriber session opens account dashboard, not registration panel', async () => {
  const me = await request('/api/v1/me', { headers: authHeaders() });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.fullName, 'Test Subscriber');
  assert.equal(me.body.user.emailVerified, false);
  assert.equal(me.body.user.kycStatus, 'not_started');
  assert.equal(Array.isArray(me.body.orders), true);
  assert.equal(Array.isArray(me.body.devices), true);
  assert.equal(me.body.devices.length, 0);
  const addedDevice = await request('/api/v1/devices', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ clientDeviceId: 'android_test_reference_000001', deviceName: 'OPPO CPH2127', manufacturer: 'OPPO', platform: 'android', model: 'CPH2127', osVersion: '11', eSimSupportKnown: true, hasEuiccHardware: true, euiccEnabled: true })
  });
  assert.equal(addedDevice.status, 201);
  const devices = await request('/api/v1/devices', { headers: authHeaders() });
  assert.equal(devices.status, 200);
  assert.equal(devices.body.devices.length, 1);
  assert.equal(devices.body.devices[0].manufacturer, 'OPPO');
  assert.equal(devices.body.devices[0].model, 'CPH2127');
  assert.equal(devices.body.devices[0].hasEuiccHardware, true);
  assert.equal(devices.body.devices[0].euiccEnabled, true);

  const profileRequest = await request('/api/v1/devices/' + addedDevice.body.device.id + '/profile', { method: 'POST', headers: authHeaders() });
  assert.equal(profileRequest.status, 202);
  assert.equal(profileRequest.body.profile.status, 'awaiting_verification');
  const incompatibleDevice = await request('/api/v1/devices', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ clientDeviceId: 'android_no_esim_reference_00001', deviceName: 'Basic phone', manufacturer: 'Example', model: 'No-eSIM', platform: 'android', eSimSupportKnown: true, hasEuiccHardware: false, euiccEnabled: false })
  });
  assert.equal(incompatibleDevice.status, 201);
  const incompatibleProfile = await request('/api/v1/devices/' + incompatibleDevice.body.device.id + '/profile', { method: 'POST', headers: authHeaders() });
  assert.equal(incompatibleProfile.status, 409);
  assert.match(incompatibleProfile.body.error, /does not have eSIM hardware/);


  assert.equal(Array.isArray(me.body.tickets), true);
  assert.equal(Array.isArray(me.body.privacyRequests), true);
  assert.equal(me.body.readiness.identityProviderConfigured, false);
  const mobileScript = fs.readFileSync(path.join(root, 'public/geniex-app.js'), 'utf8');
  assert.ok(mobileScript.includes('getDeviceInfo'));
  assert.ok(mobileScript.includes('getCurrentNetworkInfo'));
  assert.doesNotThrow(() => new Function(mobileScript));
});

test('login creates a fresh secure session; logout invalidates it and clears cookie', async () => {
  const login = await request('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'subscriber@example.com', password: 'strong-test-password-2026' })
  });
  assert.equal(login.status, 200);
  assert.equal(Object.hasOwn(login.body, 'token'), false);
  const loginCookie = cookieFrom(login);
  assert.match(login.headers.get('set-cookie') || '', /HttpOnly/);
  assert.ok(loginCookie.startsWith('expert_esim_session='));

  const account = await request('/api/v1/me', { headers: { cookie: loginCookie } });
  assert.equal(account.status, 200);
  const logout = await request('/api/v1/auth/logout', { method: 'POST', headers: { cookie: loginCookie } });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie') || '', /Max-Age=0/);
  const expired = await request('/api/v1/me', { headers: { cookie: loginCookie } });
  assert.equal(expired.status, 401);
});

test('cross-origin state-changing requests are rejected', async () => {
  const result = await request('/api/v1/auth/register', {
    method: 'POST',
    headers: { origin: 'https://attacker.invalid' },
    body: JSON.stringify({ fullName: 'Cross Site', email: 'bad@example.com', password: 'another-strong-password', acceptedTerms: true, acceptedPrivacy: true })
  });
  assert.equal(result.status, 403);
});

test('market identity checks can be initiated only with a configured partner and customer checkout is retired', async () => {
  const kyc = await request('/api/v1/kyc/start', { method: 'POST', headers: authHeaders() });
  assert.equal(kyc.status, 503);

  const plans = await request('/api/v1/plans');
  assert.equal(plans.status, 410);
  assert.equal(plans.body.code, 'SPONSORED_DEVICE_PROFILE_FLOW');

  const payInit = await request('/api/v1/esim/orders/00000000-0000-4000-8000-000000000000/pay', {
    method: 'POST',
    headers: authHeaders()
  });
  assert.equal(payInit.status, 410);
});

test('subscriber can raise a support case and privacy request and export their own account data', async () => {
  const ticket = await request('/api/v1/support/tickets', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ category: 'activation', subject: 'Cannot activate eSIM', message: 'The activation screen does not show an available eSIM profile after I sign in.' })
  });
  assert.equal(ticket.status, 201);
  assert.match(ticket.body.ticket.reference, /^EXSUP-/);

  const privacy = await request('/api/v1/privacy/requests', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ type: 'access', details: 'Please provide the personal information held for my account.' })
  });
  assert.equal(privacy.status, 201);
  assert.match(privacy.body.request.reference, /^EXPR-/);

  const exported = await request('/api/v1/privacy/export', { headers: authHeaders() });
  assert.equal(exported.status, 200);
  assert.equal(exported.body.account.email, 'subscriber@example.com');
  assert.equal(exported.body.orders.length, 0);
  assert.equal(Array.isArray(exported.body.devices), true);
  assert.equal(Array.isArray(exported.body.profiles), true);
  assert.equal(exported.body.supportTickets.length, 1);
  assert.equal(exported.body.privacyRequests.length, 1);
  assert.equal(Object.hasOwn(exported.body.account, 'passwordHash'), false);
});

test('admin endpoints show global profile readiness and reject retired package sales', async () => {
  const rejected = await request('/api/v1/admin/dashboard');
  assert.equal(rejected.status, 401);

  const dashboard = await request('/api/v1/admin/dashboard', { headers: { 'x-expert-admin-key': adminKey } });
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.body.dashboard.totals.subscribers, 1);
  assert.equal(dashboard.body.dashboard.totals.registeredDevices, 2);
  assert.equal(Array.isArray(dashboard.body.dashboard.recentDevices), true);
  assert.equal(dashboard.body.dashboard.totals.openTickets, 1);
  assert.equal(dashboard.body.dashboard.totals.privacyRequests, 1);
  assert.equal(dashboard.body.dashboard.provider.globalCoverageConfirmed, false);

  const plan = await request('/api/v1/admin/plans', {
    method: 'POST',
    headers: { 'x-expert-admin-key': adminKey },
    body: JSON.stringify({ name: 'Legacy package', dataMb: 3072, validityDays: 30, priceMinor: 100000, currency: 'USD' })
  });
  assert.equal(plan.status, 410);

  const publish = await request('/api/v1/admin/plans/00000000-0000-4000-8000-000000000000/publish', {
    method: 'POST',
    headers: { 'x-expert-admin-key': adminKey }
  });
  assert.equal(publish.status, 410);

  const ticketStatus = await request('/api/v1/admin/support/tickets/' + dashboard.body.dashboard.recentTickets[0].id + '/status', {
    method: 'POST',
    headers: { 'x-expert-admin-key': adminKey },
    body: JSON.stringify({ status: 'in_progress' })
  });
  assert.equal(ticketStatus.status, 200);

  const privacyId = dashboard.body.dashboard.recentPrivacyRequests[0].id;
  const privacyStatus = await request('/api/v1/admin/privacy/requests/' + privacyId + '/status', {
    method: 'POST',
    headers: { 'x-expert-admin-key': adminKey },
    body: JSON.stringify({ status: 'in_review' })
  });
  assert.equal(privacyStatus.status, 200);
});

test('Expert eSIM rewards, wallet, coupons, referrals, airtime requests, inbox and Railway speed tests work', async () => {
  const summary = await request('/api/v1/app/summary', { headers: authHeaders() });
  assert.equal(summary.status, 200);
  assert.equal(summary.body.summary.devices, 2);
  assert.equal(summary.body.summary.dailyCheckinAvailable, true);
  assert.ok(summary.body.summary.referralCode);
  const defaultPreferences = await request('/api/v1/app/preferences', { headers: authHeaders() });
  assert.equal(defaultPreferences.status, 200);
  assert.equal(defaultPreferences.body.preferences.darkMode, true);
  assert.equal(defaultPreferences.body.preferences.inAppNotifications, true);
  const savedPreferences = await request('/api/v1/app/preferences', {
    method: 'PATCH', headers: authHeaders(),
    body: JSON.stringify({ darkMode: false, emailNotifications: true, usageAlerts: false, sponsorOfferUpdates: true })
  });
  assert.equal(savedPreferences.status, 200);
  assert.equal(savedPreferences.body.preferences.darkMode, false);
  assert.equal(savedPreferences.body.preferences.emailNotifications, true);
  const invalidPreference = await request('/api/v1/app/preferences', {
    method: 'PATCH', headers: authHeaders(), body: JSON.stringify({ unsupportedPreference: true })
  });
  assert.equal(invalidPreference.status, 400);
  const checkin = await request('/api/v1/app/check-in', { method: 'POST', headers: authHeaders(), body: JSON.stringify({}) });
  assert.equal(checkin.status, 201);
  assert.equal(checkin.body.pointsBalance, 10);
  const checkinAgain = await request('/api/v1/app/check-in', { method: 'POST', headers: authHeaders(), body: JSON.stringify({}) });
  assert.equal(checkinAgain.status, 409);
  const spin = await request('/api/v1/app/spin', { method: 'POST', headers: authHeaders(), body: JSON.stringify({}) });
  assert.equal(spin.status, 201);
  assert.ok([5,10,15,20,30].includes(spin.body.claim.points));
  const spinAgain = await request('/api/v1/app/spin', { method: 'POST', headers: authHeaders(), body: JSON.stringify({}) });
  assert.equal(spinAgain.status, 409);
  const deviceTask = await request('/api/v1/app/tasks/register_device/claim', { method: 'POST', headers: authHeaders(), body: JSON.stringify({}) });
  assert.equal(deviceTask.status, 201);
  const deviceTaskAgain = await request('/api/v1/app/tasks/register_device/claim', { method: 'POST', headers: authHeaders(), body: JSON.stringify({}) });
  assert.equal(deviceTaskAgain.status, 409);
  const speedPing = await fetch(base + '/api/v1/tools/speedtest/ping');
  assert.equal(speedPing.status, 204);
  const speedDownload = await fetch(base + '/api/v1/tools/speedtest/download?bytes=512');
  assert.equal(speedDownload.status, 200);
  assert.equal((await speedDownload.arrayBuffer()).byteLength, 512);
  const speedUpload = await fetch(base + '/api/v1/tools/speedtest/upload', { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: new Uint8Array(2048) });
  assert.equal(speedUpload.status, 200);
  assert.equal((await speedUpload.json()).receivedBytes, 2048);
  const recordedTest = await request('/api/v1/app/speed-test', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ downloadMbps: 22.4, uploadMbps: 8.3, pingMs: 42, jitterMs: 2.5 }) });
  assert.equal(recordedTest.status, 201);
  const speedTask = await request('/api/v1/app/tasks/speed_test/claim', { method: 'POST', headers: authHeaders(), body: JSON.stringify({}) });
  assert.equal(speedTask.status, 201);
  const coupon = await request('/api/v1/admin/coupons', { method: 'POST', headers: { 'x-expert-admin-key': adminKey }, body: JSON.stringify({ title: 'Test points coupon', type: 'points', points: 5, description: 'Test coupon' }) });
  assert.equal(coupon.status, 201);
  const coupons = await request('/api/v1/app/coupons', { headers: authHeaders() });
  assert.equal(coupons.status, 200);
  const couponClaim = await request('/api/v1/app/coupons/' + coupon.body.coupon.id + '/claim', { method: 'POST', headers: authHeaders(), body: JSON.stringify({}) });
  assert.equal(couponClaim.status, 201);
  const couponAgain = await request('/api/v1/app/coupons/' + coupon.body.coupon.id + '/claim', { method: 'POST', headers: authHeaders(), body: JSON.stringify({}) });
  assert.equal(couponAgain.status, 409);
  const code = await request('/api/v1/admin/rewards/codes', { method: 'POST', headers: { 'x-expert-admin-key': adminKey }, body: JSON.stringify({ code: 'EXPERT-TEST-REWARD-2026', type: 'points', points: 10, maxRedemptions: 1 }) });
  assert.equal(code.status, 201);
  const redeemed = await request('/api/v1/app/redeem-code', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ code: 'EXPERT-TEST-REWARD-2026' }) });
  assert.equal(redeemed.status, 201);
  const redeemedAgain = await request('/api/v1/app/redeem-code', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ code: 'EXPERT-TEST-REWARD-2026' }) });
  assert.equal(redeemedAgain.status, 409);
  const storeItem = await request('/api/v1/admin/rewards/items', { method: 'POST', headers: { 'x-expert-admin-key': adminKey }, body: JSON.stringify({ title: 'Test reward item', type: 'digital', pointsCost: 10, description: 'Fulfilment test' }) });
  assert.equal(storeItem.status, 201);
  const storeOrder = await request('/api/v1/app/store/' + storeItem.body.item.id + '/redeem', { method: 'POST', headers: authHeaders(), body: JSON.stringify({}) });
  assert.equal(storeOrder.status, 201);
  assert.equal(storeOrder.body.order.status, 'awaiting_sponsor_fulfilment');
  const referralData = await request('/api/v1/app/referrals', { headers: authHeaders() });
  assert.equal(referralData.status, 200);
  const second = await request('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ fullName: 'Referred Subscriber', email: 'referred@example.com', password: 'another-strong-password', acceptedTerms: true, acceptedPrivacy: true, referralCode: summary.body.summary.referralCode }) });
  assert.equal(second.status, 201);
  const transfer = await request('/api/v1/app/wallet/transfer', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ recipientCode: second.body.user.referralCode, points: 5 }) });
  assert.equal(transfer.status, 201);
  const recipientWallet = await request('/api/v1/app/wallet', { headers: { cookie: cookieFrom(second) } });
  assert.equal(recipientWallet.status, 200);
  assert.equal(recipientWallet.body.wallet.pointsBalance, 5);
  const airtime = await request('/api/v1/app/airtime', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ countryCode: 'US', phone: '+12025550123', amount: 5, currency: 'USD' }) });
  assert.equal(airtime.status, 202);
  assert.equal(airtime.body.request.status, 'awaiting_airtime_partner');
  const announcement = await request('/api/v1/admin/messages', { method: 'POST', headers: { 'x-expert-admin-key': adminKey }, body: JSON.stringify({ title: 'Test notice', message: 'A test announcement for the inbox.' }) });
  assert.equal(announcement.status, 201);
  const inbox = await request('/api/v1/app/messages', { headers: authHeaders() });
  assert.ok(inbox.body.messages.some(x => x.id === announcement.body.message.id));
  const read = await request('/api/v1/app/messages/' + announcement.body.message.id + '/read', { method: 'POST', headers: authHeaders(), body: JSON.stringify({}) });
  assert.equal(read.status, 200);
  const wallet = await request('/api/v1/app/wallet', { headers: authHeaders() });
  assert.ok(wallet.body.wallet.pointsBalance > 0);
  const passwordChange = await request('/api/v1/auth/change-password', {
    method: 'POST', headers: authHeaders(),
    body: JSON.stringify({ currentPassword: 'strong-test-password-2026', newPassword: 'updated-strong-password-2026' })
  });
  assert.equal(passwordChange.status, 200);
  const stillSignedIn = await request('/api/v1/me', { headers: authHeaders() });
  assert.equal(stillSignedIn.status, 200);

  const adminFeatures = await request('/api/v1/admin/features', { headers: { 'x-expert-admin-key': adminKey } });
  assert.equal(adminFeatures.status, 200);
  assert.ok(adminFeatures.body.engagement.totalPointsIssued > 0);
  const fulfilmentRecord = adminFeatures.body.records.airtimeRequests.find(x => x.id === airtime.body.request.id);
  assert.ok(fulfilmentRecord);
  const unreferencedFulfilment = await request('/api/v1/admin/features/fulfilment', {
    method: 'POST', headers: { 'x-expert-admin-key': adminKey },
    body: JSON.stringify({ type: 'airtime', id: airtime.body.request.id, status: 'delivered' })
  });
  assert.equal(unreferencedFulfilment.status, 400);
  const fulfilment = await request('/api/v1/admin/features/fulfilment', {
    method: 'POST', headers: { 'x-expert-admin-key': adminKey },
    body: JSON.stringify({ type: 'airtime', id: airtime.body.request.id, status: 'delivered', supplierReference: 'TEST-SUPPLIER-REF-2026', message: 'Test only: supplier confirmation recorded.' })
  });
  assert.equal(fulfilment.status, 200);
  assert.equal(fulfilment.body.record.status, 'delivered');
  assert.equal(fulfilment.body.record.supplierReference, 'TEST-SUPPLIER-REF-2026');
  const fulfilmentAgain = await request('/api/v1/admin/features/fulfilment', {
    method: 'POST', headers: { 'x-expert-admin-key': adminKey },
    body: JSON.stringify({ type: 'airtime', id: airtime.body.request.id, status: 'delivered' })
  });
  assert.equal(fulfilmentAgain.status, 409);

});

test('unsigned or unconfigured provider callbacks cannot create live service', async () => {
  const esim = await request('/api/v1/global-esim/webhook', {
    method: 'POST',
    headers: { 'x-expert-signature': 'deadbeef' },
    body: JSON.stringify({ type: 'esim.profile.issued', reference: 'not-a-real-order', data: { activationCode: 'LPA:1$example' } })
  });
  assert.equal(esim.status, 401);

  const pay = await request('/api/v1/payments/paystack/webhook', {
    method: 'POST',
    body: JSON.stringify({ event: 'charge.success', data: { reference: 'not-real' } })
  });
  assert.equal(pay.status, 410);

  const kyc = await request('/api/v1/kyc/webhook', {
    method: 'POST',
    headers: { 'x-kyc-signature': 'deadbeef' },
    body: JSON.stringify({ event: 'subscriber.kyc.verified', data: { subscriberReference: 'not-real' } })
  });
  assert.equal(kyc.status, 503);
});

test('GENIEX-style client routes expose only real provider readiness', async () => {
  const status = await request('/api/v1/geniex/status');
  assert.equal(status.status, 200);
  assert.equal(status.body.networkProviderConfigured, false);
  assert.equal(status.body.dataCatalogueConfigured, false);
  assert.equal(status.body.usageFeedConfigured, false);
  assert.equal(status.body.walletProviderConfigured, false);
  assert.equal(status.body.sponsorProviderConfigured, false);

  const catalog = await request('/api/v1/geniex/catalog');
  assert.equal(catalog.status, 200);
  assert.deepEqual(catalog.body.plans, []);
  assert.deepEqual(catalog.body.bundles, []);

  const usage = await request('/api/v1/geniex/usage');
  assert.equal(usage.status, 200);
  assert.equal(usage.body.usage.available, false);

  const anonymousConnect = await request('/api/v1/geniex/connect', { method: 'POST', body: '{}' });
  assert.equal(anonymousConnect.status, 401);
  const connect = await request('/api/v1/geniex/connect', { method: 'POST', headers: authHeaders(), body: '{}' });
  assert.equal(connect.status, 503);
  assert.equal(connect.body.connected, false);

  const recharge = await request('/api/v1/geniex/balance/recharge', { method: 'POST', headers: authHeaders(), body: '{}' });
  assert.equal(recharge.status, 503);
  const ads = await request('/api/v1/geniex/ad-reward/claim', { method: 'POST', headers: authHeaders(), body: '{}' });
  assert.equal(ads.status, 503);
  const sponsorOffers = await request('/api/v1/geniex/sponsor/offers');
  assert.equal(sponsorOffers.status, 200);
  assert.deepEqual(sponsorOffers.body.offers, []);
  assert.equal(sponsorOffers.body.rewardedAdsConfigured, false);

  for (const route of [
    '/api/v1/geniex/balance/account',
    '/api/v1/geniex/balance/pin/setup',
    '/api/v1/geniex/balance/pin/reset',
    '/api/v1/geniex/balance/unfreeze'
  ]) {
    const response = await request(route, { method: 'POST', headers: authHeaders(), body: '{}' });
    assert.equal(response.status, 503, route);
  }
});

test('customer UI follows the migrated APK country and plan flow while retaining same-origin features', () => {
  const mainHtml = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const appJs = fs.readFileSync(path.join(root, 'public/geniex-app.js'), 'utf8');
  const appCss = fs.readFileSync(path.join(root, 'public/geniex.css'), 'utf8');
  const serviceWorker = fs.readFileSync(path.join(root, 'public/sw.js'), 'utf8');
  assert.match(mainHtml, /geniex-app\.js/);
  assert.match(mainHtml, /geniex\.css/);
  assert.doesNotMatch(mainHtml, /account\.js|expert-features\.js|Activate eSIM|My eSIM/);
  assert.doesNotThrow(() => new Function(appJs));
  assert.doesNotMatch(appJs, /https?:\/\//);
  assert.doesNotMatch(appJs, /ExpertESimNative|onExpertEsimNativeResult/);
  assert.match(appJs, /ExpertMobileNative/);
  assert.match(appJs, /sponsorsPage/);
  assert.match(appJs, /balance-pin-setup/);
  assert.match(appJs, /speed-boost/);
  assert.match(appJs, /Data Bundles/);
  assert.match(appJs, /App Bundles/);
  assert.match(appJs, /Network Analyzer/);
  assert.match(appJs, /setPreferredNetwork/);
  assert.match(appJs, /Battery & Device Info/);
  const androidSource = fs.readFileSync(path.join(root, 'android/app/src/main/java/com/expertesim/app/MainActivity.kt'), 'utf8');
  assert.match(androidSource, /ExpertMobileBridge/);
  assert.doesNotMatch(androidSource, /downloadProfile|switchToSubscription|downloadSubscription/);
  const androidManifest = fs.readFileSync(path.join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
  assert.match(androidManifest, /android:label="Expert eSIM"/);
  assert.match(appJs, /api\/v1\/tools\/speedtest/);
  assert.match(appJs, /function countriesPage/);
  assert.match(appJs, /function countryPlansPage/);
  assert.match(appJs, /function morePage/);
  assert.match(appJs, /select-country/);
  assert.match(appCss, /country-row/);
  assert.match(appCss, /plan-option/);
  assert.match(serviceWorker, /geniex-app\.js/);
  assert.doesNotMatch(serviceWorker, /account\.js|expert-features\.js/);

  const adminHtml = fs.readFileSync(path.join(root, 'public/admin.html'), 'utf8');
  assert.match(adminHtml, /Supplier \/ sponsor transaction reference/);
  const adminScript = adminHtml.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(adminScript, 'admin script exists');
  assert.doesNotThrow(() => new Function(adminScript[1]));

  const legal = fs.readFileSync(path.join(root, 'public/legal.html'), 'utf8');
  assert.match(legal, /PRE-LAUNCH DRAFT/);
  assert.match(legal, /Privacy Notice/);
});
