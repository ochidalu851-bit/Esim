(function () {
  "use strict";
  const view = document.getElementById("activateView");
  if (!view) return;
  const TOKEN_KEY = "expertEsimAccountToken";
  let token = "";
  try { token = localStorage.getItem(TOKEN_KEY) || ""; } catch (e) {}
  let mode = "register";
  const esc = value => String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
  view.innerHTML = '<style>' +
    '#activateView .portal-card{display:grid;gap:13px}#activateView .portal-input{width:100%;box-sizing:border-box;min-height:46px;padding:12px;border:1px solid #344257;border-radius:12px;background:#0b121b;color:#f5f7fb;font:inherit;font-size:13px}#activateView .portal-label{font-size:11px;font-weight:800;color:#c7d2e3}#activateView .portal-tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px}#activateView .portal-tab,#activateView .portal-secondary{padding:11px;border:1px solid #344257;background:#111a26;color:#e9eff8;border-radius:11px;font-size:12px;font-weight:800}#activateView .portal-tab.active{border-color:#91acd3;background:#1b2a40}#activateView .portal-form{display:grid;gap:11px}#activateView .portal-action{border:1px solid #8198c0;background:linear-gradient(145deg,#bdcdec,#879fc9);color:#101725;padding:13px;border-radius:12px;font-size:13px;font-weight:850}#activateView .portal-action:disabled{opacity:.55}#activateView .portal-item{display:grid;gap:8px;background:#0d141e;border:1px solid #2c394c;border-radius:14px;padding:13px}#activateView .portal-row{display:flex;justify-content:space-between;align-items:center;gap:8px}#activateView .portal-meta{color:#9aa9bd;font-size:10px;line-height:1.5}#activateView .portal-title{font-weight:850;font-size:14px}#activateView .portal-chip{font-size:9px;color:#c5d6ef;border:1px solid #354860;background:#182638;border-radius:99px;padding:6px 8px}#activateView .portal-empty{padding:14px;border:1px dashed #3a485d;border-radius:13px;color:#98a8bd;font-size:11px;line-height:1.55}#activateView .portal-notice{padding:12px;border:1px solid #4a4028;background:#201b12;color:#d7c9a4;border-radius:13px;font-size:11px;line-height:1.55}' +
    '</style>' +
    '<div class="backline"><button class="back-button" data-portal-back type="button" aria-label="Back"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m15 6-6 6 6 6"/></svg></button><div><div class="page-title">My Expert eSIM</div><div class="page-subtitle">Your subscriber account, data packages and issued eSIM profiles.</div></div></div>' +
    '<div class="card portal-card" id="portalAuth">' +
      '<div class="portal-tabs"><button class="portal-tab active" data-portal-mode="register" type="button">Create account</button><button class="portal-tab" data-portal-mode="login" type="button">Sign in</button></div>' +
      '<form class="portal-form" id="portalForm">' +
        '<div id="portalNameWrap"><label class="portal-label" for="portalName">Full name</label><input class="portal-input" id="portalName" autocomplete="name" required placeholder="Your full name"></div>' +
        '<div><label class="portal-label" for="portalEmail">Email address</label><input class="portal-input" id="portalEmail" type="email" autocomplete="email" required placeholder="you@example.com"></div>' +
        '<div id="portalPhoneWrap"><label class="portal-label" for="portalPhone">Phone number</label><input class="portal-input" id="portalPhone" type="tel" autocomplete="tel" placeholder="+234..."></div>' +
        '<div><label class="portal-label" for="portalPassword">Password</label><input class="portal-input" id="portalPassword" type="password" minlength="10" required placeholder="At least 10 characters"></div>' +
        '<button class="portal-action" id="portalSubmit" type="submit">Create Expert eSIM account</button>' +
      '</form>' +
      '<p class="activation-status" id="portalStatus" aria-live="polite">Create your subscriber account. Mobile-data service will be enabled after an authorised network partner is connected.</p>' +
    '</div>' +
    '<div class="card portal-card" id="portalMember" hidden>' +
      '<div class="portal-row"><div><div class="portal-title" id="portalUserName">Subscriber</div><div class="portal-meta" id="portalUserEmail"></div></div><button class="portal-secondary" id="portalLogout" type="button">Sign out</button></div>' +
      '<div class="portal-notice">Your subscriber account is active. Data packages will appear after the host-network and eSIM provisioning agreements are connected.</div>' +
      '<div class="portal-row"><div class="portal-title">Expert data packages</div><button class="portal-secondary" id="portalRefreshPlans" type="button">Refresh</button></div>' +
      '<div id="portalPlans"><div class="portal-empty">Loading packages…</div></div>' +
      '<div class="portal-row"><div class="portal-title">Your eSIM orders</div><button class="portal-secondary" id="portalRefreshOrders" type="button">Refresh</button></div>' +
      '<div id="portalOrders"><div class="portal-empty">Loading orders…</div></div>' +
    '</div>';

  const $ = id => document.getElementById(id);
  async function api(route, options) {
    options = options || {};
    const headers = Object.assign({"content-type":"application/json"}, options.headers || {});
    if (token) headers.authorization = "Bearer " + token;
    const response = await fetch("/api/v1" + route, Object.assign({}, options, {headers}));
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Request failed (" + response.status + ")");
    return data;
  }
  function setMode(next) {
    mode = next;
    view.querySelectorAll("[data-portal-mode]").forEach(button => button.classList.toggle("active", button.dataset.portalMode === mode));
    $("portalNameWrap").hidden = mode !== "register";
    $("portalPhoneWrap").hidden = mode !== "register";
    $("portalName").required = mode === "register";
    $("portalPassword").autocomplete = mode === "register" ? "new-password" : "current-password";
    $("portalSubmit").textContent = mode === "register" ? "Create Expert eSIM account" : "Sign in";
  }
  view.querySelectorAll("[data-portal-mode]").forEach(button => button.addEventListener("click", () => setMode(button.dataset.portalMode)));
  view.querySelector("[data-portal-back]").addEventListener("click", () => {
    const home = document.querySelector('[data-page="home"]');
    if (home) home.click();
  });
  $("portalForm").addEventListener("submit", async event => {
    event.preventDefault();
    $("portalSubmit").disabled = true;
    $("portalStatus").textContent = mode === "register" ? "Creating subscriber account…" : "Signing in…";
    const payload = {email:$("portalEmail").value.trim(), password:$("portalPassword").value};
    if (mode === "register") {
      payload.fullName = $("portalName").value.trim();
      payload.phone = $("portalPhone").value.trim();
    }
    try {
      const result = await api("/auth/" + (mode === "register" ? "register" : "login"), {method:"POST", body:JSON.stringify(payload)});
      token = result.token;
      try { localStorage.setItem(TOKEN_KEY, token); } catch (e) {}
      $("portalForm").reset();
      await refresh();
      $("portalStatus").textContent = "Your subscriber account is ready.";
    } catch (error) {
      $("portalStatus").textContent = error.message;
    } finally {
      $("portalSubmit").disabled = false;
    }
  });
  $("portalLogout").addEventListener("click", async () => {
    try { await api("/auth/logout", {method:"POST"}); } catch (e) {}
    token = "";
    try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
    $("portalAuth").hidden = false;
    $("portalMember").hidden = true;
    setMode("login");
    $("portalStatus").textContent = "You have signed out.";
  });
  async function refreshPlans() {
    const target = $("portalPlans");
    target.innerHTML = '<div class="portal-empty">Loading data packages…</div>';
    try {
      const result = await api("/plans");
      if (!result.plans.length) {
        target.innerHTML = '<div class="portal-empty">No Expert eSIM data packages are available yet. The catalogue will open when the host-network and eSIM provisioning partners are connected.</div>';
        return;
      }
      target.innerHTML = result.plans.map(plan => {
        const gb = (plan.dataMb / 1024).toFixed(plan.dataMb % 1024 === 0 ? 0 : 1);
        const price = (plan.priceMinor / 100).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2});
        return '<article class="portal-item"><div class="portal-title">' + esc(plan.name) + '</div><div class="portal-meta">' + gb + ' GB · ' + plan.validityDays + ' days · ' + esc(plan.networkModes.join(" / ").toUpperCase()) + '</div><div class="portal-row"><strong>' + esc(plan.currency) + ' ' + price + '</strong><button class="portal-action" data-portal-order="' + esc(plan.id) + '" type="button">Request eSIM</button></div></article>';
      }).join("");
      target.querySelectorAll("[data-portal-order]").forEach(button => button.addEventListener("click", () => requestOrder(button.dataset.portalOrder, button)));
    } catch (error) {
      target.innerHTML = '<div class="portal-empty">' + esc(error.message) + '</div>';
    }
  }
  async function requestOrder(planId, button) {
    button.disabled = true;
    button.textContent = "Submitting…";
    try {
      let preferredNetwork = "auto";
      try {
        const saved = localStorage.getItem("expertPreferredNetwork");
        if (["auto","4g","5g"].includes(saved)) preferredNetwork = saved;
      } catch (e) {}
      const result = await api("/esim/orders", {method:"POST", body:JSON.stringify({planId:planId, preferredNetwork:preferredNetwork})});
      $("portalStatus").textContent = result.message || "eSIM order received.";
      await refreshOrders();
    } catch (error) {
      $("portalStatus").textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = "Request eSIM";
    }
  }
  async function refreshOrders() {
    const target = $("portalOrders");
    target.innerHTML = '<div class="portal-empty">Loading your eSIM orders…</div>';
    if (!token) {
      target.innerHTML = '<div class="portal-empty">Sign in to view eSIM orders.</div>';
      return;
    }
    try {
      const result = await api("/esim/orders");
      if (!result.orders.length) {
        target.innerHTML = '<div class="portal-empty">No eSIM orders yet.</div>';
        return;
      }
      target.innerHTML = result.orders.map(order => {
        const gb = (order.dataMb / 1024).toFixed(order.dataMb % 1024 === 0 ? 0 : 1);
        const status = order.status.replaceAll("_", " ").toUpperCase();
        const installButton = order.status === "profile_issued" ? '<button class="portal-action" data-portal-install="' + esc(order.id) + '" type="button">Install profile</button>' : "";
        return '<article class="portal-item"><div class="portal-row"><span class="portal-title">' + esc(order.planName) + '</span><span class="portal-chip">' + esc(status) + '</span></div><div class="portal-meta">' + gb + ' GB · ' + order.validityDays + ' days · ' + esc(order.preferredNetwork.toUpperCase()) + ' · ' + esc(order.reference) + '</div><div class="portal-meta">' + esc(order.message || "") + '</div>' + installButton + '</article>';
      }).join("");
      target.querySelectorAll("[data-portal-install]").forEach(button => button.addEventListener("click", () => installProfile(button.dataset.portalInstall, button)));
    } catch (error) {
      target.innerHTML = '<div class="portal-empty">' + esc(error.message) + '</div>';
    }
  }
  async function installProfile(orderId, button) {
    const native = window.ExpertESimNative;
    if (!native || typeof native.downloadProfile !== "function") {
      $("portalStatus").textContent = "Install Expert eSIM on a phone with supported eSIM hardware to install the profile.";
      return;
    }
    button.disabled = true;
    button.textContent = "Preparing installer…";
    try {
      const result = await api("/esim/orders/" + encodeURIComponent(orderId) + "/profile");
      await api("/esim/orders/" + encodeURIComponent(orderId) + "/install-requested", {method:"POST"});
      $("portalStatus").textContent = "Android is opening its secure eSIM installer. Complete any system approval prompt.";
      native.downloadProfile(result.profile.activationCode, result.profile.confirmationCode || "");
    } catch (error) {
      $("portalStatus").textContent = error.message;
      button.disabled = false;
      button.textContent = "Install profile";
    }
  }
  $("portalRefreshPlans").addEventListener("click", refreshPlans);
  $("portalRefreshOrders").addEventListener("click", refreshOrders);
  async function refresh() {
    $("portalAuth").hidden = Boolean(token);
    $("portalMember").hidden = !token;
    if (!token) return;
    try {
      const result = await api("/me");
      $("portalUserName").textContent = result.user.fullName;
      $("portalUserEmail").textContent = result.user.email + " · KYC: " + result.user.kycStatus.replaceAll("_", " ");
      await refreshPlans();
      await refreshOrders();
    } catch (error) {
      token = "";
      try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
      $("portalAuth").hidden = false;
      $("portalMember").hidden = true;
      $("portalStatus").textContent = error.message;
    }
  }
  window.ExpertAccountPortal = {refresh:refresh, refreshOrders:refreshOrders};
  refresh();
})();