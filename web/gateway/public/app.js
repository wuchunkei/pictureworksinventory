"use strict";
/* PictureWorks Inventory — web client (vanilla JS SPA). Calls /api same-origin. */

const Screens = {};      // populated by screens.js
const Components = {};    // populated by screens.js / acf.js

// ---------------------------------------------------------------- State + API
const State = {
  token: localStorage.getItem("token") || null,
  user: null, permissions: null,
  companies: [], skus: [], users: [], records: [], notifications: [], userLogs: [],
};
function setToken(t) { State.token = t; if (t) localStorage.setItem("token", t); else localStorage.removeItem("token"); }

// ---------------------------------------------------------------- Geolocation
// No custom consent UI — we call the browser's native geolocation, which shows
// its own permission prompt. Read on every load ("each use"); denial just means
// no GPS and the region gate falls back to the IP country.
const Geo = { lat: null, lng: null, country: null };
function acquireGeo() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve();
    navigator.geolocation.getCurrentPosition(
      (pos) => { Geo.lat = +pos.coords.latitude.toFixed(6); Geo.lng = +pos.coords.longitude.toFixed(6); resolve(); },
      () => resolve(), { enableHighAccuracy: false, timeout: 8000, maximumAge: 0 }
    );
  });
}

// ---------------------------------------------------------------- Server nodes
// Mirrors the app's bundled catalog. baseUrl "" = same-origin via the Worker
// (which forwards the visitor's country) — the default/recommended route.
// All staging nodes share one Atlas DB, so a session is valid across nodes.
const ServerNodes = [
  { label: "Cloudflare (Staging)", baseUrl: "" },
  { label: "CMLink (Staging)", baseUrl: "https://inventory-staging-cmlink.wuchunkei.com:5173" },
  { label: "CTExcel (Staging)", baseUrl: "https://inventory-staging-ctexcel.wuchunkei.com:5173" },
];
const Node = { label: localStorage.getItem("nodeLabel") || ServerNodes[0].label, restricted: false };
function selectedNode() { return ServerNodes.find(n => n.label === Node.label) || ServerNodes[0]; }
function apiBase() { const u = selectedNode().baseUrl; return u ? u + "/api/" : "/api/"; }
function isChinaNode(label) { return /CMLink|CTExcel/.test(label); }
// Geofence removed — every node is always selectable regardless of location.
function nodeSelectable(n) { return true; }
// Country/region grouping for the node picker, derived from the label.
function nodeRegion(label) {
  if (isChinaNode(label)) return "China";
  if (/\(HKG\)/.test(label)) return "Hong Kong";
  if (/\(SJC\)/.test(label)) return "United States";
  if (/\(Staging\)/i.test(label)) return "Staging";
  return "Other";
}
const NODE_REGION_ORDER = ["China", "Hong Kong", "United States", "Staging", "Other"];

function setNode(label) {
  const n = ServerNodes.find(x => x.label === label); if (!n) return false;
  Node.label = label; localStorage.setItem("nodeLabel", label); return true;
}

// ---- Recommended (auto-fastest) vs pinned node ----
// nodeChosen: the first-launch picker was completed. nodeAuto: auto-use the
// lowest-latency node each load (else the pinned node in nodeLabel).
function firstNodeChosen() { return localStorage.getItem("nodeChosen") === "1"; }
function nodeAuto() { return localStorage.getItem("nodeAuto") === "1"; }

async function measureNode(n) {
  const url = (n.baseUrl || "") + "/api/geo";
  const t0 = performance.now();
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url, { signal: ctrl.signal }); clearTimeout(t);
    return res.ok ? Math.round(performance.now() - t0) : null;
  } catch (e) { return null; }
}

// Lowest-latency reachable node; falls back to the first node.
function recommendedNode(lat) {
  const reachable = ServerNodes.filter(n => lat[n.label] != null);
  if (reachable.length) return reachable.reduce((a, b) => lat[a.label] <= lat[b.label] ? a : b);
  return ServerNodes[0];
}

