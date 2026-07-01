require("dotenv").config();
const http = require("http");
const { URL } = require("url");
const {
  SKU_PATTERN,
  StateStore,
  MongoStateStore,
  hashPassword,
  id,
  isPasswordExpired,
  now,
  publicUser,
  sessionPolicy,
  verifyPassword
} = require("./state");
const acf = require("./acfGenerator");
const mailer = require("./mailer");

// Notification types that should also be emailed (when SMTP is enabled).
// Approval requests (borrow/return/disposal) come through as "pending";
// the daily stock check uses "unscanned_check".
const EMAIL_NOTIFICATION_TYPES = new Set([
  "unscanned_check", "approval", "borrow_request", "return_request",
  "disposal_request", "repair_request", "transfer_request"
]);

// Email the recipients of a notification, if SMTP is enabled and the type is
// one we mirror to email. Fire-and-forget (never blocks the request).
function emailNotification(state, notification) {
  const smtp = state.notificationSettings?.smtp;
  if (!smtp?.enabled || !mailer.smtpConfigured(smtp)) return;
  const isPending = notification.status === "pending";
  if (!EMAIL_NOTIFICATION_TYPES.has(notification.type) && !isPending) return;
  const emails = (notification.recipientUserIds || [])
    .map((uid) => state.users.find((u) => u.id === uid))
    .filter((u) => u && !u.isDisabled && u.email)
    .map((u) => u.email);
  if (!emails.length) return;
  const subject = `[Inventory] ${notification.title}`;
  const text = `${notification.title}\n\n${notification.body}\n\n— PictureWorks Inventory`;
  mailer.sendMail(smtp, { to: emails, subject, text })
    .then((r) => { if (!r.ok) console.warn("[Email] send failed:", r.error); })
    .catch((e) => console.warn("[Email] send error:", e.message));
}

const PORT = Number(process.env.API_PORT || process.env.PORT || 4000);
const HOST = process.env.API_HOST || "0.0.0.0";
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "http://localhost:5173";
const DEFAULT_MONGODB_DB = "pictureAir_inventory";
let store;
let storeReady;

function productionMongoDbName() {
  return process.env.MONGODB_DB || DEFAULT_MONGODB_DB;
}

async function initializeStore(options = {}) {
  if (store) return store;
  if (storeReady) return storeReady;

  storeReady = (async () => {
    const useMongo = options.useMongo ?? Boolean(process.env.MONGODB_URI);
    if (useMongo) {
      store = new MongoStateStore(process.env.MONGODB_URI, productionMongoDbName());
      await store.connect();
    } else {
      store = new StateStore();
      store.load();
    }
    return store;
  })();

  return storeReady;
}

function sendJson(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": headers.origin || "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Geo",
    "Access-Control-Expose-Headers": "CF-Ray",
    "Access-Control-Max-Age": "86400"
  });
  res.end(JSON.stringify(body));
}

function error(res, statusCode, message, code = "error") {
  sendJson(res, statusCode, { error: message, code });
}

function sendBinary(res, buffer, contentType, filename) {
  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Content-Length": buffer.length,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "Content-Disposition"
  });
  res.end(buffer);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let aborted = false;
    // 25 MB: file uploads (ACF XLSX with embedded signature images, staff
    // spreadsheets) are base64-in-JSON and easily exceed a 1 MB cap.
    const MAX_BODY = 25 * 1024 * 1024;
    req.on("data", (chunk) => {
      if (aborted) return;
      raw += chunk;
      if (raw.length > MAX_BODY) {
        aborted = true;
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
  });
}

function cleanseSessions(state) {
  const current = Date.now();
  for (const user of state.users) {
    user.sessions = (user.sessions || []).filter((session) => new Date(session.expiresAt).getTime() > current);
  }
}

function clientIpFrom(req) {
  // X-Real-IP may be set by a frontend proxy to the visitor's true IP (some
  // proxy subrequests otherwise make cf-connecting-ip the edge IP).
  // Direct app traffic doesn't set it, so cf-connecting-ip (set by the CF edge /
  // tunnel) is the visitor IP there.
  return req.headers["x-real-ip"] || req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress || "";
}

function firstHeaderValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function cloudflareNodeFrom(req) {
  const cfRay = String(firstHeaderValue(req.headers["cf-ray"]) || "").split(",")[0].trim();
  const colo = cfRay.match(/-([a-z]{3})(?:\b|$)/i)?.[1]?.toUpperCase() || null;
  return { colo, ray: cfRay || null };
}

function logWithIp(ip) {
  return (state, actor, type, entityType, entityId, message, metadata = {}) =>
    createUserLog(state, actor, type, entityType, entityId, message, metadata, ip);
}

// Geolocation from a request: Cloudflare country header + client-supplied GPS
// (the app/web sends "X-Client-Geo: <lat>,<lng>" after the user consents).
function geoFrom(req) {
  const country = (req.headers["cf-ipcountry"] || "").toUpperCase() || null;
  let lat = null, lng = null;
  const raw = req.headers["x-client-geo"];
  if (raw) {
    const [a, b] = String(raw).split(",").map((s) => parseFloat(s));
    if (!isNaN(a) && !isNaN(b)) { lat = a; lng = b; }
  }
  return { country, lat, lng };
}

// Like logWithIp, but auto-attaches the request's IP + geolocation to every
// log entry's metadata — so every operation records where it happened.
function logWithReq(req) {
  const ip = clientIpFrom(req);
  const geo = geoFrom(req);
  return (state, actor, type, entityType, entityId, message, metadata = {}) =>
    createUserLog(state, actor, type, entityType, entityId, message, Object.assign({ geo }, metadata), ip);
}

function createUserLog(state, actor, type, entityType, entityId, message, metadata = {}, ipAddress = null) {
  const log = {
    id: id("log"),
    type,
    entityType,
    entityId,
    actorUserId: actor?.id || null,
    actorName: actor?.name || "System",
    actorRole: actor?.role || "system",
    message,
    metadata,
    ipAddress: ipAddress || null,
    createdAt: now()
  };
  state.userLogs.unshift(log);
  return log;
}

function permissionsFor(user) {
  const role = user.role;
  return {
    canViewInventory: role !== "staff",
    canManageInventory: ["warehouse_manager", "admin", "superadmin"].includes(role),
    canRepairInventory: ["admin", "superadmin"].includes(role),
    canRequestDisposal: ["warehouse_manager", "admin", "superadmin"].includes(role),
    canReturnFromRepair: ["warehouse_manager", "admin", "superadmin"].includes(role),
    canManageUsers: ["admin", "superadmin"].includes(role),
    canReceiveNotifications: role !== "staff",
    canManageAlerts: role === "superadmin",
    canViewUserLogs: role === "superadmin",
    canReviewApprovals: role === "superadmin",
    canCreateAdmin: role === "superadmin"
  };
}

function findWarehouse(state, warehouseId) {
  return state.warehouses.find((warehouse) => warehouse.id === warehouseId);
}

function findBranchOwner(state, branchId) {
  for (const warehouse of state.warehouses) {
    const branch = warehouse.branches?.find((candidate) => candidate.id === branchId);
    if (branch) return { warehouse, branch };
  }
  return null;
}

// Only superadmin sees every company. Admin is now scoped to its assigned
// companies/branches (like a manager) — empty branchIds = the whole company.
function userCanAccessWarehouse(user, warehouseId) {
  if (user.role === "superadmin") return true;
  return (user.warehouseIds || []).includes(warehouseId);
}

function userCanAccessBranch(user, warehouseId, branchId) {
  if (user.role === "superadmin") return true;
  if (!userCanAccessWarehouse(user, warehouseId)) return false;
  const branchIds = user.branchIds || [];
  return branchIds.length === 0 || branchIds.includes(branchId);
}

function scopeSkusForUser(state, user) {
  if (user.role === "superadmin") return state.skus;
  if (user.role === "staff") {
    return state.skus.filter((sku) => sku.borrowedByUserId === user.id || sku.status === "available");
  }
  return state.skus.filter((sku) => userCanAccessBranch(user, sku.warehouseId, sku.branchId));
}

function scopeUsersForUser(state, user) {
  if (user.role === "superadmin" || user.role === "admin") return state.users;
  if (user.role === "warehouse_manager") {
    return state.users.filter((candidate) => {
      if (candidate.id === user.id) return true;
      if (candidate.role === "superadmin" || candidate.role === "admin") return false;
      const commonWarehouse = (candidate.warehouseIds || []).some((warehouseId) => userCanAccessWarehouse(user, warehouseId));
      if (!commonWarehouse) return false;
      const managerBranches = user.branchIds || [];
      if (managerBranches.length === 0) return true;
      const candidateBranches = candidate.branchIds || [];
      return candidateBranches.length === 0 || candidateBranches.some((branchId) => managerBranches.includes(branchId));
    });
  }
  return state.users.filter((candidate) => candidate.id === user.id);
}

function scopeRecordsForUser(state, user) {
  if (user.role === "superadmin") return state.records;
  if (user.role === "staff") {
    return state.records.filter((record) => record.userId === user.id || record.operatorId === user.id);
  }
  return state.records.filter((record) => {
    if (record.operatorId === user.id || record.userId === user.id) return true;
    const sku = state.skus.find((candidate) => candidate.id === record.skuId);
    return sku && userCanAccessBranch(user, sku.warehouseId, sku.branchId);
  });
}

function createSession(state, user, req) {
  const policy = sessionPolicy(user.role);
  const token = cryptoSafeToken();
  const expiresAt = new Date(Date.now() + policy.ttlMs).toISOString();
  const session = {
    token,
    createdAt: now(),
    expiresAt,
    userAgent: req.headers["user-agent"] || "",
    ip: req.socket.remoteAddress || ""
  };
  user.sessions ||= [];
  user.sessions.push(session);
  user.sessions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (Number.isFinite(policy.maxDevices)) {
    user.sessions = user.sessions.slice(0, policy.maxDevices);
  }
  return { token, expiresAt };
}

function cryptoSafeToken() {
  return require("crypto").randomBytes(32).toString("base64url");
}

function authenticate(req) {
  const authHeader = req.headers.authorization || "";
  const [, token] = authHeader.match(/^Bearer\s+(.+)$/i) || [];
  if (!token) return null;
  const state = store.data;
  cleanseSessions(state);
  for (const user of state.users) {
    const session = (user.sessions || []).find((candidate) => candidate.token === token);
    if (session && !user.isDisabled) {
      return { user, session };
    }
  }
  return null;
}

// Set/clear a branch's endorser (the person who signs the Asset Check Form).
// The endorser MUST be an existing user so they can be notified to sign.
// Returns an error string, or null on success.
function applyEndorser(state, branch, body) {
  if (!("endorserUserId" in body)) return null; // field omitted → leave unchanged
  const wanted = body.endorserUserId;
  if (!wanted) { branch.endorserUserId = null; branch.endorserName = null; return null; }
  const user = state.users.find((u) => u.id === wanted && !u.isDisabled);
  if (!user) return "Endorser must be an existing user.";
  branch.endorserUserId = user.id;
  branch.endorserName = user.name;
  return null;
}

// Record who last scanned a SKU and when — used as the "CHECKED BY" / "DATE"
// columns in the Asset Check Form export.
function markScanned(sku, actor) {
  sku.lastScannedAt = now();
  sku.lastScannedByUserId = actor?.id || null;
  sku.lastScannedByName = actor?.name || null;
}

function skuPayload(state, sku) {
  const warehouse = findWarehouse(state, sku.warehouseId);
  const branch = warehouse?.branches?.find((candidate) => candidate.id === sku.branchId);
  const location = branch?.locations?.find((l) => l.id === sku.locationId);
  const category = warehouse?.categories?.find((candidate) => candidate.id === sku.categoryId);
  const borrower = state.users.find((candidate) => candidate.id === sku.borrowedByUserId);
  const repairer = state.users.find((candidate) => candidate.id === sku.repairRequestedByUserId);
  return {
    ...sku,
    skuCode: sku.skuCode || sku.skuNumber,
    skuNumber: sku.skuNumber || sku.skuCode,
    companyCode: warehouse?.code || "",
    companyName: warehouse?.name || "",
    parkName: branch?.name || "",
    locationName: location?.name || "",
    categoryCode: category?.code || "",
    borrowedByName: borrower?.name || null,
    borrowedByUsername: borrower?.username || null,
    repairRequestedByName: repairer?.name || null
  };
}

function bootstrapPayload(state, user) {
  return {
    currentUser: publicUser(user),
    permissions: permissionsFor(user),
    warehouses: state.warehouses,
    skus: scopeSkusForUser(state, user).map((sku) => skuPayload(state, sku)),
    users: scopeUsersForUser(state, user).map(publicUser),
    records: scopeRecordsForUser(state, user),
    notifications: user.role === "staff" ? [] : state.notifications.filter((notification) => {
      return (notification.recipientUserIds || []).includes(user.id) || notification.senderUserId === user.id;
    }),
    userLogs: user.role === "superadmin" ? state.userLogs : undefined,
    notificationSettings: user.role === "superadmin" ? state.notificationSettings : undefined,
    pingAlerts: user.role === "superadmin" ? (state.pingAlerts || { recipientUserIds: [], intervalMinutes: 5 }) : undefined,
    wecomDirectoryMeta: user.role === "superadmin" ? { latestImportAt: state.wecomDirectory?.latestImportAt || null } : undefined
  };
}

function normalizeSkuCode(value) {
  return String(value || "").trim().toUpperCase();
}

