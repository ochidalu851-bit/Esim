'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 8080);
const PUBLIC_DIR = path.resolve(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || '/data';
const STORE_FILE = path.join(DATA_DIR, 'expert-esim-store.json');
const MAX_BODY = 65536;
const SESSION_DAYS = 30;
let writeQueue = Promise.resolve();

function emptyStore() {
  return { version: 1, users: [], sessions: [], plans: [], orders: [], audit: [], providerEvents: [], paymentEvents: [], consents: [], supportTickets: [], privacyRequests: [] };
}
function normalizeStore(store) {
  for (const key of ['users','sessions','plans','orders','audit','providerEvents','paymentEvents','consents','supportTickets','privacyRequests']) {
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
  if (current.count > limit) {
    const error = Object.assign(new Error('Too many attempts. Please wait before trying again.'), { statusCode: 429 });
    throw error;
  }
  if (rateBuckets.size > 5000) {
    for (const [key, value] of rateBuckets) if (now - value.startedAt > 3600000) rateBuckets.delete(key);
  }
}
function enforceSameOrigin(req, url) {
  const origin = String(req.headers.origin || '');
  if (!origin) return;
  const host = String(req.headers.host || '');
  const protocol = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const expected = protocol + '://' + host;
  if (origin !== expected) throw Object.assign(new Error('Cross-site request rejected.'), { statusCode: 403 });
}
function adminOk(req) {
  const secret = process.env.EXPERT_ESIM_ADMIN_KEY || '';
  return Boolean(secret) && equal(req.headers['x-expert-admin-key'] || tokenFrom(req), secret);
}
function providerStatus() {
  let validUrl = false;
  try { validUrl = new URL(process.env.ESIM_PROVIDER_CREATE_ORDER_URL || '').protocol === 'https:'; } catch {}
  let kycUrlValid = false;
  try { kycUrlValid = new URL(process.env.KYC_PROVIDER_START_URL || '').protocol === 'https:'; } catch {}
  return {
    adapterConfigured: validUrl && Boolean(process.env.ESIM_PROVIDER_API_KEY) && Boolean(process.env.ESIM_PROFILE_ENCRYPTION_KEY),
    webhookConfigured: Boolean(process.env.ESIM_PROVIDER_WEBHOOK_SECRET),
    profileEncryptionConfigured: Boolean(encryptionKey()),
    hostNetworkAgreement: process.env.HOST_NETWORK_AGREEMENT_ACTIVE === 'true',
    smdpPartnerConfigured: process.env.SMDP_PARTNER_ACTIVE === 'true',
    serviceEnabled: process.env.EXPERT_ESIM_SERVICE_ENABLED === 'true',
    paystackConfigured: Boolean(process.env.PAYSTACK_SECRET_KEY) && Boolean(process.env.PAYSTACK_WEBHOOK_SECRET),
    kycProviderConfigured: kycUrlValid && Boolean(process.env.KYC_PROVIDER_API_KEY) && Boolean(process.env.KYC_PROVIDER_WEBHOOK_SECRET),
    emailDeliveryConfigured: Boolean(process.env.RESEND_API_KEY) && Boolean(process.env.EXPERT_ESIM_EMAIL_FROM)
  };
}
function readyToSell() {
  const p = providerStatus();
  return p.adapterConfigured && p.webhookConfigured && p.hostNetworkAgreement && p.smdpPartnerConfigured && p.serviceEnabled;
}
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
  return 'scrypt$32768
function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
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
  if (!readyToSell()) throw Object.assign(new Error('Cannot publish plans until the host-network agreement, authorised SM-DP+ partner, provider API and service activation are configured.'), { statusCode: 409 });
  return transact(store => {
    const plan = store.plans.find(x => x.id === planId);
    if (!plan) throw Object.assign(new Error('Plan not found.'), { statusCode: 404 });
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
  const currency = String(data.currency || 'NGN').toUpperCase();
  if (name.length < 2 || name.length > 80) throw Object.assign(new Error('Enter a plan name between 2 and 80 characters.'), { statusCode: 400 });
  if (!Number.isInteger(dataMb) || dataMb < 1) throw Object.assign(new Error('Data allowance must be a positive number of MB.'), { statusCode: 400 });
  if (!Number.isInteger(validityDays) || validityDays < 1 || validityDays > 3650) throw Object.assign(new Error('Validity must be between 1 and 3650 days.'), { statusCode: 400 });
  if (!Number.isSafeInteger(priceMinor) || priceMinor < 0) throw Object.assign(new Error('Price must be provided in minor currency units (kobo for NGN).'), { statusCode: 400 });
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
async function createOrder(user, data) {
  const snapshot = await loadStore();
  const plan = snapshot.plans.find(x => x.id === String(data.planId || '') && x.status === 'published');
  if (!plan) throw Object.assign(new Error('This data package is not available.'), { statusCode: 404 });
  const preferredNetwork = String(data.preferredNetwork || 'auto');
  if (!['auto', '4g', '5g'].includes(preferredNetwork)) throw Object.assign(new Error('Select Automatic, 4G or 5G.'), { statusCode: 400 });
  if (!plan.networkModes.includes(preferredNetwork) && !plan.networkModes.includes('auto')) throw Object.assign(new Error('This plan does not support the selected network mode.'), { statusCode: 400 });
  const providerReady = readyToSell();
  const now = new Date().toISOString();
  const order = {
    id: crypto.randomUUID(), reference: refCode(), userId: user.id, planId: plan.id,
    planName: plan.name, dataMb: plan.dataMb, validityDays: plan.validityDays,
    priceMinor: plan.priceMinor, currency: plan.currency, preferredNetwork,
    status: providerReady ? 'provisioning' : 'awaiting_partner',
    providerOrderId: null, encryptedActivationCode: null, encryptedConfirmationCode: null,
    message: providerReady ? 'Provisioning request is being submitted.' : 'Awaiting an authorised host-network and eSIM provisioning partner. No profile has been issued and no mobile data is active.',
    createdAt: now, updatedAt: now
  };
  await transact(store => {
    store.orders.push(order);
    store.audit.push({ id: crypto.randomUUID(), event: 'esim.order.created', subject: order.id, at: now });
  });
  if (providerReady) {
    try { await attachProviderResult(order.reference, await providerProvision(order, user, plan)); }
    catch {
      await transact(store => {
        const current = store.orders.find(x => x.id === order.id);
        if (current) { current.status = 'provider_error'; current.message = 'Provider did not accept the request. No profile was issued.'; current.updatedAt = new Date().toISOString(); }
      });
    }
  }
  const current = await loadStore();
  return orderView(current.orders.find(x => x.id === order.id));
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
    if (type === 'esim.profile.issued') {
      if (!data.activationCode) throw Object.assign(new Error('Issued-profile event must contain an activation code.'), { statusCode: 400 });
      order.encryptedActivationCode = encryptSecret(String(data.activationCode));
      if (data.confirmationCode) order.encryptedConfirmationCode = encryptSecret(String(data.confirmationCode));
      order.providerOrderId = data.providerOrderId || order.providerOrderId || null;
      order.status = 'profile_issued'; order.profileIssuedAt = now;
      order.message = 'Your authorised Expert eSIM profile is ready to install.';
    } else if (type === 'esim.profile.activated') {
      order.status = 'active'; order.activatedAt = now;
      order.message = 'The provider confirmed your eSIM subscription is active.';
    } else if (type === 'esim.profile.failed') {
      order.status = 'provider_error'; order.message = 'The provider reported a provisioning failure.';
    } else {
      throw Object.assign(new Error('Unsupported provider event type.'), { statusCode: 400 });
    }
    order.updatedAt = now;
    store.providerEvents.push({ id: crypto.randomUUID(), reference, type, receivedAt: now });
    store.audit.push({ id: crypto.randomUUID(), event: 'provider.' + type, subject: order.id, at: now });
    return { received: true, reference, status: order.status };
  });
}
async function profileForUser(userId, orderId) {
  const store = await loadStore();
  const order = store.orders.find(x => x.id === orderId && x.userId === userId);
  if (!order) throw Object.assign(new Error('eSIM order not found.'), { statusCode: 404 });
  if (!['profile_issued', 'active'].includes(order.status)) throw Object.assign(new Error('The provider has not issued an installable eSIM profile yet.'), { statusCode: 409 });
  return {
    activationCode: decryptSecret(order.encryptedActivationCode),
    confirmationCode: order.encryptedConfirmationCode ? decryptSecret(order.encryptedConfirmationCode) : '',
    reference: order.reference
  };
}
async function dashboard() {
  const store = await loadStore();
  const count = status => store.orders.filter(x => x.status === status).length;
  return {
    provider: providerStatus(),
    totals: {
      subscribers: store.users.length, plans: store.plans.length,
      publishedPlans: store.plans.filter(x => x.status === 'published').length,
      orders: store.orders.length, awaitingPartner: count('awaiting_partner'),
      provisioning: count('provisioning'), profilesIssued: count('profile_issued'),
      activeProfiles: count('active'), providerErrors: count('provider_error')
    },
    plans: store.plans.map(x => ({ id: x.id, name: x.name, dataMb: x.dataMb, validityDays: x.validityDays, priceMinor: x.priceMinor, currency: x.currency, status: x.status, networkModes: x.networkModes })),
    recentOrders: store.orders.slice(-30).reverse().map(orderView)
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
  const p = url.pathname, m = req.method;
  if (p === '/health' && m === 'GET') {
    await fsp.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
    await loadStore();
    return send(res, 200, { ok: true, service: 'Expert eSIM', persistentStoreReady: true, provider: providerStatus() });
  }
  if ((p === '/api/status' || p === '/api/v1/status') && m === 'GET') {
    const cfg = providerStatus();
    return send(res, 200, {
      ok: true, service: 'Expert eSIM', product: 'branded-mvno-platform-foundation',
      subscriberAccounts: true, persistentSubscriberStore: true,
      providerProvisioning: readyToSell() ? 'configured' : 'awaiting-authorised-partner',
      profileEncryption: cfg.profileEncryptionConfigured ? 'configured' : 'not-configured',
      cellularDataProvisioning: 'not-active-until-host-network-confirms',
      message: 'Account, plan and eSIM order management is available. Live cellular data requires an authorised host-network and SM-DP+ provider.'
    });
  }
  if (p === '/api/esim/status' && m === 'GET') return send(res, 200, { ok: true, connected: false, providerConfigured: readyToSell(), profileIssued: false, message: 'A host-network and authorised eSIM provider must issue a profile before Expert eSIM can connect.' });

  if (p === '/api/v1/auth/register' && m === 'POST') {
    const result = await register(await body(req));
    return send(res, 201, { ok: true, ...result });
  }
  if (p === '/api/v1/auth/login' && m === 'POST') {
    const result = await login(await body(req));
    return send(res, 200, { ok: true, ...result });
  }
  if (p === '/api/v1/auth/logout' && m === 'POST') {
    const token = tokenFrom(req), tokenHash = token ? hashToken(token) : '';
    await transact(store => { store.sessions = store.sessions.filter(x => x.tokenHash !== tokenHash); });
    return send(res, 200, { ok: true });
  }
  if (p === '/api/v1/me' && m === 'GET') {
    const user = await signedIn(req), store = await loadStore();
    const orders = store.orders.filter(x => x.userId === user.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map(orderView);
    return send(res, 200, { ok: true, user: userView(user), orders });
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
    return send(res, result.status === 'awaiting_partner' ? 202 : 201, { ok: true, order: result, message: result.message });
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
      return send(res, 201, { ok: true, plan, message: 'Plan saved as a draft. It cannot be published until the provider and host-network requirements are satisfied.' });
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
  try { await route(req, res, url); } catch (error) { fail(res, error); }
});
server.listen(PORT, '0.0.0.0', () => console.log('Expert eSIM API listening on port ' + PORT));
server.on('error', error => { console.error('Expert eSIM server error:', error.message); process.exitCode = 1; });
 + salt + '
function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function userView(user) {
  return { id: user.id, fullName: user.fullName, email: user.email, phone: user.phone || null, kycStatus: user.kycStatus, createdAt: user.createdAt };
}
function orderView(order) {
  return {
    id: order.id, reference: order.reference, planId: order.planId, planName: order.planName,
    dataMb: order.dataMb, validityDays: order.validityDays, priceMinor: order.priceMinor,
    currency: order.currency, preferredNetwork: order.preferredNetwork, status: order.status,
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
    const user = {
      id: crypto.randomUUID(), fullName, email, phone,
      passwordHash: hashPassword(password), status: 'active', kycStatus: 'not_started',
      createdAt: new Date().toISOString()
    };
    store.users.push(user);
    store.audit.push({ id: crypto.randomUUID(), event: 'subscriber.registered', subject: user.id, at: user.createdAt });
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
  if (!readyToSell()) throw Object.assign(new Error('Cannot publish plans until the host-network agreement, authorised SM-DP+ partner, provider API and service activation are configured.'), { statusCode: 409 });
  return transact(store => {
    const plan = store.plans.find(x => x.id === planId);
    if (!plan) throw Object.assign(new Error('Plan not found.'), { statusCode: 404 });
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
  const currency = String(data.currency || 'NGN').toUpperCase();
  if (name.length < 2 || name.length > 80) throw Object.assign(new Error('Enter a plan name between 2 and 80 characters.'), { statusCode: 400 });
  if (!Number.isInteger(dataMb) || dataMb < 1) throw Object.assign(new Error('Data allowance must be a positive number of MB.'), { statusCode: 400 });
  if (!Number.isInteger(validityDays) || validityDays < 1 || validityDays > 3650) throw Object.assign(new Error('Validity must be between 1 and 3650 days.'), { statusCode: 400 });
  if (!Number.isSafeInteger(priceMinor) || priceMinor < 0) throw Object.assign(new Error('Price must be provided in minor currency units (kobo for NGN).'), { statusCode: 400 });
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
async function createOrder(user, data) {
  const snapshot = await loadStore();
  const plan = snapshot.plans.find(x => x.id === String(data.planId || '') && x.status === 'published');
  if (!plan) throw Object.assign(new Error('This data package is not available.'), { statusCode: 404 });
  const preferredNetwork = String(data.preferredNetwork || 'auto');
  if (!['auto', '4g', '5g'].includes(preferredNetwork)) throw Object.assign(new Error('Select Automatic, 4G or 5G.'), { statusCode: 400 });
  if (!plan.networkModes.includes(preferredNetwork) && !plan.networkModes.includes('auto')) throw Object.assign(new Error('This plan does not support the selected network mode.'), { statusCode: 400 });
  const providerReady = readyToSell();
  const now = new Date().toISOString();
  const order = {
    id: crypto.randomUUID(), reference: refCode(), userId: user.id, planId: plan.id,
    planName: plan.name, dataMb: plan.dataMb, validityDays: plan.validityDays,
    priceMinor: plan.priceMinor, currency: plan.currency, preferredNetwork,
    status: providerReady ? 'provisioning' : 'awaiting_partner',
    providerOrderId: null, encryptedActivationCode: null, encryptedConfirmationCode: null,
    message: providerReady ? 'Provisioning request is being submitted.' : 'Awaiting an authorised host-network and eSIM provisioning partner. No profile has been issued and no mobile data is active.',
    createdAt: now, updatedAt: now
  };
  await transact(store => {
    store.orders.push(order);
    store.audit.push({ id: crypto.randomUUID(), event: 'esim.order.created', subject: order.id, at: now });
  });
  if (providerReady) {
    try { await attachProviderResult(order.reference, await providerProvision(order, user, plan)); }
    catch {
      await transact(store => {
        const current = store.orders.find(x => x.id === order.id);
        if (current) { current.status = 'provider_error'; current.message = 'Provider did not accept the request. No profile was issued.'; current.updatedAt = new Date().toISOString(); }
      });
    }
  }
  const current = await loadStore();
  return orderView(current.orders.find(x => x.id === order.id));
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
    if (type === 'esim.profile.issued') {
      if (!data.activationCode) throw Object.assign(new Error('Issued-profile event must contain an activation code.'), { statusCode: 400 });
      order.encryptedActivationCode = encryptSecret(String(data.activationCode));
      if (data.confirmationCode) order.encryptedConfirmationCode = encryptSecret(String(data.confirmationCode));
      order.providerOrderId = data.providerOrderId || order.providerOrderId || null;
      order.status = 'profile_issued'; order.profileIssuedAt = now;
      order.message = 'Your authorised Expert eSIM profile is ready to install.';
    } else if (type === 'esim.profile.activated') {
      order.status = 'active'; order.activatedAt = now;
      order.message = 'The provider confirmed your eSIM subscription is active.';
    } else if (type === 'esim.profile.failed') {
      order.status = 'provider_error'; order.message = 'The provider reported a provisioning failure.';
    } else {
      throw Object.assign(new Error('Unsupported provider event type.'), { statusCode: 400 });
    }
    order.updatedAt = now;
    store.providerEvents.push({ id: crypto.randomUUID(), reference, type, receivedAt: now });
    store.audit.push({ id: crypto.randomUUID(), event: 'provider.' + type, subject: order.id, at: now });
    return { received: true, reference, status: order.status };
  });
}
async function profileForUser(userId, orderId) {
  const store = await loadStore();
  const order = store.orders.find(x => x.id === orderId && x.userId === userId);
  if (!order) throw Object.assign(new Error('eSIM order not found.'), { statusCode: 404 });
  if (!['profile_issued', 'active'].includes(order.status)) throw Object.assign(new Error('The provider has not issued an installable eSIM profile yet.'), { statusCode: 409 });
  return {
    activationCode: decryptSecret(order.encryptedActivationCode),
    confirmationCode: order.encryptedConfirmationCode ? decryptSecret(order.encryptedConfirmationCode) : '',
    reference: order.reference
  };
}
async function dashboard() {
  const store = await loadStore();
  const count = status => store.orders.filter(x => x.status === status).length;
  return {
    provider: providerStatus(),
    totals: {
      subscribers: store.users.length, plans: store.plans.length,
      publishedPlans: store.plans.filter(x => x.status === 'published').length,
      orders: store.orders.length, awaitingPartner: count('awaiting_partner'),
      provisioning: count('provisioning'), profilesIssued: count('profile_issued'),
      activeProfiles: count('active'), providerErrors: count('provider_error')
    },
    plans: store.plans.map(x => ({ id: x.id, name: x.name, dataMb: x.dataMb, validityDays: x.validityDays, priceMinor: x.priceMinor, currency: x.currency, status: x.status, networkModes: x.networkModes })),
    recentOrders: store.orders.slice(-30).reverse().map(orderView)
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
  const p = url.pathname, m = req.method;
  if (p === '/health' && m === 'GET') {
    await fsp.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
    await loadStore();
    return send(res, 200, { ok: true, service: 'Expert eSIM', persistentStoreReady: true, provider: providerStatus() });
  }
  if ((p === '/api/status' || p === '/api/v1/status') && m === 'GET') {
    const cfg = providerStatus();
    return send(res, 200, {
      ok: true, service: 'Expert eSIM', product: 'branded-mvno-platform-foundation',
      subscriberAccounts: true, persistentSubscriberStore: true,
      providerProvisioning: readyToSell() ? 'configured' : 'awaiting-authorised-partner',
      profileEncryption: cfg.profileEncryptionConfigured ? 'configured' : 'not-configured',
      cellularDataProvisioning: 'not-active-until-host-network-confirms',
      message: 'Account, plan and eSIM order management is available. Live cellular data requires an authorised host-network and SM-DP+ provider.'
    });
  }
  if (p === '/api/esim/status' && m === 'GET') return send(res, 200, { ok: true, connected: false, providerConfigured: readyToSell(), profileIssued: false, message: 'A host-network and authorised eSIM provider must issue a profile before Expert eSIM can connect.' });

  if (p === '/api/v1/auth/register' && m === 'POST') {
    const result = await register(await body(req));
    return send(res, 201, { ok: true, ...result });
  }
  if (p === '/api/v1/auth/login' && m === 'POST') {
    const result = await login(await body(req));
    return send(res, 200, { ok: true, ...result });
  }
  if (p === '/api/v1/auth/logout' && m === 'POST') {
    const token = tokenFrom(req), tokenHash = token ? hashToken(token) : '';
    await transact(store => { store.sessions = store.sessions.filter(x => x.tokenHash !== tokenHash); });
    return send(res, 200, { ok: true });
  }
  if (p === '/api/v1/me' && m === 'GET') {
    const user = await signedIn(req), store = await loadStore();
    const orders = store.orders.filter(x => x.userId === user.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map(orderView);
    return send(res, 200, { ok: true, user: userView(user), orders });
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
    return send(res, result.status === 'awaiting_partner' ? 202 : 201, { ok: true, order: result, message: result.message });
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
      return send(res, 201, { ok: true, plan, message: 'Plan saved as a draft. It cannot be published until the provider and host-network requirements are satisfied.' });
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
  try { await route(req, res, url); } catch (error) { fail(res, error); }
});
server.listen(PORT, '0.0.0.0', () => console.log('Expert eSIM API listening on port ' + PORT));
server.on('error', error => { console.error('Expert eSIM server error:', error.message); process.exitCode = 1; });
 + crypto.scryptSync(password, salt, 64, options).toString('hex');
}
function verifyPassword(password, stored) {
  const text = String(stored || '');
  const modern = text.split('
function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function userView(user) {
  return { id: user.id, fullName: user.fullName, email: user.email, phone: user.phone || null, kycStatus: user.kycStatus, createdAt: user.createdAt };
}
function orderView(order) {
  return {
    id: order.id, reference: order.reference, planId: order.planId, planName: order.planName,
    dataMb: order.dataMb, validityDays: order.validityDays, priceMinor: order.priceMinor,
    currency: order.currency, preferredNetwork: order.preferredNetwork, status: order.status,
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
    const user = {
      id: crypto.randomUUID(), fullName, email, phone,
      passwordHash: hashPassword(password), status: 'active', kycStatus: 'not_started',
      createdAt: new Date().toISOString()
    };
    store.users.push(user);
    store.audit.push({ id: crypto.randomUUID(), event: 'subscriber.registered', subject: user.id, at: user.createdAt });
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
  if (!readyToSell()) throw Object.assign(new Error('Cannot publish plans until the host-network agreement, authorised SM-DP+ partner, provider API and service activation are configured.'), { statusCode: 409 });
  return transact(store => {
    const plan = store.plans.find(x => x.id === planId);
    if (!plan) throw Object.assign(new Error('Plan not found.'), { statusCode: 404 });
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
  const currency = String(data.currency || 'NGN').toUpperCase();
  if (name.length < 2 || name.length > 80) throw Object.assign(new Error('Enter a plan name between 2 and 80 characters.'), { statusCode: 400 });
  if (!Number.isInteger(dataMb) || dataMb < 1) throw Object.assign(new Error('Data allowance must be a positive number of MB.'), { statusCode: 400 });
  if (!Number.isInteger(validityDays) || validityDays < 1 || validityDays > 3650) throw Object.assign(new Error('Validity must be between 1 and 3650 days.'), { statusCode: 400 });
  if (!Number.isSafeInteger(priceMinor) || priceMinor < 0) throw Object.assign(new Error('Price must be provided in minor currency units (kobo for NGN).'), { statusCode: 400 });
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
async function createOrder(user, data) {
  const snapshot = await loadStore();
  const plan = snapshot.plans.find(x => x.id === String(data.planId || '') && x.status === 'published');
  if (!plan) throw Object.assign(new Error('This data package is not available.'), { statusCode: 404 });
  const preferredNetwork = String(data.preferredNetwork || 'auto');
  if (!['auto', '4g', '5g'].includes(preferredNetwork)) throw Object.assign(new Error('Select Automatic, 4G or 5G.'), { statusCode: 400 });
  if (!plan.networkModes.includes(preferredNetwork) && !plan.networkModes.includes('auto')) throw Object.assign(new Error('This plan does not support the selected network mode.'), { statusCode: 400 });
  const providerReady = readyToSell();
  const now = new Date().toISOString();
  const order = {
    id: crypto.randomUUID(), reference: refCode(), userId: user.id, planId: plan.id,
    planName: plan.name, dataMb: plan.dataMb, validityDays: plan.validityDays,
    priceMinor: plan.priceMinor, currency: plan.currency, preferredNetwork,
    status: providerReady ? 'provisioning' : 'awaiting_partner',
    providerOrderId: null, encryptedActivationCode: null, encryptedConfirmationCode: null,
    message: providerReady ? 'Provisioning request is being submitted.' : 'Awaiting an authorised host-network and eSIM provisioning partner. No profile has been issued and no mobile data is active.',
    createdAt: now, updatedAt: now
  };
  await transact(store => {
    store.orders.push(order);
    store.audit.push({ id: crypto.randomUUID(), event: 'esim.order.created', subject: order.id, at: now });
  });
  if (providerReady) {
    try { await attachProviderResult(order.reference, await providerProvision(order, user, plan)); }
    catch {
      await transact(store => {
        const current = store.orders.find(x => x.id === order.id);
        if (current) { current.status = 'provider_error'; current.message = 'Provider did not accept the request. No profile was issued.'; current.updatedAt = new Date().toISOString(); }
      });
    }
  }
  const current = await loadStore();
  return orderView(current.orders.find(x => x.id === order.id));
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
    if (type === 'esim.profile.issued') {
      if (!data.activationCode) throw Object.assign(new Error('Issued-profile event must contain an activation code.'), { statusCode: 400 });
      order.encryptedActivationCode = encryptSecret(String(data.activationCode));
      if (data.confirmationCode) order.encryptedConfirmationCode = encryptSecret(String(data.confirmationCode));
      order.providerOrderId = data.providerOrderId || order.providerOrderId || null;
      order.status = 'profile_issued'; order.profileIssuedAt = now;
      order.message = 'Your authorised Expert eSIM profile is ready to install.';
    } else if (type === 'esim.profile.activated') {
      order.status = 'active'; order.activatedAt = now;
      order.message = 'The provider confirmed your eSIM subscription is active.';
    } else if (type === 'esim.profile.failed') {
      order.status = 'provider_error'; order.message = 'The provider reported a provisioning failure.';
    } else {
      throw Object.assign(new Error('Unsupported provider event type.'), { statusCode: 400 });
    }
    order.updatedAt = now;
    store.providerEvents.push({ id: crypto.randomUUID(), reference, type, receivedAt: now });
    store.audit.push({ id: crypto.randomUUID(), event: 'provider.' + type, subject: order.id, at: now });
    return { received: true, reference, status: order.status };
  });
}
async function profileForUser(userId, orderId) {
  const store = await loadStore();
  const order = store.orders.find(x => x.id === orderId && x.userId === userId);
  if (!order) throw Object.assign(new Error('eSIM order not found.'), { statusCode: 404 });
  if (!['profile_issued', 'active'].includes(order.status)) throw Object.assign(new Error('The provider has not issued an installable eSIM profile yet.'), { statusCode: 409 });
  return {
    activationCode: decryptSecret(order.encryptedActivationCode),
    confirmationCode: order.encryptedConfirmationCode ? decryptSecret(order.encryptedConfirmationCode) : '',
    reference: order.reference
  };
}
async function dashboard() {
  const store = await loadStore();
  const count = status => store.orders.filter(x => x.status === status).length;
  return {
    provider: providerStatus(),
    totals: {
      subscribers: store.users.length, plans: store.plans.length,
      publishedPlans: store.plans.filter(x => x.status === 'published').length,
      orders: store.orders.length, awaitingPartner: count('awaiting_partner'),
      provisioning: count('provisioning'), profilesIssued: count('profile_issued'),
      activeProfiles: count('active'), providerErrors: count('provider_error')
    },
    plans: store.plans.map(x => ({ id: x.id, name: x.name, dataMb: x.dataMb, validityDays: x.validityDays, priceMinor: x.priceMinor, currency: x.currency, status: x.status, networkModes: x.networkModes })),
    recentOrders: store.orders.slice(-30).reverse().map(orderView)
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
  const p = url.pathname, m = req.method;
  if (p === '/health' && m === 'GET') {
    await fsp.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
    await loadStore();
    return send(res, 200, { ok: true, service: 'Expert eSIM', persistentStoreReady: true, provider: providerStatus() });
  }
  if ((p === '/api/status' || p === '/api/v1/status') && m === 'GET') {
    const cfg = providerStatus();
    return send(res, 200, {
      ok: true, service: 'Expert eSIM', product: 'branded-mvno-platform-foundation',
      subscriberAccounts: true, persistentSubscriberStore: true,
      providerProvisioning: readyToSell() ? 'configured' : 'awaiting-authorised-partner',
      profileEncryption: cfg.profileEncryptionConfigured ? 'configured' : 'not-configured',
      cellularDataProvisioning: 'not-active-until-host-network-confirms',
      message: 'Account, plan and eSIM order management is available. Live cellular data requires an authorised host-network and SM-DP+ provider.'
    });
  }
  if (p === '/api/esim/status' && m === 'GET') return send(res, 200, { ok: true, connected: false, providerConfigured: readyToSell(), profileIssued: false, message: 'A host-network and authorised eSIM provider must issue a profile before Expert eSIM can connect.' });

  if (p === '/api/v1/auth/register' && m === 'POST') {
    const result = await register(await body(req));
    return send(res, 201, { ok: true, ...result });
  }
  if (p === '/api/v1/auth/login' && m === 'POST') {
    const result = await login(await body(req));
    return send(res, 200, { ok: true, ...result });
  }
  if (p === '/api/v1/auth/logout' && m === 'POST') {
    const token = tokenFrom(req), tokenHash = token ? hashToken(token) : '';
    await transact(store => { store.sessions = store.sessions.filter(x => x.tokenHash !== tokenHash); });
    return send(res, 200, { ok: true });
  }
  if (p === '/api/v1/me' && m === 'GET') {
    const user = await signedIn(req), store = await loadStore();
    const orders = store.orders.filter(x => x.userId === user.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map(orderView);
    return send(res, 200, { ok: true, user: userView(user), orders });
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
    return send(res, result.status === 'awaiting_partner' ? 202 : 201, { ok: true, order: result, message: result.message });
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
      return send(res, 201, { ok: true, plan, message: 'Plan saved as a draft. It cannot be published until the provider and host-network requirements are satisfied.' });
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
  try { await route(req, res, url); } catch (error) { fail(res, error); }
});
server.listen(PORT, '0.0.0.0', () => console.log('Expert eSIM API listening on port ' + PORT));
server.on('error', error => { console.error('Expert eSIM server error:', error.message); process.exitCode = 1; });
);
  if (modern.length === 4 && modern[0] === 'scrypt') {
    const N = Number(modern[1]);
    if (N !== 32768 || !/^[a-f0-9]{32}$/.test(modern[2]) || !/^[a-f0-9]{128}$/.test(modern[3])) return false;
    const actual = crypto.scryptSync(String(password || ''), modern[2], 64, { N, r: 8, p: 1, maxmem: 128 * 1024 * 1024 }).toString('hex');
    return equal(actual, modern[3]);
  }
  const legacy = text.split(':');
  if (legacy.length !== 2) return false;
  return equal(crypto.scryptSync(String(password || ''), legacy[0], 64).toString('hex'), legacy[1]);
}
function hashToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }
function userView(user) {
  return { id: user.id, fullName: user.fullName, email: user.email, phone: user.phone || null, kycStatus: user.kycStatus, createdAt: user.createdAt };
}
function orderView(order) {
  return {
    id: order.id, reference: order.reference, planId: order.planId, planName: order.planName,
    dataMb: order.dataMb, validityDays: order.validityDays, priceMinor: order.priceMinor,
    currency: order.currency, preferredNetwork: order.preferredNetwork, status: order.status,
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
    const user = {
      id: crypto.randomUUID(), fullName, email, phone,
      passwordHash: hashPassword(password), status: 'active', kycStatus: 'not_started',
      createdAt: new Date().toISOString()
    };
    store.users.push(user);
    store.audit.push({ id: crypto.randomUUID(), event: 'subscriber.registered', subject: user.id, at: user.createdAt });
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
  if (!readyToSell()) throw Object.assign(new Error('Cannot publish plans until the host-network agreement, authorised SM-DP+ partner, provider API and service activation are configured.'), { statusCode: 409 });
  return transact(store => {
    const plan = store.plans.find(x => x.id === planId);
    if (!plan) throw Object.assign(new Error('Plan not found.'), { statusCode: 404 });
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
  const currency = String(data.currency || 'NGN').toUpperCase();
  if (name.length < 2 || name.length > 80) throw Object.assign(new Error('Enter a plan name between 2 and 80 characters.'), { statusCode: 400 });
  if (!Number.isInteger(dataMb) || dataMb < 1) throw Object.assign(new Error('Data allowance must be a positive number of MB.'), { statusCode: 400 });
  if (!Number.isInteger(validityDays) || validityDays < 1 || validityDays > 3650) throw Object.assign(new Error('Validity must be between 1 and 3650 days.'), { statusCode: 400 });
  if (!Number.isSafeInteger(priceMinor) || priceMinor < 0) throw Object.assign(new Error('Price must be provided in minor currency units (kobo for NGN).'), { statusCode: 400 });
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
async function createOrder(user, data) {
  const snapshot = await loadStore();
  const plan = snapshot.plans.find(x => x.id === String(data.planId || '') && x.status === 'published');
  if (!plan) throw Object.assign(new Error('This data package is not available.'), { statusCode: 404 });
  const preferredNetwork = String(data.preferredNetwork || 'auto');
  if (!['auto', '4g', '5g'].includes(preferredNetwork)) throw Object.assign(new Error('Select Automatic, 4G or 5G.'), { statusCode: 400 });
  if (!plan.networkModes.includes(preferredNetwork) && !plan.networkModes.includes('auto')) throw Object.assign(new Error('This plan does not support the selected network mode.'), { statusCode: 400 });
  const providerReady = readyToSell();
  const now = new Date().toISOString();
  const order = {
    id: crypto.randomUUID(), reference: refCode(), userId: user.id, planId: plan.id,
    planName: plan.name, dataMb: plan.dataMb, validityDays: plan.validityDays,
    priceMinor: plan.priceMinor, currency: plan.currency, preferredNetwork,
    status: providerReady ? 'provisioning' : 'awaiting_partner',
    providerOrderId: null, encryptedActivationCode: null, encryptedConfirmationCode: null,
    message: providerReady ? 'Provisioning request is being submitted.' : 'Awaiting an authorised host-network and eSIM provisioning partner. No profile has been issued and no mobile data is active.',
    createdAt: now, updatedAt: now
  };
  await transact(store => {
    store.orders.push(order);
    store.audit.push({ id: crypto.randomUUID(), event: 'esim.order.created', subject: order.id, at: now });
  });
  if (providerReady) {
    try { await attachProviderResult(order.reference, await providerProvision(order, user, plan)); }
    catch {
      await transact(store => {
        const current = store.orders.find(x => x.id === order.id);
        if (current) { current.status = 'provider_error'; current.message = 'Provider did not accept the request. No profile was issued.'; current.updatedAt = new Date().toISOString(); }
      });
    }
  }
  const current = await loadStore();
  return orderView(current.orders.find(x => x.id === order.id));
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
    if (type === 'esim.profile.issued') {
      if (!data.activationCode) throw Object.assign(new Error('Issued-profile event must contain an activation code.'), { statusCode: 400 });
      order.encryptedActivationCode = encryptSecret(String(data.activationCode));
      if (data.confirmationCode) order.encryptedConfirmationCode = encryptSecret(String(data.confirmationCode));
      order.providerOrderId = data.providerOrderId || order.providerOrderId || null;
      order.status = 'profile_issued'; order.profileIssuedAt = now;
      order.message = 'Your authorised Expert eSIM profile is ready to install.';
    } else if (type === 'esim.profile.activated') {
      order.status = 'active'; order.activatedAt = now;
      order.message = 'The provider confirmed your eSIM subscription is active.';
    } else if (type === 'esim.profile.failed') {
      order.status = 'provider_error'; order.message = 'The provider reported a provisioning failure.';
    } else {
      throw Object.assign(new Error('Unsupported provider event type.'), { statusCode: 400 });
    }
    order.updatedAt = now;
    store.providerEvents.push({ id: crypto.randomUUID(), reference, type, receivedAt: now });
    store.audit.push({ id: crypto.randomUUID(), event: 'provider.' + type, subject: order.id, at: now });
    return { received: true, reference, status: order.status };
  });
}
async function profileForUser(userId, orderId) {
  const store = await loadStore();
  const order = store.orders.find(x => x.id === orderId && x.userId === userId);
  if (!order) throw Object.assign(new Error('eSIM order not found.'), { statusCode: 404 });
  if (!['profile_issued', 'active'].includes(order.status)) throw Object.assign(new Error('The provider has not issued an installable eSIM profile yet.'), { statusCode: 409 });
  return {
    activationCode: decryptSecret(order.encryptedActivationCode),
    confirmationCode: order.encryptedConfirmationCode ? decryptSecret(order.encryptedConfirmationCode) : '',
    reference: order.reference
  };
}
async function dashboard() {
  const store = await loadStore();
  const count = status => store.orders.filter(x => x.status === status).length;
  return {
    provider: providerStatus(),
    totals: {
      subscribers: store.users.length, plans: store.plans.length,
      publishedPlans: store.plans.filter(x => x.status === 'published').length,
      orders: store.orders.length, awaitingPartner: count('awaiting_partner'),
      provisioning: count('provisioning'), profilesIssued: count('profile_issued'),
      activeProfiles: count('active'), providerErrors: count('provider_error')
    },
    plans: store.plans.map(x => ({ id: x.id, name: x.name, dataMb: x.dataMb, validityDays: x.validityDays, priceMinor: x.priceMinor, currency: x.currency, status: x.status, networkModes: x.networkModes })),
    recentOrders: store.orders.slice(-30).reverse().map(orderView)
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
  const p = url.pathname, m = req.method;
  if (p === '/health' && m === 'GET') {
    await fsp.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
    await loadStore();
    return send(res, 200, { ok: true, service: 'Expert eSIM', persistentStoreReady: true, provider: providerStatus() });
  }
  if ((p === '/api/status' || p === '/api/v1/status') && m === 'GET') {
    const cfg = providerStatus();
    return send(res, 200, {
      ok: true, service: 'Expert eSIM', product: 'branded-mvno-platform-foundation',
      subscriberAccounts: true, persistentSubscriberStore: true,
      providerProvisioning: readyToSell() ? 'configured' : 'awaiting-authorised-partner',
      profileEncryption: cfg.profileEncryptionConfigured ? 'configured' : 'not-configured',
      cellularDataProvisioning: 'not-active-until-host-network-confirms',
      message: 'Account, plan and eSIM order management is available. Live cellular data requires an authorised host-network and SM-DP+ provider.'
    });
  }
  if (p === '/api/esim/status' && m === 'GET') return send(res, 200, { ok: true, connected: false, providerConfigured: readyToSell(), profileIssued: false, message: 'A host-network and authorised eSIM provider must issue a profile before Expert eSIM can connect.' });

  if (p === '/api/v1/auth/register' && m === 'POST') {
    const result = await register(await body(req));
    return send(res, 201, { ok: true, ...result });
  }
  if (p === '/api/v1/auth/login' && m === 'POST') {
    const result = await login(await body(req));
    return send(res, 200, { ok: true, ...result });
  }
  if (p === '/api/v1/auth/logout' && m === 'POST') {
    const token = tokenFrom(req), tokenHash = token ? hashToken(token) : '';
    await transact(store => { store.sessions = store.sessions.filter(x => x.tokenHash !== tokenHash); });
    return send(res, 200, { ok: true });
  }
  if (p === '/api/v1/me' && m === 'GET') {
    const user = await signedIn(req), store = await loadStore();
    const orders = store.orders.filter(x => x.userId === user.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map(orderView);
    return send(res, 200, { ok: true, user: userView(user), orders });
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
    return send(res, result.status === 'awaiting_partner' ? 202 : 201, { ok: true, order: result, message: result.message });
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
      return send(res, 201, { ok: true, plan, message: 'Plan saved as a draft. It cannot be published until the provider and host-network requirements are satisfied.' });
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
  try { await route(req, res, url); } catch (error) { fail(res, error); }
});
server.listen(PORT, '0.0.0.0', () => console.log('Expert eSIM API listening on port ' + PORT));
server.on('error', error => { console.error('Expert eSIM server error:', error.message); process.exitCode = 1; });