// Picked "Recommended" → auto-use the fastest node now and on every load.
function chooseRecommended(label) {
  localStorage.setItem("nodeAuto", "1");
  localStorage.setItem("nodeChosen", "1");
  if (label) setNode(label);
}
// Pinned a specific node → fixed to it until changed.
function chooseSpecificNode(label) {
  localStorage.setItem("nodeAuto", "0");
  localStorage.setItem("nodeChosen", "1");
  setNode(label);
}

// On load: in auto mode, measure and switch to the fastest node.
async function applyNodePreferenceOnLaunch() {
  if (!nodeAuto()) return;
  const lat = {};
  await Promise.all(ServerNodes.map(async n => { lat[n.label] = await measureNode(n); }));
  const best = recommendedNode(lat);
  if (best) setNode(best.label);
}

// Geofence removed. Still pull the IP country for informational logging only;
// it no longer gates node selection. The GPS fix continues to flow into the
// X-Client-Geo header so the backend can log where each operation happened.
async function refreshNodeGate() {
  try { const g = await api("geo"); Geo.country = g.country; } catch (e) { /* keep prior */ }
}

// Probe a node's reachability (short timeout). Unreachable nodes are greyed out.
async function probeNode(n) {
  const url = (n.baseUrl || "") + "/api/geo";
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch (e) { return false; }
}

function openNodePicker() {
  const lat = {}; // label -> ms | null(offline) | undefined(measuring)
  const latText = (label) => !(label in lat) ? "…" : (lat[label] == null ? "超時" : lat[label] + " ms");
  const wrap = h("div", {});
  async function pick(fn) { fn(); close(); try { await reloadAndRender(); } catch (e) { toast(e.message); } }
  function draw() {
    clear(wrap);
    // Recommended (auto-fastest). A blue ✓ when currently in auto mode.
    const best = recommendedNode(lat);
    wrap.append(h("div", { class: "list-card", onclick: () => pick(() => chooseRecommended(best && best.label)) },
      h("span", { class: "grow" }, "⚡ 推荐（自动选择最快）" + (best ? " · " + best.label : "")),
      nodeAuto() ? h("span", { style: "color:var(--blue)" }, "✓") : h("span", { class: "muted" }, latText(best && best.label))));
    // All nodes grouped by country/region.
    const byRegion = {};
    ServerNodes.forEach(n => { const r = nodeRegion(n.label); (byRegion[r] ||= []).push(n); });
    const regions = NODE_REGION_ORDER.filter(r => byRegion[r])
      .concat(Object.keys(byRegion).filter(r => !NODE_REGION_ORDER.includes(r)));
    for (const region of regions) {
      wrap.append(h("div", { class: "section-label" }, region));
      for (const n of byRegion[region]) {
        const offline = lat[n.label] === null;
        // ✓ only when pinned to this node (not auto).
        const sel = !nodeAuto() && Node.label === n.label;
        const right = sel ? h("span", { style: "color:var(--blue)" }, "✓") : h("span", { class: "muted" }, latText(n.label));
        wrap.append(h("div", { class: "list-card", style: offline ? "opacity:.5" : "",
          onclick: () => { if (offline) { toast("This node is unreachable right now."); return; } pick(() => chooseSpecificNode(n.label)); } },
          h("span", { class: "grow" }, n.label), right));
      }
    }
  }
  draw();
  const close = modal({ title: "Server Node", body: h("div", {}, wrap,
    h("div", { class: "muted", style: "margin-top:8px;font-size:12px" }, "选择「推荐」后每次自动用最快节点；选具体节点则固定使用它。")),
    actions: [h("button", { class: "btn outline", onclick: () => close() }, "Close")] });
  // Measure latencies in the background and re-render as results arrive.
  ServerNodes.forEach(async (n) => { lat[n.label] = await measureNode(n); draw(); });
}

