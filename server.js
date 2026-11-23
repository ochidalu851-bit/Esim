'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createGlobalEsim } = require('./global-esim');

const PORT = Number(process.env.PORT || 8080);
const PUBLIC_DIR = path.resolve(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || '/data';
const STORE_FILE = path.join(DATA_DIR, 'expert-esim-store.json');
const MAX_BODY = 65536;
const SESSION_DAYS = 30;
let writeQueue = Promise.resolve();

function emptyStore() {
  return { version: 1, users: [], sessions: [], plans: [], orders: [], devices: [], profiles: [], audit: [], providerEvents: [], paymentEvents: [], consents: [], supportTickets: [], privacyRequests: [] };
}
function normalizeStore(store) {
  for (const key of ['users','sessions','plans','orders','devices','profiles','audit','providerEvents','paymentEvents','consents','supportTickets','privacyRequests']) {
    if (!Array.isArray(store[key])) store[key] = [];
  }
  for (const user of store.users) {
    if (!user.kycStatus) user.kycStatus = 'not_started';
    if (typeof user.emailVerified !== 'boolean') user.emailVerified = false;
  }
  for (const order of store.orders) {
    if (!order.paymentStatus) order.paymentStatus = Number(order.priceMinor || 0) > 0 ? 'pending' : 'paid';
  }
  return store;
}
async function loadStore() {
  await writeQueue.catch(() => {});
  try {
    const value = JSON.parse(await fsp.readFile(STORE_FILE, 'utf8'));
    if (!value || value.version !== 1) throw new Error('Unsupported subscriber store version');
    return normalizeStore(value);
  } catch (error) {
    if (error.code === 'ENOENT') return emptyStore();
    throw error;
  }
}
function transact(action) {
  const task = writeQueue.then(async () => {
    let store;
    try { store = JSON.parse(await fsp.readFile(STORE_FILE, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; store = emptyStore(); }
    normalizeStore(store);
    const result = await action(store);
    await fsp.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
    const temp = STORE_FILE + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
    await fsp.writeFile(temp, JSON.stringify(store), { mode: 0o600 });
    await fsp.rename(temp, STORE_FILE);
    return result;
  });
  writeQueue = task.catch(() => {});
  return task;
}
function send(res, status, value, extraHeaders = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
    ...extraHeaders
  });
  res.end(JSON.stringify(value));
}
function fail(res, error) {
  const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
  if (status >= 500) console.error('Expert eSIM API error:', error.message);
  send(res, status, { ok: false, error: status >= 500 ? 'The server could not complete the request.' : error.message });
}
async function rawBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('Request body is too large.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function body(req) {
  const raw = await rawBody(req);
  if (!raw.length) return {};
  try { return JSON.parse(raw.toString('utf8')); }
  catch { throw Object.assign(new Error('Request body must be valid JSON.'), { statusCode: 400 }); }
}
function equal(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
const SESSION_COOKIE = 'expert_esim_session';
function cookieValue(req, name) {
  const raw = String(req.headers.cookie || '');
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return '';
}
function tokenFrom(req) {
  const value = String(req.headers.authorization || '');
  if (value.startsWith('Bearer ')) return value.slice(7).trim();
  return cookieValue(req, SESSION_COOKIE);
}
function sessionCookie(token, maxAge = SESSION_DAYS * 86400) {
  return SESSION_COOKIE + '=' + encodeURIComponent(token) + '; Path=/; Max-Age=' + maxAge + '; Secure; HttpOnly; SameSite=Strict';
}
function clearSessionCookie() {
  return SESSION_COOKIE + '=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict';
}
const rateBuckets = new Map();
function rateLimit(req, key, limit, windowMs) {
  const now = Date.now();
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  const bucketKey = key + ':' + ip;
  const current = rateBuckets.get(bucketKey);
  if (!current || now - current.startedAt >= windowMs) {
    rateBuckets.set(bucketKey, { startedAt: now, count: 1 });
    return;
  }
  current.count += 1;
  if (current.count > limit) throw Object.assign(new Error('Too many attempts. Please wait before trying again.'), { statusCode: 429 });
  if (rateBuckets.size > 5000) {
    for (const entry of rateBuckets.keys()) if (now - rateBuckets.get(entry).startedAt > 3600000) rateBuckets.delete(entry);
  }
}
function enforceSameOrigin(req) {
  const origin = String(req.headers.origin || '');
  if (!origin) return;
  const host = String(req.headers.host || '');
  const protocol = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  if (origin !== protocol + '://' + host) throw Object.assign(new Error('Cross-site request rejected.'), { statusCode: 403 });
}
function adminOk(req) {
  const secret = process.env.EXPERT_ESIM_ADMIN_KEY || '';
  return Boolean(secret) && equal(req.headers['x-expert-admin-key'] || tokenFrom(req), secret);
}
function providerStatus() {
  let profileUrlValid = false, identityUrlValid = false;
  try { profileUrlValid = new URL(process.env.GLOBAL_ESIM_PROFILE_API_URL || '').protocol === 'https:'; } catch {}
  try { identityUrlValid = new URL(process.env.GLOBAL_IDENTITY_PROVIDER_START_URL || '').protocol === 'https:'; } catch {}
  return {
    profileProviderConfigured: profileUrlValid && Boolean(process.env.GLOBAL_ESIM_PROFILE_API_KEY) && Boolean(encryptionKey()),
    webhookConfigured: Boolean(process.env.ESIM_PROVIDER_WEBHOOK_SECRET),
    profileEncryptionConfigured: Boolean(encryptionKey()),
    globalConnectivityPartnerConfigured: Boolean(process.env.GLOBAL_CONNECTIVITY_PROVIDER_NAME) && process.env.GLOBAL_CONNECTIVITY_AGREEMENT_ACTIVE === 'true',
    globalCoverageConfirmed: process.env.GLOBAL_ESIM_GLOBAL_COVERAGE_CONFIRMED === 'true',
    unlimitedDataContractConfirmed: process.env.GLOBAL_ESIM_UNLIMITED_DATA_CONFIRMED === 'true',
    smdpPartnerConfigured: process.env.SMDP_PARTNER_ACTIVE === 'true',
    serviceEnabled: process.env.EXPERT_ESIM_SERVICE_ENABLED === 'true',
    identityProviderConfigured: identityUrlValid && Boolean(process.env.GLOBAL_IDENTITY_PROVIDER_API_KEY) && Boolean(process.env.GLOBAL_IDENTITY_PROVIDER_WEBHOOK_SECRET),
    emailDeliveryConfigured: Boolean(process.env.RESEND_API_KEY) && Boolean(process.env.EXPERT_ESIM_EMAIL_FROM),
    privacyGovernanceReady: process.env.PRIVACY_GOVERNANCE_READY === 'true',
    consumerSupportReady: process.env.CONSUMER_SUPPORT_READY === 'true',
    connectivityProviderName: process.env.GLOBAL_CONNECTIVITY_PROVIDER_NAME || null
  };
}
function readyToProvisionGlobally() {
  const p = providerStatus();
  return p.profileProviderConfigured && p.webhookConfigured && p.globalConnectivityPartnerConfigured &&
    p.globalCoverageConfirmed && p.unlimitedDataContractConfirmed && p.smdpPartnerConfigured &&
    p.serviceEnabled && p.privacyGovernanceReady && p.consumerSupportReady;
}
function readyToSell() { return readyToProvisionGlobally(); }
function encryptionKey() {
  const text = process.env.ESIM_PROFILE_ENCRYPTION_KEY || '';
  if (!text) return null;
  try {
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
    const key = Buffer.from(b64 + '='.repeat((4 - b64.length % 4) % 4), 'base64');
    return key.length === 32 ? key : null;
  } catch { return null; }
}
function encryptSecret(value) {
  const key = encryptionKey();
  if (!key) throw new Error('Profile encryption is not configured.');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return iv.toString('base64url') + '.' + cipher.getAuthTag().toString('base64url') + '.' + encrypted.toString('base64url');
}
function decryptSecret(value) {
  const key = encryptionKey();
  if (!key) throw new Error('Profile encryption is not configured.');
  const parts = String(value || '').split('.');
  if (parts.length !== 3) throw new Error('Stored profile is invalid.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parts[0], 'base64url'));
  decipher.setAuthTag(Buffer.from(parts[1], 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(parts[2], 'base64url')), decipher.final()]).toString('utf8');
}
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const options = { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
  return 'scrypt-v2:' + salt + ':' + crypto.scryptSync(password, salt, 64, options).toString('hex');
}
function verifyPassword(password, stored) {
  const pieces = String(stored || '').split(':');
  if (pieces.length === 3 && pieces[0] === 'scrypt-v2' && /^[a-f0-9]{32}$/.test(pieces[1])) {
    const actual = crypto.scryptSync(String(password || ''), pieces[1], 64, { N: 32768, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }).toString('hex');
    return equal(actual, pieces[2]);
  }
  if (pieces.length === 2) return equal(crypto.scryptSync(String(password || ''), pieces[0], 64).toString('hex'), pieces[1]);
  return false;
}
function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
const globalEsim = createGlobalEsim({
  loadStore, transact, hashToken, encryptSecret, decryptSecret,
  isReady: readyToProvisionGlobally
});
function userView(user) {
  return { id: user.id, fullName: user.fullName, email: user.email, phone: user.phone || null, kycStatus: user.kycStatus || 'not_started', emailVerified: Boolean(user.emailVerified), createdAt: user.createdAt };
}
function orderView(order) {
  return {
    id: order.id, reference: order.reference, planId: order.planId, planName: order.planName,
    dataMb: order.dataMb, validityDays: order.validityDays, priceMinor: order.priceMinor,
    currency: order.currency, preferredNetwork: order.preferredNetwork, status: order.status,
    paymentStatus: order.paymentStatus || 'pending', paymentReference: order.paymentReference || null,
    providerOrderId: order.providerOrderId || null, message: order.message,
    createdAt: order.createdAt, updatedAt: order.updatedAt,
    profileIssuedAt: order.profileIssuedAt || null, activatedAt: order.activatedAt || null
  };
}
async function currentUser(req) {
  const token = tokenFrom(req);
  if (!token) return null;
  const store = await loadStore();
  const session = store.sessions.find(x => x.tokenHash === hashToken(token) && Date.parse(x.expiresAt) > Date.now());
  if (!session) return null;
  const user = store.users.find(x => x.id === session.userId && x.status === 'active');
  return user || null;
}
async function signedIn(req) {
  const user = await currentUser(req);
  if (!user) throw Object.assign(new Error('Sign in to continue.'), { statusCode: 401 });
  return user;
}
function refCode() {
  return 'EXSIM-' + new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14) + '-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}
async function createSession(store, user) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  store.sessions = store.sessions.filter(x => Date.parse(x.expiresAt) > now.getTime());
  store.sessions.push({
    id: crypto.randomUUID(), userId: user.id, tokenHash: hashToken(token),
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + SESSION_DAYS * 86400000).toISOString()
  });
  return token;
}
async function register(bodyData) {
  const email = String(bodyData.email || '').trim().toLowerCase();
  const fullName = String(bodyData.fullName || '').trim();
  const password = String(bodyData.password || '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Object.assign(new Error('Enter a valid email address.'), { statusCode: 400 });
  if (fullName.length < 2 || fullName.length > 120) throw Object.assign(new Error('Enter your full name.'), { statusCode: 400 });
  if (password.length < 10 || password.length > 256) throw Object.assign(new Error('Choose a password with at least 10 characters.'), { statusCode: 400 });
  const phone = String(bodyData.phone || '').trim();
  return transact(async store => {
    if (store.users.some(x => x.email === email)) throw Object.assign(new Error('An account with this email already exists.'), { statusCode: 409 });
    if (bodyData.acceptedTerms !== true || bodyData.acceptedPrivacy !== true) throw Object.assign(new Error('Accept the Terms and Privacy Notice to create your account.'), { statusCode: 400 });
    const now = new Date().toISOString();
    const user = {
      id: crypto.randomUUID(), fullName, email, phone,
      passwordHash: hashPassword(password), status: 'active', kycStatus: 'not_started', emailVerified: false,
      createdAt: now
    };
    store.users.push(user);
    store.consents.push({ id: crypto.randomUUID(), userId: user.id, type: 'terms-and-privacy', termsVersion: '1.0', privacyVersion: '1.0', acceptedAt: now, retentionUntil: new Date(Date.now() + 2 * 365 * 86400000).toISOString() });
    store.audit.push({ id: crypto.randomUUID(), event: 'subscriber.registered', subject: user.id, at: now });
    store.audit.push({ id: crypto.randomUUID(), event: 'subscriber.terms_privacy_accepted', subject: user.id, at: now });
    return { user: userView(user), token: await createSession(store, user) };
  });
}
async function login(data) {
  const email = String(data.email || '').trim().toLowerCase();
  const snapshot = await loadStore();
  const found = snapshot.users.find(x => x.email === email && x.status === 'active');
  if (!found || !verifyPassword(String(data.password || ''), found.passwordHash)) throw Object.assign(new Error('Email or password is incorrect.'), { statusCode: 401 });
  return transact(async store => {
    const user = store.users.find(x => x.id === found.id && x.status === 'active');
    if (!user) throw Object.assign(new Error('This account is unavailable.'), { statusCode: 403 });
    store.audit.push({ id: crypto.randomUUID(), event: 'subscriber.login', subject: user.id, at: new Date().toISOString() });
    return { user: userView(user), token: await createSession(store, user) };
  });
}
async function publishPlan(planId) {
  if (!readyToSell()) throw Object.assign(new Error('Required connectivity agreements, profile provisioning, identity checks where applicable, privacy controls and support must be confirmed before profile issuance.'), { statusCode: 409 });
  return transact(store => {
    const plan = store.plans.find(x => x.id === planId);
    if (!plan) throw Object.assign(new Error('Plan not found.'), { statusCode: 404 });
    if (plan.priceMinor > 0 && (!providerStatus().paystackConfigured)) throw Object.assign(new Error('Configure Paystack payments and signed payment webhooks before publishing a paid package.'), { statusCode: 409 });
    plan.status = 'published'; plan.updatedAt = new Date().toISOString();
    store.audit.push({ id: crypto.randomUUID(), event: 'plan.published', subject: plan.id, at: plan.updatedAt });
    return { id: plan.id, name: plan.name, status: plan.status };
  });
}
async function createPlan(data) {
  const name = String(data.name || '').trim();
  const dataMb = Number(data.dataMb);
  const validityDays = Number(data.validityDays);
  const priceMinor = Number(data.priceMinor);
  const currency = String(data.currency || 'USD').toUpperCase();
  if (name.length < 2 || name.length > 80) throw Object.assign(new Error('Enter a plan name between 2 and 80 characters.'), { statusCode: 400 });
  if (!Number.isInteger(dataMb) || dataMb < 1) throw Object.assign(new Error('Data allowance must be a positive number of MB.'), { statusCode: 400 });
  if (!Number.isInteger(validityDays) || validityDays < 1 || validityDays > 3650) throw Object.assign(new Error('Validity must be between 1 and 3650 days.'), { statusCode: 400 });
  if (!Number.isSafeInteger(priceMinor) || priceMinor < 0) throw Object.assign(new Error('Price must be provided in minor currency units.'), { statusCode: 400 });
  if (!/^[A-Z]{3}$/.test(currency)) throw Object.assign(new Error('Currency must be an ISO code.'), { statusCode: 400 });
  const supported = Array.isArray(data.networkModes) ? data.networkModes.filter(x => ['auto', '4g', '5g'].includes(x)) : ['auto', '4g', '5g'];
  return transact(store => {
    const now = new Date().toISOString();
    const plan = {
      id: crypto.randomUUID(), name, description: String(data.description || '').slice(0, 500),
      dataMb, validityDays, priceMinor, currency,
      networkModes: [...new Set(supported.length ? supported : ['auto'])],
      status: 'draft', createdAt: now, updatedAt: now
    };
    store.plans.push(plan);
    store.audit.push({ id: crypto.randomUUID(), event: 'plan.created', subject: plan.id, at: now });
    return plan;
  });
}
async function providerProvision(order, user, plan) {
  const response = await fetch(process.env.ESIM_PROVIDER_CREATE_ORDER_URL, {
    method: 'POST',
    headers: {
      authorization: 'Bearer ' + process.env.ESIM_PROVIDER_API_KEY,
      'content-type': 'application/json',
      accept: 'application/json',
      'idempotency-key': order.reference
    },
    body: JSON.stringify({
      reference: order.reference,
      customer: { customerReference: user.id, name: user.fullName, email: user.email, phone: user.phone || undefined },
      plan: { planReference: plan.id, name: plan.name, dataMb: plan.dataMb, validityDays: plan.validityDays, priceMinor: plan.priceMinor, currency: plan.currency },
      preferredNetwork: order.preferredNetwork
    }),
    signal: AbortSignal.timeout(15000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error('eSIM provider responded with HTTP ' + response.status);
  return result;
}
async function attachProviderResult(reference, result) {
  return transact(store => {
    const order = store.orders.find(x => x.reference === reference);
    if (!order) throw Object.assign(new Error('eSIM order not found.'), { statusCode: 404 });
    const activationCode = result && (result.activationCode || (result.profile && result.profile.activationCode));
    order.providerOrderId = (result && (result.providerOrderId || result.orderId)) || order.providerOrderId || null;
    const now = new Date().toISOString();
    if (activationCode) {
      order.encryptedActivationCode = encryptSecret(String(activationCode));
      if (result.confirmationCode) order.encryptedConfirmationCode = encryptSecret(String(result.confirmationCode));
      order.status = 'profile_issued';
      order.profileIssuedAt = now;
      order.message = 'The authorised provider issued your Expert eSIM profile. Install it from My eSIM.';
    } else if (result && ['failed', 'rejected'].includes(result.status)) {
      order.status = 'provider_error';
      order.message = 'The provider rejected the provisioning request. No profile was issued.';
    } else {
      order.status = 'provisioning';
      order.message = 'Provider accepted the request. Waiting for the secure profile-issued callback.';
    }
    order.updatedAt = now;
    store.audit.push({ id: crypto.randomUUID(), event: 'provider.provisioning_result', subject: order.id, at: now });
    return orderView(order);
  });
}
async function startOrderProvisioning(orderId) {
  const snapshot = await loadStore();
  const found = snapshot.orders.find(item => item.id === orderId);
  if (!found) throw Object.assign(new Error('eSIM order not found.'), { statusCode: 404 });
  if (found.paymentStatus !== 'paid') throw Object.assign(new Error('Payment must be verified before a profile is provisioned.'), { statusCode: 409 });
  if (!readyToSell()) {
    await transact(store => {
      const order = store.orders.find(item => item.id === orderId);
      if (order) {
        order.status = 'awaiting_partner';
        order.message = 'Payment is verified. Waiting for the authorised host network and SM-DP+ provider before issuing your profile.';
        order.updatedAt = new Date().toISOString();
      }
    });
    return;
  }
  const order = snapshot.orders.find(item => item.id === orderId);
  const user = snapshot.users.find(item => item.id === order.userId);
  const plan = snapshot.plans.find(item => item.id === order.planId);
  if (!user || !plan) throw new Error('Order subscriber or plan record is unavailable.');
  if (user.kycStatus !== 'verified') throw Object.assign(new Error('Telecom identity verification must be confirmed before provisioning.'), { statusCode: 409 });
  await transact(store => {
    const current = store.orders.find(item => item.id === orderId);
    if (current) {
      current.status = 'provisioning';
      current.message = 'Payment and identity checks are confirmed. Submitting your subscription to the authorised eSIM provider.';
      current.updatedAt = new Date().toISOString();
    }
  });
  try {
    const result = await providerProvision(order, user, plan);
    await attachProviderResult(order.reference, result);
  } catch (error) {
    await transact(store => {
      const current = store.orders.find(item => item.id === orderId);
      if (current) {
        current.status = 'provider_error';
        current.message = 'The authorised eSIM provider did not accept the provisioning request. No profile was issued.';
        current.updatedAt = new Date().toISOString();
      }
      store.audit.push({ id: crypto.randomUUID(), event: 'esim.provider_request_failed', subject: orderId, at: new Date().toISOString() });
    });
    throw error;
  }
}
async function createOrder(user, data) {
  if (!user.emailVerified) throw Object.assign(new Error('Verify your email address before ordering mobile service.'), { statusCode: 403 });
  if (user.kycStatus !== 'verified') throw Object.assign(new Error('Complete the authorised subscriber identity verification before ordering an eSIM.'), { statusCode: 403 });
  const snapshot = await loadStore();
  const plan = snapshot.plans.find(x => x.id === String(data.planId || '') && x.status === 'published');
  if (!plan) throw Object.assign(new Error('This data package is not available.'), { statusCode: 404 });
  const preferredNetwork = String(data.preferredNetwork || 'auto');
  if (!['auto', '4g', '5g'].includes(preferredNetwork)) throw Object.assign(new Error('Select Automatic, 4G or 5G.'), { statusCode: 400 });
  if (!plan.networkModes.includes(preferredNetwork) && !plan.networkModes.includes('auto')) throw Object.assign(new Error('This plan does not support the selected network mode.'), { statusCode: 400 });
  const now = new Date().toISOString();
  const paid = Number(plan.priceMinor) === 0;
  const order = {
    id: crypto.randomUUID(), reference: refCode(), userId: user.id, planId: plan.id,
    planName: plan.name, dataMb: plan.dataMb, validityDays: plan.validityDays,
    priceMinor: plan.priceMinor, currency: plan.currency, preferredNetwork,
    paymentStatus: paid ? 'paid' : 'pending',
    paymentReference: null,
    status: paid ? (readyToSell() ? 'provisioning' : 'awaiting_partner') : 'awaiting_payment',
    providerOrderId: null, encryptedActivationCode: null, encryptedConfirmationCode: null,
    message: paid
      ? (readyToSell() ? 'Order is being submitted for eSIM provisioning.' : 'The order is recorded. Live eSIM provisioning is waiting for the authorised host-network and SM-DP+ partners.')
      : 'Your eSIM order is awaiting payment. After payment is verified, provisioning will continue when the required host-network and eSIM partners are connected.',
    createdAt: now, updatedAt: now
  };
  await transact(store => {
    store.orders.push(order);
    store.audit.push({ id: crypto.randomUUID(), event: 'esim.order.created', subject: order.id, at: now });
  });
  if (paid && readyToSell()) {
    try { await startOrderProvisioning(order.id); } catch {}
  }
  const current = await loadStore();
  return orderView(current.orders.find(x => x.id === order.id));
}
async function initializePaystackPayment(user, orderId) {
  if (!process.env.PAYSTACK_SECRET_KEY || !process.env.PAYSTACK_WEBHOOK_SECRET) throw Object.assign(new Error('Paystack is not configured yet. Payments are not enabled.'), { statusCode: 503 });
  const snapshot = await loadStore();
  const order = snapshot.orders.find(x => x.id === orderId && x.userId === user.id);
  if (!order) throw Object.assign(new Error('eSIM order not found.'), { statusCode: 404 });
  if (order.paymentStatus === 'paid') throw Object.assign(new Error('This order has already been paid.'), { statusCode: 409 });
  if (!Number.isSafeInteger(order.priceMinor) || order.priceMinor < 1) throw Object.assign(new Error('This order does not require payment.'), { statusCode: 400 });
  const reference = 'EXPAY-' + crypto.randomBytes(16).toString('hex').toUpperCase();
  const callbackUrl = (process.env.EXPERT_ESIM_PUBLIC_URL || 'https://' + (process.env.RAILWAY_PUBLIC_DOMAIN || 'expert-esim-web-production.up.railway.app')) + '/?payment_return=1';
  const response = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + process.env.PAYSTACK_SECRET_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      email: user.email, amount: order.priceMinor, currency: order.currency, reference,
      callback_url: callbackUrl,
      metadata: { orderId: order.id, orderReference: order.reference, customerId: user.id }
    }),
    signal: AbortSignal.timeout(15000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.status !== true || !result.data || !result.data.authorization_url) throw Object.assign(new Error('Paystack could not initialise this payment.'), { statusCode: 502 });
  await transact(store => {
    const current = store.orders.find(x => x.id === order.id && x.userId === user.id);
    if (!current || current.paymentStatus === 'paid') throw Object.assign(new Error('Order payment state changed.'), { statusCode: 409 });
    current.paymentReference = reference;
    current.paymentStatus = 'pending';
    current.updatedAt = new Date().toISOString();
    store.audit.push({ id: crypto.randomUUID(), event: 'payment.initialized', subject: order.id, at: current.updatedAt });
  });
  return { authorizationUrl: result.data.authorization_url, accessCode: result.data.access_code, reference, amount: order.priceMinor, currency: order.currency };
}
function verifyPaystackSignature(raw, headers) {
  const key = process.env.PAYSTACK_WEBHOOK_SECRET || '';
  if (!key) return false;
  const modern = String(headers['paystack-signature'] || '');
  if (modern) {
    const fields = modern.split(',').map(x => x.trim());
    const timestampField = fields.find(x => x.startsWith('t='));
    const time = timestampField ? Number(timestampField.slice(2)) : 0;
    if (!time || Math.abs(Date.now() / 1000 - time) > 300) return false;
    const expected = crypto.createHmac('sha512', key).update(String(time) + '.').update(raw).digest('hex');
    const signatures = fields.filter(x => x.startsWith('v1=')).map(x => x.slice(3).split(':').pop());
    return signatures.some(signature => /^[a-f0-9]{128}$/i.test(signature) && equal(expected, signature.toLowerCase()));
  }
  const legacy = String(headers['x-paystack-signature'] || '');
  if (!/^[a-f0-9]{128}$/i.test(legacy)) return false;
  const expected = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY || key).update(raw).digest('hex');
  return equal(expected, legacy.toLowerCase());
}
async function verifyPaystackTransaction(reference) {
  const response = await fetch('https://api.paystack.co/transaction/verify/' + encodeURIComponent(reference), {
    headers: { authorization: 'Bearer ' + process.env.PAYSTACK_SECRET_KEY, accept: 'application/json' },
    signal: AbortSignal.timeout(15000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.status !== true || !result.data) throw new Error('Paystack transaction verification failed.');
  return result.data;
}
async function confirmPaystackPayment(user, orderId) {
  const snapshot = await loadStore();
  const order = snapshot.orders.find(x => x.id === orderId && x.userId === user.id);
  if (!order) throw Object.assign(new Error('eSIM order not found.'), { statusCode: 404 });
  if (order.paymentStatus === 'paid') return orderView(order);
  if (!order.paymentReference) throw Object.assign(new Error('No payment attempt is recorded for this order.'), { statusCode: 409 });
  const verification = await verifyPaystackTransaction(order.paymentReference);
  if (verification.status !== 'success' || Number(verification.amount) !== Number(order.priceMinor) || String(verification.currency) !== String(order.currency) || String(verification.reference) !== String(order.paymentReference)) {
    throw Object.assign(new Error('Paystack has not confirmed a matching successful payment for this order.'), { statusCode: 409 });
  }
  const updated = await transact(store => {
    const current = store.orders.find(x => x.id === order.id && x.userId === user.id);
    if (!current) throw Object.assign(new Error('eSIM order not found.'), { statusCode: 404 });
    if (current.paymentStatus !== 'paid') {
      current.paymentStatus = 'paid';
      current.paidAt = new Date().toISOString();
      current.paymentProvider = 'paystack';
      current.updatedAt = current.paidAt;
      store.paymentEvents.push({ id: crypto.randomUUID(), providerEventId: 'verify:' + order.paymentReference, reference: order.paymentReference, orderId: current.id, receivedAt: current.paidAt });
      store.audit.push({ id: crypto.randomUUID(), event: 'payment.verified_by_customer', subject: current.id, at: current.paidAt });
    }
    return orderView(current);
  });
  await startOrderProvisioning(order.id);
  const latest = await loadStore();
  return orderView(latest.orders.find(x => x.id === order.id) || updated);
}
async function paystackWebhook(raw, headers) {
  if (!verifyPaystackSignature(raw, headers)) throw Object.assign(new Error('Invalid Paystack webhook signature.'), { statusCode: 401 });
  let event;
  try { event = JSON.parse(raw.toString('utf8')); } catch { throw Object.assign(new Error('Webhook body must be valid JSON.'), { statusCode: 400 }); }
  if (event.event !== 'charge.success') return { received: true, ignored: true, event: event.event || 'unknown' };
  const reference = String(event.data && event.data.reference || '');
  if (!reference) throw Object.assign(new Error('Payment reference is missing.'), { statusCode: 400 });
  const verification = await verifyPaystackTransaction(reference);
  const snapshot = await loadStore();
  const order = snapshot.orders.find(x => x.paymentReference === reference);
  if (!order) throw Object.assign(new Error('No Expert eSIM order matches this payment reference.'), { statusCode: 404 });
  if (verification.status !== 'success' || Number(verification.amount) !== Number(order.priceMinor) || String(verification.currency) !== String(order.currency) || String(verification.reference) !== reference) {
    throw Object.assign(new Error('Verified payment does not match the order amount, currency or reference.'), { statusCode: 409 });
  }
  const eventId = String(event.data.id || reference);
  const updated = await transact(store => {
    if (store.paymentEvents.some(item => item.providerEventId === eventId)) {
      const existing = store.orders.find(x => x.id === order.id);
      return { duplicate: true, order: orderView(existing) };
    }
    const current = store.orders.find(x => x.id === order.id);
    if (!current) throw Object.assign(new Error('eSIM order not found.'), { statusCode: 404 });
    current.paymentStatus = 'paid';
    current.paidAt = new Date().toISOString();
    current.paymentProvider = 'paystack';
    current.updatedAt = current.paidAt;
    store.paymentEvents.push({ id: crypto.randomUUID(), providerEventId: eventId, reference, orderId: current.id, receivedAt: current.paidAt });
    store.audit.push({ id: crypto.randomUUID(), event: 'payment.verified', subject: current.id, at: current.paidAt });
    return { duplicate: false, order: orderView(current) };
  });
  if (!updated.duplicate) await startOrderProvisioning(order.id);
  return { received: true, duplicate: updated.duplicate, order: updated.order };
}

async function providerWebhook(raw, signature) {
  const secret = process.env.ESIM_PROVIDER_WEBHOOK_SECRET || '';
  if (!secret) throw Object.assign(new Error('Provider webhook authentication is not configured.'), { statusCode: 503 });
  const expected = crypto.createHmac('sha256', secret).update(raw).digest();
  const supplied = Buffer.from(String(signature || '').replace(/^sha256=/i, '').trim(), 'hex');
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) throw Object.assign(new Error('Invalid provider webhook signature.'), { statusCode: 401 });
  let event;
  try { event = JSON.parse(raw.toString('utf8')); } catch { throw Object.assign(new Error('Webhook body must be valid JSON.'), { statusCode: 400 }); }
  const data = event.data || event;
  const reference = String(data.reference || event.reference || '');
  const type = String(event.type || event.event || '');
  if (!reference) throw Object.assign(new Error('Provider event is missing its Expert eSIM order reference.'), { statusCode: 400 });
  return transact(store => {
    const order = store.orders.find(x => x.reference === reference);
    if (!order) throw Object.assign(new Error('Unknown Expert eSIM order.'), { statusCode: 404 });
    const now = new Date().toISOString();
    const providerEventId = String(event.id || data.eventId || (reference + ':' + type));
    if (store.providerEvents.some(item => item.id === providerEventId)) return { received: true, duplicate: true, reference, status: order.status };
    const subscriber = store.users.find(item => item.id === order.userId);
    if (order.paymentStatus !== 'paid' || !subscriber || subscriber.kycStatus !== 'verified') throw Object.assign(new Error('Payment and authorised subscriber identity verification must be complete before eSIM profile activation.'), { statusCode: 409 });
    if (type === 'esim.profile.issued') {
      if (!data.activationCode) throw Object.assign(new Error('Issued-profile event must contain an activation code.'), { statusCode: 400 });
      order.encryptedActivationCode = encryptSecret(String(data.activationCode));
      if (data.confirmationCode) order.encryptedConfirmationCode = encryptSecret(String(data.confirmationCode));
      order.providerOrderId = data.providerOrderId || order.providerOrderId || null;
      order.status = 'profile_issued'; order.profileIssuedAt = now;
      order.message = 'Your authorised Expert eSIM profile is ready to install.';
    } else if (type === 'esim.profile.activated') {
      if (!order.encryptedActivationCode) throw Object.assign(new Error('The eSIM profile has not been issued.'), { statusCode: 409 });
      order.status = 'active'; order.activatedAt = now;
      order.message = 'The provider confirmed your eSIM subscription is active.';
    } else if (type === 'esim.profile.failed') {
      order.status = 'provider_error'; order.message = 'The provider reported a provisioning failure.';
    } else {
      throw Object.assign(new Error('Unsupported provider event type.'), { statusCode: 400 });
    }
    order.updatedAt = now;
    store.providerEvents.push({ id: providerEventId, reference, type, receivedAt: now });
    store.audit.push({ id: crypto.randomUUID(), event: 'provider.' + type, subject: order.id, at: now });
    return { received: true, duplicate: false, reference, status: order.status };
  });
}
async function profileForUser(userId, orderId) {
  const store = await loadStore();
  const order = store.orders.find(x => x.id === orderId && x.userId === userId);
  if (!order) throw Object.assign(new Error('eSIM order not found.'), { statusCode: 404 });
  if (order.paymentStatus !== 'paid' || !['profile_issued', 'active'].includes(order.status)) throw Object.assign(new Error('Payment and provider profile issuance must both be confirmed before installation.'), { statusCode: 409 });
  return {
    activationCode: decryptSecret(order.encryptedActivationCode),
    confirmationCode: order.encryptedConfirmationCode ? decryptSecret(order.encryptedConfirmationCode) : '',
    reference: order.reference
  };
}
async function sendVerificationEmail(user) {
  if (!providerStatus().emailDeliveryConfigured) return { sent: false, reason: 'email_provider_not_configured' };
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await transact(store => {
    const current = store.users.find(x => x.id === user.id);
    if (!current) throw Object.assign(new Error('Subscriber account not found.'), { statusCode: 404 });
    current.emailVerificationTokenHash = tokenHash;
    current.emailVerificationExpiresAt = expiresAt;
  });
  const base = (process.env.EXPERT_ESIM_PUBLIC_URL || 'https://' + (process.env.RAILWAY_PUBLIC_DOMAIN || 'expert-esim-web-production.up.railway.app')).replace(/\/$/, '');
  const link = base + '/api/v1/auth/verify-email?token=' + encodeURIComponent(token);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + process.env.RESEND_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: process.env.EXPERT_ESIM_EMAIL_FROM,
      to: [user.email],
      subject: 'Verify your Expert eSIM email address',
      html: '<p>Hello ' + String(user.fullName).replace(/[&<>]/g, '') + ',</p><p>Confirm your email address for your Expert eSIM subscriber account.</p><p><a href="' + link + '">Verify email address</a></p><p>This link expires in 60 minutes. If you did not create this account, you can ignore this message.</p>'
    }),
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    await transact(store => {
      const current = store.users.find(x => x.id === user.id);
      if (current) { delete current.emailVerificationTokenHash; delete current.emailVerificationExpiresAt; }
    });
    throw Object.assign(new Error('Email verification could not be sent. Check the configured email sender.'), { statusCode: 502 });
  }
  return { sent: true, expiresAt, providerMessageId: data.id || null };
}
async function verifyEmailToken(token) {
  const tokenHash = hashToken(String(token || ''));
  return transact(store => {
    const user = store.users.find(x => x.emailVerificationTokenHash === tokenHash && x.emailVerificationExpiresAt && Date.parse(x.emailVerificationExpiresAt) > Date.now());
    if (!user) throw Object.assign(new Error('This verification link is invalid or has expired.'), { statusCode: 400 });
    user.emailVerified = true;
    user.emailVerifiedAt = new Date().toISOString();
    delete user.emailVerificationTokenHash;
    delete user.emailVerificationExpiresAt;
    store.audit.push({ id: crypto.randomUUID(), event: 'subscriber.email_verified', subject: user.id, at: user.emailVerifiedAt });
    return userView(user);
  });
}
async function beginKyc(user) {
  if (!providerStatus().identityProviderConfigured) throw Object.assign(new Error('The secure identity-verification partner is not connected yet.'), { statusCode: 503 });
  if (!user.emailVerified) throw Object.assign(new Error('Verify your email address before starting subscriber verification.'), { statusCode: 403 });
  if (user.kycStatus === 'verified') return { verified: true, status: 'verified', message: 'Your identity has already been verified.' };
  const base = (process.env.EXPERT_ESIM_PUBLIC_URL || 'https://' + (process.env.RAILWAY_PUBLIC_DOMAIN || 'expert-esim-web-production.up.railway.app')).replace(/\/$/, '');
  const response = await fetch(process.env.GLOBAL_IDENTITY_PROVIDER_START_URL, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + process.env.GLOBAL_IDENTITY_PROVIDER_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      subscriberReference: user.id,
      customer: { fullName: user.fullName, email: user.email, phone: user.phone || undefined },
      returnUrl: base + '/?kyc=return',
      webhookUrl: base + '/api/v1/kyc/webhook'
    }),
    signal: AbortSignal.timeout(15000)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.verificationUrl || !result.reference) throw Object.assign(new Error('The identity-verification partner did not return a valid secure verification session.'), { statusCode: 502 });
  await transact(store => {
    const current = store.users.find(x => x.id === user.id);
    if (current) {
      current.kycStatus = 'pending';
      current.kycProviderReference = String(result.reference);
      current.kycStartedAt = new Date().toISOString();
    }
    store.audit.push({ id: crypto.randomUUID(), event: 'subscriber.kyc_started', subject: user.id, at: new Date().toISOString() });
  });
  return { status: 'pending', verificationUrl: result.verificationUrl, reference: result.reference, message: 'Continue in the secure identity-verification partner page. Requirements depend on the applicable market and connectivity provider.' };
}
async function kycWebhook(raw, signature) {
  const secret = process.env.GLOBAL_IDENTITY_PROVIDER_WEBHOOK_SECRET || '';
  if (!secret) throw Object.assign(new Error('Identity provider webhook authentication is not configured.'), { statusCode: 503 });
  const expected = crypto.createHmac('sha256', secret).update(raw).digest();
  const supplied = Buffer.from(String(signature || '').replace(/^sha256=/i, '').trim(), 'hex');
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) throw Object.assign(new Error('Invalid identity provider signature.'), { statusCode: 401 });
  let event;
  try { event = JSON.parse(raw.toString('utf8')); } catch { throw Object.assign(new Error('Webhook body must be valid JSON.'), { statusCode: 400 }); }
  const data = event.data || event;
  const reference = String(data.subscriberReference || data.reference || '');
  const state = String(event.type || event.event || data.status || '');
  if (!reference) throw Object.assign(new Error('Identity callback is missing its subscriber reference.'), { statusCode: 400 });
  return transact(store => {
    const user = store.users.find(x => x.id === reference || x.kycProviderReference === reference);
    if (!user) throw Object.assign(new Error('Subscriber identity record not found.'), { statusCode: 404 });
    const eventId = String(event.id || data.eventId || (reference + ':' + state));
    if (store.providerEvents.some(x => x.id === eventId)) return { received: true, duplicate: true, status: user.kycStatus };
    if (['subscriber.kyc.verified', 'verified', 'kyc.verified'].includes(state)) {
      user.kycStatus = 'verified';
      user.kycVerifiedAt = new Date().toISOString();
    } else if (['subscriber.kyc.rejected', 'rejected', 'kyc.rejected'].includes(state)) {
      user.kycStatus = 'rejected';
      user.kycRejectedAt = new Date().toISOString();
    } else if (['subscriber.kyc.pending', 'pending', 'kyc.pending'].includes(state)) {
      user.kycStatus = 'pending';
    } else {
      throw Object.assign(new Error('Unsupported identity provider event.'), { statusCode: 400 });
    }
    store.providerEvents.push({ id: eventId, reference, type: state, receivedAt: new Date().toISOString() });
    store.audit.push({ id: crypto.randomUUID(), event: 'subscriber.kyc_' + user.kycStatus, subject: user.id, at: new Date().toISOString() });
    return { received: true, duplicate: false, status: user.kycStatus };
  });
}
async function createSupportTicket(user, data) {
  const subject = String(data.subject || '').trim();
  const message = String(data.message || '').trim();
  const category = String(data.category || 'general');
  const allowed = ['activation', 'billing', 'network', 'technical', 'privacy', 'other'];
  if (!allowed.includes(category)) throw Object.assign(new Error('Select a valid support category.'), { statusCode: 400 });
  if (subject.length < 4 || subject.length > 120) throw Object.assign(new Error('Subject must be 4 to 120 characters.'), { statusCode: 400 });
  if (message.length < 20 || message.length > 4000) throw Object.assign(new Error('Describe the issue in 20 to 4000 characters.'), { statusCode: 400 });
  return transact(store => {
    const now = new Date().toISOString();
    const ticket = {
      id: crypto.randomUUID(),
      reference: 'EXSUP-' + new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14) + '-' + crypto.randomBytes(3).toString('hex').toUpperCase(),
      userId: user.id, category, subject, message, status: 'open', createdAt: now, updatedAt: now
    };
    store.supportTickets.push(ticket);
    store.audit.push({ id: crypto.randomUUID(), event: 'support.ticket_created', subject: ticket.id, at: now });
    return ticket;
  });
}
async function createPrivacyRequest(user, data) {
  const type = String(data.type || '');
  const allowed = ['access', 'correction', 'deletion', 'portability', 'objection'];
  if (!allowed.includes(type)) throw Object.assign(new Error('Choose a valid privacy request type.'), { statusCode: 400 });
  const details = String(data.details || '').trim().slice(0, 1500);
  return transact(store => {
    const now = new Date().toISOString();
    const record = {
      id: crypto.randomUUID(),
      reference: 'EXPR-' + new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14) + '-' + crypto.randomBytes(3).toString('hex').toUpperCase(),
      userId: user.id, type, details, status: 'received', createdAt: now, updatedAt: now
    };
    store.privacyRequests.push(record);
    store.audit.push({ id: crypto.randomUUID(), event: 'privacy.request_received', subject: record.id, at: now });
    return record;
  });
}

