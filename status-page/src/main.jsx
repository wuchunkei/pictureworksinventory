import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { motion } from "motion/react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  History
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import "./index.css";

const STATUS_API_BASE =
  import.meta.env.VITE_STATUS_API_BASE || "/api";
const STATUS_NODE_ENDPOINT = import.meta.env.VITE_STATUS_NODE_ENDPOINT || "/health";
const STATUS_STATE_ENDPOINT = import.meta.env.VITE_STATUS_STATE_ENDPOINT || "/status-state";
const STATUS_EVENTS_ENDPOINT = import.meta.env.VITE_STATUS_EVENTS_ENDPOINT || "/status-events";
const LOG_STORAGE_KEY = "pictureworks_inventory_status_logs";
const CHECK_STORAGE_KEY = "pictureworks_inventory_status_checks";
const MAX_STORED_LOGS = 200;
const MAX_STORED_CHECKS = 10000;
const VISIBLE_STATUS_DAYS = 50;
const HEALTH_CHECK_INTERVAL_MINUTES = 10;

function logSignature(log) {
  if (log?.title === "Backend recovered") return [log?.level, log?.phase, log?.title].join("|");
  return [log?.level, log?.phase, log?.title, log?.summary].join("|");
}

function shouldDedupeLog(log) {
  return log?.level === "error" || log?.level === "warning" || log?.title === "Backend recovered";
}

function normalizeLogs(logs) {
  let hasHealthCheckPassed = false;
  const seenIssues = new Set();
  return logs.filter((log) => {
    if (log?.title === "Health check passed") {
      if (hasHealthCheckPassed) return false;
      hasHealthCheckPassed = true;
    }
    if (shouldDedupeLog(log)) {
      const signature = logSignature(log);
      if (seenIssues.has(signature)) return false;
      seenIssues.add(signature);
    }
    return true;
  });
}

function readStoredLogs() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LOG_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? normalizeLogs(parsed.filter((log) => log?.title === "Health check passed")) : [];
  } catch {
    return [];
  }
}

function writeStoredLogs(logs) {
  const localLogs = logs.filter((log) => log?.title === "Health check passed");
  window.localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(normalizeLogs(localLogs).slice(0, MAX_STORED_LOGS)));
}

function readStoredChecks() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CHECK_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, MAX_STORED_CHECKS) : [];
  } catch {
    return [];
  }
}

function writeStoredChecks(checks) {
  window.localStorage.setItem(CHECK_STORAGE_KEY, JSON.stringify(checks.slice(0, MAX_STORED_CHECKS)));
}

function makeLog({ title, summary, level, phase, latency = null }) {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title,
    summary,
    level,
    phase,
    latency,
    timestamp: new Date().toISOString()
  };
}

function makeCheckSample({ phase, latency = null, timestamp = new Date().toISOString(), slot = null }) {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    phase,
    latency,
    timestamp,
    slot
  };
}

function parseCloudflareColo(cfRay) {
  return String(cfRay || "").match(/-([a-z]{3})(?:\b|$)/i)?.[1]?.toUpperCase() || null;
}

function cloudflareNodeFromResponse(response, data) {
  const bodyNode = data?.cloudflareNode || {};
  const ray = bodyNode.ray || data?.cfRay || response.headers.get("x-api-cf-ray") || response.headers.get("cf-ray") || null;
  const colo = bodyNode.colo || data?.colo || response.headers.get("x-api-cf-colo") || parseCloudflareColo(ray);
  return { colo: colo || null, ray: ray || null };
}

function mergeCloudflareNodes(primary, fallback) {
  return {
    colo: primary?.colo || fallback?.colo || null,
    ray: primary?.ray || fallback?.ray || null
  };
}