async function api(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json", "Accept": "application/json" };
  if (State.token) headers["Authorization"] = "Bearer " + State.token;
  if (Geo.lat != null && Geo.lng != null) headers["X-Client-Geo"] = `${Geo.lat},${Geo.lng}`;
  const res = await fetch(apiBase() + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 204) return {};
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    if (!res.ok) throw new Error("Request failed (" + res.status + ")");
    return res; // binary
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || ("Request failed (" + res.status + ")"));
  return data;
}

// ---------------------------------------------------------------- DOM helpers
const $ = (sel, root = document) => root.querySelector(sel);
function h(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, "");
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of children.flat()) { if (c == null || c === false) continue; e.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return e;
}
function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 1800); }

function modal({ title, body, actions, onClose }) {
  const root = $("#modal-root");
  let closed = false;
  const close = () => { if (closed) return; closed = true; clear(root); if (onClose) onClose(); };
  const back = h("div", { class: "modal-backdrop", onclick: e => { if (e.target === back) close(); } },
    h("div", { class: "modal" },
      h("div", { class: "modal-head" },
        h("h2", {}, title),
        h("button", { class: "modal-close", "aria-label": "Close", onclick: () => close() }, "✕")),
      body,
      h("div", { class: "modal-actions" }, ...(actions || []).map(a => a))
    ));
  clear(root); root.append(back);
  return close;
}
function confirmDialog(title, message, confirmLabel, onConfirm, danger = true) {
  const close = modal({ title, body: h("div", { class: "muted" }, message), actions: [
    h("button", { class: "btn outline", onclick: () => close() }, "Cancel"),
    h("button", { class: "btn " + (danger ? "danger" : ""), onclick: async () => { close(); await onConfirm(); } }, confirmLabel),
  ]});
}
function fieldInput(label, value, opts = {}) {
  const input = h("input", Object.assign({ value: value ?? "" }, opts));
  const wrap = h("div", { class: "field" }, h("label", {}, label), input);
  wrap.input = input;
  return wrap;
}
function selectField(label, value, options, opts = {}) {
  const sel = h("select", opts, ...options.map(o => h("option", { value: o.value, selected: o.value === value }, o.label)));
  const wrap = h("div", { class: "field" }, h("label", {}, label), sel);
  wrap.select = sel;
  return wrap;
}

// ---------------------------------------------------------------- Date utils
function fmtDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso); if (isNaN(d)) return iso;
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtDate(iso) { if (!iso) return ""; const d = new Date(iso); if (isNaN(d)) return iso; const p = n => String(n).padStart(2,"0"); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; }

// ---------------------------------------------------------------- Bootstrap
async function refresh() {
  const b = await api("bootstrap");
  State.user = b.currentUser; State.permissions = b.permissions;
  State.companies = b.warehouses || []; State.skus = b.skus || [];
  State.users = b.users || []; State.records = b.records || []; State.notifications = b.notifications || [];
}

