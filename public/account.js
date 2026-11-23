(function () {
  "use strict";
  const view = document.getElementById("activateView");
  if (!view) return;
  let authMode = "register";
  let legacySessionToken = "";
  try { legacySessionToken = localStorage.getItem("expertEsimAccountToken") || ""; } catch (e) {}
  const $ = id => document.getElementById(id);
  const escapeHtml = value => String(value == null ? "" : value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  view.innerHTML = '<style>' +
    '#activateView [hidden]{display:none!important}' +
    '#activateView .portal-layout{display:grid;gap:14px}' +
    '#activateView .portal-card{display:grid;gap:13px}' +
    '#activateView .portal-label{font-size:11px;font-weight:800;color:#c7d2e3}' +
    '#activateView .portal-input,#activateView .portal-select,#activateView .portal-textarea{width:100%;box-sizing:border-box;min-height:46px;padding:12px;border:1px solid #344257;border-radius:12px;background:#0b121b;color:#f5f7fb;font:inherit;font-size:13px}' +
    '#activateView .portal-textarea{min-height:92px;resize:vertical}' +
    '#activateView .portal-tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px}' +
    '#activateView .portal-tab,#activateView .portal-secondary{padding:11px;border:1px solid #344257;background:#111a26;color:#e9eff8;border-radius:11px;font-size:12px;font-weight:800}' +
    '#activateView .portal-tab.active{border-color:#91acd3;background:#1b2a40}' +
    '#activateView .portal-form{display:grid;gap:11px}' +
    '#activateView .portal-action{border:1px solid #8198c0;background:linear-gradient(145deg,#bdcdec,#879fc9);color:#101725;padding:13px;border-radius:12px;font-size:13px;font-weight:850}' +
    '#activateView .portal-action:disabled{opacity:.55;cursor:not-allowed}' +
    '#activateView .portal-item{display:grid;gap:8px;background:#0d141e;border:1px solid #2c394c;border-radius:14px;padding:13px}' +
    '#activateView .portal-row{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}' +
    '#activateView .portal-meta{color:#9aa9bd;font-size:10px;line-height:1.5}' +
    '#activateView .portal-title{font-weight:850;font-size:14px}' +
    '#activateView .portal-section{font-weight:850;font-size:15px;margin-top:4px}' +
    '#activateView .portal-chip{font-size:9px;color:#c5d6ef;border:1px solid #354860;background:#182638;border-radius:99px;padding:6px 8px}' +
    '#activateView .portal-empty{padding:14px;border:1px dashed #3a485d;border-radius:13px;color:#98a8bd;font-size:11px;line-height:1.55}' +
    '#activateView .portal-notice{padding:12px;border:1px solid #4a4028;background:#201b12;color:#d7c9a4;border-radius:13px;font-size:11px;line-height:1.55}' +
    '#activateView .portal-good{padding:11px;border:1px solid #2c5945;background:#102219;color:#b7e2c6;border-radius:12px;font-size:11px;line-height:1.5}' +
    '#activateView .portal-check{display:flex;align-items:flex-start;gap:8px;color:#b9c6d8;font-size:10px;line-height:1.5}' +
    '#activateView .portal-check input{margin-top:2px}' +
    '#activateView .portal-links{color:#c6d9f5;text-decoration:underline}' +
    '#activateView .portal-status{min-height:18px;color:#afbed2;font-size:11px;line-height:1.5}' +
    '#activateView .portal-actions{display:flex;gap:8px;flex-wrap:wrap}' +
    '</style>' +
    '<div class="backline"><button class="back-button" data-portal-back type="button" aria-label="Back to dashboard"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 6-6 6 6 6"/></svg></button><div><div class="page-title">Account</div><div class="page-subtitle">Your devices, individual eSIM profiles and sponsored mobile connectivity.</div></div></div>' +
    '<div class="card portal-card" id="portalAuth" hidden>' +
      '<div class="portal-tabs"><button class="portal-tab active" data-portal-mode="register" type="button">Create account</button><button class="portal-tab" data-portal-mode="login" type="button">Sign in</button></div>' +
      '<form class="portal-form" id="portalForm">' +
        '<div id="portalNameWrap"><label class="portal-label" for="portalName">Full name</label><input class="portal-input" id="portalName" autocomplete="name" required placeholder="Your full name"></div>' +
        '<div><label class="portal-label" for="portalEmail">Email address</label><input class="portal-input" id="portalEmail" type="email" autocomplete="email" required placeholder="you@example.com"></div>' +
        '<div id="portalPhoneWrap"><label class="portal-label" for="portalPhone">Phone number</label><input class="portal-input" id="portalPhone" type="tel" autocomplete="tel" placeholder="+234..."></div>' +
        '<div><label class="portal-label" for="portalPassword">Password</label><input class="portal-input" id="portalPassword" type="password" minlength="10" autocomplete="new-password" required placeholder="At least 10 characters"></div>' +
        '<label class="portal-check"><input type="checkbox" id="portalTerms" required><span>I have read and agree to the <a class="portal-links" href="/legal.html#terms" target="_blank" rel="noopener">Terms of Service</a> and <a class="portal-links" href="/legal.html#privacy" target="_blank" rel="noopener">Privacy Notice</a>.</span></label>' +
        '<button class="portal-action" id="portalSubmit" type="submit">Create Expert eSIM account</button>' +
      '</form>' +
      '<p class="portal-status" id="portalAuthStatus" aria-live="polite">Create your subscriber account. This account does not itself activate mobile data or create an eSIM profile.</p>' +
    '</div>' +
    '<div class="portal-layout" id="portalChecking"><div class="card portal-card"><div class="portal-meta">Checking your Expert eSIM account…</div></div></div>' +
    '<div class="portal-layout" id="portalMember" hidden>' +
      '<div class="card portal-card">' +
        '<div class="portal-row"><div><div class="portal-title" id="portalUserName">Subscriber</div><div class="portal-meta" id="portalUserEmail"></div><div class="portal-meta" id="portalUserPhone"></div></div><button class="portal-secondary" id="portalLogout" type="button">Sign out</button></div>' +
        '<div class="portal-row"><strong>Account security</strong><span class="portal-chip" id="portalEmailState">Email not verified</span></div>' +
        '<div class="portal-notice" id="portalEmailNotice">Verify the email address on your account before requesting a sponsored eSIM profile.</div>' +
        '<button class="portal-secondary" id="portalResendEmail" type="button">Send verification email</button>' +
        '<div class="portal-row"><strong>Identity verification (where required)</strong><span class="portal-chip" id="portalKycState">Not started</span></div>' +
        '<div class="portal-notice" id="portalKycNotice">The global connectivity partner may require secure identity checks depending on the countries and networks used. Any required checks are completed through its authorised verification provider.</div>' +
        '<button class="portal-action" id="portalStartKyc" type="button">Start secure identity verification</button>' +
        '<div class="portal-status" id="portalMemberStatus" aria-live="polite"></div>' +
      '</div>' +
      '<div class="card portal-card">' +
        '<div class="portal-row"><div class="portal-section">My devices and eSIM profiles</div><button class="portal-secondary" id="portalRefreshDevices" type="button">Refresh</button></div>' +
        '<div class="portal-good">Expert eSIM is designed to fund the mobile-data service. Users do not purchase data packages here. Each registered device receives its own separate eSIM profile. Global roaming and unlimited-data access become available only where the contracted network provider confirms them.</div>' +
        '<div class="portal-form" id="portalDeviceForm">' +
          '<div class="portal-item" id="portalDetectedDevice">Reading this phone automatically…</div>' +
          '<button class="portal-action" id="portalRegisterDevice" type="button">Request eSIM profile for this device</button>' +
          '<div class="portal-status" id="portalDeviceStatus" aria-live="polite"></div>' +
        '</div>' +
        '<div id="portalDevices"><div class="portal-empty">Loading registered devices…</div></div>' +
      '</div>' +
      '<div class="card portal-card">' +
        '<div class="portal-section">Help and complaints</div>' +
        '<form class="portal-form" id="portalSupportForm">' +
          '<div><label class="portal-label" for="portalSupportCategory">Issue type</label><select class="portal-select" id="portalSupportCategory"><option value="activation">eSIM activation</option><option value="billing">Payment or billing</option><option value="network">Network / data connection</option><option value="technical">App or technical issue</option><option value="privacy">Privacy or personal data</option><option value="other">Other</option></select></div>' +
          '<div><label class="portal-label" for="portalSupportSubject">Subject</label><input class="portal-input" id="portalSupportSubject" minlength="4" maxlength="120" required placeholder="Briefly describe the issue"></div>' +
          '<div><label class="portal-label" for="portalSupportMessage">Details</label><textarea class="portal-textarea" id="portalSupportMessage" minlength="20" maxlength="4000" required placeholder="Tell our support team what happened (20–4000 characters)"></textarea></div>' +
          '<button class="portal-action" type="submit" id="portalSupportSubmit">Submit support case</button>' +
          '<div class="portal-status" id="portalSupportStatus" aria-live="polite"></div>' +
        '</form>' +
        '<div class="portal-section">Your support cases</div><div id="portalTickets"><div class="portal-empty">No cases yet.</div></div>' +
      '</div>' +
      '<div class="card portal-card">' +
        '<div class="portal-section">Privacy and personal data</div>' +
      '<button class="portal-secondary" id="portalExportData" type="button">Download my personal data</button>' +
        '<p class="portal-meta">You can request access, correction, deletion, portability or restriction/objection. Requests are reviewed; legally required telecom and payment records may have to be retained.</p>' +
        '<form class="portal-form" id="portalPrivacyForm">' +
          '<div><label class="portal-label" for="portalPrivacyType">Request type</label><select class="portal-select" id="portalPrivacyType"><option value="access">Access my data</option><option value="correction">Correct my data</option><option value="deletion">Request deletion</option><option value="portability">Data portability</option><option value="objection">Object to processing</option></select></div>' +
          '<div><label class="portal-label" for="portalPrivacyDetails">Details (optional)</label><textarea class="portal-textarea" id="portalPrivacyDetails" maxlength="1500" placeholder="Tell us what you are requesting"></textarea></div>' +
          '<button class="portal-action" type="submit" id="portalPrivacySubmit">Submit privacy request</button><div class="portal-status" id="portalPrivacyStatus" aria-live="polite"></div>' +
        '</form>' +
        '<div class="portal-section">Your privacy requests</div><div id="portalPrivacyRequests"><div class="portal-empty">No privacy requests yet.</div></div>' +
        '<p class="portal-meta"><a class="portal-links" href="/legal.html#privacy" target="_blank" rel="noopener">Read Privacy Notice and data-protection contact details</a></p>' +
      '</div>' +
    '</div>';

  async function api(route, options) {
    options = options || {};
    const headers = Object.assign({"content-type":"application/json"}, options.headers || {});
    if (legacySessionToken && !headers.authorization) headers.authorization = "Bearer " + legacySessionToken;
    const response = await fetch("/api/v1" + route, Object.assign({}, options, {headers, credentials:"same-origin"}));
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || "Request failed (" + response.status + ")");
      error.status = response.status;
      throw error;
    }
    if (route === "/me" && legacySessionToken) {
      try { localStorage.removeItem("expertEsimAccountToken"); } catch (e) {}
      legacySessionToken = "";
    }
    return data;
  }
  function setMode(next) {
    authMode = next;
    view.querySelectorAll("[data-portal-mode]").forEach(button => button.classList.toggle("active", button.dataset.portalMode === authMode));
    $("portalNameWrap").hidden = authMode !== "register";
    $("portalPhoneWrap").hidden = authMode !== "register";
    $("portalName").required = authMode === "register";
    $("portalPhone").required = false;
    $("portalTerms").required = authMode === "register";
    $("portalTerms").closest("label").hidden = authMode !== "register";
    $("portalPassword").autocomplete = authMode === "register" ? "new-password" : "current-password";
    $("portalSubmit").textContent = authMode === "register" ? "Create Expert eSIM account" : "Sign in";
  }
  view.querySelectorAll("[data-portal-mode]").forEach(button => button.addEventListener("click", () => setMode(button.dataset.portalMode)));
  view.querySelector("[data-portal-back]").addEventListener("click", () => {
    const home = document.querySelector('[data-page="home"]');
    if (home) home.click();
  });
  $("portalForm").addEventListener("submit", async event => {
    event.preventDefault();
    $("portalSubmit").disabled = true;
    $("portalAuthStatus").textContent = authMode === "register" ? "Creating your subscriber account…" : "Signing in…";
    const payload = {email:$("portalEmail").value.trim(), password:$("portalPassword").value};
    if (authMode === "register") {
      payload.fullName = $("portalName").value.trim();
      payload.phone = $("portalPhone").value.trim();
      payload.acceptedTerms = $("portalTerms").checked;
      payload.acceptedPrivacy = $("portalTerms").checked;
      const inviteCode = new URLSearchParams(window.location.search).get("ref");
      if (inviteCode) payload.referralCode = inviteCode;
    }
    try {
      const result = await api("/auth/" + (authMode === "register" ? "register" : "login"), {method:"POST", body:JSON.stringify(payload)});
      $("portalForm").reset();
      await refresh();
      $("portalMemberStatus").textContent = authMode === "register"
        ? (result.emailVerification && result.emailVerification.sent ? "Account created. Check your email to verify it." : "Account created. Email verification is not yet configured, so data-service requests will stay disabled.")
        : "Signed in successfully.";
    } catch (error) {
      $("portalAuthStatus").textContent = error.message;
    } finally {
      $("portalSubmit").disabled = false;
    }
  });
  $("portalLogout").addEventListener("click", async () => {
    try { await api("/auth/logout", {method:"POST"}); } catch (e) {}
    $("portalAuth").hidden = false;
    $("portalMember").hidden = true;
    $("portalAuthStatus").textContent = "You have signed out.";
    setMode("login");
  });
  $("portalResendEmail").addEventListener("click", async () => {
    $("portalResendEmail").disabled = true;
    try {
      const result = await api("/auth/verification/send", {method:"POST"});
      $("portalMemberStatus").textContent = result.sent ? "Verification email sent. Check your inbox." : "Your email is already verified.";
    } catch (error) { $("portalMemberStatus").textContent = error.message; }
    finally { $("portalResendEmail").disabled = false; }
  });
  $("portalStartKyc").addEventListener("click", async () => {
    $("portalStartKyc").disabled = true;
    $("portalMemberStatus").textContent = "Checking the authorised identity-verification service…";
    try {
      const result = await api("/kyc/start", {method:"POST"});
      if (result.verificationUrl) window.location.href = result.verificationUrl;
      else $("portalMemberStatus").textContent = result.message || "Identity verification is not available yet.";
    } catch (error) { $("portalMemberStatus").textContent = error.message; }
    finally { $("portalStartKyc").disabled = false; }
  });
  function statusItem(title, meta, status) {
    return '<article class="portal-item"><div class="portal-row"><span class="portal-title">' + escapeHtml(title) + '</span><span class="portal-chip">' + escapeHtml(String(status || "").replaceAll("_"," ").toUpperCase()) + '</span></div><div class="portal-meta">' + escapeHtml(meta || "") + '</div></article>';
  }
  function currentDeviceClientId(user) {
    const key = "expertEsimDeviceId:" + user.id;
    try {
      let id = localStorage.getItem(key);
      if (!id) {
        id = "device_" + (window.crypto && crypto.randomUUID ? crypto.randomUUID().replace(/-/g,"") : Date.now().toString(36) + Math.random().toString(36).slice(2));
        localStorage.setItem(key,id);
      }
      return id;
    } catch (error) {
      return "device_" + Date.now().toString(36) + Math.random().toString(36).slice(2);
    }
  }
  function detectPlatform() {
    const ua = String(navigator.userAgent || "").toLowerCase();
    if (ua.includes("android")) return "android";
    if (ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod")) return "ios";
    return "other";
  }
  let activeUser = null;
  let currentDeviceInfo = null;
  let currentDeviceRecord = null;
  async function readCurrentDevice(user) {
    const native = window.ExpertESimNative;
    if (native && typeof native.getDeviceInfo === "function") {
      try {
        const info = JSON.parse(native.getDeviceInfo());
        if (info && info.clientDeviceId && info.platform) return info;
      } catch (error) {}
    }
    const platform = detectPlatform();
    let model = "";
    let osVersion = "";
    if (navigator.userAgentData && typeof navigator.userAgentData.getHighEntropyValues === "function") {
      try {
        const high = await navigator.userAgentData.getHighEntropyValues(["model","platformVersion"]);
        model = String(high.model || "");
        osVersion = String(high.platformVersion || "");
      } catch (error) {}
    }
    const fallbackName = model || (platform === "android" ? "Android device" : platform === "ios" ? "Apple mobile device" : "This device");
    return {
      clientDeviceId: currentDeviceClientId(user),
      deviceName: fallbackName,
      manufacturer: "",
      model,
      platform,
      osVersion,
      eSimSupportKnown: false,
      hasEuiccHardware: null,
      euiccEnabled: null,
      detectionSource: "browser"
    };
  }
  function renderDetectedDevice(info) {
    const target = $("portalDetectedDevice");
    if (!target || !info) return;
    const name = [info.manufacturer,info.model].filter(Boolean).join(" ") || info.deviceName || "This device";
    let capability = "eSIM capability is not exposed by this browser.";
    if (info.eSimSupportKnown && info.hasEuiccHardware === false) capability = "No eSIM hardware detected on this phone.";
    else if (info.eSimSupportKnown && info.hasEuiccHardware === true && info.euiccEnabled === false) capability = "eSIM hardware detected, but eSIM support is disabled.";
    else if (info.eSimSupportKnown && info.hasEuiccHardware === true && info.euiccEnabled === true) capability = "eSIM hardware detected and enabled.";
    target.innerHTML = '<div class="portal-title">' + escapeHtml(name) + '</div>' +
      '<div class="portal-meta">' + escapeHtml(String(info.platform || "unknown").toUpperCase()) +
      (info.osVersion ? " · OS " + escapeHtml(info.osVersion) : "") + '</div>' +
      '<div class="portal-meta">' + escapeHtml(capability) + '</div>';
  }
  async function registerCurrentDevice(user) {
    currentDeviceInfo = await readCurrentDevice(user);
    renderDetectedDevice(currentDeviceInfo);
    const result = await api("/devices",{method:"POST",body:JSON.stringify(currentDeviceInfo)});
    currentDeviceRecord = result.device;
    return currentDeviceRecord;
  }
  function renderDevice(device) {
    const profile = device.latestProfile;
    const state = profile ? profile.status : "not_requested";
    const unsupported = device.eSimSupportKnown === true && (device.hasEuiccHardware === false || device.euiccEnabled === false);
    const request = !unsupported && (!profile || ["provider_error","cancelled","awaiting_partners","awaiting_verification","verification_required"].includes(state))
      ? '<button class="portal-action" data-device-request="' + escapeHtml(device.id) + '" type="button">Request profile for this device</button>' : "";
    const install = profile && ["profile_issued","active"].includes(state)
      ? '<button class="portal-action" data-device-install="' + escapeHtml(device.id) + '" type="button">Install eSIM profile</button>' : "";
    const capability = device.eSimSupportKnown
      ? (device.hasEuiccHardware ? (device.euiccEnabled ? "eSIM hardware available" : "eSIM hardware disabled") : "No eSIM hardware")
      : "eSIM capability not exposed";
    return '<article class="portal-item"><div class="portal-row"><span class="portal-title">' + escapeHtml(device.deviceName) + '</span><span class="portal-chip">' + escapeHtml(String(state).replaceAll("_"," ").toUpperCase()) + '</span></div>' +
      '<div class="portal-meta">' + escapeHtml([device.manufacturer,device.model].filter(Boolean).join(" ") || String(device.platform || "device").toUpperCase()) +
      (device.osVersion ? " · OS " + escapeHtml(device.osVersion) : "") + '</div>' +
      '<div class="portal-meta">' + escapeHtml(capability) + '</div>' +
      '<div class="portal-meta">' + escapeHtml(unsupported ? "This phone cannot install an eSIM profile. Register an eSIM-compatible device instead." : (profile ? profile.message : "This device was detected automatically.")) + '</div>' + request + install + '</article>';
  }
  async function refreshDevices(existing) {
    const target = $("portalDevices");
    target.innerHTML = '<div class="portal-empty">Loading registered devices…</div>';
    try {
      const result = existing ? {devices:existing} : await api("/devices");
      if (!result.devices || !result.devices.length) {
        target.innerHTML = '<div class="portal-empty">No device is registered yet. Open Expert eSIM on each device and register it to request its individual profile.</div>';
        return;
      }
      target.innerHTML = result.devices.map(renderDevice).join("");
      target.querySelectorAll("[data-device-request]").forEach(button => button.addEventListener("click",() => requestDeviceProfile(button.dataset.deviceRequest,button)));
      target.querySelectorAll("[data-device-install]").forEach(button => button.addEventListener("click",() => installDeviceProfile(button.dataset.deviceInstall,button)));
    } catch (error) {
      target.innerHTML = '<div class="portal-empty">' + escapeHtml(error.message) + '</div>';
    }
  }
  async function requestDeviceProfile(deviceId,button) {
    button.disabled = true;
    button.textContent = "Requesting profile…";
    try {
      const result = await api("/devices/" + encodeURIComponent(deviceId) + "/profile",{method:"POST"});
      $("portalDeviceStatus").textContent = result.profile.message || result.message || "Profile request received.";
      await refreshDevices();
    } catch (error) {
      $("portalDeviceStatus").textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = "Request / check profile";
    }
  }
  async function installDeviceProfile(deviceId,button) {
    button.disabled = true;
    button.textContent = "Preparing installation…";
    try {
      const result = await api("/devices/" + encodeURIComponent(deviceId) + "/profile");
      const native = window.ExpertESimNative;
      if (native && typeof native.downloadProfile === "function") {
        $("portalMemberStatus").textContent = "Opening the secure eSIM installer. Complete the device confirmation prompt.";
        native.downloadProfile(result.profile.activationCode,result.profile.confirmationCode || "");
      } else {
        const details = document.createElement("details");
        details.className = "portal-item";
        const summary = document.createElement("summary");
        summary.textContent = "Manual eSIM installation details";
        const code = document.createElement("code");
        code.style.display = "block";
        code.style.wordBreak = "break-all";
        code.style.marginTop = "10px";
        code.textContent = result.profile.activationCode;
        details.appendChild(summary);
        details.appendChild(code);
        if (result.profile.confirmationCode) {
          const extra = document.createElement("div");
          extra.className = "portal-meta";
          extra.textContent = "Confirmation code: " + result.profile.confirmationCode;
          details.appendChild(extra);
        }
        $("portalDevices").prepend(details);
        $("portalMemberStatus").textContent = "Use the provider-issued details in your device's Add eSIM settings. Keep them private.";
      }
    } catch (error) {
      $("portalMemberStatus").textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = "Install eSIM profile";
    }
  }
  $("portalRegisterDevice").addEventListener("click",async () => {
    const button = $("portalRegisterDevice");
    button.disabled = true;
    $("portalDeviceStatus").textContent = "Reading this phone and checking eSIM support…";
    try {
      if (!activeUser) throw new Error("Sign in to continue.");
      if (!currentDeviceRecord) await registerCurrentDevice(activeUser);
      if (currentDeviceInfo && currentDeviceInfo.eSimSupportKnown && currentDeviceInfo.hasEuiccHardware === false) {
        throw new Error("This phone does not have eSIM hardware. An eSIM-compatible phone is required.");
      }
      if (currentDeviceInfo && currentDeviceInfo.eSimSupportKnown && currentDeviceInfo.euiccEnabled === false) {
        throw new Error("eSIM hardware was detected, but eSIM support is disabled on this phone.");
      }
      $("portalDeviceStatus").textContent = "Requesting the separate eSIM profile for " + (currentDeviceInfo.deviceName || "this phone") + "…";
      const result = await api("/devices/" + encodeURIComponent(currentDeviceRecord.id) + "/profile",{method:"POST"});
      $("portalDeviceStatus").textContent = result.profile.message || result.message || "Profile request received.";
      await refreshDevices();
    } catch (error) {
      $("portalDeviceStatus").textContent = error.message;
      await refreshDevices();
    } finally {
      button.disabled = false;
      button.textContent = "Request eSIM profile for this device";
    }
  });
  $("portalSupportForm").addEventListener("submit", async event => {
    event.preventDefault();
    $("portalSupportSubmit").disabled = true;
    $("portalSupportStatus").textContent = "Submitting your support case…";
    try {
      const result = await api("/support/tickets", {method:"POST", body:JSON.stringify({
        category:$("portalSupportCategory").value,
        subject:$("portalSupportSubject").value,
        message:$("portalSupportMessage").value
      })});
      $("portalSupportForm").reset();
      $("portalSupportStatus").textContent = "Case " + result.ticket.reference + " received.";
      await refresh();
    } catch (error) { $("portalSupportStatus").textContent = error.message; }
    finally { $("portalSupportSubmit").disabled = false; }
  });
  $("portalExportData").addEventListener("click", async () => {
    const button = $("portalExportData");
    button.disabled = true;
    try {
      const response = await fetch("/api/v1/privacy/export", { credentials: "same-origin" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Could not export your data.");
      const blob = new Blob([JSON.stringify(result, null, 2)], {type:"application/json"});
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = "expert-esim-personal-data.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
      $("portalPrivacyStatus").textContent = "Your account data export has been prepared.";
    } catch (error) {
      $("portalPrivacyStatus").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
  $("portalPrivacyForm").addEventListener("submit", async event => {
    event.preventDefault();
    $("portalPrivacySubmit").disabled = true;
    $("portalPrivacyStatus").textContent = "Submitting your privacy request…";
    try {
      const result = await api("/privacy/requests", {method:"POST", body:JSON.stringify({
        type:$("portalPrivacyType").value,
        details:$("portalPrivacyDetails").value
      })});
      $("portalPrivacyForm").reset();
      $("portalPrivacyStatus").textContent = "Request " + result.request.reference + " received for review.";
      await refresh();
    } catch (error) { $("portalPrivacyStatus").textContent = error.message; }
    finally { $("portalPrivacySubmit").disabled = false; }
  });
  async function refresh() {
    $("portalAuth").hidden = true;
    $("portalMember").hidden = true;
    $("portalChecking").hidden = false;
    try {
      const data = await api("/me");
      const user = data.user;
      $("portalUserName").textContent = user.fullName;
      $("portalUserEmail").textContent = user.email;
      $("portalUserPhone").textContent = user.phone || "No phone number supplied";
      $("portalChecking").hidden = true;
      $("portalAuth").hidden = true;
      $("portalMember").hidden = false;
      $("portalEmailState").textContent = user.emailVerified ? "Verified" : "Not verified";
      $("portalEmailNotice").textContent = user.emailVerified
        ? "Your email address is verified."
        : "Verify your email address before requesting a sponsored eSIM profile.";
      $("portalResendEmail").hidden = user.emailVerified || !data.readiness.emailDeliveryConfigured;
      $("portalKycState").textContent = String(user.kycStatus || "not_started").replaceAll("_"," ");
      $("portalKycNotice").textContent = user.kycStatus === "verified"
        ? "Your identity verification has been confirmed by the authorised verification partner."
        : "Identity checks depend on the applicable destination-market rules and the global connectivity provider. Expert eSIM does not collect identity documents directly in this form.";
      $("portalStartKyc").hidden = user.kycStatus === "verified" || !data.readiness.identityProviderConfigured;
      if (!data.readiness.identityProviderConfigured && user.kycStatus !== "verified") {
        $("portalMemberStatus").textContent = "Secure identity verification is awaiting the contracted global verification partner.";
      }
      activeUser = user;
      try {
        await registerCurrentDevice(user);
        $("portalDeviceStatus").textContent = "This phone was detected and registered automatically.";
      } catch (deviceError) {
        $("portalDeviceStatus").textContent = "Could not register this phone automatically: " + deviceError.message;
      }
      await Promise.all([refreshDevices(),refreshTickets(data.tickets || []),refreshPrivacyRequests(data.privacyRequests || [])]);
    } catch (error) {
      $("portalMember").hidden = true;
      if (error.status === 401) {
        $("portalChecking").hidden = true;
        $("portalAuth").hidden = false;
        $("portalAuthStatus").textContent = "Sign in or create an account to access your Expert eSIM account.";
      } else {
        $("portalAuth").hidden = true;
        $("portalChecking").hidden = false;
        $("portalChecking").innerHTML = '<div class="card portal-card"><div class="portal-title">Your account is temporarily unavailable</div><div class="portal-meta">' + escapeHtml(error.message) + '</div><button class="portal-action" id="portalRetry" type="button">Try again</button></div>';
        $("portalRetry").addEventListener("click", refresh);
      }
    }
  }
  async function refreshTickets(existing) {
    const target = $("portalTickets");
    const data = existing || [];
    target.innerHTML = data.length ? data.map(ticket => statusItem(ticket.subject, ticket.reference + " · " + ticket.category + " · " + new Date(ticket.createdAt).toLocaleDateString(), ticket.status)).join("") : '<div class="portal-empty">No support cases yet.</div>';
  }
  async function refreshPrivacyRequests(existing) {
    const target = $("portalPrivacyRequests");
    const data = existing || [];
    target.innerHTML = data.length ? data.map(item => statusItem(item.type.replaceAll("_"," "), item.reference + " · " + new Date(item.createdAt).toLocaleDateString(), item.status)).join("") : '<div class="portal-empty">No privacy requests yet.</div>';
  }
  $("portalRefreshDevices").addEventListener("click", refresh);
  window.ExpertAccountPortal = {
    refresh:refresh, refreshDevices:refreshDevices,
    recordSpeedTest: async function(result){ return api("/app/speed-test",{method:"POST",body:JSON.stringify(result)}); }
  };
  const query = new URLSearchParams(window.location.search);
  const emailVerifiedReturn = query.get("email_verified") === "1";
  if (emailVerifiedReturn) setMode("login");
  refresh().then(() => {
    if (emailVerifiedReturn) {
      if ($("portalMember").hidden) $("portalAuthStatus").textContent = "Your email address has been verified. Sign in to continue.";
      else $("portalMemberStatus").textContent = "Your email address has been verified.";
    }

  });
})();