function findSkuByCode(state, skuCode) {
  const normalized = normalizeSkuCode(skuCode);
  return state.skus.find((sku) => normalizeSkuCode(sku.skuCode || sku.skuNumber) === normalized);
}

// Category code embedded in an ASSET ID like "PWBJ-CAM-0001" (second-to-last segment).
function acfCategoryCode(assetId) {
  const p = String(assetId || "").trim().split("-");
  return p.length >= 2 ? String(p[p.length - 2]).toUpperCase() : "";
}
// 4-digit number embedded in an ASSET ID (last segment, digits only).
function acfNumber(assetId) {
  const p = String(assetId || "").trim().split("-");
  return String(p[p.length - 1] || "").replace(/\D/g, "").padStart(4, "0").slice(-4);
}

// Parse the asset rows out of an exported ACF spreadsheet (XLSX/CSV). Finds the
// header row containing "ASSET ID" and reads ASSET ID / LOCATION / DESCRIPTION /
// SERIAL columns by position. Returns [{ assetId, location, description, serial }].
function parseAcfRows(base64) {
  const XLSX = require("xlsx");
  const buf = Buffer.from(base64, "base64");
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "" });
  const norm = (c) => String(c == null ? "" : c).trim();
  let headerIdx = -1;
  const col = { assetId: -1, location: -1, description: -1, serial: -1, remark: -1 };
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].map((c) => norm(c).toUpperCase());
    const ai = r.findIndex((c) => c === "ASSET ID");
    if (ai >= 0) {
      headerIdx = i;
      col.assetId = ai;
      col.location = r.findIndex((c) => c.includes("LOCATION"));
      col.description = r.findIndex((c) => c.includes("DESCRIPTION"));
      col.serial = r.findIndex((c) => c.includes("SERIAL"));
      // User's free-form remark column. Prefer a labelled header; otherwise
      // default to column J (index 9), where notes like "To OW" are kept.
      col.remark = r.findIndex((c) => c.includes("REMARK") || c.includes("NOTE") || c.includes("备注"));
      if (col.remark < 0) col.remark = 9;
      break;
    }
  }
  if (headerIdx < 0) throw new Error("Could not find an 'ASSET ID' column — is this an Asset Check Form?");
  const out = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i].map(norm);
    const assetId = col.assetId >= 0 ? r[col.assetId] : "";
    if (!assetId) continue;
    // Only real asset IDs (CODE-CAT-#### shape). This skips the signature footer
    // rows ("CHECKED BY:", "ENDORSED BY:", department, date) that share the
    // ASSET ID column, so they aren't mistaken for inventory items.
    if (!SKU_PATTERN.test(normalizeSkuCode(assetId))) continue;
    out.push({
      assetId,
      location: col.location >= 0 ? r[col.location] : "",
      description: col.description >= 0 ? r[col.description] : "",
      serial: col.serial >= 0 ? r[col.serial] : "",
      remark: col.remark >= 0 ? (r[col.remark] || "") : ""
    });
  }
  return out;
}

function createRecord(state, actor, type, sku, details = {}) {
  const record = {
    id: id("record"),
    type,
    skuId: sku.id,
    skuCode: sku.skuCode || sku.skuNumber,
    serialNumber: sku.serialNumber || "",
    userId: details.userId ?? sku.borrowedByUserId ?? null,
    operatorId: actor.id,
    fromBranchId: details.fromBranchId || null,
    toBranchId: details.toBranchId || null,
    note: details.note || "",
    metadata: details.metadata || {},
    createdAt: now()
  };
  state.records.unshift(record);
  return record;
}

function assertCanOperateOnSku(user, sku) {
  if (user.role === "staff") {
    if (sku.borrowedByUserId && sku.borrowedByUserId !== user.id) {
      return "Staff can only operate their own borrowed equipment.";
    }
    return null;
  }
  if (!userCanAccessBranch(user, sku.warehouseId, sku.branchId)) {
    return "SKU is outside your company or park scope.";
  }
  return null;
}

function allowedUserRoleCreator(actorRole, targetRole) {
  if (actorRole === "superadmin") return true;
  if (actorRole === "admin") return ["staff", "warehouse_manager"].includes(targetRole);
  return false;
}

async function handlePublicRoute(req, res, pathname, method) {
  if (method === "GET" && pathname === "/api/health") {
    return sendJson(res, 200, {
      ok: true,
      service: "inventory-borrowing-api",
      version: "0.1.0",
      publicBaseUrl: PUBLIC_BASE_URL,
      cloudflareNode: cloudflareNodeFrom(req),
      time: now()
    });
  }

  // Externally-triggered daily stock check (for hosts where an in-process timer
  // is unreliable, e.g. free dynos that sleep). Protected by CRON_SECRET:
  // POST /api/cron/daily-check with header  X-Cron-Secret: <CRON_SECRET>.
  if (method === "POST" && pathname === "/api/cron/daily-check") {
    const secret = process.env.CRON_SECRET;
    if (!secret || req.headers["x-cron-secret"] !== secret) {
      return error(res, 401, "Invalid cron secret.", "unauthorized");
    }
    try { await runDailyStockCheck(); } catch (e) { /* logged inside */ }
    return sendJson(res, 200, { ok: true, ranAt: now() });
  }

  // Geolocation for node-selection gating. Reads Cloudflare's CF-IPCountry
  // (present on CF-fronted requests) and echoes any client-supplied GPS.
  if (method === "GET" && pathname === "/api/geo") {
    const g = geoFrom(req);
    return sendJson(res, 200, { country: g.country, lat: g.lat, lng: g.lng, ip: clientIpFrom(req) });
  }

  if (method === "GET" && pathname === "/api/server-nodes") {
    const serverNodes = await store.getServerNodes();
    return sendJson(res, 200, { serverNodes });
  }

  if (method === "POST" && pathname === "/api/staff/parse-xlsx") {
    const body = await readBody(req);
    const base64 = String(body.fileBase64 || "");
    if (!base64) return error(res, 400, "No file provided.", "validation_error");
    let entries = [];
    try {
      const XLSX = require("xlsx");
      const buf = Buffer.from(base64, "base64");
      const wb = XLSX.read(buf, { type: "buffer" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "" });
      const norm = (c) => String(c == null ? "" : c).trim();
      let nameCol = -1, phoneCol = -1, emailCol = -1, headerIdx = -1;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i].map(norm);
        const ni = row.findIndex((c) => c === "姓名" || c.toLowerCase() === "name");
        if (ni >= 0) {
          headerIdx = i;
          nameCol = ni;
          phoneCol = row.findIndex((c) => c === "手机" || ["phone", "mobile"].includes(c.toLowerCase()));
          emailCol = row.findIndex((c) => c === "邮箱" || c.toLowerCase() === "email");
          if (emailCol < 0) emailCol = row.findIndex((c) => c.includes("邮箱"));
          break;
        }
      }
      if (headerIdx < 0) return error(res, 400, "Could not find a 姓名/Name column.", "parse_error");
      for (let i = headerIdx + 1; i < rows.length; i++) {
        const row = rows[i].map(norm);
        const name = row[nameCol] || "";
        if (!name) continue;
        const phone = phoneCol >= 0 ? (row[phoneCol] || "") : "";
        const email = emailCol >= 0 ? (row[emailCol] || "") : "";
        entries.push({ name, phone, email });
      }
    } catch (e) {
      return error(res, 400, "Failed to parse the spreadsheet: " + e.message, "parse_error");
    }
    return sendJson(res, 200, { entries });
  }

  if (method === "POST" && pathname === "/api/login-start") {
    const body = await readBody(req);
    const username = String(body.username || "").trim();
    const user = store.data.users.find((candidate) => candidate.username === username);
    return sendJson(res, 200, {
      exists: Boolean(user),
      hasPassword: Boolean(user?.passwordHash),
      resetRequired: Boolean(user?.passwordResetRequired),
      user: user ? { username: user.username, name: user.name, phoneCountryCode: user.phoneCountryCode } : null
    });
  }

  if (method === "POST" && pathname === "/api/forgot-password") {
    const body = await readBody(req);
    const clientIp = clientIpFrom(req);
    const username = String(body.username || "").trim();
    store.mutate((state) => {
      const user = state.users.find((u) => u.username === username);
      createUserLog(state, user || null, "forgot_password", "session", user?.id || null,
        user ? `${user.name} requested password reset.` : `Forgot password attempt for unknown user "${username}".`,
        {}, clientIp);
    });
    return sendJson(res, 200, { ok: true });
  }

  if (method === "POST" && pathname === "/api/verify-identity") {
    const body = await readBody(req);
    const clientIp = clientIpFrom(req);
    const username = String(body.username || "").trim();
    const name = String(body.name || "").trim();
    const phone = String(body.phone || "").trim();
    return store.mutate((state) => {
      const user = state.users.find((u) => u.username === username);
      if (!user || user.isDisabled) {
        createUserLog(state, null, "reset_password_verify_failed", "session", null,
          `Identity verify failed: unknown user "${username}".`, {}, clientIp);
        return error(res, 404, "User was not found.", "user_not_found");
      }
      const nameMatches = user.name.trim().toLowerCase() === name.toLowerCase();
      const phoneMatches = String(user.phone || "").trim() === phone;
      if (!nameMatches || !phoneMatches) {
        createUserLog(state, user, "reset_password_verify_failed", "session", user.id,
          `Identity verify failed for ${user.name}: name or phone mismatch.`, {}, clientIp);
        return error(res, 403, "Name or phone number does not match our records.", "identity_mismatch");
      }
      createUserLog(state, user, "reset_password_verify", "session", user.id,
        `${user.name} passed identity verification.`, {}, clientIp);
      return sendJson(res, 200, { ok: true });
    });
  }

  if (method === "POST" && pathname === "/api/login/biometric") {
    const body = await readBody(req);
    const clientIp = clientIpFrom(req);
    const btToken = String(body.biometricToken || "");
    if (!btToken) return error(res, 400, "Biometric token is required.", "missing_field");
    return store.mutate((state) => {
      cleanseSessions(state);
      const user = state.users.find((u) => u.biometricToken === btToken && !u.isDisabled);
      if (!user) return error(res, 401, "Biometric token is invalid or expired.", "invalid_biometric_token");
      if (!user.biometricTokenExpiresAt || new Date(user.biometricTokenExpiresAt).getTime() <= Date.now()) {
        user.biometricToken = null;
        user.biometricTokenExpiresAt = null;
        return error(res, 401, "Biometric token is invalid or expired.", "invalid_biometric_token");
      }
      const session = createSession(state, user, req);
      createUserLog(state, user, "login", "session", user.id, `${user.name} logged in via biometric.`, {}, clientIp);
      return sendJson(res, 200, { token: session.token, expiresAt: session.expiresAt, currentUser: publicUser(user), passwordExpired: isPasswordExpired(user) });
    });
  }

  if (method === "POST" && pathname === "/api/login") {
    const body = await readBody(req);
    const clientIp = clientIpFrom(req);
    return store.mutate((state) => {
      cleanseSessions(state);
      const user = state.users.find((candidate) => candidate.username === String(body.username || "").trim());
      if (!user || user.isDisabled) {
        createUserLog(state, null, "login_failed", "session", null, `Failed login attempt for "${String(body.username || "").trim()}".`, {}, clientIp);
        return error(res, 401, "Invalid employee ID or password.", "invalid_credentials");
      }
      if (user.passwordResetRequired || !user.passwordHash) {
        return error(res, 403, "Password reset is required.", "password_reset_required");
      }
      if (!verifyPassword(String(body.password || ""), user.passwordHash)) {
        createUserLog(state, user, "login_failed", "session", user.id, `Wrong password for ${user.name}.`, {}, clientIp);
        return error(res, 401, "Invalid employee ID or password.", "invalid_credentials");
      }
      const session = createSession(state, user, req);
      createUserLog(state, user, "login", "session", user.id, `${user.name} logged in.`, {}, clientIp);
      return sendJson(res, 200, { token: session.token, expiresAt: session.expiresAt, currentUser: publicUser(user), passwordExpired: isPasswordExpired(user) });
    });
  }

  if (method === "POST" && pathname === "/api/register") {
    const body = await readBody(req);
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const confirmPassword = String(body.confirmPassword || body.passwordConfirmation || "");
    const phone = String(body.phone || "").trim();
    const clientIp = clientIpFrom(req);
    return store.mutate((state) => {
      const user = state.users.find((candidate) => candidate.username === username);
      if (!user || user.isDisabled) return error(res, 404, "User was not found.", "user_not_found");
      if (user.passwordHash && !user.passwordResetRequired) return error(res, 409, "User already has a password.", "already_registered");
      if (!password || password !== confirmPassword) return error(res, 400, "Passwords do not match.", "password_mismatch");
      if (String(user.phone || "").trim() !== phone) return error(res, 403, "Please contact IT.", "phone_mismatch");
      user.passwordHash = hashPassword(password);
      user.passwordChangedAt = now();
      user.passwordResetRequired = false;
      user.updatedAt = now();
      const session = createSession(state, user, req);
      createUserLog(state, user, "register", "user", user.id, `${user.name} registered a password.`, {}, clientIp);
      return sendJson(res, 200, { token: session.token, expiresAt: session.expiresAt, currentUser: publicUser(user) });
    });
  }

  if (method === "POST" && pathname === "/api/reset-password") {
    const body = await readBody(req);
    const username = String(body.username || "").trim();
    const password = String(body.newPassword || body.password || "");
    const confirmPassword = String(body.confirmPassword || body.passwordConfirmation || "");
    const phone = String(body.phone || "").trim();
    const clientIp = clientIpFrom(req);
    return store.mutate((state) => {
      const user = state.users.find((candidate) => candidate.username === username);
      if (!user || user.isDisabled) return error(res, 404, "User was not found.", "user_not_found");
      if (!password || password !== confirmPassword) return error(res, 400, "Passwords do not match.", "password_mismatch");
      if (String(user.phone || "").trim() !== phone) return error(res, 403, "Please contact IT.", "phone_mismatch");
      if (user.passwordHash && verifyPassword(password, user.passwordHash)) {
        return error(res, 400, "New password cannot equal old password.", "password_reused");
      }
      user.passwordHash = hashPassword(password);
      user.passwordChangedAt = now();
      user.passwordResetRequired = false;
      user.sessions = [];
      user.updatedAt = now();
      const session = createSession(state, user, req);
      createUserLog(state, user, "reset_password", "user", user.id, `${user.name} reset password.`, {}, clientIp);
      return sendJson(res, 200, { token: session.token, expiresAt: session.expiresAt, currentUser: publicUser(user) });
    });
  }

  if (pathname.startsWith("/api/wecom/oauth/")) {
    return sendJson(res, 501, { error: "WeCom SSO is not enabled.", code: "wecom_sso_disabled" });
  }

  return false;
}