async function fetchStatusNode(signal) {
  try {
    const response = await fetch(STATUS_NODE_ENDPOINT, {
      cache: "no-store",
      signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) return null;
    return cloudflareNodeFromResponse(response, data);
  } catch {
    return null;
  }
}

async function fetchSharedState(signal) {
  try {
    const response = await fetch(STATUS_STATE_ENDPOINT, {
      cache: "no-store",
      signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) return null;
    return {
      logs: normalizeLogs(Array.isArray(data.logs) ? data.logs : []),
      checks: Array.isArray(data.checks) ? data.checks.slice(0, MAX_STORED_CHECKS) : []
    };
  } catch {
    return null;
  }
}

async function postSharedEvent(event, signal) {
  try {
    const response = await fetch(STATUS_EVENTS_ENDPOINT, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) return null;
    return {
      logs: normalizeLogs(Array.isArray(data.logs) ? data.logs : []),
      checks: Array.isArray(data.checks) ? data.checks.slice(0, MAX_STORED_CHECKS) : []
    };
  } catch {
    return null;
  }
}

function getAlignedSlotKey(date = new Date()) {
  const aligned = new Date(date);
  const minutes = aligned.getMinutes();
  aligned.setMinutes(minutes - (minutes % HEALTH_CHECK_INTERVAL_MINUTES), 0, 0);
  return aligned.toISOString();
}

function msUntilNextAlignedCheck(date = new Date()) {
  const intervalMs = HEALTH_CHECK_INTERVAL_MINUTES * 60 * 1000;
  const elapsedMs =
    (date.getMinutes() % HEALTH_CHECK_INTERVAL_MINUTES) * 60 * 1000 +
    date.getSeconds() * 1000 +
    date.getMilliseconds();
  return elapsedMs === 0 ? intervalMs : intervalMs - elapsedMs;
}

function useBackendHealth() {
  const previousPhase = useRef(null);
  const [localLogs, setLocalLogs] = useState(() => readStoredLogs());
  const [sharedLogs, setSharedLogs] = useState([]);
  const [checks, setChecks] = useState(() => readStoredChecks());
  const [state, setState] = useState({
    phase: "checking",
    latency: null,
    checkedAt: null,
    service: null,
    cloudflareNode: null,
    message: "Checking backend availability...",
    log: {
      title: "Health check initializing",
      summary: "The page is preparing the first backend health probe.",
      level: "info"
    }
  });

  useEffect(() => {
    let cancelled = false;
    let timer;

    function applySharedState(sharedState) {
      if (!sharedState) return;
      setSharedLogs(sharedState.logs || []);
      if (sharedState.checks?.length) {
        setChecks(sharedState.checks);
        writeStoredChecks(sharedState.checks);
      }
    }

    async function syncSharedState(signal) {
      applySharedState(await fetchSharedState(signal));
    }

    function recordLocalLog(entry) {
      setLocalLogs((current) => {
        const withoutDuplicateSuccess = current.filter((log) => log.title !== "Health check passed");
        const next = entry.title === "Health check passed"
          ? [entry, ...withoutDuplicateSuccess].slice(0, MAX_STORED_LOGS)
          : normalizeLogs([entry, ...current]).slice(0, MAX_STORED_LOGS);
        writeStoredLogs(next);
        return next;
      });
    }

    function recordSharedLog(entry) {
      if (entry.title === "Health check passed") return;
      setSharedLogs((current) => normalizeLogs([entry, ...current]).slice(0, MAX_STORED_LOGS));
    }

    async function recordSharedEvent(event, signal) {
      const sharedState = await postSharedEvent(event, signal);
      applySharedState(sharedState);
    }

    async function check({ sharedSample = false } = {}) {
      const startedAt = performance.now();
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 8000);
      const statusNodePromise = fetchStatusNode(controller.signal);

      try {
        const response = await fetch(`${STATUS_API_BASE.replace(/\/$/, "")}/health`, {
          cache: "no-store",
          signal: controller.signal
        });
        const latency = Math.round(performance.now() - startedAt);
        const data = await response.json().catch(() => ({}));
        if (cancelled) return;
        const phase = response.ok && data.ok !== false ? "online" : "degraded";
        const previousPhaseValue = previousPhase.current;
        const apiNode = cloudflareNodeFromResponse(response, data);
        const statusNode = await statusNodePromise;
        const cloudflareNode = mergeCloudflareNodes(statusNode, apiNode);
        const log = phase === "online"
          ? makeLog({
              title: previousPhaseValue && previousPhaseValue !== "online" ? "Backend recovered" : "Health check passed",
              summary: previousPhaseValue && previousPhaseValue !== "online"
                ? `API Service recovered and responded successfully in ${latency}ms.`
                : `API Service responded successfully in ${latency}ms.`,
              level: "success",
              phase,
              latency
            })
          : makeLog({
              title: "Backend health check degraded",
              summary: `The API Service returned HTTP ${response.status}. This may be caused by backend errors, maintenance, or an unhealthy upstream service.`,
              level: "warning",
              phase,
              latency
            });
        setState({
          phase,
          latency,
          checkedAt: new Date(),
          service: data.service || "inventory-borrowing-api",
          cloudflareNode,
          message: response.ok ? "Backend is responding." : `Health check returned ${response.status}.`,
          log
        });
        if (log.title === "Health check passed") {
          recordLocalLog(log);
        } else {
          recordSharedLog(log);
        }
        if (sharedSample || log.title !== "Health check passed") {
          const event = { log: log.title === "Health check passed" ? null : log };
          if (sharedSample) {
            event.check = makeCheckSample({ phase, latency, slot: getAlignedSlotKey() });
          }
          await recordSharedEvent(event, controller.signal);
        }
        previousPhase.current = phase;
      } catch (error) {
        if (cancelled) return;
        const statusNode = await statusNodePromise;
        const isTimeout = error.name === "AbortError";
        const phase = "offline";
        const log = makeLog({
          title: isTimeout ? "Health check timeout" : "Backend unreachable",
          summary: isTimeout
            ? "The API Service did not respond within 8 seconds. Possible causes include network latency, backend overload, or a stalled upstream route."
            : "The browser could not reach the API Service. Possible causes include DNS failure, network interruption, CORS rejection, or the backend node being down.",
          level: "error",
          phase
        });
        setState({
          phase,
          latency: null,
          checkedAt: new Date(),
          service: "inventory-borrowing-api",
          cloudflareNode: statusNode,
          message: isTimeout ? "Health check timed out." : "Backend is unreachable.",
          log
        });
        recordSharedLog(log);
        const event = { log };
        if (sharedSample) event.check = makeCheckSample({ phase, slot: getAlignedSlotKey() });
        await recordSharedEvent(event, controller.signal);
        previousPhase.current = phase;
      } finally {
        window.clearTimeout(timeout);
      }
    }

    function scheduleAlignedChecks() {
      timer = window.setTimeout(async () => {
        await check({ sharedSample: true });
        if (!cancelled) scheduleAlignedChecks();
      }, msUntilNextAlignedCheck());
    }

    const sharedController = new AbortController();
    syncSharedState(sharedController.signal);
    check();
    scheduleAlignedChecks();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      sharedController.abort();
    };
  }, []);

  const logs = useMemo(
    () => normalizeLogs([...localLogs, ...sharedLogs]).slice(0, MAX_STORED_LOGS),
    [localLogs, sharedLogs]
  );

  return { health: state, logs, checks };
}

