const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "data");
const STATE_PATH = process.env.STATE_FILE || path.join(DATA_DIR, "state.json");
const SKU_PATTERN = /^[A-Z0-9]+-[A-Z0-9]+-\d{4}$/;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const PASSWORD_EXPIRY_MS = 90 * DAY;
const PASSWORD_EXPIRY_ROLES = ["staff", "admin"];

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, passwordHash) {
  if (!password || !passwordHash) return false;
  const [scheme, salt, stored] = passwordHash.split(":");
  if (scheme !== "scrypt" || !salt || !stored) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(stored, "hex");
  return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate);
}

function publicUser(user) {
  if (!user) return null;
  const { passwordHash, sessions, ...safe } = user;
  return safe;
}

function sessionPolicy(role) {
  if (role === "staff") return { maxDevices: 1, ttlMs: 16 * HOUR, biometricTtlMs: 5 * DAY };
  if (role === "warehouse_manager") return { maxDevices: 2, ttlMs: 7 * DAY, biometricTtlMs: 14 * DAY };
  if (role === "admin") return { maxDevices: Infinity, ttlMs: 14 * DAY, biometricTtlMs: 30 * DAY };
  return { maxDevices: Infinity, ttlMs: 30 * DAY, biometricTtlMs: 90 * DAY };
}

function isPasswordExpired(user) {
  if (!PASSWORD_EXPIRY_ROLES.includes(user.role)) return false;
  if (!user.passwordChangedAt) return false;
  return Date.now() - new Date(user.passwordChangedAt).getTime() > PASSWORD_EXPIRY_MS;
}

function defaultServerNodes() {
  return [
    { label: "Cloudflare(Overseas)", url: "https://inventory-staging.wuchunkei.xyz/api" },
    { label: "Ngrok", url: "https://arguable-olive-anew.ngrok-free.dev/api" },
    { label: "Tailscale", url: "https://hkx86-production.longhair-mizar.ts.net/api" },
    { label: "CMLink", url: "https://inventory-cmlink.wuchunkei.com/api" },
    { label: "CTExcel", url: "https://inventory-ctexcel.wuchunkei.com/api" }
  ];
}

function createSeedState() {
  // Empty initial state — no demo accounts, companies or SKUs. A fresh database
  // starts blank; all real data lives only in MongoDB. (Function kept because
  // the JSON fallback and the Mongo first-run seed reference it.)
  return {
    schemaVersion: 1,
    users: [],
    warehouses: [],
    skus: [],
    records: [],
    notifications: [],
    userLogs: [],
    notificationSettings: {
      smtp: {
        enabled: false,
        health: "unable",
        lastTestAt: null
      },
      templates: {}
    },
    wecomDirectory: {
      latestImportAt: null,
      members: []
    },
    // Backend-uptime ping alerts: who gets emailed when a node goes down/recovers.
    pingAlerts: {
      recipientUserIds: [],
      intervalMinutes: 5
    },
    serverNodes: defaultServerNodes()
  };
}

class StateStore {
  constructor(statePath = STATE_PATH) {
    this.statePath = statePath;
    this.state = null;
  }

  load() {
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    if (!fs.existsSync(this.statePath)) {
      this.state = createSeedState();
      this.save();
      return this.state;
    }

    const raw = fs.readFileSync(this.statePath, "utf8");
    this.state = JSON.parse(raw);
    this.state.users ||= [];
    this.state.warehouses ||= [];
    this.state.skus ||= [];
    this.state.records ||= [];
    this.state.notifications ||= [];
    this.state.userLogs ||= [];
    this.state.notificationSettings ||= {};
    this.state.wecomDirectory ||= { latestImportAt: null, members: [] };
    this.state.pingAlerts ||= { recipientUserIds: [], intervalMinutes: 5 };
    this.state.serverNodes ||= defaultServerNodes();
    return this.state;
  }

  async getServerNodes() {
    const nodes = this.data.serverNodes;
    return (nodes && nodes.length) ? nodes : defaultServerNodes();
  }