async function handleAuthenticatedRoute(req, res, pathname, method, auth, url) {
  const actor = auth.user;
  const log = logWithReq(req);

  if (method === "POST" && pathname === "/api/logout") {
    const sessionToken = auth.session?.token;
    return store.mutate((state) => {
      const user = state.users.find((u) => u.id === actor.id);
      if (user && sessionToken) {
        user.sessions = (user.sessions || []).filter((s) => s.token !== sessionToken);
      }
      log(state, actor, "logout", "session", actor.id, `${actor.name} logged out.`);
      return sendJson(res, 200, { ok: true });
    });
  }

  if (method === "POST" && pathname === "/api/session/extend") {
    const body = await readBody(req);
    const biometric = Boolean(body.biometric);
    return store.mutate((state) => {
      const user = state.users.find((u) => u.id === actor.id);
      const session = (user?.sessions || []).find((s) => s.token === auth.session.token);
      if (!user || !session) return error(res, 404, "Session not found.", "not_found");
      const policy = sessionPolicy(user.role);
      const ttl = biometric ? policy.biometricTtlMs : policy.ttlMs;
      session.expiresAt = new Date(Date.now() + ttl).toISOString();
      if (biometric) {
        const biometricToken = cryptoSafeToken();
        user.biometricToken = biometricToken;
        user.biometricTokenExpiresAt = new Date(Date.now() + policy.biometricTtlMs).toISOString();
        return sendJson(res, 200, { expiresAt: session.expiresAt, biometricToken });
      }
      return sendJson(res, 200, { expiresAt: session.expiresAt });
    });
  }

  if (method === "POST" && pathname === "/api/change-password") {
    const body = await readBody(req);
    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");
    const confirmPassword = String(body.confirmPassword || "");
    const clientIp = clientIpFrom(req);
    if (!currentPassword) return error(res, 400, "Current password is required.", "missing_field");
    if (!newPassword || newPassword !== confirmPassword) return error(res, 400, "Passwords do not match.", "password_mismatch");
    if (newPassword.length < 8) return error(res, 400, "Password must be at least 8 characters.", "password_too_short");
    return store.mutate((state) => {
      const user = state.users.find((u) => u.id === actor.id);
      if (!user) return error(res, 404, "User not found.", "not_found");
      if (!verifyPassword(currentPassword, user.passwordHash)) return error(res, 401, "Current password is incorrect.", "invalid_credentials");
      if (verifyPassword(newPassword, user.passwordHash)) return error(res, 400, "New password cannot be the same as the current password.", "password_reused");
      user.passwordHash = hashPassword(newPassword);
      user.passwordChangedAt = now();
      user.updatedAt = now();
      const currentToken = auth.session.token;
      user.sessions = (user.sessions || []).filter((s) => s.token === currentToken);
      log(state, actor, "password_change", "user", actor.id, `${actor.name} changed their password.`, {}, clientIp);
      return sendJson(res, 200, { ok: true });
    });
  }

  if (method === "GET" && pathname === "/api/bootstrap") {
    return sendJson(res, 200, bootstrapPayload(store.data, actor));
  }

  if (method === "GET" && pathname === "/api/warehouses") {
    return sendJson(res, 200, { warehouses: store.data.warehouses });
  }

  if (method === "POST" && pathname === "/api/warehouses") {
    if (!["admin", "superadmin"].includes(actor.role)) return error(res, 403, "Forbidden.", "forbidden");
    const body = await readBody(req);
    return store.mutate((state) => {
      const warehouse = {
        id: id("company"),
        code: String(body.code || "").trim().toUpperCase(),
        name: String(body.name || "").trim(),
        branches: [],
        categories: [],
        descriptions: [],
        createdAt: now(),
        updatedAt: now()
      };
      if (!warehouse.code || !warehouse.name) return error(res, 400, "Company code and name are required.", "validation_error");
      state.warehouses.push(warehouse);
      log(state, actor, "company_create", "company", warehouse.id, `Created company ${warehouse.code}.`);
      return sendJson(res, 201, { warehouse });
    });
  }

  const warehouseMatch = pathname.match(/^\/api\/warehouses\/([^/]+)$/);
  if (warehouseMatch && method === "PATCH") {
    if (!["admin", "superadmin"].includes(actor.role)) return error(res, 403, "Forbidden.", "forbidden");
    const body = await readBody(req);
    return store.mutate((state) => {
      const warehouse = findWarehouse(state, warehouseMatch[1]);
      if (!warehouse) return error(res, 404, "Company was not found.", "not_found");
      if (actor.role === "superadmin" && body.code != null) warehouse.code = String(body.code).trim().toUpperCase();
      if (body.name != null) warehouse.name = String(body.name).trim();
      warehouse.updatedAt = now();
      log(state, actor, "company_edit", "company", warehouse.id, `Edited company ${warehouse.code}.`);
      return sendJson(res, 200, { warehouse });
    });
  }

  if (warehouseMatch && method === "DELETE") {
    if (actor.role !== "superadmin") return error(res, 403, "Forbidden.", "forbidden");
    return store.mutate((state) => {
      const warehouse = findWarehouse(state, warehouseMatch[1]);
      if (!warehouse) return error(res, 404, "Company was not found.", "not_found");
      // Branches/categories/locations are nested in the company and removed with
      // it. Only block when real inventory or user assignments still reference it.
      const skuCount = state.skus.filter((sku) => sku.warehouseId === warehouse.id).length;
      const userCount = state.users.filter((user) => (user.warehouseIds || []).includes(warehouse.id)).length;
      if (skuCount || userCount) {
        const parts = [];
        if (skuCount) parts.push(`${skuCount} item${skuCount === 1 ? "" : "s"}`);
        if (userCount) parts.push(`${userCount} assigned user${userCount === 1 ? "" : "s"}`);
        return error(res, 409, `Can't delete: this company still has ${parts.join(" and ")}. Remove them first.`, "in_use");
      }
      state.warehouses = state.warehouses.filter((candidate) => candidate.id !== warehouse.id);
      log(state, actor, "company_delete", "company", warehouse.id, `Deleted company ${warehouse.code}.`);
      return sendJson(res, 200, { ok: true });
    });
  }

  const branchRoute = pathname.match(/^\/api\/warehouses\/([^/]+)\/branches(?:\/([^/]+))?$/);
  if (branchRoute) {
    if (!["warehouse_manager", "admin", "superadmin"].includes(actor.role)) return error(res, 403, "Forbidden.", "forbidden");
    const [_, warehouseId, branchId] = branchRoute;
    if (method === "POST") {
      const body = await readBody(req);
      return store.mutate((state) => {
        const warehouse = findWarehouse(state, warehouseId);
        if (!warehouse) return error(res, 404, "Company was not found.", "not_found");
        const branch = { id: id("park"), name: String(body.name || "").trim(), createdAt: now(), updatedAt: now() };
        if (!branch.name) return error(res, 400, "Park name is required.", "validation_error");
        const endorserErr = applyEndorser(state, branch, body);
        if (endorserErr) return error(res, 400, endorserErr, "validation_error");
        warehouse.branches ||= [];
        warehouse.branches.push(branch);
        warehouse.updatedAt = now();
        log(state, actor, "park_create", "park", branch.id, `Created park ${branch.name}.`);
        return sendJson(res, 201, { branch });
      });
    }
    if (method === "PATCH" && branchId) {
      const body = await readBody(req);
      let endorserChanged = false;
      const result = store.mutate((state) => {
        const warehouse = findWarehouse(state, warehouseId);
        const branch = warehouse?.branches?.find((candidate) => candidate.id === branchId);
        if (!branch) return error(res, 404, "Park was not found.", "not_found");
        const oldEndorser = branch.endorserUserId || null;
        branch.name = String(body.name || branch.name).trim();
        const endorserErr = applyEndorser(state, branch, body);
        if (endorserErr) return error(res, 400, endorserErr, "validation_error");
        branch.updatedAt = now();
        endorserChanged = (branch.endorserUserId || null) !== oldEndorser;
        log(state, actor, "park_edit", "park", branch.id, `Edited park ${branch.name}.`);
        return sendJson(res, 200, { branch });
      });
      // Auto-deny any still-pending Asset Check Forms routed to the old endorser.
      if (endorserChanged) {
        autoDenyFormsForEndorserChange(branchId).catch((e) => console.error("[ACF] auto-deny:", e.message));
      }
      return result;
    }
    if (method === "DELETE" && branchId) {
      return store.mutate((state) => {
        const warehouse = findWarehouse(state, warehouseId);
        const branch = warehouse?.branches?.find((candidate) => candidate.id === branchId);
        if (!branch) return error(res, 404, "Park was not found.", "not_found");
        if (state.skus.some((sku) => sku.branchId === branch.id)) return error(res, 409, "Park is still in use.", "in_use");
        warehouse.branches = warehouse.branches.filter((candidate) => candidate.id !== branch.id);
        log(state, actor, "park_delete", "park", branch.id, `Deleted park ${branch.name}.`);
        return sendJson(res, 200, { ok: true });
      });
    }
  }

  const locationRoute = pathname.match(/^\/api\/warehouses\/([^/]+)\/branches\/([^/]+)\/locations(?:\/([^/]+))?$/);
  if (locationRoute) {
    if (!["warehouse_manager", "admin", "superadmin"].includes(actor.role)) return error(res, 403, "Forbidden.", "forbidden");
    const [_, warehouseId, branchId, locationId] = locationRoute;
    if (method === "POST") {
      const body = await readBody(req);
      return store.mutate((state) => {
        const warehouse = findWarehouse(state, warehouseId);
        const branch = warehouse?.branches?.find((b) => b.id === branchId);
        if (!branch) return error(res, 404, "Branch was not found.", "not_found");
        const location = { id: id("location"), name: String(body.name || "").trim(), createdAt: now(), updatedAt: now() };
        if (!location.name) return error(res, 400, "Location name is required.", "validation_error");
        branch.locations ||= [];
        branch.locations.push(location);
        branch.updatedAt = now();
        log(state, actor, "location_create", "location", location.id, `Created location ${location.name}.`);
        return sendJson(res, 201, { location });
      });
    }
    if (method === "PATCH" && locationId) {
      const body = await readBody(req);
      return store.mutate((state) => {
        const warehouse = findWarehouse(state, warehouseId);
        const branch = warehouse?.branches?.find((b) => b.id === branchId);
        const location = branch?.locations?.find((l) => l.id === locationId);
        if (!location) return error(res, 404, "Location was not found.", "not_found");
        location.name = String(body.name || location.name).trim();
        location.updatedAt = now();
        log(state, actor, "location_edit", "location", location.id, `Edited location ${location.name}.`);
        return sendJson(res, 200, { location });
      });
    }
    if (method === "DELETE" && locationId) {
      return store.mutate((state) => {
        const warehouse = findWarehouse(state, warehouseId);
        const branch = warehouse?.branches?.find((b) => b.id === branchId);
        const location = branch?.locations?.find((l) => l.id === locationId);
        if (!location) return error(res, 404, "Location was not found.", "not_found");
        if (state.skus.some((sku) => sku.locationId === location.id)) return error(res, 409, "Location is still in use.", "in_use");
        branch.locations = branch.locations.filter((l) => l.id !== location.id);
        branch.updatedAt = now();
        log(state, actor, "location_delete", "location", location.id, `Deleted location ${location.name}.`);
        return sendJson(res, 200, { ok: true });
      });
    }
  }

  const categoryRoute = pathname.match(/^\/api\/warehouses\/([^/]+)\/categories(?:\/([^/]+))?$/);
  if (categoryRoute) {
    if (!["warehouse_manager", "admin", "superadmin"].includes(actor.role)) return error(res, 403, "Forbidden.", "forbidden");
    const [_, warehouseId, categoryId] = categoryRoute;
    if (method === "POST") {
      const body = await readBody(req);
      return store.mutate((state) => {
        const warehouse = findWarehouse(state, warehouseId);
        if (!warehouse) return error(res, 404, "Company was not found.", "not_found");
        const category = {
          id: id("category"),
          code: String(body.code || "").trim().toUpperCase(),
          branchIds: Array.isArray(body.branchIds) ? body.branchIds : [],
          createdAt: now(),
          updatedAt: now()
        };
        if (!category.code) return error(res, 400, "Category code is required.", "validation_error");
        warehouse.categories ||= [];
        warehouse.categories.push(category);
        warehouse.updatedAt = now();
        log(state, actor, "category_create", "category", category.id, `Created category ${category.code}.`);
        return sendJson(res, 201, { category });
      });
    }
    if (method === "PATCH" && categoryId) {
      const body = await readBody(req);
      return store.mutate((state) => {
        const warehouse = findWarehouse(state, warehouseId);
        const category = warehouse?.categories?.find((candidate) => candidate.id === categoryId);
        if (!category) return error(res, 404, "Category was not found.", "not_found");
        category.code = String(body.code || category.code).trim().toUpperCase();
        if (Array.isArray(body.branchIds)) category.branchIds = body.branchIds;
        category.updatedAt = now();
        log(state, actor, "category_edit", "category", category.id, `Edited category ${category.code}.`);
        return sendJson(res, 200, { category });
      });
    }
    if (method === "DELETE" && categoryId) {
      return store.mutate((state) => {
        const warehouse = findWarehouse(state, warehouseId);
        const category = warehouse?.categories?.find((candidate) => candidate.id === categoryId);
        if (!category) return error(res, 404, "Category was not found.", "not_found");
        if (state.skus.some((sku) => sku.categoryId === category.id)) return error(res, 409, "Category is still in use.", "in_use");
        warehouse.categories = warehouse.categories.filter((candidate) => candidate.id !== category.id);
        log(state, actor, "category_delete", "category", category.id, `Deleted category ${category.code}.`);
        return sendJson(res, 200, { ok: true });
      });
    }
  }

  if (method === "GET" && pathname === "/api/skus") {
    return sendJson(res, 200, { skus: scopeSkusForUser(store.data, actor).map((sku) => skuPayload(store.data, sku)) });
  }

  if (method === "POST" && pathname === "/api/skus") {
    if (!["warehouse_manager", "admin", "superadmin"].includes(actor.role)) return error(res, 403, "Forbidden.", "forbidden");
    const body = await readBody(req);
    return store.mutate((state) => {
      const warehouse = findWarehouse(state, body.warehouseId || body.companyId);
      const branch = warehouse?.branches?.find((candidate) => candidate.id === (body.branchId || body.parkId));
      const category = warehouse?.categories?.find((candidate) => candidate.id === body.categoryId);
      if (!warehouse || !branch || !category) return error(res, 400, "Company, park, and category are required.", "validation_error");
      if (!userCanAccessBranch(actor, warehouse.id, branch.id)) return error(res, 403, "SKU is outside your scope.", "forbidden");
      const location = body.locationId ? (branch.locations || []).find((l) => l.id === body.locationId) : null;
      if (body.locationId && !location) return error(res, 400, "Location was not found in this branch.", "validation_error");
      const number = String(body.skuNumber || body.number || "").replace(/\D/g, "").padStart(4, "0").slice(-4);
      const skuCode = `${warehouse.code}-${category.code}-${number}`;
      if (!SKU_PATTERN.test(skuCode)) return error(res, 400, "Invalid SKU code.", "invalid_sku");
      if (findSkuByCode(state, skuCode)) return error(res, 409, "SKU code already exists.", "duplicate_sku");
      const description = (warehouse.descriptions || []).find((candidate) => candidate.id === body.descriptionId);
      const sku = {
        id: id("sku"),
        skuCode,
        skuNumber: skuCode,
        warehouseId: warehouse.id,
        categoryId: category.id,
        branchId: branch.id,
        locationId: location ? location.id : null,
        serialNumber: String(body.serialNumber || "").trim(),
        descriptionId: description?.id || null,
        descriptionText: description?.text || String(body.descriptionText || "").trim(),
        status: "available",
        borrowedByUserId: null,
        borrowedAt: null,
        repairStartedAt: null,
        disposalType: null,
        soldTo: null,
        createdAt: now(),
        updatedAt: now()
      };
      state.skus.push(sku);
      log(state, actor, "sku_add", "sku", sku.id, `Added SKU ${skuCode}.`);
      return sendJson(res, 201, { sku: skuPayload(state, sku) });
    });
  }

  // ---- ACF import: parse an Asset Check Form + diff against current inventory ----
  if (method === "POST" && pathname === "/api/inventory/import/parse") {
    if (!["warehouse_manager", "admin", "superadmin"].includes(actor.role)) return error(res, 403, "Forbidden.", "forbidden");
    const body = await readBody(req);
    const base64 = String(body.fileBase64 || "");
    if (!base64) return error(res, 400, "No file provided.", "validation_error");
    const state = store.data;
    const warehouse = findWarehouse(state, body.companyId);
    const branch = warehouse?.branches?.find((b) => b.id === body.branchId);
    if (!warehouse || !branch) return error(res, 400, "Company and branch are required.", "validation_error");
    let parsed;
    try { parsed = parseAcfRows(base64); }
    catch (e) { return error(res, 400, "Failed to parse the file: " + e.message, "parse_error"); }

    const norm = (s) => String(s == null ? "" : s).trim();
    const eq = (a, b) => norm(a).toLowerCase() === norm(b).toLowerCase();
    const result = { newItems: [], mismatched: [], existing: [], newLocations: [], remarks: [] };

    // Rows the user annotated in their remark column (e.g. "To OW" = a possible
    // transfer) — pulled out separately so they're easy to spot. A remark row is
    // still categorised normally above; this just highlights it.
    for (const row of parsed) {
      const remark = norm(row.remark);
      if (!remark) continue;
      const sku = findSkuByCode(state, norm(row.assetId));
      let curBranchId = null, curLocationName = "";
      if (sku) {
        const sbr = (warehouse.branches || []).find((b) => b.id === sku.branchId);
        curBranchId = sku.branchId || null;
        curLocationName = norm(sbr?.locations?.find((l) => l.id === sku.locationId)?.name);
      }
      result.remarks.push({
        assetId: norm(row.assetId), remark, skuId: sku ? sku.id : null,
        description: norm(row.description), serial: norm(row.serial), location: norm(row.location),
        currentBranchId: curBranchId, currentLocation: curLocationName
      });
    }

    // Locations in the file that don't yet exist in the selected branch (created
    // automatically on apply) — surfaced so the user can see what's new.
    const existingLocNames = new Set((branch.locations || []).map((l) => norm(l.name).toLowerCase()));
    const seenNewLoc = new Set();
    for (const row of parsed) {
      const locName = norm(row.location);
      if (locName && !existingLocNames.has(locName.toLowerCase()) && !seenNewLoc.has(locName.toLowerCase())) {
        seenNewLoc.add(locName.toLowerCase());
        result.newLocations.push(locName);
      }
    }

    for (const row of parsed) {
      const assetId = norm(row.assetId);
      if (!assetId) continue;
      const sku = findSkuByCode(state, assetId);
      if (!sku) {
        result.newItems.push({ assetId, description: norm(row.description), serial: norm(row.serial), location: norm(row.location), category: acfCategoryCode(assetId) });
        continue;
      }
      const wh = findWarehouse(state, sku.warehouseId);
      const cat = wh?.categories?.find((c) => c.id === sku.categoryId);
      const br = wh?.branches?.find((b) => b.id === sku.branchId);
      const loc = br?.locations?.find((l) => l.id === sku.locationId);
      const diffs = [];
      // Only flag a field when the ACF actually provides a (differing) value.
      if (norm(row.description) && !eq(sku.descriptionText, row.description)) diffs.push({ field: "description", current: norm(sku.descriptionText), imported: norm(row.description) });
      if (norm(row.serial) && !eq(sku.serialNumber, row.serial)) diffs.push({ field: "serial", current: norm(sku.serialNumber), imported: norm(row.serial) });
      if (norm(row.location) && !eq(loc?.name, row.location)) diffs.push({ field: "location", current: norm(loc?.name), imported: norm(row.location) });
      if (!eq(cat?.code, acfCategoryCode(assetId))) diffs.push({ field: "category", current: norm(cat?.code), imported: acfCategoryCode(assetId) });
      if (diffs.length === 0) {
        result.existing.push({ assetId, skuId: sku.id });
      } else {
        result.mismatched.push({ assetId, skuId: sku.id, diffs, description: norm(row.description), serial: norm(row.serial), location: norm(row.location) });
      }
    }
    result.counts = { new: result.newItems.length, mismatched: result.mismatched.length, existing: result.existing.length, newLocations: result.newLocations.length, remarks: result.remarks.length, total: parsed.length };
    return sendJson(res, 200, result);
  }

  // ---- ACF import: apply the selected creates/updates ----
  if (method === "POST" && pathname === "/api/inventory/import/apply") {
    if (!["warehouse_manager", "admin", "superadmin"].includes(actor.role)) return error(res, 403, "Forbidden.", "forbidden");
    const body = await readBody(req);
    return store.mutate((state) => {
      const warehouse = findWarehouse(state, body.companyId);
      const branch = warehouse?.branches?.find((b) => b.id === body.branchId);
      if (!warehouse || !branch) return error(res, 400, "Company and branch are required.", "validation_error");
      if (!userCanAccessBranch(actor, warehouse.id, branch.id)) return error(res, 403, "Branch is outside your scope.", "forbidden");
      const norm = (s) => String(s == null ? "" : s).trim();

      // Resolve (or auto-create) a category by code / a location by name.
      function resolveCategory(code) {
        code = norm(code).toUpperCase();
        let cat = (warehouse.categories || []).find((c) => norm(c.code).toUpperCase() === code);
        if (!cat) { cat = { id: id("category"), code, branchIds: [], createdAt: now(), updatedAt: now() }; warehouse.categories = warehouse.categories || []; warehouse.categories.push(cat); }
        return cat;
      }
      // Resolve/create a location by name within a SPECIFIC branch.
      function resolveLocationIn(targetBranch, name) {
        name = norm(name);
        if (!name || !targetBranch) return null;
        targetBranch.locations = targetBranch.locations || [];
        let loc = targetBranch.locations.find((l) => norm(l.name).toLowerCase() === name.toLowerCase());
        if (!loc) { loc = { id: id("location"), name, createdAt: now(), updatedAt: now() }; targetBranch.locations.push(loc); }
        return loc;
      }
      const resolveLocation = (name) => resolveLocationIn(branch, name);

      let created = 0, updated = 0, transferred = 0;
      const errors = [];

      // Remark-row placements: per-row branch/location chosen by the user.
      // Existing SKU → transfer to the target branch/location; new → create there.
      // Processed first so create/update can skip these rows.
      const placedAssetIds = new Set();
      const placedSkuIds = new Set();
      for (const p of (body.place || [])) {
        const targetBranch = (warehouse.branches || []).find((b) => b.id === p.branchId);
        if (!targetBranch) { errors.push(`${norm(p.assetId)}: target branch not found`); continue; }
        if (!userCanAccessBranch(actor, warehouse.id, targetBranch.id)) { errors.push(`${norm(p.assetId)}: target branch out of scope`); continue; }
        const loc = resolveLocationIn(targetBranch, p.location);
        if (p.skuId) {
          const sku = state.skus.find((s) => s.id === p.skuId);
          if (!sku) { errors.push(`${norm(p.assetId)}: not found`); continue; }
          sku.branchId = targetBranch.id;
          sku.locationId = loc ? loc.id : null;
          if (norm(p.description)) { sku.descriptionText = norm(p.description); sku.descriptionId = null; }
          if (norm(p.serial)) sku.serialNumber = norm(p.serial);
          sku.updatedAt = now();
          placedSkuIds.add(p.skuId);
          transferred++;
          log(state, actor, "transfer", "sku", sku.id, `Transferred ${sku.skuCode} to ${targetBranch.name}${loc ? " / " + loc.name : ""} (ACF import).`);
        } else {
          const assetId = norm(p.assetId);
          const skuCode = `${warehouse.code}-${acfCategoryCode(assetId)}-${acfNumber(assetId)}`;
          if (!SKU_PATTERN.test(skuCode)) { errors.push(`${assetId}: invalid SKU code`); continue; }
          if (findSkuByCode(state, skuCode)) { errors.push(`${assetId}: already exists`); continue; }
          const cat = resolveCategory(acfCategoryCode(assetId));
          state.skus.push({
            id: id("sku"), skuCode, skuNumber: skuCode,
            warehouseId: warehouse.id, categoryId: cat.id, branchId: targetBranch.id,
            locationId: loc ? loc.id : null,
            serialNumber: norm(p.serial),
            descriptionId: null, descriptionText: norm(p.description),
            status: "available", borrowedByUserId: null, borrowedAt: null,
            repairStartedAt: null, disposalType: null, soldTo: null,
            createdAt: now(), updatedAt: now()
          });
          placedAssetIds.add(assetId);
          created++;
        }
      }

      for (const item of (body.create || [])) {
        const assetId = norm(item.assetId);
        if (placedAssetIds.has(assetId)) continue;   // handled by a placement
        const skuCode = `${warehouse.code}-${acfCategoryCode(assetId)}-${acfNumber(assetId)}`;
        if (!SKU_PATTERN.test(skuCode)) { errors.push(`${assetId}: invalid SKU code`); continue; }
        if (findSkuByCode(state, skuCode)) { errors.push(`${assetId}: already exists`); continue; }
        const cat = resolveCategory(acfCategoryCode(assetId));
        const loc = resolveLocation(item.location);
        state.skus.push({
          id: id("sku"), skuCode, skuNumber: skuCode,
          warehouseId: warehouse.id, categoryId: cat.id, branchId: branch.id,
          locationId: loc ? loc.id : null,
          serialNumber: norm(item.serial),
          descriptionId: null, descriptionText: norm(item.description),
          status: "available", borrowedByUserId: null, borrowedAt: null,
          repairStartedAt: null, disposalType: null, soldTo: null,
          createdAt: now(), updatedAt: now()
        });
        created++;
      }
      for (const item of (body.update || [])) {
        if (placedSkuIds.has(item.skuId)) continue;   // handled by a placement
        const sku = state.skus.find((s) => s.id === item.skuId);
        if (!sku) { errors.push(`${item.assetId || item.skuId}: not found`); continue; }
        if (norm(item.description)) { sku.descriptionText = norm(item.description); sku.descriptionId = null; }
        if (norm(item.serial)) sku.serialNumber = norm(item.serial);
        if (norm(item.location)) { const loc = resolveLocation(item.location); if (loc) sku.locationId = loc.id; sku.branchId = branch.id; }
        sku.updatedAt = now();
        updated++;
      }
      log(state, actor, "inventory_import", "warehouse", warehouse.id, `Imported ACF into ${warehouse.code}/${branch.name}: ${created} created, ${updated} updated, ${transferred} transferred.`);
      return sendJson(res, 200, { created, updated, transferred, errors });
    });
  }

  const skuRoute = pathname.match(/^\/api\/skus\/([^/]+)(?:\/(disposal))?$/);
  if (skuRoute) {
    const [_, skuId, child] = skuRoute;
    if (method === "PATCH" && !child) {
      if (!["admin", "superadmin"].includes(actor.role)) return error(res, 403, "Forbidden.", "forbidden");
      const body = await readBody(req);
      return store.mutate((state) => {
        const sku = state.skus.find((candidate) => candidate.id === skuId);
        if (!sku) return error(res, 404, "SKU was not found.", "not_found");
        if (!userCanAccessBranch(actor, sku.warehouseId, sku.branchId)) return error(res, 403, "SKU is outside your scope.", "forbidden");
        const warehouse = findWarehouse(state, sku.warehouseId);
        // Recompute SKU code when the category or the 4-digit number changes.
        const numberProvided = body.skuNumber != null && String(body.skuNumber).trim() !== "";
        if ((body.categoryId != null && body.categoryId !== sku.categoryId) || numberProvided) {
          const category = warehouse?.categories?.find((c) => c.id === (body.categoryId || sku.categoryId));
          if (!category) return error(res, 400, "Category was not found.", "validation_error");
          let number = String(sku.skuCode || "").split("-").pop() || "0000";
          if (numberProvided) {
            number = String(body.skuNumber).replace(/\D/g, "").padStart(4, "0").slice(-4);
          }
          const newCode = `${warehouse.code}-${category.code}-${number}`;
          if (newCode !== sku.skuCode && findSkuByCode(state, newCode)) return error(res, 409, "SKU code already exists.", "duplicate_sku");
          sku.categoryId = category.id;
          sku.skuCode = newCode;
          sku.skuNumber = newCode;
        }
        // Branch change → reset location (locations belong to a branch).
        if (body.branchId != null && body.branchId !== sku.branchId) {
          const branch = warehouse?.branches?.find((b) => b.id === body.branchId);
          if (!branch) return error(res, 400, "Branch was not found.", "validation_error");
          sku.branchId = branch.id;
          sku.locationId = null;
        }
        // Location change (validate it belongs to the current branch).
        if (body.locationId !== undefined) {
          const branch = warehouse?.branches?.find((b) => b.id === sku.branchId);
          if (body.locationId) {
            const loc = (branch?.locations || []).find((l) => l.id === body.locationId);
            if (!loc) return error(res, 400, "Location was not found in this branch.", "validation_error");
            sku.locationId = loc.id;
          } else {
            sku.locationId = null;
          }
        }
        if (body.serialNumber != null) sku.serialNumber = String(body.serialNumber).trim();
        if (body.descriptionId !== undefined) {
          const desc = (warehouse?.descriptions || []).find((d) => d.id === body.descriptionId);
          if (body.descriptionId && desc) {
            sku.descriptionId = desc.id;
            sku.descriptionText = desc.text;
          } else {
            sku.descriptionId = null;
            if (body.descriptionText != null) sku.descriptionText = String(body.descriptionText).trim();
          }
        } else if (body.descriptionText != null) {
          sku.descriptionText = String(body.descriptionText).trim();
        }
        sku.updatedAt = now();
        log(state, actor, "sku_edit", "sku", sku.id, `Edited SKU ${sku.skuCode}.`);
        return sendJson(res, 200, { sku: skuPayload(state, sku) });
      });
    }
    if (method === "DELETE" && !child) {
      if (!["admin", "superadmin"].includes(actor.role)) return error(res, 403, "Forbidden.", "forbidden");
      return store.mutate((state) => {
        const sku = state.skus.find((candidate) => candidate.id === skuId);
        if (!sku) return error(res, 404, "SKU was not found.", "not_found");
        if (!userCanAccessBranch(actor, sku.warehouseId, sku.branchId)) return error(res, 403, "SKU is outside your scope.", "forbidden");
        state.skus = state.skus.filter((candidate) => candidate.id !== sku.id);
        log(state, actor, "sku_delete", "sku", sku.id, `Deleted SKU ${sku.skuCode}.`);
        return sendJson(res, 200, { ok: true });
      });
    }
    if (method === "POST" && child === "disposal") {
      if (!["warehouse_manager", "admin", "superadmin"].includes(actor.role)) return error(res, 403, "Forbidden.", "forbidden");
      const body = await readBody(req);
      return store.mutate((state) => {
        const sku = state.skus.find((candidate) => candidate.id === skuId);
        if (!sku) return error(res, 404, "SKU was not found.", "not_found");
        if (!userCanAccessBranch(actor, sku.warehouseId, sku.branchId)) return error(res, 403, "SKU is outside your scope.", "forbidden");
        const disposalType = body.type === "sold_to_another_party" ? "sold_to_another_party" : "disposed_from_inventory";
        if (disposalType === "sold_to_another_party" && !String(body.soldTo || "").trim()) {
          return error(res, 400, "Sold to is required.", "validation_error");
        }
        sku.status = disposalType === "sold_to_another_party" ? "sold" : "disposed";
        sku.disposalType = disposalType;
        sku.soldTo = disposalType === "sold_to_another_party" ? String(body.soldTo).trim() : null;
        sku.updatedAt = now();
        createRecord(state, actor, sku.status === "sold" ? "sold" : "disposal", sku, { note: body.note || "", metadata: { soldTo: sku.soldTo } });
        log(state, actor, "sku_disposal", "sku", sku.id, `${sku.status === "sold" ? "Sold" : "Disposed"} SKU ${sku.skuCode}.`);
        return sendJson(res, 200, { sku: skuPayload(state, sku) });
      });
    }
  }

  const scanRoute = pathname.match(/^\/api\/scan\/(.+)$/);
  if (method === "GET" && scanRoute) {
    const skuCode = decodeURIComponent(scanRoute[1]);
    if (!SKU_PATTERN.test(normalizeSkuCode(skuCode))) return error(res, 400, "Invalid SKU code.", "invalid_sku");
    return store.mutate((state) => {
      const sku = findSkuByCode(state, skuCode);
      if (!sku) return error(res, 404, "SKU was not found.", "not_found");
      const scopeError = assertCanOperateOnSku(actor, sku);
      if (scopeError) return error(res, 403, scopeError, "forbidden");
      markScanned(sku, actor);
      log(state, actor, "scan", "sku", sku.id, `Scanned ${sku.skuCode || sku.skuNumber}.`);
      return sendJson(res, 200, { sku: skuPayload(state, sku) });
    });
  }

  if (["/api/borrow", "/api/return", "/api/repair", "/api/return-after-repair"].includes(pathname) && method === "POST") {
    const body = await readBody(req);
    const skuCode = body.skuNumber || body.skuCode;
    const type = pathname.split("/").pop();
    return store.mutate((state) => {
      const sku = findSkuByCode(state, skuCode);
      if (!sku) return error(res, 404, "SKU was not found.", "not_found");
      const scopeError = assertCanOperateOnSku(actor, sku);
      if (scopeError) return error(res, 403, scopeError, "forbidden");
      if (type === "borrow") {
        if (sku.status !== "available") return error(res, 409, "Only available equipment can be borrowed.", "invalid_status");
        sku.status = "borrowed";
        sku.borrowedByUserId = actor.id;
        sku.borrowedAt = now();
        markScanned(sku, actor);
        sku.updatedAt = now();
        createRecord(state, actor, "borrow", sku, { userId: actor.id });
        log(state, actor, "borrow", "sku", sku.id, `Borrowed ${sku.skuCode}.`);
      } else if (type === "return") {
        if (sku.status !== "borrowed") return error(res, 409, "Only borrowed equipment can be returned.", "invalid_status");
        const borrowerId = sku.borrowedByUserId;
        sku.status = "available";
        sku.borrowedByUserId = null;
        sku.borrowedAt = null;
        markScanned(sku, actor);
        sku.updatedAt = now();
        createRecord(state, actor, "return", sku, { userId: borrowerId });
        log(state, actor, "return", "sku", sku.id, `Returned ${sku.skuCode}.`);
      } else if (type === "repair") {
        if (!["admin", "superadmin"].includes(actor.role)) return error(res, 403, "Only admin or superadmin can request repair.", "forbidden");
        if (sku.status !== "available") return error(res, 409, "Only available equipment can be marked for repair.", "invalid_status");
        sku.status = "repairing";
        sku.repairStartedAt = now();
        sku.repairRequestedByUserId = actor.id;
        sku.repairReason = body.reason ? String(body.reason).trim() : null;
        sku.repairDestination = body.destination ? String(body.destination).trim() : null;
        markScanned(sku, actor);
        sku.updatedAt = now();
        createRecord(state, actor, "repair", sku);
        log(state, actor, "repair", "sku", sku.id, `Marked ${sku.skuCode} as repairing.`);
      } else {
        if (actor.role === "staff") return error(res, 403, "Staff cannot return equipment from repair.", "forbidden");
        if (sku.status !== "repairing") return error(res, 409, "Only repairing equipment can be marked repaired.", "invalid_status");
        sku.status = "available";
        sku.repairStartedAt = null;
        sku.repairRequestedByUserId = null;
        sku.repairReason = null;
        sku.repairDestination = null;
        markScanned(sku, actor);
        sku.updatedAt = now();
        createRecord(state, actor, "repaired", sku);
        log(state, actor, "repaired", "sku", sku.id, `Marked ${sku.skuCode} as repaired.`);
      }
      return sendJson(res, 200, { sku: skuPayload(state, sku) });
    });
  }

  if (method === "POST" && pathname === "/api/transfer") {
    if (!["warehouse_manager", "admin", "superadmin"].includes(actor.role)) return error(res, 403, "Forbidden.", "forbidden");
    const body = await readBody(req);
    return store.mutate((state) => {
      const sku = state.skus.find((candidate) => candidate.id === body.skuId) || findSkuByCode(state, body.skuNumber || body.skuCode);
      if (!sku) return error(res, 404, "SKU was not found.", "not_found");
      if (["disposed", "sold"].includes(sku.status)) return error(res, 409, "Disposed or sold equipment cannot be transferred.", "invalid_status");
      if (!userCanAccessBranch(actor, sku.warehouseId, sku.branchId)) return error(res, 403, "SKU is outside your scope.", "forbidden");
      const target = findBranchOwner(state, body.toBranchId || body.targetBranchId || body.targetParkId);
      if (!target) return error(res, 404, "Target park was not found.", "not_found");
      if (target.warehouse.id !== sku.warehouseId) return error(res, 400, "Transfer is only allowed within the same company.", "invalid_transfer");
      if (!target.warehouse.categories?.some((category) => category.id === sku.categoryId)) {
        return error(res, 400, "Target company does not have the SKU category.", "invalid_transfer");
      }
      const fromBranchId = sku.branchId;
      sku.branchId = target.branch.id;
      sku.updatedAt = now();
      createRecord(state, actor, "transfer", sku, { fromBranchId, toBranchId: target.branch.id, note: body.reason || "" });
      log(state, actor, "sku_transfer", "sku", sku.id, `Transferred ${sku.skuCode} to ${target.branch.name}.`);
      return sendJson(res, 200, { sku: skuPayload(state, sku) });
    });
  }

  if (method === "POST" && pathname === "/api/disposal") {
    if (!["warehouse_manager", "admin", "superadmin"].includes(actor.role)) return error(res, 403, "Forbidden.", "forbidden");
    const body = await readBody(req);
    const reason = String(body.reason || "").trim();
    const netBookValue = String(body.netBookValue || "").trim();
    if (!reason || !netBookValue) return error(res, 400, "Reason and net book value are required.", "validation_error");
    return store.mutate((state) => {
      const sku = state.skus.find((candidate) => candidate.id === body.skuId) || findSkuByCode(state, body.skuNumber || body.skuCode);
      if (!sku) return error(res, 404, "SKU was not found.", "not_found");
      if (["disposed", "sold"].includes(sku.status)) return error(res, 409, "Disposed or sold equipment cannot be disposed again.", "invalid_status");
      if (!userCanAccessBranch(actor, sku.warehouseId, sku.branchId)) return error(res, 403, "SKU is outside your scope.", "forbidden");
      const recipients = state.users.filter((user) => user.role === "superadmin" && !user.isDisabled).map((user) => user.id);
      const notification = {
        id: id("notification"),
        type: "disposal_request",
        title: `Disposal request: ${sku.skuCode}`,
        body: `${actor.name || actor.username} requested disposal. Reason: ${reason}. Net book value: ${netBookValue}.`,
        senderUserId: actor.id,
        recipientUserIds: recipients,
        status: "pending",
        relatedEntityType: "sku",
        relatedEntityId: sku.id,
        requestedPatch: { action: "disposal", skuId: sku.id, skuCode: sku.skuCode, reason, netBookValue },
        reviewedByUserId: null,
        reviewedAt: null,
        reviewNote: null,
        createdAt: now(),
        updatedAt: now()
      };
      state.notifications.unshift(notification);
      emailNotification(state, notification);
      log(state, actor, "sku_disposal_request", "sku", sku.id, `Requested disposal for ${sku.skuCode}.`);
      return sendJson(res, 200, { sku: skuPayload(state, sku), notification });
    });
  }

  if (method === "GET" && pathname === "/api/records") {
    return sendJson(res, 200, { records: scopeRecordsForUser(store.data, actor) });
  }

  if (method === "GET" && pathname === "/api/users") {
    return sendJson(res, 200, { users: scopeUsersForUser(store.data, actor).map(publicUser) });
  }

  if (method === "POST" && pathname === "/api/users") {
    if (!["admin", "superadmin"].includes(actor.role)) return error(res, 403, "Forbidden.", "forbidden");
    const body = await readBody(req);
    return store.mutate((state) => {
      const role = body.role || "staff";
      if (!allowedUserRoleCreator(actor.role, role)) return error(res, 403, "Cannot create this role.", "forbidden");
      const username = String(body.username || "").trim();
      if (!username || state.users.some((user) => user.username === username)) return error(res, 409, "Employee ID already exists or is invalid.", "duplicate_user");
      const user = {
        id: id("user"),
        username,
        name: String(body.name || username).trim(),
        role,
        phone: String(body.phone || "").trim(),
        phoneCountryCode: body.phoneCountryCode || "+86",
        email: String(body.email || "").trim(),
        wecomUserId: body.wecomUserId || null,
        wechatOpenId: body.wechatOpenId || null,
        passwordHash: null,
        passwordResetRequired: true,
        isDisabled: false,
        disabledAt: null,
        warehouseIds: role === "superadmin" ? [] : body.warehouseIds || body.companyIds || [],
        branchIds: role === "superadmin" ? [] : body.branchIds || body.parkIds || [],
        createdAt: now(),
        updatedAt: now(),
        passwordChangedAt: now(),
        sessions: []
      };
      state.users.push(user);
      log(state, actor, "user_create", "user", user.id, `Created user ${user.username}.`);
      return sendJson(res, 201, { user: publicUser(user) });
    });
  }

  const userRoute = pathname.match(/^\/api\/users\/([^/]+)(?:\/([^/]+))?$/);
  if (userRoute) {
    const [_, userId, action] = userRoute;
    if (!["admin", "superadmin"].includes(actor.role) && action !== "password") return error(res, 403, "Forbidden.", "forbidden");
    if (method === "PATCH" && !action) {
      const body = await readBody(req);
      return store.mutate((state) => {
        const user = state.users.find((candidate) => candidate.id === userId);
        if (!user) return error(res, 404, "User was not found.", "not_found");
        if (actor.role === "admin" && ["admin", "superadmin"].includes(user.role)) return error(res, 403, "Forbidden.", "forbidden");
        if (body.name != null) user.name = String(body.name).trim();
        if (body.role != null && allowedUserRoleCreator(actor.role, body.role)) user.role = body.role;
        if (body.phone != null) user.phone = String(body.phone).trim();
        if (body.phoneCountryCode != null) user.phoneCountryCode = String(body.phoneCountryCode).trim();
        if (body.email != null) user.email = String(body.email).trim();
        if (body.warehouseIds != null || body.companyIds != null) user.warehouseIds = body.warehouseIds || body.companyIds || [];
        if (body.branchIds != null || body.parkIds != null) user.branchIds = body.branchIds || body.parkIds || [];
        user.updatedAt = now();
        log(state, actor, "user_edit", "user", user.id, `Edited user ${user.username}.`);
        return sendJson(res, 200, { user: publicUser(user) });
      });
    }
    if (method === "PATCH" && action === "disable") {
      return store.mutate((state) => {
        const user = state.users.find((candidate) => candidate.id === userId);
        if (!user) return error(res, 404, "User was not found.", "not_found");
        if (actor.role === "admin" && ["admin", "superadmin"].includes(user.role)) return error(res, 403, "Forbidden.", "forbidden");
        if (state.skus.some((sku) => sku.borrowedByUserId === user.id)) {
          return error(res, 409, "This user still has borrowed equipment.", "borrowed_items_exist");
        }
        user.isDisabled = true;
        user.disabledAt = now();
        user.sessions = [];
        user.updatedAt = now();
        log(state, actor, "user_disable", "user", user.id, `Disabled user ${user.username}.`);
        return sendJson(res, 200, { user: publicUser(user) });
      });
    }
    if (method === "PATCH" && action === "resume") {
      return store.mutate((state) => {
        const user = state.users.find((candidate) => candidate.id === userId);
        if (!user) return error(res, 404, "User was not found.", "not_found");
        if (actor.role === "admin" && ["admin", "superadmin"].includes(user.role)) return error(res, 403, "Forbidden.", "forbidden");
        user.isDisabled = false;
        user.disabledAt = null;
        user.updatedAt = now();
        log(state, actor, "user_resume", "user", user.id, `Resumed user ${user.username}.`);
        return sendJson(res, 200, { user: publicUser(user) });
      });
    }
    if (method === "PATCH" && action === "password") {
      const body = await readBody(req);
      return store.mutate((state) => {
        const target = state.users.find((candidate) => candidate.id === userId);
        if (!target) return error(res, 404, "User was not found.", "not_found");
        if (actor.id !== target.id && !["admin", "superadmin"].includes(actor.role)) return error(res, 403, "Forbidden.", "forbidden");
        const newPassword = String(body.newPassword || body.password || "");
        if (!newPassword) return error(res, 400, "New password is required.", "validation_error");
        target.passwordHash = hashPassword(newPassword);
        target.passwordResetRequired = false;
        target.sessions = [];
        target.updatedAt = now();
        log(state, actor, "change_password", "user", target.id, `Changed password for ${target.username}.`);
        return sendJson(res, 200, { ok: true });
      });
    }
    if (method === "POST" && action === "reset-password-required") {
      return store.mutate((state) => {
        const target = state.users.find((candidate) => candidate.id === userId);
        if (!target) return error(res, 404, "User was not found.", "not_found");
        if (actor.role === "admin" && ["admin", "superadmin"].includes(target.role)) return error(res, 403, "Forbidden.", "forbidden");
        target.passwordHash = null;
        target.passwordResetRequired = true;
        target.sessions = [];
        target.updatedAt = now();
        log(state, actor, "admin_password_reset", "user", target.id, `Reset password requirement for ${target.username}.`);
        return sendJson(res, 200, { user: publicUser(target) });
      });
    }
  }

  if (method === "GET" && pathname === "/api/notifications") {
    if (actor.role === "staff") return sendJson(res, 200, { notifications: [] });
    return sendJson(res, 200, {
      notifications: store.data.notifications.filter((notification) => {
        return (notification.recipientUserIds || []).includes(actor.id) || notification.senderUserId === actor.id;
      })
    });
  }

  if (method === "POST" && pathname === "/api/notifications") {
    if (actor.role === "staff") return error(res, 403, "Staff cannot create notifications.", "forbidden");
    const body = await readBody(req);
    return store.mutate((state) => {
      const notification = {
        id: id("notification"),
        type: body.type || "info",
        title: String(body.title || "Notification").trim(),
        body: String(body.body || "").trim(),
        senderUserId: actor.id,
        recipientUserIds: body.recipientUserIds || [],
        status: body.status || "unread",
        relatedEntityType: body.relatedEntityType || null,
        relatedEntityId: body.relatedEntityId || null,
        requestedPatch: body.requestedPatch || null,
        reviewedByUserId: null,
        reviewedAt: null,
        reviewNote: null,
        createdAt: now(),
        updatedAt: now()
      };
      state.notifications.unshift(notification);
      emailNotification(state, notification);
      log(state, actor, "notification_create", "notification", notification.id, `Created notification ${notification.title}.`);
      return sendJson(res, 201, { notification });
    });
  }

  const notificationReviewRoute = pathname.match(/^\/api\/notifications\/([^/]+)\/review$/);
  if (notificationReviewRoute && method === "POST") {
    if (actor.role === "staff") return error(res, 403, "Staff cannot review notifications.", "forbidden");
    const body = await readBody(req);
    return store.mutate((state) => {
      const notification = state.notifications.find((candidate) => candidate.id === notificationReviewRoute[1]);
      if (!notification) return error(res, 404, "Notification was not found.", "not_found");
      if (actor.role !== "superadmin" && !(notification.recipientUserIds || []).includes(actor.id)) {
        return error(res, 403, "Forbidden.", "forbidden");
      }
      const approved = body.status === "approved" || body.approved === true;
      notification.status = approved ? "approved" : "denied";
      if (body.reviewNote != null) notification.reviewNote = String(body.reviewNote);
      notification.reviewedByUserId = actor.id;
      notification.reviewedAt = now();
      notification.updatedAt = now();
      if (approved && notification.requestedPatch?.action === "disposal") {
        const sku = state.skus.find((candidate) => candidate.id === notification.requestedPatch.skuId);
        if (sku && !["disposed", "sold"].includes(sku.status)) {
          sku.status = "disposed";
          sku.disposalType = "disposed_from_inventory";
          sku.disposalReason = notification.requestedPatch.reason || "";
          sku.netBookValue = notification.requestedPatch.netBookValue || "";
          sku.updatedAt = now();
          createRecord(state, actor, "disposal", sku, {
            note: sku.disposalReason,
            metadata: { netBookValue: sku.netBookValue, notificationId: notification.id }
          });
          log(state, actor, "sku_disposal", "sku", sku.id, `Approved disposal for ${sku.skuCode}.`);
        }
      }
      log(state, actor, "notification_review", "notification", notification.id, `Reviewed notification ${notification.title}.`);
      return sendJson(res, 200, { notification });
    });
  }

  const notificationRoute = pathname.match(/^\/api\/notifications\/([^/]+)$/);
  if (notificationRoute && method === "PATCH") {
    if (actor.role === "staff") return error(res, 403, "Staff cannot update notifications.", "forbidden");
    const body = await readBody(req);
    return store.mutate((state) => {
      const notification = state.notifications.find((candidate) => candidate.id === notificationRoute[1]);
      if (!notification) return error(res, 404, "Notification was not found.", "not_found");
      if (!(notification.recipientUserIds || []).includes(actor.id) && notification.senderUserId !== actor.id && actor.role !== "superadmin") {
        return error(res, 403, "Forbidden.", "forbidden");
      }
      if (body.status) notification.status = body.status;
      if (body.reviewNote != null) notification.reviewNote = String(body.reviewNote);
      if (["approved", "denied", "rejected"].includes(body.status)) {
        notification.reviewedByUserId = actor.id;
        notification.reviewedAt = now();
      }
      notification.updatedAt = now();
      log(state, actor, "notification_update", "notification", notification.id, `Updated notification ${notification.title}.`);
      return sendJson(res, 200, { notification });
    });
  }

  if (method === "GET" && pathname === "/api/notification-settings") {
    if (actor.role !== "superadmin") return error(res, 403, "Forbidden.", "forbidden");
    return sendJson(res, 200, { notificationSettings: store.data.notificationSettings || {} });
  }

  if (method === "PATCH" && pathname === "/api/notification-settings") {
    if (actor.role !== "superadmin") return error(res, 403, "Forbidden.", "forbidden");
    const body = await readBody(req);
    return store.mutate((state) => {
      state.notificationSettings = { ...state.notificationSettings, ...body, updatedAt: now() };
      log(state, actor, "alert_config_edit", "notificationSettings", "notificationSettings", "Edited alert settings.");
      return sendJson(res, 200, { notificationSettings: state.notificationSettings });
    });
  }

  // Ping-alert recipients (who gets emailed when a backend node goes down/up).
  if (method === "GET" && pathname === "/api/ping-alerts") {
    if (actor.role !== "superadmin") return error(res, 403, "Forbidden.", "forbidden");
    return sendJson(res, 200, { pingAlerts: store.data.pingAlerts || { recipientUserIds: [], intervalMinutes: 5 } });
  }

  if (method === "PATCH" && pathname === "/api/ping-alerts") {
    if (actor.role !== "superadmin") return error(res, 403, "Forbidden.", "forbidden");
    const body = await readBody(req);
    return store.mutate((state) => {
      const cur = state.pingAlerts || { recipientUserIds: [], intervalMinutes: 5 };
      if (Array.isArray(body.recipientUserIds)) {
        // Only superadmins who have an email on record may be recipients.
        cur.recipientUserIds = body.recipientUserIds.filter((id) => {
          const u = state.users.find((x) => x.id === id);
          return u && u.role === "superadmin" && String(u.email || "").includes("@");
        });
      }
      if (body.intervalMinutes != null) cur.intervalMinutes = Math.max(1, Number(body.intervalMinutes) || 5);
      cur.updatedAt = now();
      state.pingAlerts = cur;
      log(state, actor, "alert_config_edit", "pingAlerts", "pingAlerts", "Edited ping-alert recipients.");
      return sendJson(res, 200, { pingAlerts: state.pingAlerts });
    });
  }

  if (method === "POST" && ["/api/notification-settings/smtp-test", "/api/notification-settings/test-smtp"].includes(pathname)) {
    if (actor.role !== "superadmin") return error(res, 403, "Forbidden.", "forbidden");
    const body = await readBody(req);
    const state = store.data;
    const smtp = state.notificationSettings?.smtp || {};
    // Send a real test email to the superadmin's own address (or one provided).
    const to = String(body.to || actor.email || "").trim();
    if (!to.includes("@")) return error(res, 400, "No test recipient email. Set your profile email first.", "no_email");
    const result = await mailer.sendMail(smtp, {
      to,
      subject: "[Inventory] SMTP test email",
      text: `This is a test email from PictureWorks Inventory.\nIf you received it, SMTP is configured correctly.\n\nSent at ${now()}.`
    });
    store.mutate((s) => {
      s.notificationSettings.smtp ||= {};
      s.notificationSettings.smtp.lastTestAt = now();
      s.notificationSettings.smtp.health = result.ok ? "ok" : "not work";
      log(s, actor, "smtp_test", "notificationSettings", "notificationSettings",
        result.ok ? `SMTP test email sent to ${to}.` : `SMTP test failed: ${result.error}`);
    });
    return sendJson(res, 200, {
      ok: result.ok,
      health: result.ok ? "ok" : "not work",
      message: result.ok ? `Test email sent to ${to}.` : `SMTP test failed: ${result.error}`
    });
  }

  if (method === "GET" && pathname === "/api/user-logs") {
    if (actor.role !== "superadmin") return error(res, 403, "Forbidden.", "forbidden");
    return sendJson(res, 200, { userLogs: store.data.userLogs });
  }

  if (method === "POST" && ["/api/wecom/directory/sync", "/api/wecom/directory/import"].includes(pathname)) {
    if (actor.role !== "superadmin") return error(res, 403, "Forbidden.", "forbidden");
    return store.mutate((state) => {
      state.wecomDirectory.latestImportAt = now();
      log(state, actor, "wecom_directory_import", "wecomDirectory", "wecomDirectory", "Updated directory metadata.");
      return sendJson(res, 200, { latestImportAt: state.wecomDirectory.latestImportAt, members: state.wecomDirectory.members || [] });
    });
  }

  if (method === "GET" && pathname === "/api/wecom/directory/search") {
    if (!["admin", "superadmin"].includes(actor.role)) return error(res, 403, "Forbidden.", "forbidden");
    const query = String(url.searchParams.get("q") || "").trim().toLowerCase();
    const members = (store.data.wecomDirectory.members || []).filter((member) => {
      return [member.name, member.username, member.phone, member.email].some((value) => String(value || "").toLowerCase().includes(query));
    });
    return sendJson(res, 200, { members });
  }

  // ---------------------------------------------------------- Asset Check Forms
  if (pathname === "/api/asset-check-forms" && method === "POST") {
    return createAssetCheckForm(req, res, actor, log);
  }
  const acfSignRoute = pathname.match(/^\/api\/asset-check-forms\/([^/]+)\/(sign|deny)$/);
  if (acfSignRoute && method === "POST") {
    return signOrDenyAssetCheckForm(req, res, actor, log, acfSignRoute[1], acfSignRoute[2]);
  }
  const acfWithdrawRoute = pathname.match(/^\/api\/asset-check-forms\/([^/]+)\/withdraw$/);
  if (acfWithdrawRoute && method === "POST") {
    return withdrawAssetCheckForm(res, actor, log, acfWithdrawRoute[1]);
  }
  const acfResubmitRoute = pathname.match(/^\/api\/asset-check-forms\/([^/]+)\/resubmit$/);
  if (acfResubmitRoute && method === "POST") {
    return resubmitAssetCheckForm(req, res, actor, log, acfResubmitRoute[1]);
  }
  const acfGetRoute = pathname.match(/^\/api\/asset-check-forms\/([^/]+)$/);
  if (acfGetRoute && method === "GET") {
    return getAssetCheckForm(res, actor, acfGetRoute[1]);
  }
  const acfDownloadRoute = pathname.match(/^\/api\/asset-check-forms\/([^/]+)\/download$/);
  if (acfDownloadRoute && method === "GET") {
    return downloadAssetCheckForm(res, actor, acfDownloadRoute[1]);
  }

  return false;
}