async function dashboard() {
  const store = await loadStore();
  return {
    provider: providerStatus(),
    totals: {
      subscribers: store.users.length,
      emailUnverified: store.users.filter(x => !x.emailVerified).length,
      identityPending: store.users.filter(x => x.kycStatus === 'pending').length,
      identityVerified: store.users.filter(x => x.kycStatus === 'verified').length,
      registeredDevices: store.devices.length,
      deviceProfiles: store.profiles.length,
      profilesAwaitingPartners: store.profiles.filter(x => x.status === 'awaiting_partners').length,
      profilesProvisioning: store.profiles.filter(x => x.status === 'provisioning').length,
      profilesIssued: store.profiles.filter(x => x.status === 'profile_issued').length,
      activeDeviceProfiles: store.profiles.filter(x => x.status === 'active').length,
      profilesInReview: store.profiles.filter(x => x.status === 'partner_review').length,
      providerErrors: store.profiles.filter(x => x.status === 'provider_error').length,
      openTickets: store.supportTickets.filter(x => x.status === 'open' || x.status === 'in_progress').length,
      privacyRequests: store.privacyRequests.filter(x => x.status === 'received' || x.status === 'in_review').length
    },
    recentSubscribers: store.users.slice(-100).reverse().map(userView),
    recentDevices: store.devices.slice(-100).reverse().map(device => {
      const latest = store.profiles.filter(x => x.deviceId === device.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
      return { id: device.id, deviceName: device.deviceName, platform: device.platform, model: device.model || null, latestProfile: latest ? { id: latest.id, reference: latest.reference, status: latest.status, message: latest.message || '' } : null };
    }),
    recentProfiles: store.profiles.slice(-100).reverse().map(x => ({ id: x.id, reference: x.reference, deviceId: x.deviceId, status: x.status, message: x.message || '' })),
    recentTickets: store.supportTickets.slice(-30).reverse().map(({message, ...ticket}) => ticket),
    recentPrivacyRequests: store.privacyRequests.slice(-30).reverse()
  };
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon'
};
function serveStatic(req, res, pathname) {
  if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, { error: 'Method not allowed.' });
  const requested = pathname === '/admin' || pathname === '/admin/' ? '/admin.html' : pathname;
  let decoded;
  try { decoded = decodeURIComponent(requested); } catch { return send(res, 400, { error: 'Invalid path.' }); }
  const rel = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, rel);
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 400, { error: 'Invalid path.' });
  fs.readFile(file, (error, content) => {
    if (error) return send(res, error.code === 'ENOENT' ? 404 : 500, { error: 'File not found.' });
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': ['.html', '.js'].includes(ext) ? 'no-cache' : 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://speed.cloudflare.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    });
    if (req.method === 'HEAD') return res.end();
    res.end(content);
  });
}
async function route(req, res, url) {
  const legacyCheckout = url.pathname === '/api/v1/plans' ||
    url.pathname === '/api/v1/esim/orders' ||
    url.pathname.startsWith('/api/v1/esim/orders/') ||
    url.pathname === '/api/v1/payments/paystack/webhook' ||
    url.pathname === '/api/v1/admin/plans' ||
    url.pathname.startsWith('/api/v1/admin/plans/');
  if (legacyCheckout) return send(res, 410, { ok: false, code: 'SPONSORED_DEVICE_PROFILE_FLOW', error: 'Customer data-package sales are disabled. Register a device and request its sponsored eSIM profile.' });
  const p = url.pathname, m = req.method;
  if (p === '/health' && m === 'GET') {
    await fsp.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
    await loadStore();
    return send(res, 200, { ok: true, service: 'Expert eSIM', persistentStoreReady: true, provider: providerStatus() });
  }
  if ((p === '/api/status' || p === '/api/v1/status') && m === 'GET') {
    const cfg = providerStatus();
    return send(res, 200, {
      ok: true, service: 'Expert eSIM', product: 'global-sponsored-esim-connectivity-platform',
      subscriberAccounts: true, persistentSubscriberStore: true,
      providerProvisioning: readyToProvisionGlobally() ? 'configured' : 'awaiting-global-connectivity-and-esim-partners',
      profileEncryption: cfg.profileEncryptionConfigured ? 'configured' : 'not-configured',
      cellularDataProvisioning: 'not-active-until-global-provider-confirms-profile-and-roaming',
      message: 'Expert eSIM requests a separate sponsored-unlimited profile for each registered device. Live connectivity depends on a contracted global connectivity provider and authorised eSIM profile provider.'
    });
  }
  if (p === '/api/esim/status' && m === 'GET') return send(res, 200, { ok: true, connected: false, providerConfigured: readyToProvisionGlobally(), profileIssued: false, message: 'A contracted global provider and authorised eSIM profile provider must issue and activate a profile before Expert eSIM can connect.' });

  if (p === '/api/v1/auth/register' && m === 'POST') {
    rateLimit(req, 'register', 5, 15 * 60 * 1000);
    const result = await register(await body(req));
    let delivery = { sent: false, reason: 'email_provider_not_configured' };
    if (providerStatus().emailDeliveryConfigured) {
      try { delivery = await sendVerificationEmail(result.user); }
      catch (error) { delivery = { sent: false, reason: 'delivery_failed' }; }
    }
    return send(res, 201, { ok: true, user: result.user, emailVerification: delivery, message: delivery.sent ? 'Account created. Verify your email to continue.' : 'Account created. Email verification is not yet configured; mobile service ordering remains locked until verification is available.' }, { 'set-cookie': sessionCookie(result.token) });
  }
  if (p === '/api/v1/auth/login' && m === 'POST') {
    rateLimit(req, 'login', 8, 15 * 60 * 1000);
    const result = await login(await body(req));
    return send(res, 200, { ok: true, user: result.user }, { 'set-cookie': sessionCookie(result.token) });
  }
  if (p === '/api/v1/auth/logout' && m === 'POST') {
    const token = tokenFrom(req), tokenHash = token ? hashToken(token) : '';
    await transact(store => { store.sessions = store.sessions.filter(x => x.tokenHash !== tokenHash); });
    return send(res, 200, { ok: true }, { 'set-cookie': clearSessionCookie() });
  }
  if (p === '/api/v1/auth/verification/send' && m === 'POST') {
    const user = await signedIn(req);
    if (user.emailVerified) return send(res, 200, { ok: true, verified: true });
    const delivery = await sendVerificationEmail(user);
    return send(res, 200, { ok: true, ...delivery });
  }
  if (p === '/api/v1/auth/verify-email' && m === 'GET') {
    await verifyEmailToken(url.searchParams.get('token'));
    res.writeHead(303, { location: '/?email_verified=1', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' });
    return res.end();
  }
  if (p === '/api/v1/me' && m === 'GET') {
    const user = await signedIn(req), store = await loadStore();
    const orders = store.orders.filter(x => x.userId === user.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map(orderView);
    const tickets = store.supportTickets.filter(x => x.userId === user.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
    const privacyRequests = store.privacyRequests.filter(x => x.userId === user.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
    const headers = {};
    if (String(req.headers.authorization || '').startsWith('Bearer ')) headers['set-cookie'] = sessionCookie(tokenFrom(req));
    return send(res, 200, { ok: true, user: userView(user), orders, devices: await globalEsim.listDevices(user), tickets, privacyRequests, readiness: providerStatus() }, headers);
  }
  if (p === '/api/v1/devices' && m === 'GET') return send(res, 200, { ok: true, devices: await globalEsim.listDevices(await signedIn(req)) });
  if (p === '/api/v1/devices' && m === 'POST') return send(res, 201, { ok: true, device: await globalEsim.registerDevice(await signedIn(req), await body(req)) });
  const deviceProfilePath = p.match(/^\/api\/v1\/devices\/([0-9a-f-]{36})\/profile$/i);
  if (deviceProfilePath && m === 'POST') {
    const profile = await globalEsim.requestProfile(await signedIn(req), deviceProfilePath[1]);
    return send(res, ['profile_issued','active'].includes(profile.status) ? 201 : 202, { ok: true, profile, message: profile.message });
  }
  if (deviceProfilePath && m === 'GET') return send(res, 200, { ok: true, profile: await globalEsim.getProfile(await signedIn(req), deviceProfilePath[1]) });
  if (p === '/api/v1/global-esim/webhook' && m === 'POST') return send(res, 200, { ok: true, ...(await globalEsim.handleWebhook(await rawBody(req), req.headers['x-expert-signature'])) });
  if (p === '/api/v1/kyc/start' && m === 'POST') {
    const user = await signedIn(req);
    return send(res, 200, { ok: true, ...(await beginKyc(user)) });
  }
  if (p === '/api/v1/support/tickets' && m === 'GET') {
    const user = await signedIn(req), store = await loadStore();
    const tickets = store.supportTickets.filter(x => x.userId === user.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
    return send(res, 200, { ok: true, tickets });
  }
  if (p === '/api/v1/support/tickets' && m === 'POST') {
    const user = await signedIn(req);
    const ticket = await createSupportTicket(user, await body(req));
    return send(res, 201, { ok: true, ticket, message: 'Your support case has been recorded.' });
  }
  if (p === '/api/v1/privacy/requests' && m === 'GET') {
    const user = await signedIn(req), store = await loadStore();
    return send(res, 200, { ok: true, requests: store.privacyRequests.filter(x => x.userId === user.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt)) });
  }
  if (p === '/api/v1/privacy/export' && m === 'GET') {
    const user = await signedIn(req), store = await loadStore();
    const exportData = {
      exportedAt: new Date().toISOString(),
      account: userView(user),
      orders: store.orders.filter(x => x.userId === user.id).map(orderView),
      devices: store.devices.filter(x => x.userId === user.id).map(device => ({
        id: device.id, deviceName: device.deviceName, manufacturer: device.manufacturer || null,
        platform: device.platform, model: device.model || null, osVersion: device.osVersion || null,
        eSimSupportKnown: device.eSimSupportKnown === true,
        hasEuiccHardware: typeof device.hasEuiccHardware === 'boolean' ? device.hasEuiccHardware : null,
        euiccEnabled: typeof device.euiccEnabled === 'boolean' ? device.euiccEnabled : null,
        status: device.status, createdAt: device.createdAt
      })),
      profiles: store.profiles.filter(x => x.userId === user.id).map(profile => ({
        id: profile.id, reference: profile.reference, deviceId: profile.deviceId, status: profile.status,
        dataPolicy: 'sponsored-unlimited', coverageScope: profile.coverageScope || null,
        unlimitedDataConfirmed: Boolean(profile.unlimitedDataConfirmed),
        coverageConfirmed: Boolean(profile.coverageConfirmed), providerProfileId: profile.providerProfileId || null,
        createdAt: profile.createdAt, updatedAt: profile.updatedAt, issuedAt: profile.issuedAt || null,
        activatedAt: profile.activatedAt || null
      })),
      consents: store.consents.filter(x => x.userId === user.id),
      supportTickets: store.supportTickets.filter(x => x.userId === user.id),
      privacyRequests: store.privacyRequests.filter(x => x.userId === user.id)
    };
    return send(res, 200, exportData, { 'content-disposition': 'attachment; filename="expert-esim-personal-data.json"' });
  }
  if (p === '/api/v1/privacy/requests' && m === 'POST') {
    const user = await signedIn(req);
    const request = await createPrivacyRequest(user, await body(req));
    return send(res, 201, { ok: true, request, message: 'Your privacy request has been recorded for review.' });
  }
  if (p === '/api/v1/plans' && m === 'GET') {
    const store = await loadStore();
    const plans = store.plans.filter(x => x.status === 'published').map(x => ({
      id: x.id, name: x.name, description: x.description, dataMb: x.dataMb,
      validityDays: x.validityDays, priceMinor: x.priceMinor, currency: x.currency, networkModes: x.networkModes
    }));
    return send(res, 200, { ok: true, plans, availability: plans.length ? 'available' : 'awaiting-network-partner' });
  }
  if (p === '/api/v1/esim/orders' && m === 'GET') {
    const user = await signedIn(req), store = await loadStore();
    return send(res, 200, { ok: true, orders: store.orders.filter(x => x.userId === user.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map(orderView) });
  }
  if (p === '/api/v1/esim/orders' && m === 'POST') {
    const user = await signedIn(req), result = await createOrder(user, await body(req));
    return send(res, ['awaiting_partner','awaiting_payment','provisioning'].includes(result.status) ? 202 : 201, { ok: true, order: result, message: result.message });
  }
  const paymentInit = p.match(/^\/api\/v1\/esim\/orders\/([0-9a-f-]{36})\/pay$/i);
  if (paymentInit && m === 'POST') {
    const user = await signedIn(req);
    return send(res, 200, { ok: true, payment: await initializePaystackPayment(user, paymentInit[1]) });
  }
  const verifyPaymentMatch = p.match(/^\/api\/v1\/esim\/orders\/([0-9a-f-]{36})\/verify-payment$/i);
  if (verifyPaymentMatch && m === 'POST') {
    const user = await signedIn(req);
    const order = await confirmPaystackPayment(user, verifyPaymentMatch[1]);
    return send(res, 200, { ok: true, order });
  }
  if (p === '/api/v1/payments/paystack/webhook' && m === 'POST') {
    const result = await paystackWebhook(await rawBody(req), req.headers);
    return send(res, 200, { ok: true, ...result });
  }
  if (p === '/api/v1/kyc/webhook' && m === 'POST') {
    const result = await kycWebhook(await rawBody(req), req.headers['x-kyc-signature']);
    return send(res, 200, { ok: true, ...result });
  }
  const profileMatch = p.match(/^\/api\/v1\/esim\/orders\/([0-9a-f-]{36})\/profile$/i);
  if (profileMatch && m === 'GET') return send(res, 200, { ok: true, profile: await profileForUser((await signedIn(req)).id, profileMatch[1]) });
  const installedMatch = p.match(/^\/api\/v1\/esim\/orders\/([0-9a-f-]{36})\/install-requested$/i);
  if (installedMatch && m === 'POST') {
    const user = await signedIn(req);
    const result = await transact(store => {
      const order = store.orders.find(x => x.id === installedMatch[1] && x.userId === user.id);
      if (!order || !['profile_issued', 'active'].includes(order.status)) throw Object.assign(new Error('This order does not have an issued profile.'), { statusCode: 409 });
      order.installRequestedAt = new Date().toISOString(); order.updatedAt = order.installRequestedAt;
      return orderView(order);
    });
    return send(res, 200, { ok: true, order: result });
  }
  if (p === '/api/v1/provider/webhook' && m === 'POST') {
    const result = await providerWebhook(await rawBody(req), req.headers['x-expert-signature']);
    return send(res, 200, { ok: true, ...result });
  }
  if (p.startsWith('/api/v1/admin/')) {
    if (!adminOk(req)) return send(res, 401, { ok: false, error: 'Admin authentication is required.' });
    if (p === '/api/v1/admin/dashboard' && m === 'GET') return send(res, 200, { ok: true, dashboard: await dashboard() });
    if (p === '/api/v1/admin/users' && m === 'GET') {
      const store = await loadStore();
      return send(res, 200, { ok: true, users: store.users.map(userView) });
    }
    if (p === '/api/v1/admin/plans' && m === 'POST') {
      const plan = await createPlan(await body(req));
      return send(res, 201, { ok: true, plan, message: 'Plan saved as a draft. Publishing is blocked until network, provisioning and payment requirements are configured.' });
    }
    if (p === '/api/v1/admin/support/tickets' && m === 'GET') {
      const store = await loadStore();
      return send(res, 200, { ok: true, tickets: store.supportTickets.slice(-200).reverse() });
    }
    const ticketStatus = p.match(/^\/api\/v1\/admin\/support\/tickets\/([0-9a-f-]{36})\/status$/i);
    if (ticketStatus && m === 'POST') {
      const data = await body(req), next = String(data.status || '');
      if (!['open','in_progress','resolved','closed'].includes(next)) throw Object.assign(new Error('Invalid support-ticket status.'), { statusCode: 400 });
      const updated = await transact(store => {
        const ticket = store.supportTickets.find(x => x.id === ticketStatus[1]);
        if (!ticket) throw Object.assign(new Error('Support case not found.'), { statusCode: 404 });
        ticket.status = next; ticket.updatedAt = new Date().toISOString();
        store.audit.push({ id: crypto.randomUUID(), event: 'support.ticket_status_changed', subject: ticket.id, at: ticket.updatedAt });
        return ticket;
      });
      return send(res, 200, { ok: true, ticket: updated });
    }
    if (p === '/api/v1/admin/privacy/requests' && m === 'GET') {
      const store = await loadStore();
      return send(res, 200, { ok: true, requests: store.privacyRequests.slice(-200).reverse() });
    }
    const privacyStatus = p.match(/^\/api\/v1\/admin\/privacy\/requests\/([0-9a-f-]{36})\/status$/i);
    if (privacyStatus && m === 'POST') {
      const data = await body(req), next = String(data.status || '');
      if (!['received','in_review','fulfilled','rejected'].includes(next)) throw Object.assign(new Error('Invalid privacy-request status.'), { statusCode: 400 });
      const updated = await transact(store => {
        const request = store.privacyRequests.find(x => x.id === privacyStatus[1]);
        if (!request) throw Object.assign(new Error('Privacy request not found.'), { statusCode: 404 });
        request.status = next; request.updatedAt = new Date().toISOString();
        store.audit.push({ id: crypto.randomUUID(), event: 'privacy.request_status_changed', subject: request.id, at: request.updatedAt });
        return request;
      });
      return send(res, 200, { ok: true, request: updated });
    }
    const publish = p.match(/^\/api\/v1\/admin\/plans\/([0-9a-f-]{36})\/publish$/i);
    if (publish && m === 'POST') return send(res, 200, { ok: true, plan: await publishPlan(publish[1]) });
    return send(res, 404, { ok: false, error: 'Admin endpoint not found.' });
  }
  if (p === '/api/esim/connect' && m === 'POST') return send(res, 503, { ok: false, connected: false, code: 'ESIM_SERVICE_NOT_PROVISIONED', message: 'No authorised Expert eSIM subscription is assigned to this device yet.' });
  if (p === '/api/esim/disconnect' && m === 'POST') return send(res, 409, { ok: false, connected: false, code: 'NO_ACTIVE_EXPERT_ESIM_SESSION', message: 'There is no active Expert eSIM mobile-data session to disconnect.' });
  return serveStatic(req, res, p);
}
const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://' + (req.headers.host || 'localhost')); }
  catch { return send(res, 400, { error: 'Invalid request URL.' }); }
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'cache-control': 'no-store' }); return res.end(); }
  try {
    if (['POST','PUT','PATCH','DELETE'].includes(req.method) && !['/api/v1/provider/webhook','/api/v1/kyc/webhook','/api/v1/payments/paystack/webhook'].includes(url.pathname)) enforceSameOrigin(req);
    if (['POST','PUT','PATCH','DELETE'].includes(req.method) && url.pathname.startsWith('/api/v1/admin/')) rateLimit(req, 'admin', 120, 60 * 1000);
    await route(req, res, url);
  } catch (error) { fail(res, error); }
});
server.listen(PORT, '0.0.0.0', () => console.log('Expert eSIM API listening on port ' + PORT));
server.on('error', error => { console.error('Expert eSIM server error:', error.message); process.exitCode = 1; });