  save() {
    if (!this.state) return;
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    const tmp = `${this.statePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmp, this.statePath);
  }

  get data() {
    return this.state || this.load();
  }

  mutate(mutator) {
    const result = mutator(this.data);
    this.save();
    return result;
  }
}

// Each top-level entity lives in its own collection (one document per entity),
// instead of being crammed into a single `app_state` document. This removes the
// 16 MB single-document ceiling, lets append-heavy logs grow under a TTL, and
// lets multiple backend nodes on a shared cluster read/write the same data
// without clobbering each other (each request reloads the latest snapshot).
//
//  • BOUNDED   — small, can be deleted: fully loaded into memory; persisted by
//    upserting only changed docs and deleting ids that disappeared.
//  • APPEND    — log-like, only grows: only the most-recent slice is kept in
//    memory; persisted by upserting present docs (never bulk-deleted).
const BOUNDED_KEYS = ["users", "warehouses", "skus"];
const APPEND_KEYS = ["records", "notifications", "userLogs"];
// state key -> MongoDB collection name
const COLLECTION_NAME = {
  users: "users",
  warehouses: "warehouses",
  skus: "skus",
  records: "records",
  notifications: "notifications",
  userLogs: "user_logs"
};
const SETTINGS_KEYS = ["notificationSettings", "wecomDirectory", "pingAlerts"];
// How many recent append-only docs to hold in memory for API responses.
const APPEND_CAP = { records: 2000, notifications: 1000, userLogs: 3000 };
// Auto-expire audit logs after this many days (the dominant growth driver).
const USER_LOG_TTL_DAYS = Number(process.env.USER_LOG_TTL_DAYS || 540);

function stripId(doc) {
  if (!doc) return doc;
  const { _id, _ts, ...rest } = doc;
  return rest;
}

class MongoStateStore {
  constructor(mongoUri, dbName) {
    this.mongoUri = mongoUri;
    this.dbName = dbName;
    this.state = null;
    this.db = null;
    this._loaded = {};       // collectionKey -> Map(id -> JSON snapshot at load)
    this._lastWrite = Promise.resolve();
  }

  _col(key) {
    return this.db.collection(COLLECTION_NAME[key]);
  }

  async connect() {
    const { MongoClient } = require("mongodb");
    const client = new MongoClient(this.mongoUri, { serverSelectionTimeoutMS: 8000 });
    await client.connect();
    this.db = client.db(this.dbName);

    await this._migrateFromLegacyDoc();
    await this._ensureIndexes();
    await this._ensureSeed();
    await this.refresh();

    console.log("[MongoDB] connected to", this.dbName,
      "(multi-collection) — users:", this.state.users.length,
      "skus:", this.state.skus.length,
      "logs(recent):", this.state.userLogs.length);
    return this.state;
  }

  // One-time: explode the legacy single `app_state` document into per-entity
  // collections. The monolith doc (id:"main") is AUTHORITATIVE — each target
  // collection is fully replaced from it, so any stale leftover documents from
  // an older schema are overwritten rather than shadowing the real data. Runs
  // only while id:"main" still exists; afterwards it is renamed, so re-runs are
  // a no-op (idempotent).
  async _migrateFromLegacyDoc() {
    // Once migrated, never migrate again — even if an old-code sibling node
    // resurrects an `app_state` {id:"main"} document (e.g. via its daily job).
    // This protects the per-entity collections from being clobbered by stale data.
    const marker = await this.db.collection("settings").findOne({ _id: "_migratedAt" });
    if (marker) return;
    const legacy = await this.db.collection("app_state").findOne({ id: "main" });
    if (!legacy || !legacy.data) return;
    const data = legacy.data;

    for (const key of [...BOUNDED_KEYS, ...APPEND_KEYS]) {
      const arr = (Array.isArray(data[key]) ? data[key] : []).filter((e) => e && e.id);
      await this._col(key).deleteMany({}); // clear stale rows; monolith is authoritative
      if (arr.length) {
        await this._col(key).bulkWrite(
          arr.map((e) => ({ replaceOne: { filter: { _id: e.id }, replacement: this._toDoc(key, e), upsert: true } })),
          { ordered: false }
        );
      }
    }
    const settings = SETTINGS_KEYS
      .filter((key) => data[key] !== undefined)
      .map((key) => ({ _id: key, value: data[key] }));
    settings.push({ _id: "schemaVersion", value: data.schemaVersion || 1 });
    await this.db.collection("settings").bulkWrite(
      settings.map((s) => ({ replaceOne: { filter: { _id: s._id }, replacement: s, upsert: true } })),
      { ordered: false }
    );
    // Permanent marker so migration never runs again on this database.
    await this.db.collection("settings").updateOne(
      { _id: "_migratedAt" }, { $set: { value: now() } }, { upsert: true }
    );
    // Keep the legacy doc as a one-time backup, but rename so it is never used again.
    await this.db.collection("app_state").updateOne(
      { id: "main" }, { $set: { id: "main_legacy_backup", migratedAt: now() } }
    ).catch(() => {});
    console.log("[MongoDB] migrated legacy app_state into per-entity collections (authoritative overwrite)");
  }

  async _ensureIndexes() {
    // TTL on audit logs (uses a dedicated BSON Date field `_ts`).
    await this._col("userLogs").createIndex(
      { _ts: 1 }, { expireAfterSeconds: USER_LOG_TTL_DAYS * 24 * 60 * 60 }
    ).catch((e) => console.warn("[MongoDB] log TTL index:", e.message));
    for (const key of APPEND_KEYS) {
      await this._col(key).createIndex({ createdAt: -1 }).catch(() => {});
    }
    // Drop the obsolete server_nodes collection (nodes are bundled in the app).
    if ((await this.db.listCollections({ name: "server_nodes" }).toArray()).length) {
      await this.db.collection("server_nodes").drop().catch(() => {});
    }
  }

  // Seed a fresh database the first time (no users yet anywhere).
  async _ensureSeed() {
    const usersCount = await this._col("users").countDocuments();
    if (usersCount > 0) return;
    const seed = createSeedState();
    this.state = seed;
    this._captureLoaded(seed);
    await this._persistFull(seed);
    console.log("[MongoDB] seeded fresh multi-collection state into", this.dbName);
  }

  _toDoc(key, entity) {
    const doc = { _id: entity.id, ...entity };
    if (key === "userLogs") {
      const t = entity.createdAt ? new Date(entity.createdAt) : new Date();
      doc._ts = isNaN(t.getTime()) ? new Date() : t;
    }
    return doc;
  }

  // Reload the in-memory snapshot from the database. Called on connect and at the
  // start of every request so each node sees the latest committed data (and
  // sessions issued by sibling nodes on the same shared cluster).
  async refresh() {
    await this._lastWrite; // don't read mid-write
    const state = {};
    // Run all collection reads in parallel so refresh costs ~one round-trip,
    // which matters when the shared cluster is a cross-region hop away.
    const [boundedResults, appendResults, settingsDocs] = await Promise.all([
      Promise.all(BOUNDED_KEYS.map((key) => this._col(key).find({}).toArray())),
      Promise.all(APPEND_KEYS.map((key) =>
        this._col(key).find({}).sort({ createdAt: -1 }).limit(APPEND_CAP[key]).toArray()
      )),
      this.db.collection("settings").find({}).toArray()
    ]);
    BOUNDED_KEYS.forEach((key, i) => { state[key] = boundedResults[i].map(stripId); });
    // newest-first, matching the app's unshift order
    APPEND_KEYS.forEach((key, i) => { state[key] = appendResults[i].map(stripId); });
    const settings = Object.fromEntries(settingsDocs.map((d) => [d._id, d.value]));
    state.notificationSettings = settings.notificationSettings || {};
    state.wecomDirectory = settings.wecomDirectory || { latestImportAt: null, members: [] };
    state.pingAlerts = settings.pingAlerts || { recipientUserIds: [], intervalMinutes: 5 };
    state.schemaVersion = settings.schemaVersion || 1;

    this.state = state;
    this._captureLoaded(state);
    return state;
  }

  _captureLoaded(state) {
    this._loaded = {};
    for (const key of [...BOUNDED_KEYS, ...APPEND_KEYS]) {
      const map = new Map();
      for (const e of state[key] || []) {
        if (e && e.id) map.set(e.id, JSON.stringify(e));
      }
      this._loaded[key] = map;
    }
  }

  async getServerNodes() {
    return defaultServerNodes();
  }

  // --- Asset Check Forms (kept OUT of the per-request snapshot: they carry
  // signature blobs + frozen row snapshots and are accessed on demand only) ---
  get acfForms() {
    return this.db.collection("asset_check_forms");
  }

  _bucket() {
    const { GridFSBucket } = require("mongodb");
    return new GridFSBucket(this.db, { bucketName: "acf_files" });
  }

  // Store a generated file buffer in GridFS; returns its ObjectId as a string.
  saveFile(buffer, filename, contentType) {
    return new Promise((resolve, reject) => {
      const bucket = this._bucket();
      const up = bucket.openUploadStream(filename, { contentType });
      up.on("error", reject);
      up.on("finish", () => resolve(String(up.id)));
      up.end(buffer);
    });
  }

  async loadFile(fileId) {
    const { ObjectId } = require("mongodb");
    const bucket = this._bucket();
    const chunks = [];
    return new Promise((resolve, reject) => {
      bucket.openDownloadStream(new ObjectId(fileId))
        .on("data", (c) => chunks.push(c))
        .on("error", reject)
        .on("end", () => resolve(Buffer.concat(chunks)));
    });
  }

  get data() {
    return this.state;
  }

  // Apply a mutation in memory (sync, so callers are unchanged), then persist the
  // delta. Persistence is queued on `_lastWrite` so a concurrent refresh() waits.
  mutate(mutator) {
    const result = mutator(this.state);
    this._lastWrite = this._lastWrite
      .then(() => this._persistDelta(this.state))
      .catch((err) => console.error("[MongoDB] save error:", err));
    return result;
  }

  // Upsert only changed/new docs; for bounded collections also delete ids that
  // vanished from the snapshot. Append collections are never bulk-deleted.
  async _persistDelta(state) {
    for (const key of [...BOUNDED_KEYS, ...APPEND_KEYS]) {
      const loaded = this._loaded[key] || new Map();
      const present = new Map();
      const ops = [];
      for (const e of state[key] || []) {
        if (!e || !e.id) continue;
        const json = JSON.stringify(e);
        present.set(e.id, json);
        if (loaded.get(e.id) !== json) {
          ops.push({ replaceOne: { filter: { _id: e.id }, replacement: this._toDoc(key, e), upsert: true } });
        }
      }
      if (BOUNDED_KEYS.includes(key)) {
        const removed = [...loaded.keys()].filter((idv) => !present.has(idv));
        if (removed.length) ops.push({ deleteMany: { filter: { _id: { $in: removed } } } });
      }
      if (ops.length) await this._col(key).bulkWrite(ops, { ordered: false });
      this._loaded[key] = present;
    }
    // Singleton settings.
    const settingsOps = [];
    for (const key of SETTINGS_KEYS) {
      if (state[key] !== undefined) {
        settingsOps.push({ replaceOne: { filter: { _id: key }, replacement: { _id: key, value: state[key] }, upsert: true } });
      }
    }
    if (settingsOps.length) await this.db.collection("settings").bulkWrite(settingsOps, { ordered: false });
  }

  // Full write used only for first-time seeding.
  async _persistFull(state) {
    for (const key of [...BOUNDED_KEYS, ...APPEND_KEYS]) {
      const arr = (state[key] || []).filter((e) => e && e.id);
      if (arr.length) {
        await this._col(key).bulkWrite(
          arr.map((e) => ({ replaceOne: { filter: { _id: e.id }, replacement: this._toDoc(key, e), upsert: true } })),
          { ordered: false }
        );
      }
    }
    const settingsOps = SETTINGS_KEYS
      .filter((k) => state[k] !== undefined)
      .map((k) => ({ replaceOne: { filter: { _id: k }, replacement: { _id: k, value: state[k] }, upsert: true } }));
    settingsOps.push({ replaceOne: { filter: { _id: "schemaVersion" }, replacement: { _id: "schemaVersion", value: state.schemaVersion || 1 }, upsert: true } });
    await this.db.collection("settings").bulkWrite(settingsOps, { ordered: false });
  }
}

module.exports = {
  SKU_PATTERN,
  StateStore,
  MongoStateStore,
  createSeedState,
  hashPassword,
  id,
  isPasswordExpired,
  now,
  publicUser,
  sessionPolicy,
  verifyPassword
};