// ---- Asset Check Form helpers -------------------------------------------------

// Build the frozen row snapshot for a branch at request time.
function buildAcfSnapshot(state, warehouse, branch) {
  const rows = state.skus
    .filter((sku) => sku.warehouseId === warehouse.id && sku.branchId === branch.id &&
      ["available", "borrowed", "repairing"].includes(sku.status))
    .sort((a, b) => String(a.skuCode || "").localeCompare(String(b.skuCode || "")));
  return rows.map((sku, i) => {
    const location = (branch.locations || []).find((l) => l.id === sku.locationId);
    return {
      no: i + 1,
      assetId: sku.skuCode || sku.skuNumber || "",
      location: branch.name,
      description: sku.descriptionText || "",
      serial: sku.serialNumber || "",
      found: location ? location.name : branch.name,
      checkedBy: sku.lastScannedByName || "",
      date: acf.fmtDate(sku.lastScannedAt)
    };
  });
}

async function createAssetCheckForm(req, res, actor, log) {
  if (!["admin", "superadmin"].includes(actor.role)) return error(res, 403, "Forbidden.", "forbidden");
  const body = await readBody(req);
  const state = store.data;
  const warehouse = findWarehouse(state, body.companyId);
  if (!warehouse) return error(res, 404, "Company was not found.", "not_found");
  const branch = warehouse.branches?.find((b) => b.id === body.branchId);
  if (!branch) return error(res, 404, "Branch was not found.", "not_found");
  if (!branch.endorserUserId) return error(res, 400, "This branch has no endorser set.", "no_endorser");
  const endorser = state.users.find((u) => u.id === branch.endorserUserId && !u.isDisabled);
  if (!endorser) return error(res, 400, "The branch endorser is not a valid user.", "no_endorser");
  const acfNo = String(body.acfNo || "").trim();
  if (!acfNo) return error(res, 400, "A file name is required.", "validation_error");
  const signature = String(body.signaturePng || "").trim();
  if (!signature) return error(res, 400, "Your signature is required.", "validation_error");
  const rows = buildAcfSnapshot(state, warehouse, branch);
  if (!rows.length) return error(res, 400, "This branch has no assets to export.", "empty");

  const ts = now();
  const form = {
    _id: id("acf"),
    acfNo,
    companyId: warehouse.id,
    companyName: warehouse.name,
    branchId: branch.id,
    branchName: branch.name,
    rows,
    requester: { userId: actor.id, name: actor.name, signaturePng: signature, signedAt: ts },
    requestDate: ts,
    endorser: { userId: endorser.id, name: endorser.name, signaturePng: null, signedAt: null },
    approvalDate: null,
    status: "pending_endorsement",
    denyReason: null,
    ownerPassword: acf.randomPassword(),
    files: null,
    createdAt: ts,
    updatedAt: ts
  };
  await store.acfForms.insertOne(form);

  // Auto-complete when the requester is also the endorser: reuse their signature
  // for both boxes, skip the self sign-request, and finalise immediately.
  if (actor.id === endorser.id) {
    form.endorser.signaturePng = signature;
    form.endorser.signedAt = ts;
    form.approvalDate = ts;
    await generateAndCompleteForm(form, actor, log);
    return sendJson(res, 201, { form: publicAcf(form) });
  }

  store.mutate((s) => {
    s.notifications.unshift(acfNotification({
      type: "acf_sign_request",
      title: `Asset Check Form to sign: ${acfNo}`,
      body: `${actor.name} requests your signature for ${warehouse.name} / ${branch.name} (${rows.length} assets).`,
      senderUserId: actor.id,
      recipients: [endorser.id],
      formId: form._id,
      acf: acfMetaFor(s, form, false)
    }));
    // The requester gets a "sent" notification with a withdraw option.
    s.notifications.unshift(acfNotification({
      type: "acf_submitted",
      title: `Asset Check Form sent: ${acfNo}`,
      body: `Sent to ${endorser.name} for signing (${rows.length} assets). You can withdraw it within 30 minutes.`,
      senderUserId: actor.id,
      recipients: [actor.id],
      formId: form._id,
      acf: acfMetaFor(s, form, false)
    }));
    log(s, actor, "acf_create", "asset_check_form", form._id, `Requested ACF ${acfNo} for ${branch.name}.`);
  });
  return sendJson(res, 201, { form: publicAcf(form) });
}