function App() {
  return <StatusApp />;
}

function StatusApp() {
  const { health, logs, checks } = useBackendHealth();
  const [view, setView] = useState("status");

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [view]);

  return (
    <main className="relative min-h-screen overflow-hidden bg-black text-white">
      <BackgroundCinema />
      <Navigation />

      <section className={`relative z-10 flex min-h-screen justify-center px-5 py-28 sm:px-8 lg:px-12 ${
        view === "logs" ? "items-start" : "items-center"
      }`}>
        <div className="mx-auto flex w-full max-w-3xl justify-center">
          {view === "logs" ? (
            <LogsHistory logs={logs} onBack={() => setView("status")} />
          ) : (
            <StatusConsole health={health} logs={logs} checks={checks} onSeeAll={() => setView("logs")} />
          )}
        </div>
      </section>
    </main>
  );
}

function BackgroundCinema() {
  return (
    <div className="absolute inset-0">
      <video
        className="h-full w-full object-cover opacity-55 saturate-[.82] contrast-125"
        autoPlay
        muted
        loop
        playsInline
        poster=""
      >
        <source src="/status-cinematic.mp4" type="video/mp4" />
        <source src="https://videos.pexels.com/video-files/7565437/7565437-uhd_2560_1440_25fps.mp4" type="video/mp4" />
      </video>
      <div className="absolute inset-0 bg-liquid-radial opacity-70 blur-3xl animate-drift" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_16%,rgba(255,255,255,.18),transparent_18%),linear-gradient(180deg,rgba(0,0,0,.08),#030303_86%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,.035)_1px,transparent_1px),linear-gradient(rgba(255,255,255,.026)_1px,transparent_1px)] bg-[size:72px_72px] opacity-20" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/50 to-transparent" />
    </div>
  );
}

