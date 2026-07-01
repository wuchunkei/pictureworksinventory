import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
const output = path.join(root, "worker-bundle.js");

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return full;
  });
}

const assets = {};
for (const file of walk(dist)) {
  const route = "/" + path.relative(dist, file).split(path.sep).join("/");
  assets[route] = {
    contentType: contentTypes[path.extname(file)] || "application/octet-stream",
    body: fs.readFileSync(file).toString("base64")
  };
}

const worker = `const ASSETS = ${JSON.stringify(assets)};\n` +
`const API_ORIGIN = "https://inventory-cloudflare.wuchunkei.com";\n` +
`const SESSION_COOKIE = "pwi_session";\n` +
`const STATUS_STATE_KEY = "status-state-v1";\n` +
`const MAX_STORED_LOGS = 200;\n` +
`const MAX_STORED_CHECKS = 10000;\n\n` +
`function bytes(base64) {\n` +
`  const binary = atob(base64);\n` +
`  const out = new Uint8Array(binary.length);\n` +
`  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);\n` +
`  return out;\n` +
`}\n\n` +
`function assetResponse(asset) {\n` +
`  return new Response(bytes(asset.body), {\n` +
`    headers: {\n` +
`      "Content-Type": asset.contentType,\n` +
`      "Cache-Control": asset.contentType.includes("text/html") ? "no-cache" : "public, max-age=31536000, immutable"\n` +
`    }\n` +
`  });\n` +
`}\n\n` +
`function parseCloudflareColo(cfRay) {\n` +
`  return String(cfRay || "").match(/-([a-z]{3})(?:\\\\b|$)/i)?.[1]?.toUpperCase() || null;\n` +
`}\n\n` +
`function getCookie(request, name) {\n` +
`  const cookie = request.headers.get("cookie") || "";\n` +
`  return cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(name + "="))?.slice(name.length + 1) || "";\n` +
`}\n\n` +
`function sessionCookie(token, expiresAt) {\n` +
`  const parts = [SESSION_COOKIE + "=" + encodeURIComponent(token), "Path=/", "HttpOnly", "Secure", "SameSite=Lax"];\n` +
`  const expiry = expiresAt ? new Date(expiresAt) : null;\n` +
`  if (expiry && !Number.isNaN(expiry.getTime())) parts.push("Expires=" + expiry.toUTCString());\n` +
`  return parts.join("; ");\n` +
`}\n\n` +
`function clearSessionCookie() {\n` +
`  return SESSION_COOKIE + "=; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT";\n` +
`}\n\n` +
`function authResponsePath(pathname) {\n` +
`  return ["/api/login", "/api/register", "/api/reset-password", "/api/login/biometric"].includes(pathname);\n` +
`}\n\n` +
`function logSignature(log) {\n` +
`  if (log?.title === "Backend recovered") return [log?.level, log?.phase, log?.title].join("|");\n` +
`  return [log?.level, log?.phase, log?.title, log?.summary].join("|");\n` +
`}\n\n` +
`function shouldDedupeLog(log) {\n` +
`  return log?.level === "error" || log?.level === "warning" || log?.title === "Backend recovered";\n` +
`}\n\n` +
`function normalizeLogs(logs) {\n` +
`  const seenIssues = new Set();\n` +
`  return logs.filter((log) => {\n` +
`    if (!log || log.title === "Health check passed") return false;\n` +
`    if (shouldDedupeLog(log)) {\n` +
`      const signature = logSignature(log);\n` +
`      if (seenIssues.has(signature)) return false;\n` +
`      seenIssues.add(signature);\n` +
`    }\n` +
`    return true;\n` +
`  }).slice(0, MAX_STORED_LOGS);\n` +
`}\n\n` +
`function normalizeChecks(checks) {\n` +
`  const bySlot = new Map();\n` +
`  const withoutSlot = [];\n` +
`  for (const check of checks) {\n` +
`    if (!check?.timestamp || !check?.phase) continue;\n` +
`    if (check.slot) bySlot.set(check.slot, check);\n` +
`    else withoutSlot.push(check);\n` +
`  }\n` +
`  return [...bySlot.values(), ...withoutSlot]\n` +
`    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())\n` +
`    .slice(0, MAX_STORED_CHECKS);\n` +
`}\n\n` +
`async function readStatusState(env) {\n` +
`  const empty = { logs: [], checks: [] };\n` +
`  if (!env.STATUS_STATE) return empty;\n` +
`  const state = await env.STATUS_STATE.get(STATUS_STATE_KEY, "json");\n` +
`  if (!state) return empty;\n` +
`  return {\n` +
`    logs: normalizeLogs(Array.isArray(state.logs) ? state.logs : []),\n` +
`    checks: normalizeChecks(Array.isArray(state.checks) ? state.checks : [])\n` +
`  };\n` +
`}\n\n` +
`async function writeStatusState(env, state) {\n` +
`  if (!env.STATUS_STATE) return state;\n` +
`  const normalized = {\n` +
`    logs: normalizeLogs(state.logs || []),\n` +
`    checks: normalizeChecks(state.checks || [])\n` +
`  };\n` +
`  await env.STATUS_STATE.put(STATUS_STATE_KEY, JSON.stringify(normalized));\n` +
`  return normalized;\n` +
`}\n\n` +
`async function proxyApi(request) {\n` +
`  const target = new URL(request.url);\n` +
`  target.protocol = "https:";\n` +
`  target.hostname = new URL(API_ORIGIN).hostname;\n` +
`  target.port = "";\n` +
`  const headersIn = new Headers(request.headers);\n` +
`  const cookieToken = getCookie(request, SESSION_COOKIE);\n` +
`  if (cookieToken && !headersIn.has("authorization")) headersIn.set("Authorization", "Bearer " + decodeURIComponent(cookieToken));\n` +
`  const upstream = await fetch(new Request(target.toString(), { method: request.method, headers: headersIn, body: request.body, redirect: "manual" }));\n` +
`  const headers = new Headers(upstream.headers);\n` +
`  const apiRay = upstream.headers.get("cf-ray");\n` +
`  const apiColo = parseCloudflareColo(apiRay);\n` +
`  if (apiRay) headers.set("X-API-CF-Ray", apiRay);\n` +
`  if (apiColo) headers.set("X-API-CF-Colo", apiColo);\n` +
`  headers.append("Access-Control-Expose-Headers", "CF-Ray, X-API-CF-Ray, X-API-CF-Colo");\n` +
`  headers.delete("set-cookie");\n` +
`  if (target.pathname === "/api/logout") headers.append("Set-Cookie", clearSessionCookie());\n` +
`  const contentType = upstream.headers.get("content-type") || "";\n` +
`  if (authResponsePath(target.pathname) && contentType.includes("application/json")) {\n` +
`    const data = await upstream.json().catch(() => null);\n` +
`    if (data?.token) {\n` +
`      headers.append("Set-Cookie", sessionCookie(data.token, data.expiresAt));\n` +
`      delete data.token;\n` +
`    }\n` +
`    return Response.json(data || {}, { status: upstream.status, statusText: upstream.statusText, headers });\n` +
`  }\n` +
`  return new Response(upstream.body, {\n` +
`    status: upstream.status,\n` +
`    statusText: upstream.statusText,\n` +
`    headers\n` +
`  });\n` +
`}\n\n` +
`export default {\n` +
`  async fetch(request, env) {\n` +
`    const url = new URL(request.url);\n` +
`    if (url.pathname.startsWith("/api/")) return proxyApi(request);\n` +
`    if (url.pathname === "/health") {\n` +
`      return Response.json({\n` +
`        ok: true,\n` +
`        service: "pictureworks_inventory_status",\n` +
`        cloudflareNode: {\n` +
`          colo: request.cf?.colo || null,\n` +
`          ray: request.headers.get("cf-ray") || null\n` +
`        },\n` +
`        time: new Date().toISOString()\n` +
`      });\n` +
`    }\n` +
`    if (url.pathname === "/status-state" && request.method === "GET") {\n` +
`      const state = await readStatusState(env);\n` +
`      return Response.json({ ok: true, ...state, time: new Date().toISOString() });\n` +
`    }\n` +
`    if (url.pathname === "/status-events" && request.method === "POST") {\n` +
`      const body = await request.json().catch(() => ({}));\n` +
`      const state = await readStatusState(env);\n` +
`      if (body.log) state.logs = normalizeLogs([body.log, ...state.logs]);\n` +
`      if (body.check) state.checks = normalizeChecks([body.check, ...state.checks]);\n` +
`      const next = await writeStatusState(env, state);\n` +
`      return Response.json({ ok: true, ...next, time: new Date().toISOString() });\n` +
`    }\n` +
`    const path = url.pathname === "/" ? "/index.html" : url.pathname;\n` +
`    const asset = ASSETS[path] || ASSETS["/index.html"];\n` +
`    return assetResponse(asset);\n` +
`  }\n` +
`};\n`;

fs.writeFileSync(output, worker);
console.log(`Generated ${path.relative(root, output)} with ${Object.keys(assets).length} assets.`);