async function signOrDenyAssetCheckForm(req, res, actor, log, formId, action) {
  const body = await readBody(req);
  const form = await store.acfForms.findOne({ _id: formId });
  if (!form) return error(res, 404, "Asset Check Form was not found.", "not_found");
  if (form.endorser.userId !== actor.id) return error(res, 403, "Only the branch endorser can sign or deny.", "forbidden");
  if (form.status !== "pending_endorsement") return error(res, 409, "This form is no longer pending.", "invalid_status");

  if (action === "deny") {
    const reason = String(body.reason || "").trim();
    await store.acfForms.updateOne({ _id: formId }, { $set: { status: "denied", denyReason: reason, updatedAt: now() } });
    store.mutate((s) => {
      s.notifications.unshift(acfNotification({
        type: "acf_denied",
        title: `Asset Check Form denied: ${form.acfNo}`,
        body: `${actor.name} denied your Asset Check Form.${reason ? " Reason: " + reason : ""}`,
        senderUserId: actor.id,
        recipients: [form.requester.userId],
        formId
      }));
      log(s, actor, "acf_deny", "asset_check_form", formId, `Denied ACF ${form.acfNo}.`);
    });
    return sendJson(res, 200, { ok: true });
  }

  // sign
  const signature = String(body.signaturePng || "").trim();
  if (!signature) return error(res, 400, "Your signature is required.", "validation_error");
  form.endorser.signaturePng = signature;
  form.endorser.signedAt = now();
  form.approvalDate = now();
  await generateAndCompleteForm(form, actor, log);
  return sendJson(res, 200, { ok: true });
}

