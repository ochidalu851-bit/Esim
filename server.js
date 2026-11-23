'use strict';

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createGlobalEsim } = require('./global-esim');
const { createExpertFeatures } = require('./expert-features');

const PORT = Number(process.env.PORT || 8080);
const PUBLIC_DIR = path.resolve(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || '/data';
const STORE_FILE = path.join(DATA_DIR, 'expert-esim-store.json');
const MAX_BODY = 65536;
const SESSION_DAYS = 30;
let writeQueue = Promise.resolve();

function emptyStore() {
  return { version: 1, users: [], sessions: [], plans: [], orders: [], devices: [], profiles: [], audit: [], providerEvents: [], paymentEvents: [], consents: [], supportTickets: [], privacyRequests: [], rewardLedger: [], rewardClaims: [], speedTests: [], referrals: [], coupons: [], couponClaims: [], redeemCodes: [], storeItems: [], storeOrders: [], airtimeRequests: [], featureMessages: [], dataGrants: [] };
}
function normalizeStore(store) {
  for (const key of ['users','sessions','plans','orders','devices','profiles','audit','providerEvents','paymentEvents','consents','supportTickets','privacyRequests','rewardLedger','rewardClaims','speedTests','referrals','coupons','couponClaims','redeemCodes','storeItems','storeOrders','airtimeRequests','featureMessages','dataGrants']) {
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
const expertFeatures = createExpertFeatures({ loadStore, transact });
function userView(user) {
  return { id: user.id, fullName: user.fullName, email: user.email, phone: user.phone || null, referralCode: user.referralCode || null, kycStatus: user.kycStatus || 'not_started', emailVerified: Boolean(user.emailVerified), createdAt: user.createdAt };
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
      referralCode: 'EX' + crypto.randomBytes(5).toString('hex').toUpperCase(),
      createdAt: now
    };
    store.users.push(user);
    const referralCode = String(bodyData.referralCode || '').trim().toUpperCase();
    if (referralCode) {
      const referrer = store.users.find(x => x.id !== user.id && x.referralCode === referralCode && x.status === 'active');
      if (referrer) store.referrals.push({ id: crypto.randomUUID(), referrerUserId: referrer.id, invitedUserId: user.id, status: 'pending', createdAt: now });
    }
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
    engagement: await expertFeatures.adminSummary(),
    recentSubscribers: store.users.slice(-100).reverse().map(userView),
    recentDevices: store.devices.slice(-100).reverse().map(device => {
      const latest = store.profiles.filter(x => x.deviceId === device.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
      return { id: device.id, deviceName: device.deviceName, manufacturer: device.manufacturer || null, platform: device.platform, model: device.model || null, osVersion: device.osVersion || null, eSimSupportKnown: device.eSimSupportKnown === true, hasEuiccHardware: typeof device.hasEuiccHardware === 'boolean' ? device.hasEuiccHardware : null, euiccEnabled: typeof device.euiccEnabled === 'boolean' ? device.euiccEnabled : null, latestProfile: latest ? { id: latest.id, reference: latest.reference, status: latest.status, message: latest.message || '' } : null };
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
      'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    });
    if (req.method === 'HEAD') return res.end();
    res.end(content);
  });
}
async function route(req, res, url) {
  if (url.pathname === '/api/v1/tools/speedtest/ping' && req.method === 'GET') {
    res.writeHead(204, { 'cache-control': 'no-store', 'access-control-allow-origin': 'same-origin' });
    return res.end();
  }
  if (url.pathname === '/api/v1/tools/speedtest/download' && req.method === 'GET') {
    const requested = Number(url.searchParams.get('bytes') || 1000000);
    const bytes = Math.max(1, Math.min(10000000, Number.isFinite(requested) ? Math.floor(requested) : 1000000));
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': bytes, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    return res.end(crypto.randomBytes(bytes));
  }
  if (url.pathname === '/api/v1/tools/speedtest/upload' && req.method === 'POST') {
    let receivedBytes = 0;
    for await (const chunk of req) {
      receivedBytes += chunk.length;
      if (receivedBytes > 10000000) throw Object.assign(new Error('Speed-test upload is larger than 10 MB.'), { statusCode: 413 });
    }
    return send(res, 200, { ok: true, receivedBytes, measuredAt: new Date().toISOString() });
  }
  const legacyCheckout = url.pathname === '/api/v1/plans' ||
    url.pathname === '/api/v1/esim/orders' ||
    url.pathname.startsWith('/api/v1/esim/orders/') ||
    url.pathname.startsWith('/api/v1/payments/') ||
    url.pathname === '/api/v1/admin/plans' ||
    url.pathname.startsWith('/api/v1/admin/plans/');
  if (legacyCheckout) return send(res, 410, { ok: false, code: 'SPONSORED_DEVICE_PROFILE_FLOW', error: 'Customer data-package sales are disabled. Register a device and request its sponsored eSIM profile.' });
  const p = url.pathname, m = req.method;

  // GENIEX-style mobile client routes. These expose real readiness only; no
  // catalogue, carrier usage, payment, ad reward or network access is simulated.
  if (p === '/api/v1/geniex/status' && m === 'GET') {
    const cfg = providerStatus();
    return send(res, 200, {
      ok: true,
      networkProviderConfigured: cfg.globalConnectivityPartnerConfigured && cfg.profileProviderConfigured && cfg.smdpPartnerConfigured && cfg.globalCoverageConfirmed,
      dataCatalogueConfigured: false,
      usageFeedConfigured: false,
      walletProviderConfigured: false,
      sponsorProviderConfigured: false,
      esimProvisioningConfigured: readyToProvisionGlobally(),
      message: 'The app interface is ready. Live mobile connectivity, bundle inventory, carrier usage, cash wallet and sponsor rewards require their authorised providers.'
    });
  }
  if (p === '/api/v1/geniex/catalog' && m === 'GET') {
    return send(res, 200, { ok: true, plans: [], bundles: [], message: 'No authorised data-plan or app-bundle catalogue is connected.' });
  }
  if (p === '/api/v1/geniex/usage' && m === 'GET') {
    return send(res, 200, { ok: true, usage: { available: false, usedMb: null, remainingMb: null, message: 'An authenticated carrier usage feed is not connected.' } });
  }
  if (p === '/api/v1/geniex/connect' && m === 'POST') {
    await signedIn(req);
    return send(res, 503, { ok: false, connected: false, code: 'NETWORK_PROVIDER_NOT_CONFIGURED', error: 'No authorised mobile-network provider and active subscriber service are connected. No mobile-data session was started.' });
  }
  if (p === '/api/v1/geniex/disconnect' && m === 'POST') {
    await signedIn(req);
    return send(res, 409, { ok: false, connected: false, code: 'NO_ACTIVE_NETWORK_SESSION', error: 'There is no active provider-backed mobile-data session to disconnect.' });
  }
  if (p === '/api/v1/geniex/data/order' && m === 'POST') {
    await signedIn(req);
    return send(res, 503, { ok: false, error: 'Data-plan inventory and provider fulfilment are not connected.' });
  }
  if (p === '/api/v1/geniex/app-bundle/order' && m === 'POST') {
    await signedIn(req);
    return send(res, 503, { ok: false, error: 'App-bundle inventory and provider fulfilment are not connected.' });
  }
  if (p === '/api/v1/geniex/balance/recharge' && m === 'POST') {
    await signedIn(req);
    return send(res, 503, { ok: false, error: 'A regulated wallet and payment provider are not connected. No money has been charged.' });
  }
  if (p === '/api/v1/geniex/balance/transfer' && m === 'POST') {
    await signedIn(req);
    return send(res, 503, { ok: false, error: 'Cash balance transfer is unavailable because a regulated wallet provider is not connected.' });
  }
  if (p === '/api/v1/geniex/balance/exchange' && m === 'POST') {
    await signedIn(req);
    return send(res, 503, { ok: false, error: 'G-Coin exchange into cash requires an authorised wallet partner and an approved exchange rule.' });
  }
  if (p === '/api/v1/geniex/ad-reward/claim' && m === 'POST') {
    await signedIn(req);
    return send(res, 503, { ok: false, error: 'No sponsor or rewarded-ad provider is connected, so no free-data reward can be issued.' });
  }
  if (p === '/api/v1/geniex/boost' && m === 'POST') {
    await signedIn(req);
    return send(res, 503, { ok: false, error: 'Network speed-boost controls require the active carrier provider and its authorised API.' });
  }
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
  if (p === '/api/v1/auth/change-password' && m === 'POST') {
    const user = await signedIn(req), data = await body(req);
    const currentPassword = String(data.currentPassword || ''), newPassword = String(data.newPassword || '');
    if (!verifyPassword(currentPassword, user.passwordHash)) throw Object.assign(new Error('Current password is incorrect.'), { statusCode: 403 });
    if (newPassword.length < 10 || newPassword.length > 256 || newPassword === currentPassword) throw Object.assign(new Error('Choose a different password with at least 10 characters.'), { statusCode: 400 });
    const keepTokenHash = hashToken(tokenFrom(req));
    await transact(store => {
      const member = store.users.find(x => x.id === user.id && x.status === 'active');
      if (!member) throw Object.assign(new Error('Account is unavailable.'), { statusCode: 403 });
      member.passwordHash = hashPassword(newPassword);
      member.passwordChangedAt = new Date().toISOString();
      store.sessions = store.sessions.filter(x => x.userId !== user.id || x.tokenHash === keepTokenHash);
      store.audit.push({ id: crypto.randomUUID(), event: 'subscriber.password_changed', subject: user.id, at: member.passwordChangedAt });
    });
    return send(res, 200, { ok: true, message: 'Your password was changed. Other signed-in sessions were signed out.' });
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
  if (p === '/api/v1/app/summary' && m === 'GET') {
    return send(res, 200, { ok: true, summary: await expertFeatures.summary(await signedIn(req)) });
  }
  if (p === '/api/v1/app/preferences' && m === 'GET') {
    return send(res, 200, { ok: true, preferences: await expertFeatures.getPreferences(await signedIn(req)) });
  }
  if (p === '/api/v1/app/preferences' && m === 'PATCH') {
    const result = await expertFeatures.updatePreferences(await signedIn(req), await body(req));
    return send(res, 200, { ok: true, preferences: result });
  }
  if (p === '/api/v1/app/check-in' && m === 'POST') {
    return send(res, 201, { ok: true, ...(await expertFeatures.checkIn(await signedIn(req))) });
  }
  if (p === '/api/v1/app/spin' && m === 'POST') {
    return send(res, 201, { ok: true, ...(await expertFeatures.spinReward(await signedIn(req))) });
  }
  const taskClaim = p.match(/^\/api\/v1\/app\/tasks\/([a-z0-9_-]+)\/claim$/i);
  if (taskClaim && m === 'POST') return send(res, 201, { ok: true, ...(await expertFeatures.claimTask(await signedIn(req), taskClaim[1])) });
  if (p === '/api/v1/app/wallet' && m === 'GET') return send(res, 200, { ok: true, wallet: await expertFeatures.wallet(await signedIn(req)) });
  if (p === '/api/v1/app/wallet/transfer' && m === 'POST') return send(res, 201, { ok: true, ...(await expertFeatures.transferPoints(await signedIn(req), await body(req))) });
  if (p === '/api/v1/app/referrals' && m === 'GET') return send(res, 200, { ok: true, referrals: await expertFeatures.referrals(await signedIn(req)) });
  if (p === '/api/v1/app/coupons' && m === 'GET') return send(res, 200, { ok: true, coupons: await expertFeatures.coupons(await signedIn(req)) });
  const couponClaim = p.match(/^\/api\/v1\/app\/coupons\/([0-9a-f-]{36})\/claim$/i);
  if (couponClaim && m === 'POST') return send(res, 201, { ok: true, ...(await expertFeatures.claimCoupon(await signedIn(req), couponClaim[1])) });
  if (p === '/api/v1/app/redeem-code' && m === 'POST') return send(res, 201, { ok: true, ...(await expertFeatures.redeemCode(await signedIn(req), await body(req))) });
  if (p === '/api/v1/app/store' && m === 'GET') return send(res, 200, { ok: true, store: await expertFeatures.storeCatalog(await signedIn(req)) });
  const storeRedeem = p.match(/^\/api\/v1\/app\/store\/([0-9a-f-]{36})\/redeem$/i);
  if (storeRedeem && m === 'POST') return send(res, 201, { ok: true, order: await expertFeatures.redeemItem(await signedIn(req), storeRedeem[1]) });
  if (p === '/api/v1/app/airtime' && m === 'GET') return send(res, 200, { ok: true, requests: await expertFeatures.airtimeHistory(await signedIn(req)) });
  if (p === '/api/v1/app/airtime' && m === 'POST') return send(res, 202, { ok: true, request: await expertFeatures.airtimeRequest(await signedIn(req), await body(req)) });
  if (p === '/api/v1/app/messages' && m === 'GET') return send(res, 200, { ok: true, messages: await expertFeatures.messages(await signedIn(req)) });
  const messageRead = p.match(/^\/api\/v1\/app\/messages\/([0-9a-f-]{36})\/read$/i);
  if (messageRead && m === 'POST') return send(res, 200, { ok: true, message: await expertFeatures.markMessageRead(await signedIn(req), messageRead[1]) });
  if (p === '/api/v1/app/speed-test' && m === 'POST') return send(res, 201, { ok: true, test: await expertFeatures.recordSpeedTest(await signedIn(req), await body(req)) });
  if (p === '/api/v1/devices' && m === 'GET') return send(res, 200, { ok: true, devices: await globalEsim.listDevices(await signedIn(req)) });
  if (p === '/api/v1/devices' && m === 'POST') return send(res, 201, { ok: true, device: await globalEsim.registerDevice(await signedIn(req), await body(req)) });
  const deviceProfilePath = p.match(/^\/api\/v1\/devices\/([0-9a-f-]{36})\/profile$/i);
  if (deviceProfilePath && m === 'POST') {
    const profile = await globalEsim.requestProfile(await signedIn(req), deviceProfilePath[1]);
    return send(res, ['profile_issued','active'].includes(profile.status) ? 201 : 202, { ok: true, profile, message: profile.message });
  }
  if (deviceProfilePath && m === 'GET') return send(res, 200, { ok: true, profile: await globalEsim.getProfile(await signedIn(req), deviceProfilePath[1]) });
  if (p === '/api/v1/global-esim/webhook' && m === 'POST') return send(res, 200, { ok: true, ...(await globalEsim.handleWebhook(await rawBody(req), req.headers['x-expert-signature'])) });
  if (p === '/api/v1/kyc/webhook' && m === 'POST') {
    const result = await kycWebhook(await rawBody(req), req.headers['x-kyc-signature']);
    return send(res, 200, { ok: true, ...result });
  }
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
  if (p.startsWith('/api/v1/admin/')) {
    if (!adminOk(req)) return send(res, 401, { ok: false, error: 'Admin authentication is required.' });
    if (p === '/api/v1/admin/dashboard' && m === 'GET') return send(res, 200, { ok: true, dashboard: await dashboard() });
    if (p === '/api/v1/admin/features' && m === 'GET') return send(res, 200, { ok: true, engagement: await expertFeatures.adminSummary(), records: await expertFeatures.adminListOrders() });
    if (p === '/api/v1/admin/features/fulfilment' && m === 'POST') {
      return send(res, 200, { ok: true, record: await expertFeatures.adminUpdateFulfilment(await body(req)) });
    }
    if (p === '/api/v1/admin/coupons' && m === 'POST') return send(res, 201, { ok: true, coupon: await expertFeatures.adminCreateCoupon(await body(req)) });
    if (p === '/api/v1/admin/rewards/items' && m === 'POST') return send(res, 201, { ok: true, item: await expertFeatures.adminCreateStoreItem(await body(req)) });
    if (p === '/api/v1/admin/rewards/codes' && m === 'POST') return send(res, 201, { ok: true, code: await expertFeatures.adminCreateCode(await body(req)) });
    if (p === '/api/v1/admin/messages' && m === 'POST') return send(res, 201, { ok: true, message: await expertFeatures.adminSendMessage(await body(req)) });
    const pointAdjustment = p.match(/^\/api\/v1\/admin\/users\/([0-9a-f-]{36})\/points$/i);
    if (pointAdjustment && m === 'POST') return send(res, 200, { ok: true, ...(await expertFeatures.adminAdjustPoints(pointAdjustment[1], await body(req))) });

    if (p === '/api/v1/admin/users' && m === 'GET') {
      const store = await loadStore();
      return send(res, 200, { ok: true, users: store.users.map(userView) });
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
    if (['POST','PUT','PATCH','DELETE'].includes(req.method) && !['/api/v1/kyc/webhook'].includes(url.pathname)) enforceSameOrigin(req);
    if (['POST','PUT','PATCH','DELETE'].includes(req.method) && url.pathname.startsWith('/api/v1/admin/')) rateLimit(req, 'admin', 120, 60 * 1000);
    await route(req, res, url);
  } catch (error) { fail(res, error); }
});
server.listen(PORT, '0.0.0.0', () => console.log('Expert eSIM API listening on port ' + PORT));
server.on('error', error => { console.error('Expert eSIM server error:', error.message); process.exitCode = 1; });