// ---------------------------------------------------------------- Login
function renderLogin() {
  const app = $("#app"); clear(app);
  let step = "employee", username = "", startInfo = null, error = "";
  const card = h("div", { class: "card login-card", style: "padding:28px" });
  app.append(h("div", { class: "login-wrap" }, card));

  function draw() {
    clear(card);
    card.append(h("h1", {}, "Inventory"), h("div", { class: "muted", style: "margin-bottom:18px" }, "PictureWorks asset borrowing"));
    if (error) card.append(h("div", { class: "err", style: "margin-bottom:10px" }, error));

    if (step === "employee") {
      const f = fieldInput("Employee ID", username, { autofocus: true });
      const submit = async () => {
        username = f.input.value.trim(); if (!username) return;
        error = "";
        try {
          startInfo = await api("login-start", { method: "POST", body: { username } });
          if (!startInfo.exists) { error = "Employee not found."; draw(); return; }
          step = startInfo.hasPassword ? "password" : "setup"; draw();
        } catch (e) { error = e.message; draw(); }
      };
      f.input.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
      card.append(f, h("button", { class: "btn", style: "width:100%", onclick: submit }, "Next"),
        h("div", { class: "link", style: "margin-top:14px;text-align:center;font-size:13px", onclick: () => openNodePicker() }, "🖧 " + Node.label));
    } else if (step === "password") {
      const f = fieldInput("Password", "", { type: "password", autofocus: true });
      const submit = async () => {
        error = "";
        try { const r = await api("login", { method: "POST", body: { username, password: f.input.value } }); await onAuth(r); }
        catch (e) { error = e.message; draw(); }
      };
      f.input.addEventListener("keydown", e => { if (e.key === "Enter") submit(); });
      card.append(h("div", { class: "muted", style: "margin-bottom:10px" }, `Welcome back, ${startInfo.user?.name || username}`),
        f, h("button", { class: "btn", style: "width:100%", onclick: submit }, "Log in"),
        h("div", { class: "link", style: "margin-top:12px;text-align:center", onclick: () => { step = "employee"; error=""; draw(); } }, "‹ Wrong account"));
    } else if (step === "setup") {
      // First login: verify name + phone, then set password.
      const name = fieldInput("Full name", "");
      const phone = fieldInput("Phone", "");
      const pw = fieldInput("New password (min 8 characters)", "", { type: "password" });
      const pw2 = fieldInput("Confirm password", "", { type: "password" });
      const submit = async () => {
        error = "";
        if (pw.input.value.length < 8) { error = "Password must be at least 8 characters."; draw(); return; }
        if (pw.input.value !== pw2.input.value) { error = "Passwords do not match."; draw(); return; }
        try {
          await api("verify-identity", { method: "POST", body: { username, name: name.input.value.trim(), phone: phone.input.value.trim() } });
          const r = await api("reset-password", { method: "POST", body: { username, newPassword: pw.input.value, confirmPassword: pw2.input.value, phone: phone.input.value.trim() } });
          await onAuth(r);
        } catch (e) { error = e.message; draw(); }
      };
      card.append(h("div", { class: "muted", style: "margin-bottom:10px" }, "First login — verify your identity and set a password."),
        name, phone, pw, pw2, h("button", { class: "btn", style: "width:100%", onclick: submit }, "Set password & log in"),
        h("div", { class: "link", style: "margin-top:12px;text-align:center", onclick: () => { step = "employee"; error=""; draw(); } }, "‹ Wrong account"));
    }
  }
  draw();
}
async function onAuth(r) {
  setToken(r.token);
  if (r.passwordExpired) { /* still allow; backend will gate */ }
  await refresh();
  location.hash = "#/inventory";
  renderApp();
}

function logout() {
  api("logout", { method: "POST" }).catch(() => {});
  setToken(null); State.user = null;
  location.hash = "";
  renderLogin();
}

// ---------------------------------------------------------------- App shell
const Nav = [
  { id: "inventory", label: "Inventory", icon: "📦" },
  { id: "notifications", label: "Notifications", icon: "🔔" },
  { id: "records", label: "Records", icon: "🧾" },
];
function badgeCount() {
  const me = State.user?.id;
  return State.notifications.filter(n => n.isUnreadForBadge !== undefined ? (n.status === "unread" || n.status === "pending") : false)
    .filter(n => (n.recipientUserIds || []).includes(me) && n.senderUserId !== me).length;
}
function renderApp() {
  const app = $("#app"); clear(app);
  const route = (location.hash || "#/inventory").slice(2) || "inventory";

  const sidebar = h("div", { class: "sidebar" }, h("div", { class: "brand" }, "Inventory"));
  const navItems = [...Nav];
  if (State.permissions?.canManageInventory) navItems.push({ id: "manage", label: "Manage", icon: "🏢" });
  if (State.permissions?.canManageUsers) navItems.push({ id: "users", label: "Users", icon: "👥" });
  if (State.permissions?.canViewUserLogs) navItems.push({ id: "logs", label: "User Logs", icon: "📋" });
  for (const n of navItems) {
    const item = h("button", { class: "nav-item" + (route.startsWith(n.id) ? " active" : ""), onclick: () => { location.hash = "#/" + n.id; } },
      h("span", {}, n.icon), h("span", {}, n.label));
    if (n.id === "notifications") { const c = badgeCount(); if (c) item.append(h("span", { class: "badge" }, String(c))); }
    sidebar.append(item);
  }
  sidebar.append(h("div", { class: "nav-spacer" }),
    h("button", { class: "nav-item" + (route.startsWith("me") ? " active" : ""), onclick: () => location.hash = "#/me" }, h("span", {}, "👤"), h("span", {}, "Me")));

  const content = h("div", { class: "content" }, h("div", { class: "content-inner", id: "screen" }));
  app.append(h("div", { class: "app-shell" }, sidebar, content));
  renderScreen(route);
}