function Navigation() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-30 px-5 py-5 sm:px-8 lg:px-12">
      <div className="mx-auto flex max-w-7xl items-center justify-between rounded-full border border-white/10 bg-black/28 px-4 py-3 shadow-glass backdrop-blur-2xl">
        <a href="https://inventory.wuchunkei.com/" className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full border border-white/14 bg-white/8">
            <img src="/pictureworks-status-icon.svg" alt="" className="size-8" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium leading-none">Pictureworks Inventory</p>
            <p className="mt-1 text-xs text-white/46">Status Page</p>
          </div>
        </a>
        <nav className="hidden shrink-0 items-center gap-2 sm:flex">
          <a
            href="https://inventory.wuchunkei.com/"
            className="inline-flex h-9 items-center justify-center rounded-full border border-white/12 bg-white/[0.04] px-4 text-xs font-semibold text-white/72 transition hover:bg-white/10 hover:text-white"
          >
            Home
          </a>
          <a
            href="https://inventory.wuchunkei.com/login"
            className="inline-flex h-9 items-center justify-center rounded-full bg-white px-4 text-xs font-semibold text-black transition hover:bg-white/90"
          >
            Login
          </a>
        </nav>
        <div className="relative sm:hidden">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-4 text-xs font-semibold text-white/78 transition hover:bg-white/10 hover:text-white"
          >
            Menu
            <ChevronDown className={`size-3.5 transition-transform ${menuOpen ? "rotate-180" : ""}`} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-12 w-40 rounded-[8px] border border-white/10 bg-black/28 p-2 shadow-glass backdrop-blur-2xl">
              <a
                href="https://inventory.wuchunkei.com/"
                className="flex h-10 items-center justify-center rounded-full border border-white/12 bg-white/[0.04] text-xs font-semibold text-white/76 transition hover:bg-white/10 hover:text-white"
              >
                Home
              </a>
              <a
                href="https://inventory.wuchunkei.com/login"
                className="mt-2 flex h-10 items-center justify-center rounded-full bg-white text-xs font-semibold text-black transition hover:bg-white/90"
              >
                Login
              </a>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function StatusConsole({ health, logs, checks, onSeeAll }) {
  const tone = useMemo(() => {
    if (health.phase === "online") return {
      label: "Online",
      dot: "bg-emerald-300 shadow-[0_0_22px_rgba(110,231,183,.95)]",
      text: "text-emerald-100",
      badge: "success"
    };
    if (health.phase === "checking") return {
      label: "Checking",
      dot: "bg-white shadow-[0_0_18px_rgba(255,255,255,.7)]",
      text: "text-white",
      badge: "default"
    };
    if (health.phase === "degraded") return {
      label: "Degraded",
      dot: "bg-amber-200 shadow-[0_0_22px_rgba(253,230,138,.9)]",
      text: "text-amber-100",
      badge: "default"
    };
    return {
      label: "Offline",
      dot: "bg-red-300 shadow-[0_0_22px_rgba(252,165,165,.9)]",
      text: "text-red-100",
      badge: "default"
    };
  }, [health.phase]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 34, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ delay: 0.16, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
      className="glass-edge w-full rounded-[8px]"
    >
      <Card className="relative overflow-hidden rounded-[8px] bg-black/28">
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-white/12 to-transparent" />
        <div className="absolute left-0 top-0 h-full w-px animate-scanline bg-gradient-to-b from-transparent via-white/60 to-transparent opacity-30" />
        <CardHeader className="relative border-b border-white/10">
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-xl">Status</CardTitle>
              <p className="mt-2 text-sm text-white/52">API Service</p>
            </div>
            <Badge variant={tone.badge} className="gap-2">
              <span className={`size-1.5 rounded-full ${tone.dot}`} />
              {tone.label}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="relative space-y-5 p-5">
          <div className="liquid-sheen rounded-[8px] border border-white/10 p-5 backdrop-blur-xl">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm text-white/48">Backend availability</p>
                <p className={`mt-2 text-4xl font-medium ${tone.text}`}>{tone.label}</p>
                <p className="mt-3 max-w-md text-sm leading-6 text-white/56">{health.message}</p>
              </div>
              <div className="grid grid-cols-3 gap-3 text-right">
                <div title={health.cloudflareNode?.ray ? `Cloudflare Ray: ${health.cloudflareNode.ray}` : "Node unavailable"}>
                  <p className="text-2xl font-medium">{health.cloudflareNode?.colo || "..."}</p>
                  <p className="mt-1 text-xs text-white/42">Node</p>
                </div>
                <div>
                  <p className="text-2xl font-medium">{health.latency == null ? "..." : `${health.latency}ms`}</p>
                  <p className="mt-1 text-xs text-white/42">round trip</p>
                </div>
                <div>
                  <p className="text-2xl font-medium">
                    {health.checkedAt ? health.checkedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "..."}
                  </p>
                  <p className="mt-1 text-xs text-white/42">last check</p>
                </div>
              </div>
            </div>
          </div>
          <StatusModuleRows health={health} checks={checks} />
          <LogsPreview health={health} logs={logs} onSeeAll={onSeeAll} />
        </CardContent>
      </Card>
    </motion.div>
  );
}