// Requester may withdraw a still-pending form within this window of submitting.
const ACF_WITHDRAW_WINDOW_MS = 30 * 60 * 1000;

// Requester cancels a still-pending form before the endorser signs.
async function withdrawAssetCheckForm(res, actor, log, formId) {
  const form = await store.acfForms.findOne({ _id: formId });
  if (!form) return error(res, 404, "Asset Check Form was not found.", "not_found");
  if (form.requester.userId !== actor.id) return error(res, 403, "Only the requester can withdraw this form.", "forbidden");
  if (form.status !== "pending_endorsement") return error(res, 409, "This form can no longer be withdrawn.", "invalid_status");
  const age = Date.now() - new Date(form.requestDate).getTime();
  if (age > ACF_WITHDRAW_WINDOW_MS) return error(res, 409, "The 30-minute withdrawal window has passed.", "withdraw_expired");
  await store.acfForms.updateOne({ _id: formId }, { $set: { status: "withdrawn", updatedAt: now() } });
  store.mutate((s) => {
    // Resolve the endorser's sign request and the requester's "sent" notice.
    s.notifications.forEach((n) => {
      if (n.relatedEntityId === formId && ["acf_sign_request", "acf_submitted"].includes(n.type)) n.status = "read";
    });
    // Give the requester an entry point to edit & resubmit the withdrawn form.
    s.notifications.unshift(acfNotification({
      type: "acf_withdrawn",
      title: `Asset Check Form withdrawn: ${form.acfNo}`,
      body: "You withdrew this form. You can edit and resubmit it.",
      senderUserId: null,
      recipients: [actor.id],
      formId,
      acf: { acfNo: form.acfNo }
    }));
    log(s, actor, "acf_withdraw", "asset_check_form", formId, `Withdrew ACF ${form.acfNo}.`);
  });
  return sendJson(res, 200, { ok: true });
}