function renderScreen(route) {
  const screen = $("#screen"); if (!screen) return; clear(screen);
  const base = route.split("/")[0];
  try {
    if (base === "inventory") Screens.inventory(screen, route);
    else if (base === "notifications") Screens.notifications(screen);
    else if (base === "records") Screens.records(screen);
    else if (base === "manage") Screens.manage(screen, route);
    else if (base === "users") Screens.users(screen);
    else if (base === "logs") Screens.logs(screen);
    else if (base === "me") Screens.me(screen, route);
    else Screens.inventory(screen, route);
  } catch (e) { screen.append(h("div", { class: "err" }, e.message)); }
}

window.addEventListener("hashchange", () => { if (State.user) renderApp(); });

// ---------------------------------------------------------------- Boot
async function boot() {
  await acquireGeo();
  await refreshNodeGate();
  // First visit (no session): let the user pick the server before logging in.
  if (!State.token && !firstNodeChosen()) { renderServerSelect(); return; }
  // In auto/recommended mode, switch to the fastest node on load.
  await applyNodePreferenceOnLaunch();
  if (State.token) {
    try { await refresh(); if (!location.hash || location.hash === "#") location.hash = "#/inventory"; renderApp(); return; }
    catch (e) { setToken(null); }
  }
  renderLogin();
}

// First-launch (pre-login) server picker: choose Recommended (auto-fastest) or
// pin a specific node. Mirrors the iOS/Android first-run screen.
function renderServerSelect() {
  const app = $("#app"); clear(app);
  const card = h("div", { class: "card login-card", style: "padding:24px" });
  app.append(h("div", { class: "login-wrap" }, card));
  const lat = {};
  const latText = (label) => !(label in lat) ? "…" : (lat[label] == null ? "超時" : lat[label] + " ms");
  function proceed() { applyNodePreferenceOnLaunch().finally(renderLogin); }
  function draw() {
    clear(card);
    card.append(
      h("h1", {}, "选择服务器"),
      h("div", { class: "muted", style: "margin-bottom:16px" }, "首次使用，请先选择一个服务器节点。选择「推荐」后每次都会自动使用最快的节点；选择具体节点则会固定使用它。"));
    const best = recommendedNode(lat);
    card.append(h("button", { class: "btn", style: "width:100%;text-align:left;margin-bottom:14px",
      onclick: () => { chooseRecommended(best && best.label); proceed(); } },
      "⚡ 推荐（自动选择最快）" + (best ? "  ·  " + best.label + "  " + latText(best.label) : "")));
    const byRegion = {}; ServerNodes.forEach(n => { (byRegion[nodeRegion(n.label)] ||= []).push(n); });
    const regions = NODE_REGION_ORDER.filter(r => byRegion[r]).concat(Object.keys(byRegion).filter(r => !NODE_REGION_ORDER.includes(r)));
    for (const region of regions) {
      card.append(h("div", { class: "section-label" }, region));
      for (const n of byRegion[region]) {
        const offline = lat[n.label] === null;
        card.append(h("div", { class: "list-card", style: offline ? "opacity:.5" : "",
          onclick: () => { if (offline) { toast("This node is unreachable right now."); return; } chooseSpecificNode(n.label); proceed(); } },
          h("span", { class: "grow" }, n.label), h("span", { class: "muted" }, latText(n.label))));
      }
    }
  }
  draw();
  ServerNodes.forEach(async n => { lat[n.label] = await measureNode(n); draw(); });
}
window.addEventListener("load", boot);
