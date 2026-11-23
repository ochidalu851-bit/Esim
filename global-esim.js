'use strict';

function createGlobalEsim({ loadStore, transact, hashToken, encryptSecret, decryptSecret, isReady }) {
  function profileView(profile) {
    return { id: profile.id, reference: profile.reference, deviceId: profile.deviceId,
      status: profile.status, dataPolicy: 'sponsored-unlimited', coverageScope: profile.coverageScope || null,
      unlimitedDataConfirmed: Boolean(profile.unlimitedDataConfirmed), coverageConfirmed: Boolean(profile.coverageConfirmed),
      providerProfileId: profile.providerProfileId || null, verificationRequired: Boolean(profile.verificationRequired),
      message: profile.message || '', createdAt: profile.createdAt, updatedAt: profile.updatedAt,
      issuedAt: profile.issuedAt || null, activatedAt: profile.activatedAt || null };
  }
  function deviceView(device, profile) {
    return {
      id: device.id, deviceName: device.deviceName, manufacturer: device.manufacturer || null,
      platform: device.platform, model: device.model || null, osVersion: device.osVersion || null,
      eSimSupportKnown: device.eSimSupportKnown === true,
      hasEuiccHardware: typeof device.hasEuiccHardware === 'boolean' ? device.hasEuiccHardware : null,
      euiccEnabled: typeof device.euiccEnabled === 'boolean' ? device.euiccEnabled : null,
      status: device.status, createdAt: device.createdAt,
      latestProfile: profile ? profileView(profile) : null
    };
  }
  async function listDevices(user) {
    const store = await loadStore();
    return store.devices.filter(x => x.userId === user.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map(device => {
      const latest = store.profiles.filter(x => x.deviceId === device.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
      return deviceView(device, latest);
    });
  }
  async function registerDevice(user, data) {
    const crypto = require('node:crypto');
    const clientId = String(data.clientDeviceId || '').trim();
    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(clientId)) throw Object.assign(new Error('Device identification is invalid.'), { statusCode: 400 });
    const platform = String(data.platform || 'other').toLowerCase();
    if (!['android','ios','other'].includes(platform)) throw Object.assign(new Error('Unsupported device platform.'), { statusCode: 400 });
    const manufacturer = String(data.manufacturer || '').trim().slice(0,80);
    const model = String(data.model || '').trim().slice(0,100);
    const name = String(data.deviceName || [manufacturer, model].filter(Boolean).join(' ') || 'This device').trim().slice(0,100);
    const osVersion = String(data.osVersion || '').trim().slice(0,40);
    const eSimSupportKnown = data.eSimSupportKnown === true;
    const hasEuiccHardware = eSimSupportKnown ? data.hasEuiccHardware === true : null;
    const euiccEnabled = eSimSupportKnown ? data.euiccEnabled === true : null;
    const clientHash = hashToken(clientId);
    return transact(store => {
      let device = store.devices.find(x => x.userId === user.id && x.clientDeviceHash === clientHash);
      if (device) {
        Object.assign(device, { deviceName: name, manufacturer, platform, model, osVersion, eSimSupportKnown, hasEuiccHardware, euiccEnabled, updatedAt: new Date().toISOString() });
      } else {
        const now = new Date().toISOString();
        device = { id: crypto.randomUUID(), userId: user.id, clientDeviceHash: clientHash, deviceName: name, manufacturer, platform, model, osVersion, eSimSupportKnown, hasEuiccHardware, euiccEnabled, status: 'registered', createdAt: now, updatedAt: now };
        store.devices.push(device);
        store.audit.push({ id: crypto.randomUUID(), event: 'device.registered', subject: device.id, at: now });
      }
      const latest = store.profiles.filter(x => x.deviceId === device.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt))[0] || null;
      return deviceView(device, latest);
    });
  }
  async function provisionProfile(profileId) {
    const crypto = require('node:crypto');
    const snapshot = await loadStore();
    const profile = snapshot.profiles.find(x => x.id === profileId);
    if (!profile) throw Object.assign(new Error('Profile request not found.'), { statusCode: 404 });
    const user = snapshot.users.find(x => x.id === profile.userId);
    const device = snapshot.devices.find(x => x.id === profile.deviceId);
    if (!user || !device) throw new Error('Subscriber device is unavailable.');
    if (!user.emailVerified) {
      await transact(store => {
        const item = store.profiles.find(x => x.id === profileId);
        if (item) { item.status = 'awaiting_verification'; item.message = 'Verify the email address on your Expert eSIM account before the provider can issue this profile.'; item.updatedAt = new Date().toISOString(); }
      });
      return;
    }
    if (!isReady()) return;
    await transact(store => {
      const item = store.profiles.find(x => x.id === profileId);
      if (item) { item.status = 'provisioning'; item.message = 'Requesting a unique sponsored eSIM profile for this device.'; item.updatedAt = new Date().toISOString(); }
    });
    try {
      const base = (process.env.EXPERT_ESIM_PUBLIC_URL || 'https://' + (process.env.RAILWAY_PUBLIC_DOMAIN || 'expert-esim-web-production.up.railway.app')).replace(/\/$/, '');
      const response = await fetch(process.env.GLOBAL_ESIM_PROFILE_API_URL, {
        method: 'POST',
        headers: { authorization: 'Bearer ' + process.env.GLOBAL_ESIM_PROFILE_API_KEY, 'content-type': 'application/json', accept: 'application/json', 'idempotency-key': profile.reference },
        body: JSON.stringify({
          reference: profile.reference,
          subscriber: { subscriberReference: user.id, name: user.fullName, email: user.email },
          device: { deviceReference: device.id, name: device.deviceName, platform: device.platform, model: device.model || undefined },
          service: { type: 'mobile-data', dataPolicy: 'unlimited', funding: 'sponsored-by-expert-esim', roamingScope: 'global' },
          callbackUrl: base + '/api/v1/global-esim/webhook'
        }),
        signal: AbortSignal.timeout(20000)
      });
      const raw = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error('Global eSIM provider responded with HTTP ' + response.status);
      const data = raw.data || raw, detail = data.profile || data.simProfile || {};
      let code = data.activationCode || detail.activationCode || '';
      if (!code && detail.smdpAddress && detail.matchingId) code = detail.smdpAddress + '$' + detail.matchingId;
      const unlimited = data.unlimitedData === true || data.dataPolicy === 'unlimited' || (data.service && data.service.dataPolicy === 'unlimited');
      const global = data.coverageScope === 'global' || data.roamingScope === 'global' || (data.service && data.service.roamingScope === 'global');
      await transact(store => {
        const item = store.profiles.find(x => x.id === profileId);
        if (!item) return;
        item.providerProfileId = data.profileId || detail.id || data.subscriptionId || null;
        item.unlimitedDataConfirmed = unlimited; item.coverageConfirmed = global; item.coverageScope = global ? 'global' : 'unconfirmed';
        if (data.verificationRequired === true) {
          item.status = 'verification_required'; item.verificationRequired = true;
          item.message = 'The connectivity provider requires an additional identity or eligibility check for this destination.';
        } else if (['failed','rejected'].includes(data.status)) {
          item.status = 'provider_error'; item.message = 'The provider rejected this device request. No profile was issued.';
        } else if (code && unlimited && global) {
          item.encryptedActivationCode = encryptSecret(String(code));
          if (data.confirmationCode || detail.confirmationCode) item.encryptedConfirmationCode = encryptSecret(String(data.confirmationCode || detail.confirmationCode));
          item.status = 'profile_issued'; item.issuedAt = new Date().toISOString();
          item.message = 'The provider confirmed this device profile with unlimited-data and global-roaming attributes.';
        } else if (!unlimited || !global) {
          item.status = 'partner_review'; item.message = 'Unlimited data and global roaming were not confirmed. Activation details are withheld.';
        } else {
          item.status = 'provisioning'; item.message = 'Provider accepted the request. Waiting for its signed profile-issued callback.';
        }
        item.updatedAt = new Date().toISOString();
        store.audit.push({ id: crypto.randomUUID(), event: 'device.profile_provider_response', subject: item.id, at: item.updatedAt });
      });
    } catch (error) {
      await transact(store => { const item = store.profiles.find(x => x.id === profileId); if (item) { item.status = 'provider_error'; item.message = 'The provider could not complete this device profile request.'; item.updatedAt = new Date().toISOString(); } });
      throw error;
    }
  }
  async function requestProfile(user, deviceId) {
    const crypto = require('node:crypto');
    const snapshot = await loadStore(), device = snapshot.devices.find(x => x.id === deviceId && x.userId === user.id);
    if (!device) throw Object.assign(new Error('This device is not registered to your account.'), { statusCode: 404 });
    if (device.eSimSupportKnown === true && device.hasEuiccHardware === false) {
      throw Object.assign(new Error('This phone does not have eSIM hardware. Use an eSIM-compatible phone to request a profile.'), { statusCode: 409 });
    }
    if (device.eSimSupportKnown === true && device.hasEuiccHardware === true && device.euiccEnabled === false) {
      throw Object.assign(new Error('eSIM hardware was detected, but eSIM support is disabled on this phone.'), { statusCode: 409 });
    }
    let profile = snapshot.profiles.filter(x => x.deviceId === device.id && x.userId === user.id && !['provider_error','cancelled'].includes(x.status)).sort((a,b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (profile) {
      if (profile.status === 'verification_required' && user.kycStatus === 'verified') {
        await transact(store => {
          const item = store.profiles.find(x => x.id === profile.id);
          if (item) { item.status = 'awaiting_partners'; item.verificationRequired = false; item.message = 'Identity verification is complete. Checking global profile-provider readiness.'; item.updatedAt = new Date().toISOString(); }
        });
        const fresh = await loadStore(); profile = fresh.profiles.find(x => x.id === profile.id) || profile;
      }
      if (['awaiting_partners','awaiting_verification'].includes(profile.status) && isReady()) {
        await provisionProfile(profile.id);
        const latest = await loadStore(); profile = latest.profiles.find(x => x.id === profile.id) || profile;
      }
      return profileView(profile);
    }
    const now = new Date().toISOString();
    profile = {
      id: crypto.randomUUID(), reference: 'EXG-' + now.replace(/[-:TZ.]/g,'').slice(0,14) + '-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
      userId: user.id, deviceId: device.id,
      status: user.emailVerified ? 'awaiting_partners' : 'awaiting_verification',
      dataPolicy: 'sponsored-unlimited',
      coverageScope: null, unlimitedDataConfirmed: false, coverageConfirmed: false,
      providerProfileId: null, encryptedActivationCode: null, encryptedConfirmationCode: null,
      verificationRequired: false,
      message: user.emailVerified
        ? 'Awaiting a contracted global connectivity partner and authorised eSIM profile provider.'
        : 'Device registered. Verify your account email before the provider can issue this profile.',
      createdAt: now, updatedAt: now
    };
    await transact(store => { store.profiles.push(profile); store.audit.push({ id: crypto.randomUUID(), event: 'device.profile_requested', subject: profile.id, at: now }); });
    if (isReady()) await provisionProfile(profile.id);
    const latest = await loadStore(); return profileView(latest.profiles.find(x => x.id === profile.id) || profile);
  }
  async function getProfile(user, deviceId) {
    const store = await loadStore(), device = store.devices.find(x => x.id === deviceId && x.userId === user.id);
    if (!device) throw Object.assign(new Error('This device is not registered to your account.'), { statusCode: 404 });
    const profile = store.profiles.filter(x => x.deviceId === deviceId && x.userId === user.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!profile || !['profile_issued','active'].includes(profile.status) || !profile.encryptedActivationCode) throw Object.assign(new Error('A provider-issued profile is not ready for this device.'), { statusCode: 409 });
    return { ...profileView(profile), activationCode: decryptSecret(profile.encryptedActivationCode), confirmationCode: profile.encryptedConfirmationCode ? decryptSecret(profile.encryptedConfirmationCode) : '' };
  }
  async function handleWebhook(raw, signature) {
    const crypto = require('node:crypto'), secret = process.env.ESIM_PROVIDER_WEBHOOK_SECRET || '';
    if (!secret) throw Object.assign(new Error('eSIM provider webhook authentication is not configured.'), { statusCode: 503 });
    const expected = crypto.createHmac('sha256', secret).update(raw).digest(), supplied = Buffer.from(String(signature || '').replace(/^sha256=/i,'').trim(),'hex');
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied,expected)) throw Object.assign(new Error('Invalid eSIM provider signature.'), { statusCode: 401 });
    let event; try { event = JSON.parse(raw.toString('utf8')); } catch { throw Object.assign(new Error('Webhook body must be valid JSON.'), { statusCode: 400 }); }
    const data = event.data || event, reference = String(data.reference || event.reference || ''), type = String(event.type || event.event || '');
    if (!reference) throw Object.assign(new Error('Provider event is missing its profile reference.'), { statusCode: 400 });
    return transact(store => {
      const item = store.profiles.find(x => x.reference === reference || (data.profileId && x.providerProfileId === String(data.profileId)));
      if (!item) throw Object.assign(new Error('Profile request not found.'), { statusCode: 404 });
      const eventId = String(event.id || data.eventId || reference + ':' + type);
      if (store.providerEvents.some(x => x.id === eventId)) return { received: true, duplicate: true, status: item.status };
      const now = new Date().toISOString(), unlimited = data.unlimitedData === true || data.dataPolicy === 'unlimited', global = data.coverageScope === 'global' || data.roamingScope === 'global';
      if (type === 'esim.profile.issued') {
        const code = data.activationCode || (data.profile && data.profile.activationCode);
        if (!code) throw Object.assign(new Error('Issued callback must contain provider-issued activation details.'), { statusCode: 400 });
        if (!unlimited || !global) {
          item.status = 'partner_review'; item.message = 'Unlimited data and global roaming were not confirmed. Activation details are withheld.';
        } else {
          item.encryptedActivationCode = encryptSecret(String(code));
          if (data.confirmationCode) item.encryptedConfirmationCode = encryptSecret(String(data.confirmationCode));
          item.providerProfileId = data.profileId || item.providerProfileId || null;
          item.unlimitedDataConfirmed = true; item.coverageConfirmed = true; item.coverageScope = 'global';
          item.status = 'profile_issued'; item.issuedAt = now; item.message = 'The provider issued this device profile.';
        }
      } else if (type === 'esim.profile.activated') {
        if (!item.encryptedActivationCode || !item.unlimitedDataConfirmed || !item.coverageConfirmed) throw Object.assign(new Error('Verified global unlimited profile has not been issued.'), { statusCode: 409 });
        item.status = 'active'; item.activatedAt = now; item.message = 'The provider confirmed this device profile is active.';
      } else if (type === 'esim.profile.failed') {
        item.status = 'provider_error'; item.message = 'The provider reported a profile provisioning failure.';
      } else throw Object.assign(new Error('Unsupported provider event type.'), { statusCode: 400 });
      item.updatedAt = now; store.providerEvents.push({ id: eventId, reference, type, receivedAt: now });
      store.audit.push({ id: crypto.randomUUID(), event: 'global_esim.' + type, subject: item.id, at: now });
      return { received: true, duplicate: false, reference, status: item.status };
    });
  }
  return { listDevices, registerDevice, requestProfile, getProfile, handleWebhook };
}
module.exports = { createGlobalEsim };