// Requester edits & resubmits a denied or withdrawn form (reuses the same record):
// re-freezes the snapshot from current data and routes to the current endorser.
async function resubmitAssetCheckForm(req, res, actor, log, formId) {
  const body = await readBody(req);
  const form = await store.acfForms.findOne({ _id: formId });
  if (!form) return error(res, 404, "Asset Check Form was not found.", "not_found");
  if (form.requester.userId !== actor.id) return error(res, 403, "Only the requester can resubmit this form.", "forbidden");
  if (!["denied", "withdrawn"].includes(form.status)) return error(res, 409, "Only a denied or withdrawn form can be resubmitted.", "invalid_status");
  const signature = String(body.signaturePng || "").trim();
  if (!signature) return error(res, 400, "Your signature is required.", "validation_error");

  const state = store.data;
  // Company/branch may be edited on resubmit; default to the form's originals.
  const companyId = body.companyId || form.companyId;
  const branchId = body.branchId || form.branchId;
  const warehouse = findWarehouse(state, companyId);
  if (!warehouse) return error(res, 404, "Company was not found.", "not_found");
  const branch = warehouse?.branches?.find((b) => b.id === branchId);
  if (!branch) return error(res, 404, "Branch was not found.", "not_found");
  if (!branch.endorserUserId) return error(res, 400, "This branch has no endorser set.", "no_endorser");
  const endorser = state.users.find((u) => u.id === branch.endorserUserId && !u.isDisabled);
  if (!endorser) return error(res, 400, "The branch endorser is not a valid user.", "no_endorser");
  const rows = buildAcfSnapshot(state, warehouse, branch);
  if (!rows.length) return error(res, 400, "This branch has no assets to export.", "empty");

  const ts = now();
  const acfNo = String(body.acfNo || form.acfNo).trim();
  Object.assign(form, {
    acfNo,
    companyId: warehouse.id,
    companyName: warehouse.name,
    branchId: branch.id,
    branchName: branch.name,
    rows,
    requester: { userId: actor.id, name: actor.name, signaturePng: signature, signedAt: ts },
    requestDate: ts,
    endorser: { userId: endorser.id, name: endorser.name, signaturePng: null, signedAt: null },
    approvalDate: null,
    status: "pending_endorsement",
    denyReason: null,
    files: null,
    ownerPassword: acf.randomPassword(),
    updatedAt: ts
  });
  await store.acfForms.replaceOne({ _id: formId }, form);

  if (actor.id === endorser.id) {
    form.endorser.signaturePng = signature;
    form.endorser.signedAt = ts;
    form.approvalDate = ts;
    await generateAndCompleteForm(form, actor, log);
    return sendJson(res, 200, { form: publicAcf(form) });
  }
  store.mutate((s) => {
    s.notifications.unshift(acfNotification({
      type: "acf_sign_request",
      title: `Asset Check Form to sign: ${acfNo}`,
      body: `${actor.name} requests your signature for ${form.companyName} / ${branch.name} (${rows.length} assets).`,
      senderUserId: actor.id, recipients: [endorser.id], formId, acf: acfMetaFor(s, form, false)
    }));
    s.notifications.unshift(acfNotification({
      type: "acf_submitted",
      title: `Asset Check Form sent: ${acfNo}`,
      body: `Resent to ${endorser.name} for signing (${rows.length} assets). You can withdraw it within 30 minutes.`,
      senderUserId: actor.id, recipients: [actor.id], formId, acf: acfMetaFor(s, form, false)
    }));
    log(s, actor, "acf_resubmit", "asset_check_form", formId, `Resubmitted ACF ${acfNo}.`);
  });
  return sendJson(res, 200, { form: publicAcf(form) });
}