function getUptimeLabel(checks) {
  if (!checks.length) return "Collecting uptime";
  const onlineCount = checks.filter((check) => check.phase === "online").length;
  const uptime = (onlineCount / checks.length) * 100;
  return `${uptime.toFixed(2)}% uptime`;
}

function getLocalDayKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDayLabel(dayKey) {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString([], {
    month: "short",
    day: "numeric"
  });
}

function getDailyBars(checks) {
  const checksByDay = checks.reduce((groups, check) => {
    if (!check.timestamp) return groups;
    const date = new Date(check.timestamp);
    if (Number.isNaN(date.getTime())) return groups;
    const dayKey = getLocalDayKey(date);
    return {
      ...groups,
      [dayKey]: [...(groups[dayKey] || []), check]
    };
  }, {});

  const today = new Date();
  return Array.from({ length: VISIBLE_STATUS_DAYS }, (_, index) => {
    const date = new Date(today);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (VISIBLE_STATUS_DAYS - 1 - index));
    const dayKey = getLocalDayKey(date);
    const samples = checksByDay[dayKey] || [];
    const onlineCount = samples.filter((sample) => sample.phase === "online").length;
    const degradedCount = samples.filter((sample) => sample.phase === "degraded").length;
    const offlineCount = samples.filter((sample) => sample.phase === "offline").length;
    const uptime = samples.length ? (onlineCount / samples.length) * 100 : null;
    const phase = samples.length === 0
      ? "empty"
      : offlineCount > 0
        ? "offline"
        : degradedCount > 0
          ? "degraded"
          : "online";

    return {
      id: dayKey,
      phase,
      dayKey,
      label: getDayLabel(dayKey),
      samples: samples.length,
      uptime
    };
  });
}

function StatusModuleRows({ health, checks }) {
  const uptime = getUptimeLabel(checks);
  const bars = getDailyBars(checks);
  const modules = [
    {
      title: "Backend Node",
      uptime: health.phase === "offline" ? "Incident active" : uptime
    },
    {
      title: "API Service",
      uptime: health.phase === "offline" ? "Check failed" : uptime
    }
  ];

  return (
    <div className="space-y-3">
      {modules.map((module, index) => (
        <StatusModuleRow key={module.title} module={module} health={health} bars={bars} index={index} />
      ))}
    </div>
  );
}

