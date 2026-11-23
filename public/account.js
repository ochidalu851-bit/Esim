(function () {
  "use strict";
  const view = document.getElementById("activateView");
  if (!view) return;
  let authMode = "register";
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
    '<div class="backline"><button class="back-button" data-portal-back type="button" aria-label="Back to dashboard"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 6-6 6 6 6"/></svg></button><div><div class="page-title">My eSIM</div><div class="page-subtitle">Your Expert eSIM account, subscriptions and mobile-data services.</div></div></div>' +
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
        '<div class="portal-notice" id="portalEmailNotice">Verify the email address on your account before requesting mobile service.</div>' +
        '<button class="portal-secondary" id="portalResendEmail" type="button">Send verification email</button>' +
        '<div class="portal-row"><strong>Telecom identity verification</strong><span class="portal-chip" id="portalKycState">Not started</span></div>' +
        '<div class="portal-notice" id="portalKycNotice">Nigerian SIM activation requires identity verification through NIMC/authorised telecom channels. Expert eSIM does not collect your NIN or face/fingerprint images in this form.</div>' +
        '<button class="portal-action" id="portalStartKyc" type="button">Start secure identity verification</button>' +
        '<div class="portal-status" id="portalMemberStatus" aria-live="polite"></div>' +
      '</div>' +
      '<div class="card portal-card">' +
        '<div class="portal-row"><div class="portal-section">Expert data packages</div><button class="portal-secondary" id="portalRefreshPlans" type="button">Refresh</button></div>' +
        '<div id="portalPlans"><div class="portal-empty">Loading packages…</div></div>' +
      '</div>' +
      '<div class="card portal-card">' +
        '<div class="portal-row"><div class="portal-section">My eSIM subscriptions</div><button class="portal-secondary" id="portalRefreshOrders" type="button">Refresh</button></div>' +
        '<div id="portalOrders"><div class="portal-empty">Loading orders…</div></div>' +
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
    const response = await fetch("/api/v1" + route, Object.assign({}, options, {headers, credentials:"same-origin"}));
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Request failed (" + response.status + ")");
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
  async function refreshPlans(user, readiness) {
    const target = $("portalPlans");
    target.innerHTML = '<div class="portal-empty">Loading data packages…</div>';
    try {
      const result = await api("/plans");
      if (!result.plans.length) {
        target.innerHTML = '<div class="portal-empty">No Expert eSIM packages are available yet. Packages will appear after the NCC licence, host-network agreement, authorised SM-DP+ partner, identity verification, payments and service approval are in place.</div>';
        return;
      }
      target.innerHTML = result.plans.map(plan => {
        const gb = (plan.dataMb / 1024).toFixed(plan.dataMb % 1024 === 0 ? 0 : 1);
        const price = (plan.priceMinor / 100).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});
        const mayOrder = user.emailVerified && user.kycStatus === "verified";
        const label = !user.emailVerified ? "Verify email first" : (user.kycStatus !== "verified" ? "Complete KYC first" : "Get eSIM");
        return '<article class="portal-item"><div class="portal-title">' + escapeHtml(plan.name) + '</div><div class="portal-meta">' + gb + ' GB · ' + plan.validityDays + ' days · ' + escapeHtml(plan.networkModes.join(" / ").toUpperCase()) + '</div><div class="portal-row"><strong>' + escapeHtml(plan.currency) + ' ' + price + '</strong><button class="portal-action" data-portal-order="' + escapeHtml(plan.id) + '" type="button" ' + (mayOrder ? '' : 'disabled') + '>' + label + '</button></div></article>';
      }).join("");
      target.querySelectorAll("[data-portal-order]").forEach(button => button.addEventListener("click", () => requestOrder(button.dataset.portalOrder, button)));
    } catch (error) {
      target.innerHTML = '<div class="portal-empty">' + escapeHtml(error.message) + '</div>';
    }
  }
  async function requestOrder(planId, button) {
    button.disabled = true;
    button.textContent = "Creating order…";
    try {
      let preferredNetwork = "auto";
      try {
        const saved = localStorage.getItem("expertPreferredNetwork");
        if (["auto","4g","5g"].includes(saved)) preferredNetwork = saved;
      } catch (e) {}
      const result = await api("/esim/orders", {method:"POST", body:JSON.stringify({planId:planId, preferredNetwork:preferredNetwork})});
      let message = result.message || "eSIM order received.";
      if (result.order.status === "awaiting_payment") {
        const payment = await api("/esim/orders/" + encodeURIComponent(result.order.id) + "/pay", {method:"POST"});
        message = "Redirecting you to the secure payment page…";
        $("portalMemberStatus").textContent = message;
        window.location.href = payment.payment.authorizationUrl;
        return;
      }
      $("portalMemberStatus").textContent = message;
      await refresh();
    } catch (error) {
      $("portalMemberStatus").textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = "Get eSIM";
    }
  }
  async function refreshOrders() {
    const target = $("portalOrders");
    target.innerHTML = '<div class="portal-empty">Loading your eSIM orders…</div>';
    try {
      const result = await api("/esim/orders");
      if (!result.orders.length) {
        target.innerHTML = '<div class="portal-empty">You do not have any eSIM orders yet.</div>';
        return;
      }
      target.innerHTML = result.orders.map(order => {
        const gb = (order.dataMb / 1024).toFixed(order.dataMb % 1024 === 0 ? 0 : 1);
        const status = order.status.replaceAll("_", " ").toUpperCase();
        const payment = (order.paymentStatus || "pending").replaceAll("_", " ").toUpperCase();
        const installButton = order.status === "profile_issued" && order.paymentStatus === "paid"
          ? '<button class="portal-action" data-portal-install="' + escapeHtml(order.id) + '" type="button">Install Expert eSIM</button>' : "";
        const verifyButton = order.paymentStatus === "pending" && order.paymentReference
          ? '<button class="portal-secondary" data-portal-verify="' + escapeHtml(order.id) + '" type="button">Check payment</button>' : "";
        return '<article class="portal-item"><div class="portal-row"><span class="portal-title">' + escapeHtml(order.planName) + '</span><span class="portal-chip">' + escapeHtml(status) + '</span></div><div class="portal-meta">' + gb + ' GB · ' + order.validityDays + ' days · ' + escapeHtml(order.preferredNetwork.toUpperCase()) + ' · ' + escapeHtml(order.reference) + '</div><div class="portal-meta">Payment: ' + escapeHtml(payment) + ' · ' + escapeHtml(order.currency) + ' ' + (order.priceMinor / 100).toFixed(2) + '</div><div class="portal-meta">' + escapeHtml(order.message || "") + '</div>' + verifyButton + installButton + '</article>';
      }).join("");
      target.querySelectorAll("[data-portal-install]").forEach(button => button.addEventListener("click", () => installProfile(button.dataset.portalInstall, button)));
      target.querySelectorAll("[data-portal-verify]").forEach(button => button.addEventListener("click", () => verifyPayment(button.dataset.portalVerify, button)));
    } catch (error) {
      target.innerHTML = '<div class="portal-empty">' + escapeHtml(error.message) + '</div>';
    }
  }
  async function verifyPayment(orderId, button) {
    button.disabled = true;
    button.textContent = "Checking with Paystack…";
    $("portalMemberStatus").textContent = "Checking the payment directly with Paystack. A browser success page alone is not enough to activate an eSIM.";
    try {
      const result = await api("/esim/orders/" + encodeURIComponent(orderId) + "/verify-payment", {method:"POST"});
      $("portalMemberStatus").textContent = result.order.message || "Payment has been verified by Paystack.";
      await refreshOrders();
    } catch (error) {
      $("portalMemberStatus").textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = "Check payment";
    }
  }
  async function installProfile(orderId, button) {
    const native = window.ExpertESimNative;
    if (!native || typeof native.downloadProfile !== "function") {
      $("portalMemberStatus").textContent = "Install Expert eSIM on an eSIM-compatible Android phone to install this profile.";
      return;
    }
    button.disabled = true;
    button.textContent = "Preparing Android installer…";
    try {
      const result = await api("/esim/orders/" + encodeURIComponent(orderId) + "/profile");
      await api("/esim/orders/" + encodeURIComponent(orderId) + "/install-requested", {method:"POST"});
      $("portalMemberStatus").textContent = "Android is opening its secure eSIM installer. Complete any system confirmation prompt.";
      native.downloadProfile(result.profile.activationCode, result.profile.confirmationCode || "");
    } catch (error) {
      $("portalMemberStatus").textContent = error.message;
      button.disabled = false;
      button.textContent = "Install Expert eSIM";
    }
  }
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
        : "Verify your email address before ordering a mobile subscription.";
      $("portalResendEmail").hidden = user.emailVerified || !data.readiness.emailDeliveryConfigured;
      $("portalKycState").textContent = String(user.kycStatus || "not_started").replaceAll("_"," ");
      $("portalKycNotice").textContent = user.kycStatus === "verified"
        ? "Your identity verification has been confirmed by the authorised verification partner."
        : "Nigerian telecom activation requires NIN and biometric verification through NIMC-authorised telecom channels. Expert eSIM does not collect these details directly.";
      $("portalStartKyc").hidden = user.kycStatus === "verified" || !data.readiness.kycProviderConfigured;
      if (!data.readiness.kycProviderConfigured && user.kycStatus !== "verified") {
        $("portalMemberStatus").textContent = "Secure identity verification is awaiting an authorised verification partner.";
      }
      await Promise.all([refreshPlans(user,data.readiness),refreshOrders(),refreshTickets(data.tickets || []),refreshPrivacyRequests(data.privacyRequests || [])]);
    } catch (error) {
      $("portalChecking").hidden = true;
      $("portalAuth").hidden = false;
      $("portalMember").hidden = true;
      if (error.message !== "Sign in to continue.") $("portalAuthStatus").textContent = error.message;
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
  $("portalRefreshPlans").addEventListener("click", refresh);
  $("portalRefreshOrders").addEventListener("click", refresh);
  window.ExpertAccountPortal = {refresh:refresh, refreshOrders:refreshOrders};
  const query = new URLSearchParams(window.location.search);
  const emailVerifiedReturn = query.get("email_verified") === "1";
  const paymentReturn = query.get("payment_return") === "1";
  if (emailVerifiedReturn) setMode("login");
  refresh().then(() => {
    if (emailVerifiedReturn) {
      if ($("portalMember").hidden) $("portalAuthStatus").textContent = "Your email address has been verified. Sign in to continue.";
      else $("portalMemberStatus").textContent = "Your email address has been verified.";
    }
    if (paymentReturn && !$("portalMember").hidden) {
      $("portalMemberStatus").textContent = "Returned from Paystack. Refresh your eSIM orders or use Check payment to confirm directly with Paystack.";
    }
  });
})();