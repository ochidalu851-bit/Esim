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
const base = 'http://127.0.0.1:' + port;

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
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

async function json(route, options = {}) {
  const response = await fetch(base + route, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  return { status: response.status, body: await response.json() };
}

test('health reports the persistent store and provider remains unconfigured', async () => {
  const result = await json('/health');
  assert.equal(result.status, 200);
  assert.equal(result.body.persistentStoreReady, true);
  assert.equal(result.body.provider.adapterConfigured, false);
});

test('subscriber can register, sign in, access account and sign out', async () => {
  const created = await json('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({ fullName: 'Test Subscriber', email: 'subscriber@example.com', phone: '+2348000000000', password: 'a-strong-test-password' })
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.user.email, 'subscriber@example.com');
  assert.equal(typeof created.body.token, 'string');
  assert.equal(Object.hasOwn(created.body.user, 'passwordHash'), false);

  const token = created.body.token;
  const account = await json('/api/v1/me', { headers: { authorization: 'Bearer ' + token } });
  assert.equal(account.status, 200);
  assert.equal(account.body.user.fullName, 'Test Subscriber');

  const login = await json('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'subscriber@example.com', password: 'a-strong-test-password' })
  });
  assert.equal(login.status, 200);
  assert.ok(login.body.token);

  const logout = await json('/api/v1/auth/logout', { method: 'POST', headers: { authorization: 'Bearer ' + token } });
  assert.equal(logout.status, 200);
  const expired = await json('/api/v1/me', { headers: { authorization: 'Bearer ' + token } });
  assert.equal(expired.status, 401);
});

test('data catalogue is empty until partner-enabled packages are published', async () => {
  const result = await json('/api/v1/plans');
  assert.equal(result.status, 200);
  assert.equal(result.body.plans.length, 0);
  assert.equal(result.body.availability, 'awaiting-network-partner');
});

test('admin endpoints reject unauthorised access and save plans as draft', async () => {
  const rejected = await json('/api/v1/admin/dashboard');
  assert.equal(rejected.status, 401);

  const dashboard = await json('/api/v1/admin/dashboard', { headers: { 'x-expert-admin-key': adminKey } });
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.body.dashboard.totals.subscribers, 1);

  const plan = await json('/api/v1/admin/plans', {
    method: 'POST',
    headers: { 'x-expert-admin-key': adminKey },
    body: JSON.stringify({ name: 'Test 3 GB', dataMb: 3072, validityDays: 30, priceMinor: 100000, currency: 'NGN', networkModes: ['auto', '4g', '5g'] })
  });
  assert.equal(plan.status, 201);
  assert.equal(plan.body.plan.status, 'draft');

  const publish = await json('/api/v1/admin/plans/' + plan.body.plan.id + '/publish', {
    method: 'POST',
    headers: { 'x-expert-admin-key': adminKey }
  });
  assert.equal(publish.status, 409);
});

test('provider webhook requires a valid signature', async () => {
  const result = await json('/api/v1/provider/webhook', {
    method: 'POST',
    headers: { 'x-expert-signature': 'deadbeef' },
    body: JSON.stringify({ type: 'esim.profile.issued', reference: 'not-a-real-order', data: { activationCode: 'LPA:1$example' } })
  });
  assert.equal(result.status, 401);
});

test('front-end and admin JavaScript parse successfully', () => {
  const mainHtml = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
  const inline = mainHtml.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(inline, 'main inline script exists');
  assert.doesNotThrow(() => new Function(inline[1]));
  const accountJs = fs.readFileSync(path.join(root, 'public/account.js'), 'utf8');
  assert.doesNotThrow(() => new Function(accountJs));
  const adminHtml = fs.readFileSync(path.join(root, 'public/admin.html'), 'utf8');
  const adminScript = adminHtml.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(adminScript, 'admin script exists');
  assert.doesNotThrow(() => new Function(adminScript[1]));
});