function StatusModuleRow({ module, health, bars, index }) {
  const isOffline = health.phase === "offline";
  const isDegraded = health.phase === "degraded";

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.28 + index * 0.08, duration: 0.55 }}
      className="liquid-sheen rounded-[8px] border border-white/10 p-4 backdrop-blur-xl"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`grid size-7 shrink-0 place-items-center rounded-full shadow-[0_0_18px_rgba(255,255,255,.16)] ${
            isOffline ? "bg-red-300 text-black" : isDegraded ? "bg-amber-200 text-black" : "bg-emerald-300 text-black"
          }`}>
            <Check className="size-4" strokeWidth={3} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-white">{module.title}</p>
          </div>
        </div>
        <p className="shrink-0 text-sm font-medium text-white/54 sm:text-right">{module.uptime}</p>
      </div>
      <div className="mt-4 grid grid-cols-[repeat(50,minmax(0,1fr))] gap-[2px] sm:gap-1">
        {bars.map((bar, barIndex) => (
          <span
            key={`${module.title}-${bar.id || barIndex}`}
            title={bar.samples
              ? `${bar.label}: ${bar.uptime.toFixed(2)}% uptime, ${bar.samples} checks`
              : `${bar.label}: No check recorded`}
            className={`h-5 rounded-[2px] ${
              bar.phase === "offline"
                ? "bg-red-300"
                : bar.phase === "degraded"
                  ? "bg-amber-300"
                  : bar.phase === "online"
                    ? "bg-emerald-400"
                    : "bg-white/10"
            }`}
          />
        ))}
      </div>
    </motion.div>
  );
}

function logTone(log) {
  return log.level === "error"
    ? "border-red-300/20 bg-red-300/10 text-red-100"
    : log.level === "warning"
      ? "border-amber-200/20 bg-amber-200/10 text-amber-100"
      : log.level === "success"
        ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100"
        : "border-white/10 bg-white/[0.045] text-white/70";
}

function formatLogTime(value) {
  if (!value) return "Waiting";
  return new Date(value).toLocaleString([], {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function LogsPreview({ health, logs, onSeeAll }) {
  const fallbackLog = health.log || {
    title: "Health check initializing",
    summary: "The page is preparing the first backend health probe.",
    level: "info",
    timestamp: null
  };
  const visibleLogs = (logs.length ? logs : [fallbackLog]).slice(0, 3);

  return (
    <div className="border-t border-white/10 pt-5">
      <div className="mb-3 flex items-center justify-between gap-4">
        <p className="text-sm font-medium text-white/82">Logs</p>
        {logs.length > 3 && (
          <button
            type="button"
            onClick={onSeeAll}
            className="rounded-full border border-white/12 bg-white/[0.04] px-3 py-1 text-xs font-medium text-white/68 transition hover:bg-white/10 hover:text-white"
          >
            See all
          </button>
        )}
      </div>
      <div className="space-y-3">
        {visibleLogs.map((log) => (
          <LogBlock key={log.id || log.title} log={log} />
        ))}
      </div>
    </div>
  );
}

function LogBlock({ log }) {
  const tone =
    logTone(log);

  return (
    <div className={`rounded-[8px] border p-4 ${tone}`}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-medium text-white">{log.title}</p>
          <p className="mt-2 text-sm leading-6 text-white/58">{log.summary}</p>
        </div>
        <p className="shrink-0 text-xs text-white/42">{formatLogTime(log.timestamp)}</p>
      </div>
    </div>
  );
}

function LogsHistory({ logs, onBack }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 34, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
      className="glass-edge w-full rounded-[8px]"
    >
      <Card className="relative max-h-[calc(100vh-9rem)] overflow-hidden rounded-[8px] bg-black/28">
        <CardHeader className="relative border-b border-white/10">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-xl">
                <History className="size-4" />
                Logs history
              </CardTitle>
              <p className="mt-2 text-sm text-white/52">All recorded backend node health events on this browser.</p>
            </div>
            <button
              type="button"
              onClick={onBack}
              className="inline-flex w-fit items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-3 py-2 text-xs font-medium text-white/70 transition hover:bg-white/10 hover:text-white"
            >
              <ArrowLeft className="size-3.5" />
              Back
            </button>
          </div>
        </CardHeader>
        <CardContent className="max-h-[calc(100vh-16rem)] space-y-3 overflow-y-auto p-5">
          {logs.length === 0 ? (
            <div className="rounded-[8px] border border-white/10 bg-white/[0.045] p-4 text-sm text-white/58">
              No health logs have been recorded yet.
            </div>
          ) : (
            logs.map((log) => <LogBlock key={log.id} log={log} />)
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
