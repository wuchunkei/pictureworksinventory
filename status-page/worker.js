const API_ORIGIN = "https://inventory-cloudflare.wuchunkei.com";
const STATUS_STATE_KEY = "status-state-v1";
const MAX_STORED_LOGS = 200;
const MAX_STORED_CHECKS = 10000;

function parseCloudflareColo(cfRay) {
  return String(cfRay || "").match(/-([a-z]{3})(?:\b|$)/i)?.[1]?.toUpperCase() || null;
}

function logSignature(log) {
  if (log?.title === "Backend recovered") return [log?.level, log?.phase, log?.title].join("|");
  return [log?.level, log?.phase, log?.title, log?.summary].join("|");
}

function shouldDedupeLog(log) {
  return log?.level === "error" || log?.level === "warning" || log?.title === "Backend recovered";
}

function normalizeLogs(logs) {
  const seenIssues = new Set();
  return logs.filter((log) => {
    if (!log || log.title === "Health check passed") return false;
    if (shouldDedupeLog(log)) {
      const signature = logSignature(log);
      if (seenIssues.has(signature)) return false;
      seenIssues.add(signature);
    }
    return true;
  }).slice(0, MAX_STORED_LOGS);
}

function normalizeChecks(checks) {
  const bySlot = new Map();
  const withoutSlot = [];
  for (const check of checks) {
    if (!check?.timestamp || !check?.phase) continue;
    if (check.slot) bySlot.set(check.slot, check);
    else withoutSlot.push(check);
  }
  return [...bySlot.values(), ...withoutSlot]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, MAX_STORED_CHECKS);
}

async function readStatusState(env) {
  const empty = { logs: [], checks: [] };
  if (!env.STATUS_STATE) return empty;
  const state = await env.STATUS_STATE.get(STATUS_STATE_KEY, "json");
  if (!state) return empty;
  return {
    logs: normalizeLogs(Array.isArray(state.logs) ? state.logs : []),
    checks: normalizeChecks(Array.isArray(state.checks) ? state.checks : [])
  };
}

async function writeStatusState(env, state) {
  if (!env.STATUS_STATE) return state;
  const normalized = {
    logs: normalizeLogs(state.logs || []),
    checks: normalizeChecks(state.checks || [])
  };
  await env.STATUS_STATE.put(STATUS_STATE_KEY, JSON.stringify(normalized));
  return normalized;
}

async function proxyApi(request) {
  const target = new URL(request.url);
  target.protocol = "https:";
  target.hostname = new URL(API_ORIGIN).hostname;
  target.port = "";
  const upstream = await fetch(new Request(target.toString(), request));
  const headers = new Headers(upstream.headers);
  const apiRay = upstream.headers.get("cf-ray");
  const apiColo = parseCloudflareColo(apiRay);
  if (apiRay) headers.set("X-API-CF-Ray", apiRay);
  if (apiColo) headers.set("X-API-CF-Colo", apiColo);
  headers.append("Access-Control-Expose-Headers", "CF-Ray, X-API-CF-Ray, X-API-CF-Colo");
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) return proxyApi(request);

    if (url.pathname === "/health") {
      return Response.json({
        ok: true,
        service: "pictureworks-inventory-status",
        cloudflareNode: {
          colo: request.cf?.colo || null,
          ray: request.headers.get("cf-ray") || null
        },
        time: new Date().toISOString()
      });
    }

    if (url.pathname === "/status-state" && request.method === "GET") {
      const state = await readStatusState(env);
      return Response.json({ ok: true, ...state, time: new Date().toISOString() });
    }

    if (url.pathname === "/status-events" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const state = await readStatusState(env);
      if (body.log) state.logs = normalizeLogs([body.log, ...state.logs]);
      if (body.check) state.checks = normalizeChecks([body.check, ...state.checks]);
      const next = await writeStatusState(env, state);
      return Response.json({ ok: true, ...next, time: new Date().toISOString() });
    }

    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404) return response;

    url.pathname = "/";
    return env.ASSETS.fetch(new Request(url, request));
  }
};