// Full detail for the requester to review/edit before resubmitting.
async function getAssetCheckForm(res, actor, formId) {
  const form = await store.acfForms.findOne({ _id: formId });
  if (!form) return error(res, 404, "Asset Check Form was not found.", "not_found");
  const isParty = [form.requester.userId, form.endorser.userId].includes(actor.id);
  if (!isParty && actor.role !== "superadmin") return error(res, 403, "You cannot view this form.", "forbidden");
  return sendJson(res, 200, { form: publicAcf(form, actor) });
}

async function downloadAssetCheckForm(res, actor, formId) {
  const form = await store.acfForms.findOne({ _id: formId });
  if (!form) return error(res, 404, "Asset Check Form was not found.", "not_found");
  if (form.status !== "completed" || !form.files) return error(res, 409, "This form is not ready for download.", "not_ready");
  const isParty = [form.requester.userId, form.endorser.userId].includes(actor.id);
  const isSuper = actor.role === "superadmin";
  if (!isParty && !isSuper) return error(res, 403, "You cannot download this form.", "forbidden");

  if (isSuper) {
    const pdf = await store.loadFile(form.files.pdfId);
    const xlsx = await store.loadFile(form.files.xlsxId);
    const zip = await acf.buildZipBuffer([
      { name: `${form.acfNo}.pdf`, buffer: pdf },
      { name: `${form.acfNo}.xlsx`, buffer: xlsx }
    ]);
    return sendBinary(res, zip, "application/zip", `${form.acfNo}.zip`);
  }
  const pdf = await store.loadFile(form.files.pdfId);
  return sendBinary(res, pdf, "application/pdf", `${form.acfNo}.pdf`);
}

function acfNotification({ type, title, body, senderUserId, recipients, formId, acf: acfMeta = null }) {
  return {
    id: id("notification"),
    type,
    title,
    body,
    // ACF notifications are recipient-only: senderUserId stays null so the
    // requester never sees the endorser's sign request (and vice versa), and the
    // signer doesn't see every other recipient's completion notice.
    senderUserId: null,
    recipientUserIds: recipients,
    status: "unread",
    relatedEntityType: "asset_check_form",
    relatedEntityId: formId,
    acf: acfMeta,
    requestedPatch: null,
    reviewedByUserId: null,
    reviewedAt: null,
    reviewNote: null,
    createdAt: now(),
    updatedAt: now()
  };
}

// Phone with country code, for tap-to-call in notifications.
function phoneWithCode(user) {
  if (!user) return null;
  const code = user.phoneCountryCode || "";
  const num = user.phone || "";
  if (!num) return null;
  return `${code}${num}`;
}

// Structured metadata attached to ACF notifications so the app can render
// tappable names (call) and the password (copy) without extra lookups.
function acfMetaFor(state, form, includePassword) {
  const reqUser = state.users.find((u) => u.id === form.requester.userId);
  const endUser = state.users.find((u) => u.id === form.endorser.userId);
  return {
    acfNo: form.acfNo,
    requesterName: form.requester.name,
    requesterPhone: phoneWithCode(reqUser),
    endorserName: form.endorser.name,
    endorserPhone: phoneWithCode(endUser),
    password: includePassword ? form.ownerPassword : null
  };
}

// Generate the files and broadcast completion. Used by both the endorser's
// sign action and the auto-complete path (requester is also the endorser).
async function generateAndCompleteForm(form, actor, log) {
  form.status = "completed";
  if (!form.approvalDate) form.approvalDate = now();
  form.updatedAt = now();
  const pdfRaw = await acf.buildPdfBuffer(form);
  const pdf = await acf.encryptPdf(pdfRaw, form.ownerPassword);
  const xlsx = await acf.buildXlsxBuffer(form);
  const pdfId = await store.saveFile(pdf, `${form.acfNo}.pdf`, "application/pdf");
  const xlsxId = await store.saveFile(xlsx, `${form.acfNo}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  form.files = { pdfId, xlsxId };
  await store.acfForms.updateOne({ _id: form._id }, { $set: {
    "endorser.signaturePng": form.endorser.signaturePng,
    "endorser.signedAt": form.endorser.signedAt,
    approvalDate: form.approvalDate,
    status: form.status,
    files: form.files,
    updatedAt: form.updatedAt
  } });

  const superIds = store.data.users.filter((u) => u.role === "superadmin" && !u.isDisabled).map((u) => u.id);
  const recipients = [...new Set([form.requester.userId, form.endorser.userId, ...superIds])];
  store.mutate((s) => {
    // Withdraw/resolve the endorser's outstanding sign request for this form.
    s.notifications.forEach((n) => {
      if (n.relatedEntityId === form._id && n.type === "acf_sign_request") n.status = "read";
    });
    for (const uid of recipients) {
      const u = s.users.find((x) => x.id === uid);
      const isSuper = u?.role === "superadmin";
      s.notifications.unshift(acfNotification({
        type: "acf_completed",
        title: `Asset Check Form completed: ${form.acfNo}`,
        body: `Submitted by ${form.requester.name}, approved by ${form.endorser.name}. Click this notification to download.`,
        senderUserId: actor.id,
        recipients: [uid],
        formId: form._id,
        acf: acfMetaFor(s, form, isSuper)
      }));
    }
    log(s, actor, "acf_complete", "asset_check_form", form._id, `Completed ACF ${form.acfNo}.`);
  });
}

// When a branch's endorser changes, any still-pending forms for that branch are
// auto-denied (the originally addressed endorser is no longer valid).
async function autoDenyFormsForEndorserChange(branchId) {
  const forms = await store.acfForms.find({ branchId, status: "pending_endorsement" }).toArray();
  if (!forms.length) return;
  const reason = "The endorser has changed, please submit again.";
  for (const f of forms) {
    await store.acfForms.updateOne({ _id: f._id }, { $set: { status: "denied", denyReason: reason, updatedAt: now() } });
  }
  store.mutate((s) => {
    for (const f of forms) {
      s.notifications.forEach((n) => {
        if (n.relatedEntityId === f._id && n.type === "acf_sign_request") n.status = "read";
      });
      s.notifications.unshift(acfNotification({
        type: "acf_denied",
        title: `Asset Check Form denied: ${f.acfNo}`,
        body: reason,
        senderUserId: null,
        recipients: [f.requester.userId],
        formId: f._id,
        acf: { acfNo: f.acfNo }
      }));
    }
  });
}

// ACF metadata returned to clients (never leak the owner password or signatures).
function publicAcf(form, actor) {
  return {
    id: form._id,
    acfNo: form.acfNo,
    companyId: form.companyId,
    companyName: form.companyName,
    branchId: form.branchId,
    branchName: form.branchName,
    status: form.status,
    assetCount: (form.rows || []).length,
    rows: form.rows || [],
    requesterName: form.requester?.name,
    endorserName: form.endorser?.name,
    denyReason: form.denyReason || null,
    requestDate: form.requestDate,
    approvalDate: form.approvalDate
  };
}

async function requestListener(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method.toUpperCase();

  if (method === "OPTIONS") {
    return sendJson(res, 204, {});
  }

  try {
    await initializeStore();
    // Reload the latest committed snapshot so every node (on the shared cluster)
    // sees sibling nodes' writes and sessions before handling this request.
    if (typeof store.refresh === "function") {
      await store.refresh();
    }
    const publicResult = await handlePublicRoute(req, res, pathname, method);
    if (publicResult !== false) return;

    if (!pathname.startsWith("/api/")) {
      return error(res, 404, "Not found.", "not_found");
    }

    const auth = authenticate(req);
    if (!auth) return error(res, 401, "Authentication is required.", "unauthorized");
    const authResult = await handleAuthenticatedRoute(req, res, pathname, method, auth, url);
    if (authResult !== false) return;
    return error(res, 404, "Route was not found.", "not_found");
  } catch (err) {
    return error(res, 500, err.message || "Internal server error.", "internal_error");
  }
}

function addMonths(date, months) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

function runDailyStockCheck() {
  const checkTime = new Date();
  const windowEnd = new Date(checkTime);
  windowEnd.setHours(9, 0, 0, 0);
  const windowStart = new Date(windowEnd.getTime() - 24 * 60 * 60 * 1000);

  store.mutate((state) => {
    const oneMonthSkus = [];
    const twoMonthSkus = [];

    for (const sku of state.skus) {
      if (["disposed", "sold"].includes(sku.status)) continue;
      const refDate = sku.lastScannedAt
        ? new Date(sku.lastScannedAt)
        : sku.createdAt ? new Date(sku.createdAt) : null;
      if (!refDate) continue;

      const oneMonth = addMonths(refDate, 1);
      const twoMonths = addMonths(refDate, 2);

      if (oneMonth >= windowStart && oneMonth < windowEnd) oneMonthSkus.push(sku);
      if (twoMonths >= windowStart && twoMonths < windowEnd) twoMonthSkus.push(sku);
    }

    const recipients = state.users
      .filter((u) => !u.isDisabled && ["admin", "superadmin"].includes(u.role))
      .map((u) => u.id);

    if (recipients.length === 0) return null;

    const timestamp = now();

    const makeCheckNotification = (skus, label, relId) => ({
      id: id("notification"),
      type: "unscanned_check",
      title: `Stock Check: ${skus.length} item${skus.length > 1 ? "s" : ""} not scanned for ${label}`,
      body: skus.map((s) => s.skuCode || s.skuNumber).join(", "),
      senderUserId: null,
      recipientUserIds: recipients,
      status: "unread",
      relatedEntityType: "unscanned_check",
      relatedEntityId: relId,
      skuIds: skus.map((s) => s.id),
      requestedPatch: null,
      reviewedByUserId: null,
      reviewedAt: null,
      reviewNote: null,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    if (oneMonthSkus.length > 0) {
      const n = makeCheckNotification(oneMonthSkus, "1+ month", "1month");
      state.notifications.unshift(n);
      emailNotification(state, n);
    }

    if (twoMonthSkus.length > 0) {
      const n = makeCheckNotification(twoMonthSkus, "2+ months", "2months");
      state.notifications.unshift(n);
      emailNotification(state, n);
    }

    createUserLog(state, null, "stock_check", "system", "system",
      `Daily stock check: ${oneMonthSkus.length} at 1-month, ${twoMonthSkus.length} at 2-month threshold.`);

    return null;
  });
}

function scheduleDailyStockCheck() {
  const now = new Date();
  const next9AM = new Date(now);
  next9AM.setHours(9, 0, 0, 0);
  if (next9AM <= now) next9AM.setDate(next9AM.getDate() + 1);
  setTimeout(() => {
    runDailyStockCheck();
    scheduleDailyStockCheck();
  }, next9AM.getTime() - now.getTime());
}

if (require.main === module) {
  (async () => {
    await initializeStore();
    // Serve HTTPS directly when TLS_CERT_PATH + TLS_KEY_PATH are set (a node that
    // is exposed without a TLS-terminating proxy). Otherwise plain HTTP.
    const certPath = process.env.TLS_CERT_PATH;
    const keyPath = process.env.TLS_KEY_PATH;
    if (certPath && keyPath) {
      const fs = require("fs");
      const https = require("https");
      const options = { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
      https.createServer(options, requestListener).listen(PORT, HOST, () => {
        console.log(`Inventory API listening on https://${HOST}:${PORT}/api`);
        scheduleDailyStockCheck();
      });
    } else {
      http.createServer(requestListener).listen(PORT, HOST, () => {
        console.log(`Inventory API listening on http://${HOST}:${PORT}/api`);
        scheduleDailyStockCheck();
      });
    }
  })().catch(err => {
    console.error("Startup failed:", err);
    process.exit(1);
  });
}

module.exports = { requestListener, initializeStore, productionMongoDbName, DEFAULT_MONGODB_DB };
