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
    body: JSON.stringify({ clientDeviceId: 'device_test_reference_000001', deviceName: 'Test phone', platform: 'android', model: 'Test model' })
  });
  assert.equal(addedDevice.status, 201);
  const devices = await request('/api/v1/devices', { headers: authHeaders() });
  assert.equal(devices.status, 200);
  assert.equal(devices.body.devices.length, 1);
  const blockedProfile = await request('/api/v1/devices/' + addedDevice.body.device.id + '/profile', { method: 'POST', headers: authHeaders() });
  assert.equal(blockedProfile.status, 202);
  assert.equal(blockedProfile.body.profile.status, 'awaiting_verification');

  assert.equal(Array.isArray(me.body.tickets), true);
  assert.equal(Array.isArray(me.body.privacyRequests), true);
  assert.equal(me.body.readiness.identityProviderConfigured, false);
  const staticScript = fs.readFileSync(path.join(root, 'public/account.js'), 'utf8');
  assert.match(staticScript, /portalAuth/);
  assert.doesNotThrow(() => new Function(staticScript));
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
  assert.equal(dashboard.body.dashboard.totals.registeredDevices, 1);
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

test('unsigned or unconfigured provider callbacks cannot create live service', async () => {
  const esim = await request('/api/v1/provider/webhook', {
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

test('the subscriber UI hides authentication when a session exists and keeps it available for signed-out users', () => {
  const accountJs = fs.readFileSync(path.join(root, 'public/account.js'), 'utf8');
  assert.match(accountJs, /#activateView \[hidden\]\{display:none!important\}/);
  assert.match(accountJs, /portalAuth"\)\.hidden = true/);
  assert.match(accountJs, /portalMember"\)\.hidden = false/);
  assert.match(accountJs, /portalChecking"\)\.hidden = false/);
  assert.match(accountJs, /credentials:"same-origin"/);

  const mainHtml = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const inline = mainHtml.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(inline, 'main inline script exists');
  assert.doesNotThrow(() => new Function(inline[1]));
  assert.match(mainHtml, /<script src="\/account\.js"><\/script>/);

  const adminHtml = fs.readFileSync(path.join(root, 'public/admin.html'), 'utf8');
  const adminScript = adminHtml.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(adminScript, 'admin script exists');
  assert.doesNotThrow(() => new Function(adminScript[1]));

  const legal = fs.readFileSync(path.join(root, 'public/legal.html'), 'utf8');
  assert.match(legal, /PRE-LAUNCH DRAFT/);
  assert.match(legal, /Privacy Notice/);
});
