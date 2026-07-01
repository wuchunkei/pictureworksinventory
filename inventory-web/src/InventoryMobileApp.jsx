import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import jsQR from "jsqr";
import {
  AlertTriangle,
  ArrowLeftRight,
  Bell,
  Bluetooth,
  Boxes,
  Building2,
  Camera,
  Check,
  ChevronLeft,
  ClipboardList,
  Clock3,
  FileClock,
  Home,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  Package,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Tags,
  Trash2,
  UserRound,
  Users,
  Wifi,
  Wrench,
  X
} from "lucide-react";

const TABS = [
  { id: "home", label: "Home", icon: Home },
  { id: "search", label: "Search", icon: Search },
  { id: "notify", label: "Notify", icon: Bell },
  { id: "status", label: "Status", icon: Package },
  { id: "me", label: "Me", icon: UserRound }
];

const ROLE_LABELS = {
  staff: "Staff",
  warehouse_manager: "Manager",
  admin: "Admin",
  superadmin: "Superadmin"
};

const STATUS_TONE = {
  available: "border-emerald-200/20 bg-emerald-300/10 text-emerald-100",
  borrowed: "border-sky-200/20 bg-sky-300/10 text-sky-100",
  repairing: "border-amber-200/20 bg-amber-300/10 text-amber-100",
  disposed: "border-white/10 bg-white/[0.04] text-white/52",
  sold: "border-white/10 bg-white/[0.04] text-white/52"
};

function getBackendUserObjectId(user) {
  return user?.objectId || user?._id || user?.id || "";
}

function routeFor(objectId, view = "home", rest = []) {
  return `/u/${encodeURIComponent(objectId)}/${[view, ...rest].filter(Boolean).map((part) => encodeURIComponent(part)).join("/")}`;
}

function parseAppRoute(pathname, objectId) {
  const parts = pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
  const appParts = parts[0] === "u" && parts[1] === objectId ? parts.slice(2) : parts[0] === objectId ? parts.slice(1) : parts;
  const tab = ["home", "search", "notify", "status", "me"].includes(appParts[0]) ? appParts[0] : "home";
  const source = tab === "search" && ["qrc", "sku"].includes(appParts[1]) ? appParts[1] : null;
  const skuCode = source ? appParts[2] || "" : "";
  const detail = Boolean(source && skuCode && appParts[3] === "detail");
  return { tab, source, skuCode, detail };
}

function InventoryMobileApp({ session, apiBaseUrl, onLogout, onSessionUpdate }) {
  const userObjectId = getBackendUserObjectId(session.currentUser);
  const initialRoute = parseAppRoute(window.location.pathname, userObjectId);
  const [activeTab, setActiveTabState] = useState(initialRoute.tab);
  const [routeState, setRouteState] = useState(initialRoute);
  const [screen, setScreenState] = useState(() => initialRoute.detail ? {
    id: "sku",
    title: initialRoute.skuCode,
      params: {
      skuCode: initialRoute.skuCode,
      backPath: routeFor(userObjectId, "search", [initialRoute.source, initialRoute.skuCode])
    }
  } : null);
  const [data, setData] = useState(() => normalizeBootstrap(session?.bootstrap, session?.currentUser));
  const [loading, setLoading] = useState(!session?.bootstrap);
  const [notice, setNotice] = useState("");
  const [connection, setConnection] = useState("connecting");

  async function api(path, options = {}) {
    const response = await fetch(`${apiBaseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`, {
      method: options.method || "GET",
      cache: "no-store",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json"
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || body.error || `Request failed (${response.status}).`);
    return body;
  }

  async function refresh({ quiet = false } = {}) {
    if (!quiet) setLoading(true);
    try {
      const fresh = await api("bootstrap");
      const next = normalizeBootstrap(fresh, fresh.currentUser);
      setData(next);
      setConnection("connected");
      onSessionUpdate?.({ ...session, currentUser: fresh.currentUser, bootstrap: fresh });
      return next;
    } catch (error) {
      setConnection("lost");
      if (!quiet) setNotice(error.message || "Cannot refresh inventory.");
      if (/login|token|session|unauthorized/i.test(error.message || "")) onLogout?.();
      return null;
    } finally {
      if (!quiet) setLoading(false);
    }
  }

  async function runAction(label, action, options = {}) {
    setNotice("");
    try {
      const result = await action();
      await refresh({ quiet: true });
      if (options.close) setScreen(null);
      setNotice(options.message || `${label} completed.`);
      return result;
    } catch (error) {
      setNotice(error.message || `${label} failed.`);
      return null;
    }
  }

  function applyRoute(pathname) {
    const next = parseAppRoute(pathname, userObjectId);
    setRouteState(next);
    setActiveTabState(next.tab);
    if (next.detail && next.skuCode) {
      setScreenState({
        id: "sku",
        title: next.skuCode,
        params: {
          skuCode: next.skuCode,
          backPath: routeFor(userObjectId, "search", [next.source, next.skuCode])
        }
      });
    } else {
      setScreenState(null);
    }
  }

  function navigateTo(path, { replace = false } = {}) {
    if (window.location.pathname !== path) {
      window.history[replace ? "replaceState" : "pushState"]({}, "", path);
    }
    applyRoute(path);
  }

  function navigateTab(tab) {
    navigateTo(routeFor(userObjectId, tab));
  }

  function openScreen(nextScreen) {
    setScreenState(nextScreen);
  }

  function closeScreen() {
    if (screen?.params?.backPath) {
      navigateTo(screen.params.backPath);
    } else {
      setScreenState(null);
    }
  }

  useEffect(() => {
    refresh({ quiet: Boolean(session?.bootstrap) });
    const timer = window.setInterval(() => refresh({ quiet: true }), 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const onPopState = () => applyRoute(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [userObjectId]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [activeTab, screen?.id]);

  const context = {
    data,
    api,
    refresh,
    runAction,
    setScreen: openScreen,
    setActiveTab: navigateTab,
    onLogout,
    session,
    setNotice,
    routeState,
    navigateTo,
    routeFor: (view, rest = []) => routeFor(userObjectId, view, rest)
  };
  const userRole = data.currentUser?.role || "staff";
  const canReceiveNotifications = data.permissions?.canReceiveNotifications ?? userRole !== "staff";
  const visibleTabs = TABS.filter((tab) => tab.id !== "notify" || canReceiveNotifications);
  const effectiveActiveTab = activeTab === "notify" && !canReceiveNotifications ? "home" : activeTab;
  const currentTitle = screen?.title || TABS.find((tab) => tab.id === effectiveActiveTab)?.label || "Inventory";
  const badgeCount = canReceiveNotifications ? (data.notifications || []).filter((item) => ["unread", "pending"].includes(item.status)).length : 0;
  const borrowedCount = data.borrowedItems.length;

  return (
    <main className="relative min-h-dvh overflow-hidden bg-black text-white">
      <InventoryBackdrop />
      <header className="fixed inset-x-0 top-0 z-30 border-b border-white/10 bg-black/36 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+12px)] shadow-glass backdrop-blur-2xl">
        <div className="mx-auto flex max-w-[430px] items-center gap-3">
          {screen ? (
            <button
              type="button"
              onClick={closeScreen}
              className="grid size-10 shrink-0 place-items-center rounded-full border border-white/12 bg-white/[0.04] text-white/74"
              aria-label="Back"
            >
              <ChevronLeft className="size-5" />
            </button>
          ) : (
            <span className="grid size-10 shrink-0 place-items-center rounded-full border border-white/14 bg-white/8">
              <img src="/pictureworks-status-icon.svg" alt="" className="size-9" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-semibold leading-none">Pictureworks Inventory</p>
            <p className="mt-1 truncate text-xs text-white/46">{currentTitle}</p>
          </div>
          <button
            type="button"
            onClick={() => refresh()}
            className="grid size-10 shrink-0 place-items-center rounded-full border border-white/12 bg-white/[0.04] text-white/68"
            aria-label="Refresh"
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          </button>
        </div>
        <ConnectionBar state={connection} apiBaseUrl={apiBaseUrl} />
      </header>

      <section className="relative z-10 mx-auto min-h-dvh w-full max-w-[430px] px-4 pb-[calc(env(safe-area-inset-bottom)+96px)] pt-[calc(env(safe-area-inset-top)+124px)]">
        {notice && (
          <button
            type="button"
            onClick={() => setNotice("")}
            className="mb-4 w-full rounded-[8px] border border-white/10 bg-black/36 p-3 text-left text-sm leading-5 text-white/72 backdrop-blur-2xl"
          >
            {notice}
          </button>
        )}

        {loading && !data.currentUser ? (
          <EmptyPanel icon={Loader2} title="Loading inventory" body="Connecting to Cloudflare Hong Kong." spinning />
        ) : screen ? (
          <ScreenRouter screen={screen} context={context} />
        ) : (
          <TabRouter activeTab={effectiveActiveTab} context={context} />
        )}
      </section>

      {!screen && (
        <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-black/42 px-3 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-2 shadow-glass backdrop-blur-2xl">
          <div className={`mx-auto grid max-w-[430px] ${visibleTabs.length === 5 ? "grid-cols-5" : "grid-cols-4"} gap-1`}>
            {visibleTabs.map((tab) => {
              const Icon = tab.icon;
              const active = effectiveActiveTab === tab.id;
              const badge = tab.id === "notify" ? badgeCount : tab.id === "status" ? borrowedCount : 0;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => navigateTab(tab.id)}
                  className={`relative flex h-14 flex-col items-center justify-center rounded-[8px] text-[11px] font-semibold transition ${
                    active ? "bg-white text-black" : "text-white/54"
                  }`}
                >
                  <Icon className="mb-1 size-4" />
                  {tab.label}
                  {badge > 0 && <span className="absolute right-2 top-1.5 min-w-4 rounded-full bg-red-300 px-1 text-[10px] leading-4 text-black">{badge}</span>}
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </main>
  );
}

function TabRouter({ activeTab, context }) {
  if (activeTab === "search") return <SearchTab {...context} />;
  if (activeTab === "notify") return <NotifyTab {...context} />;
  if (activeTab === "status") return <StatusTab {...context} />;
  if (activeTab === "me") return <MeTab {...context} />;
  return <HomeTab {...context} />;
}

function ScreenRouter({ screen, context }) {
  const props = { ...context, params: screen.params || {} };
  if (screen.id === "inventory") return <InventoryScreen {...props} />;
  if (screen.id === "sku") return <SkuDetailScreen {...props} />;
  if (screen.id === "companies") return <CompaniesScreen {...props} />;
  if (screen.id === "categories") return <CategoriesScreen {...props} />;
  if (screen.id === "records") return <RecordsScreen {...props} />;
  if (screen.id === "users") return <UsersScreen {...props} />;
  if (screen.id === "userLogs") return <UserLogsScreen {...props} />;
  if (screen.id === "pingAlerts") return <PingAlertsScreen {...props} />;
  if (screen.id === "smtp") return <SmtpScreen {...props} />;
  return <RecentActivityScreen {...props} />;
}

function BottomSheet({ open, title, children, onClose, footer }) {
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[100]">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/62 backdrop-blur-sm"
      />
      <div className="absolute inset-x-0 bottom-0 mx-auto max-h-[88dvh] max-w-[430px] overflow-hidden rounded-t-[22px] border border-white/10 bg-black/82 shadow-glass backdrop-blur-2xl">
        <div className="sticky top-0 z-10 border-b border-white/10 bg-black/60 px-4 py-3 backdrop-blur-2xl">
          <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/22" />
          <div className="flex items-center gap-3">
            <p className="min-w-0 flex-1 truncate text-base font-semibold">{title}</p>
            <button
              type="button"
              onClick={onClose}
              className="grid size-9 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white/64"
              aria-label="Close sheet"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
        <div className="max-h-[calc(88dvh-72px)] overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+18px)] pt-4">
          {children}
          {footer && <div className="sticky bottom-0 -mx-4 mt-5 border-t border-white/10 bg-black/74 px-4 py-3 backdrop-blur-2xl">{footer}</div>}
        </div>
      </div>
    </div>,
    document.body
  );
}

function ConfirmSheet({ open, title, body, actionLabel = "Confirm", destructive = false, onConfirm, onClose }) {
  return (
    <BottomSheet open={open} title={title} onClose={onClose}>
      <div className="space-y-4">
        <div className={`grid size-12 place-items-center rounded-full ${destructive ? "bg-red-300/12 text-red-100" : "bg-white/8 text-white/72"}`}>
          <AlertTriangle className="size-5" />
        </div>
        <p className="text-sm leading-6 text-white/56">{body}</p>
        <div className="grid grid-cols-2 gap-2">
          <ActionButton label="Cancel" tone="dark" onClick={onClose} />
          <ActionButton label={actionLabel} tone={destructive ? "danger" : "light"} onClick={onConfirm} />
        </div>
      </div>
    </BottomSheet>
  );
}

function QrScannerSheet({ open, title, expectedCode, onCode, onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(0);
  const lastDecodeRef = useRef(0);
  const [manualCode, setManualCode] = useState("");
  const [error, setError] = useState("");
  const [unsupported, setUnsupported] = useState(false);
  const [ready, setReady] = useState(false);
  const [scannerStatus, setScannerStatus] = useState("Opening camera...");

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    const start = async () => {
      setManualCode("");
      setError("");
      setReady(false);
      setUnsupported(false);
      setScannerStatus("Opening camera...");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute("playsinline", "true");
          await videoRef.current.play();
        }
        setReady(true);
        setScannerStatus("Looking for QR code...");
        const nativeDetector = "BarcodeDetector" in window
          ? new window.BarcodeDetector({ formats: ["qr_code"] })
          : null;
        const tick = async (time) => {
          if (!videoRef.current || cancelled) return;
          if (time - lastDecodeRef.current > 180) {
            lastDecodeRef.current = time;
            const raw = await decodeFrame(videoRef.current, canvasRef.current, nativeDetector);
            if (raw) {
              handleDetected(raw);
              return;
            }
          }
          rafRef.current = window.requestAnimationFrame(tick);
        };
        rafRef.current = window.requestAnimationFrame(tick);
      } catch (err) {
        setUnsupported(true);
        setScannerStatus("Camera unavailable");
        setError(err?.message || "Camera is not available. You can enter the SKU code manually.");
      }
    };
    start();
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      lastDecodeRef.current = 0;
    };
  }, [open]);

  function handleDetected(raw) {
    const code = extractSKUCode(raw);
    if (!code) {
      setError("QR Code does not contain a valid SKU code.");
      return;
    }
    if (expectedCode && code.toUpperCase() !== expectedCode.toUpperCase()) {
      setError(`Scanned ${code}, but this action needs ${expectedCode}.`);
      return;
    }
    onCode(code);
    onClose();
  }

  function submitManual() {
    handleDetected(manualCode);
  }

  return (
    <BottomSheet open={open} title={title} onClose={onClose}>
      <div className="space-y-4">
        <div className="relative overflow-hidden rounded-[14px] border border-white/10 bg-black">
          <video ref={videoRef} playsInline muted className="h-[260px] w-full object-cover" />
          <canvas ref={canvasRef} className="hidden" />
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="h-40 w-40 rounded-[18px] border-2 border-white/78 shadow-[0_0_0_999px_rgba(0,0,0,.32)]" />
          </div>
          <div className="absolute inset-x-0 bottom-0 bg-black/54 px-4 py-3 text-center text-sm text-white/70">
            {expectedCode ? `Scan ${expectedCode} to confirm` : "Scan the item QR code"}
          </div>
          <div className={`absolute inset-0 grid place-items-center bg-black/70 text-sm text-white/56 ${ready ? "pointer-events-none bg-transparent text-transparent" : ""}`}>
            {scannerStatus}
          </div>
        </div>
        {(unsupported || error) && (
          <div className="rounded-[8px] border border-amber-200/16 bg-amber-300/10 p-3 text-sm leading-5 text-amber-100">
            {error || "This browser does not support live QR detection. Enter the SKU code manually."}
          </div>
        )}
        <div className="flex h-12 items-center gap-2 border-b border-white/20">
          <Camera className="size-4 text-white/44" />
          <input
            value={manualCode}
            onChange={(event) => setManualCode(event.target.value.toUpperCase())}
            onKeyDown={(event) => event.key === "Enter" && submitManual()}
            placeholder="Manual SKU code"
            className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-white/32"
          />
          <button type="button" onClick={submitManual} className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-black">
            Confirm
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}

async function decodeFrame(video, canvas, nativeDetector) {
  if (!video || !canvas || video.readyState < 2) return null;
  if (nativeDetector) {
    try {
      const codes = await nativeDetector.detect(video);
      if (codes[0]?.rawValue) return codes[0].rawValue;
    } catch {
      // Fall through to jsQR. Safari and embedded browsers can expose the API but fail at runtime.
    }
  }
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;
  const maxWidth = 720;
  const scale = Math.min(1, maxWidth / width);
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const result = jsQR(image.data, image.width, image.height, {
    inversionAttempts: "attemptBoth"
  });
  return result?.data || null;
}

function HomeTab({ data, setScreen }) {
  const role = data.currentUser?.role || "staff";
  const canManage = ["warehouse_manager", "admin", "superadmin"].includes(role);
  const shortcuts = [
    { id: "recent", title: "Recent activity", icon: Clock3, visible: true },
    { id: "inventory", title: "Inventory", icon: Boxes, visible: canManage },
    { id: "companies", title: "Company", icon: Building2, visible: canManage },
    { id: "categories", title: "Category", icon: Tags, visible: canManage },
    { id: "records", title: "Records", icon: ClipboardList, visible: canManage },
    { id: "users", title: "Users", icon: Users, visible: data.permissions?.canManageUsers },
    { id: "userLogs", title: "User Log", icon: FileClock, visible: data.permissions?.canViewUserLogs },
    { id: "pingAlerts", title: "Ping Alerts", icon: Wifi, visible: data.permissions?.canManageAlerts },
    { id: "smtp", title: "SMTP", icon: Mail, visible: role === "superadmin" }
  ].filter((item) => item.visible);

  return (
    <div className="space-y-4">
      <GlassPanel>
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <p className="truncate text-2xl font-semibold">{data.currentUser?.name || "Inventory"}</p>
            <p className="mt-1 text-sm text-white/48">{ROLE_LABELS[role] || role}</p>
          </div>
          <ShieldCheck className="size-6 shrink-0 text-emerald-200/80" />
        </div>
        <div className="mt-5 grid grid-cols-3 gap-2">
          <Metric title="Borrowed" value={data.borrowedItems.length} />
          <Metric title="Available" value={data.skus.filter((sku) => sku.status === "available").length} />
          <Metric title="Repairing" value={data.skus.filter((sku) => sku.status === "repairing").length} />
        </div>
      </GlassPanel>

      <SectionTitle title="Work" />
      <div className="space-y-2">
        {shortcuts.map((item) => (
          <ListButton
            key={item.id}
            icon={item.icon}
            title={item.title}
            subtitle={shortcutSubtitle(item.id, data)}
            onClick={() => setScreen({ id: item.id, title: item.title })}
          />
        ))}
      </div>
    </div>
  );
}

function SearchTab({ data, api, runAction, routeState, navigateTo, routeFor, setNotice }) {
  const canTypeSearch = ["admin", "superadmin"].includes(data.currentUser?.role);
  const [mode, setMode] = useState(routeState.source || "qrc");
  const [query, setQuery] = useState(routeState.skuCode || "");
  const [scanned, setScanned] = useState(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const normalized = query.trim().toLowerCase();
  const matches = data.skus
    .filter((sku) => {
      if (!normalized) return false;
      if (mode === "sn") return String(sku.serialNumber || "").toLowerCase().includes(normalized);
      const text = [displaySkuCode(sku), sku.descriptionText, sku.serialNumber, sku.companyName, sku.parkName].join(" ").toLowerCase();
      return text.includes(normalized);
    })
    .slice(0, 30);

  useEffect(() => {
    if (routeState.tab !== "search") return;
    setMode(routeState.source || "qrc");
    setQuery(routeState.skuCode || "");
    if (!routeState.skuCode) {
      setScanned(null);
      return;
    }
    const live = data.skus.find((sku) => displaySkuCode(sku).toUpperCase() === routeState.skuCode.toUpperCase());
    if (live) {
      setScanned(live);
      return;
    }
    lookup(routeState.skuCode, routeState.source || "qrc", { replaceRoute: true });
  }, [routeState.tab, routeState.source, routeState.skuCode, data.skus]);

  async function lookup(value = query, source = mode === "qrc" ? "qrc" : "sku", options = {}) {
    if (!value.trim()) return;
    setNotice("");
    try {
      const result = await api(`scan/${encodeURIComponent(value.trim())}`);
      if (result?.sku) {
        const code = displaySkuCode(result.sku);
        setScanned(result.sku);
        navigateTo(routeFor("search", [source, code]), { replace: options.replaceRoute });
      } else {
        setScanned(null);
        setNotice("No SKU was found for this code.");
      }
    } catch (error) {
      setScanned(null);
      setNotice(error.message || "Cannot search this SKU right now.");
    }
  }

  function openDetail(sku, source = routeState.source || (mode === "qrc" ? "qrc" : "sku")) {
    navigateTo(routeFor("search", [source, displaySkuCode(sku), "detail"]));
  }

  function clearSearchResult() {
    setMode("qrc");
    setQuery("");
    setScanned(null);
    navigateTo(routeFor("search"), { replace: true });
  }

  return (
    <div className="space-y-4">
      <GlassPanel>
        <p className="text-2xl font-semibold">Scan or search</p>
        <p className="mt-2 text-sm leading-5 text-white/48">QRC mode uses the camera. Admins can also type SKU or serial number.</p>
        {canTypeSearch && (
          <div className="mt-5 grid grid-cols-3 rounded-full border border-white/10 bg-white/[0.04] p-1 text-sm">
            {[
              ["qrc", "QRC"],
              ["sku", "SKU"],
              ["sn", "SN"]
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setMode(id);
                  setQuery("");
                  setScanned(null);
                  navigateTo(routeFor("search"));
                }}
                className={`h-9 rounded-full font-semibold ${mode === id ? "bg-white text-black" : "text-white/54"}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {mode === "qrc" && (
          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            className="mt-5 flex h-36 w-full flex-col items-center justify-center rounded-[14px] border border-white/10 bg-white/[0.035] text-white/70"
          >
            <Camera className="mb-3 size-8" />
            <span className="text-sm font-semibold">Open camera scanner</span>
            <span className="mt-1 text-xs text-white/38">Scan the QR code on the item</span>
          </button>
        )}
        <div className="mt-5 flex h-12 items-center gap-2 border-b border-white/20">
          <Search className="size-4 text-white/44" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && lookup(query, mode === "qrc" ? "qrc" : "sku")}
            placeholder={mode === "sn" ? "Serial number" : "SKU code"}
            readOnly={mode === "qrc" && !canTypeSearch}
            className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-white/32"
          />
          <button type="button" onClick={() => lookup(query, mode === "qrc" ? "qrc" : "sku")} className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-black">
            Search
          </button>
        </div>
      </GlassPanel>

      <QrScannerSheet
        open={scannerOpen}
        title="Scan QR Code"
        onClose={() => setScannerOpen(false)}
        onCode={(code) => {
          setQuery(code);
          lookup(code, "qrc");
        }}
      />

      {scanned && (
        <SearchSkuResult
          sku={scanned}
          api={api}
          runAction={runAction}
          canReturnFromRepair={data.permissions?.canReturnFromRepair ?? data.currentUser?.role !== "staff"}
          onOpenDetail={() => openDetail(scanned)}
          onClear={clearSearchResult}
        />
      )}

      {!scanned && (
        <>
          <SectionTitle title={normalized ? "Results" : "Inventory Search"} />
          {normalized && matches.length === 0 ? (
            <EmptyPanel icon={Search} title="No SKU found" body="Try a full SKU code or serial number." />
          ) : (
            <div className="space-y-2">
              {(normalized ? matches : data.skus.slice(0, 12)).map((sku) => (
                <SkuCard key={sku.id} sku={sku} onClick={() => openDetail(sku, "sku")} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SearchSkuResult({ sku, api, runAction, canReturnFromRepair, onOpenDetail, onClear }) {
  const [actionScanOpen, setActionScanOpen] = useState(false);
  const skuCode = displaySkuCode(sku);
  const action = sku.status === "available"
    ? { label: "Borrow", icon: Package, endpoint: "borrow", title: "Scan to Borrow", message: `${skuCode} borrowed.` }
    : sku.status === "borrowed"
      ? { label: "Return", icon: RefreshCw, endpoint: "return", title: "Scan to Return", message: `${skuCode} returned.` }
      : sku.status === "repairing" && canReturnFromRepair
        ? { label: "Return", icon: RefreshCw, endpoint: "return-after-repair", title: "Scan to Return", message: `${skuCode} returned from repair.` }
        : null;

  async function executeAction() {
    if (!action) return;
    const result = await runAction(action.label, () => api(action.endpoint, {
      method: "POST",
      body: { skuNumber: skuCode }
    }), {
      message: action.message
    });
    if (result !== null) onClear?.();
  }

  return (
    <div className="space-y-3">
      <SkuCard sku={sku} onClick={onOpenDetail} />
      {action && (
        <ActionButton label={action.label} icon={action.icon} onClick={() => setActionScanOpen(true)} />
      )}
      <QrScannerSheet
        open={actionScanOpen}
        title={action?.title || "Confirm action"}
        expectedCode={skuCode}
        onClose={() => setActionScanOpen(false)}
        onCode={() => {
          setActionScanOpen(false);
          executeAction();
        }}
      />
    </div>
  );
}

function SkuQuickActions({ sku, data, api, runAction, onOpenDetail }) {
  const [scanAction, setScanAction] = useState(null);
  const [repairOpen, setRepairOpen] = useState(false);
  const role = data.currentUser?.role || "staff";
  const canRepair = data.permissions?.canRepairInventory ?? ["admin", "superadmin"].includes(role);
  const canReturnFromRepair = data.permissions?.canReturnFromRepair ?? role !== "staff";

  async function execute(endpoint, body = {}) {
    await runAction(endpoint, () => api(endpoint, { method: "POST", body: { skuNumber: displaySkuCode(sku), ...body } }), {
      message: `${displaySkuCode(sku)} updated.`
    });
  }

  const actions = [];
  if (sku.status === "available") {
    actions.push({ label: "Borrow", icon: Package, endpoint: "borrow" });
    if (canRepair) actions.push({ label: "Repair", icon: Wrench, special: "repair" });
  }
  if (sku.status === "borrowed") actions.push({ label: "Return", icon: RefreshCw, endpoint: "return" });
  if (sku.status === "repairing" && canReturnFromRepair) actions.push({ label: "Return", icon: RefreshCw, endpoint: "return-after-repair" });

  return (
    <div className="mt-4 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        {actions.map((action) => (
          <ActionButton
            key={action.label}
            label={action.label}
            icon={action.icon}
            onClick={() => {
              if (action.special === "repair") setScanAction({ ...action, endpoint: "repair" });
              else setScanAction(action);
            }}
          />
        ))}
        <ActionButton label="Detail" tone="dark" icon={ClipboardList} onClick={onOpenDetail} />
      </div>
      <QrScannerSheet
        open={Boolean(scanAction)}
        title={scanAction?.label || "Confirm action"}
        expectedCode={displaySkuCode(sku)}
        onClose={() => setScanAction(null)}
        onCode={() => {
          const action = scanAction;
          setScanAction(null);
          if (action?.special === "repair") setRepairOpen(true);
          else execute(action.endpoint);
        }}
      />
      <RepairActionSheet
        open={repairOpen}
        sku={sku}
        onClose={() => setRepairOpen(false)}
        onSubmit={(body) => execute("repair", body)}
      />
    </div>
  );
}

function NotifyTab({ data, api, runAction }) {
  const notifications = [...(data.notifications || [])].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  async function updateNotification(item, status) {
    const isReview = ["approved", "denied"].includes(status);
    await runAction("Notification", () => api(`notifications/${item.id}${isReview ? "/review" : ""}`, {
      method: isReview ? "POST" : "PATCH",
      body: { status }
    }), {
      message: isReview ? `Notification ${status}.` : `Notification marked ${status}.`
    });
  }

  return (
    <div className="space-y-3">
      {notifications.length === 0 ? (
        <EmptyPanel icon={Bell} title="No notifications" body="Approvals and system messages will appear here." />
      ) : (
        notifications.map((item) => (
          <GlassPanel key={item.id}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <StatusBadge value={item.status} />
                <p className="mt-3 text-lg font-semibold">{item.title}</p>
                <p className="mt-2 text-sm leading-5 text-white/56">{item.body}</p>
                <p className="mt-3 text-xs text-white/34">{formatDateTime(item.createdAt)}</p>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              {item.status === "pending" ? (
                <>
                  <ActionButton label="Approve" onClick={() => updateNotification(item, "approved")} />
                  <ActionButton label="Deny" tone="dark" onClick={() => updateNotification(item, "denied")} />
                </>
              ) : (
                <ActionButton label="Mark read" tone="dark" onClick={() => updateNotification(item, "read")} />
              )}
            </div>
          </GlassPanel>
        ))
      )}
    </div>
  );
}

function StatusTab({ data, setScreen }) {
  const items = [...data.borrowedItems, ...data.repairingItems];
  if (items.length === 0) {
    return <EmptyPanel icon={Check} title="Now you don't have anything in loan." body="Borrowed and repairing items will appear here." />;
  }
  return (
    <div className="space-y-4">
      {data.borrowedItems.length > 0 && <SectionTitle title="Borrowed" />}
      {data.borrowedItems.map((sku) => (
        <SkuCard key={sku.id} sku={sku} date={sku.borrowedAt} onClick={() => setScreen({ id: "sku", title: displaySkuCode(sku), params: { skuId: sku.id } })} />
      ))}
      {data.repairingItems.length > 0 && <SectionTitle title="In Repair" />}
      {data.repairingItems.map((sku) => (
        <SkuCard key={sku.id} sku={sku} date={sku.repairStartedAt} onClick={() => setScreen({ id: "sku", title: displaySkuCode(sku), params: { skuId: sku.id } })} />
      ))}
    </div>
  );
}

function MeTab({ data, session, api, runAction, onLogout }) {
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [sheet, setSheet] = useState(null);
  const user = data.currentUser || session.currentUser || {};
  async function changePassword() {
    await runAction("Change password", () => api("change-password", { method: "POST", body: form }), {
      message: "Password changed."
    });
    setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
  }

  return (
    <div className="space-y-4">
      <button type="button" onClick={() => setSheet("profile")} className="w-full text-left">
        <GlassPanel>
          <div className="flex items-center gap-4">
            <span className="grid size-14 place-items-center rounded-full border border-white/10 bg-white/[0.04]">
              <UserRound className="size-7 text-white/70" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-2xl font-semibold">{user.name}</p>
              <p className="mt-1 text-sm text-white/48">{user.username} · {ROLE_LABELS[user.role] || user.role}</p>
            </div>
            <ChevronLeft className="size-4 rotate-180 text-white/32" />
          </div>
        </GlassPanel>
      </button>

      <ListButton icon={Settings} title="Settings" subtitle="Server node and preferences" onClick={() => setSheet("settings")} />
      <ListButton icon={Bluetooth} title="Bluetooth" subtitle="Scanner discovery placeholder" onClick={() => setSheet("bluetooth")} />
      {user.role === "superadmin" && <ListButton icon={Mail} title="Email Alerts" subtitle="SMTP settings" onClick={() => setSheet("smtp")} />}

      <button
        type="button"
        onClick={() => setSheet("logout")}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-full border border-red-200/20 bg-red-300/10 text-sm font-semibold text-red-100"
      >
        <LogOut className="size-4" />
        Log out
      </button>

      <BottomSheet open={sheet === "profile"} title="Profile" onClose={() => setSheet(null)}>
        <div className="space-y-4">
          <InfoTile label="Name" value={user.name} />
          <InfoTile label="Employee ID" value={user.username} />
          <InfoTile label="Role" value={ROLE_LABELS[user.role] || user.role} />
          <InfoTile label="Phone" value={[user.phoneCountryCode, user.phone].filter(Boolean).join(" ") || "Not set"} />
          <InfoTile label="Email" value={user.email || "Not set"} />
          <ActionButton label="Change Password" icon={KeyRound} onClick={() => setSheet("password")} />
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === "password"} title="Change Password" onClose={() => setSheet(null)}>
        <FormInput type="password" label="Current password" value={form.currentPassword} onChange={(value) => setForm({ ...form, currentPassword: value })} />
        <FormInput type="password" label="New password" value={form.newPassword} onChange={(value) => setForm({ ...form, newPassword: value })} />
        <FormInput type="password" label="Confirm password" value={form.confirmPassword} onChange={(value) => setForm({ ...form, confirmPassword: value })} />
        <ActionButton label="Save password" onClick={() => { setSheet(null); changePassword(); }} />
      </BottomSheet>

      <BottomSheet open={sheet === "settings"} title="Settings" onClose={() => setSheet(null)}>
        <div className="space-y-3">
          <InfoTile label="Backend node" value="Cloudflare Hong Kong" />
          <InfoTile label="API route" value="Cloudflare(HKG)" />
          <InfoTile label="Regional protection" value="Only the HKG backend is selectable on web." />
        </div>
      </BottomSheet>

      <BottomSheet open={sheet === "bluetooth"} title="Bluetooth" onClose={() => setSheet(null)}>
        <EmptyPanel icon={Bluetooth} title="Bluetooth scanner" body="Mobile browsers do not expose the same native Bluetooth scanner flow as iOS. Camera QR scanning is available in Search and SKU actions." />
      </BottomSheet>

      <BottomSheet open={sheet === "smtp"} title="Email Alerts" onClose={() => setSheet(null)}>
        <SmtpScreen api={api} runAction={runAction} />
      </BottomSheet>

      <ConfirmSheet
        open={sheet === "logout"}
        title="Log out of Inventory?"
        body="This will remove the current browser session."
        actionLabel="Log Out"
        destructive
        onClose={() => setSheet(null)}
        onConfirm={() => {
          setSheet(null);
          onLogout();
        }}
      />
    </div>
  );
}

function RecentActivityScreen({ data }) {
  return (
    <RecordList records={(data.records || []).slice(0, 100)} emptyTitle="No recent activity" />
  );
}

function InventoryScreen({ data, api, runAction, setScreen }) {
  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptySkuForm(data));
  const items = data.skus.filter((sku) => {
    const text = [displaySkuCode(sku), sku.descriptionText, sku.serialNumber, sku.companyName, sku.parkName, sku.categoryCode].join(" ").toLowerCase();
    return text.includes(query.trim().toLowerCase());
  });

  async function createSku() {
    await runAction("Create SKU", () => api("skus", { method: "POST", body: compactObject(form) }), {
      message: "SKU created."
    });
    setForm(emptySkuForm(data));
    setFormOpen(false);
  }

  return (
    <div className="space-y-4">
      <SearchBox value={query} onChange={setQuery} placeholder="Search inventory" />
      <ActionButton label="Add SKU" icon={Plus} onClick={() => setFormOpen(true)} />
      <BottomSheet open={formOpen} title="Add SKU" onClose={() => setFormOpen(false)}>
        <div className="space-y-3">
          <SkuForm form={form} setForm={setForm} data={data} />
          <ActionButton label="Create SKU" onClick={createSku} />
        </div>
      </BottomSheet>
      <div className="space-y-2">
        {items.map((sku) => (
          <SkuCard key={sku.id} sku={sku} onClick={() => setScreen({ id: "sku", title: displaySkuCode(sku), params: { skuId: sku.id } })} />
        ))}
      </div>
    </div>
  );
}

function SkuDetailScreen({ data, api, runAction, params, navigateTo, routeFor, setNotice }) {
  const localSku = data.skus.find((item) => {
    if (params.skuId && item.id === params.skuId) return true;
    if (params.skuCode && displaySkuCode(item).toUpperCase() === params.skuCode.toUpperCase()) return true;
    return false;
  });
  const [remoteSku, setRemoteSku] = useState(null);
  const [remoteSkuFailed, setRemoteSkuFailed] = useState(false);
  const [sheet, setSheet] = useState(null);
  const [scanAction, setScanAction] = useState(null);
  const role = data.currentUser?.role;
  const canManage = ["warehouse_manager", "admin", "superadmin"].includes(role);
  const canRepair = data.permissions?.canRepairInventory ?? ["admin", "superadmin"].includes(role);
  const canRequestDisposal = data.permissions?.canRequestDisposal ?? canManage;
  const canReturnFromRepair = data.permissions?.canReturnFromRepair ?? role !== "staff";
  const canEdit = role === "superadmin";

  useEffect(() => {
    let cancelled = false;
    setRemoteSku(null);
    setRemoteSkuFailed(false);
    if (localSku || !params.skuCode) return () => {
      cancelled = true;
    };
    api(`scan/${encodeURIComponent(params.skuCode)}`)
      .then((result) => {
        if (!cancelled) setRemoteSku(result?.sku || null);
      })
      .catch((error) => {
        if (!cancelled) {
          setRemoteSkuFailed(true);
          setNotice?.(error.message || "Cannot load this SKU.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [localSku?.id, params.skuCode]);

  const sku = localSku || remoteSku;
  if (!sku) {
    if (remoteSkuFailed) return <EmptyPanel icon={Package} title="SKU not found" body="Scan or search the SKU again." />;
    return params.skuCode
      ? <EmptyPanel icon={Loader2} title="Loading SKU" body="Fetching the latest SKU details." spinning />
      : <EmptyPanel icon={Package} title="SKU not found" body="Refresh inventory and try again." />;
  }
  const branchOptions = branchList(data).filter((branch) => branch.warehouseId === sku.warehouseId && branch.id !== sku.branchId);
  const recentRecords = (data.records || []).filter((record) => record.skuId === sku.id).slice(0, 8);

  function clearSearchDetailAfterSuccess(result) {
    if (result !== null && params.backPath) navigateTo(routeFor("search"), { replace: true });
  }

  async function skuAction(endpoint, body = {}) {
    const result = await runAction(endpoint, () => api(endpoint, { method: "POST", body: { skuNumber: displaySkuCode(sku), ...body } }), {
      message: `${displaySkuCode(sku)} updated.`
    });
    clearSearchDetailAfterSuccess(result);
  }

  return (
    <div className="space-y-4">
      <SkuCard sku={sku} />
      <GlassPanel>
        <SectionTitle title="Details" compact />
        <DetailRow label="Company" value={sku.companyName} />
        <DetailRow label="Branch" value={sku.parkName} />
        <DetailRow label="Location" value={sku.locationName} />
        <DetailRow label="Category" value={sku.categoryCode} />
        <DetailRow label="Serial" value={sku.serialNumber} />
        <DetailRow label="Description" value={sku.descriptionText} />
        <DetailRow label="Borrower" value={sku.borrowedByName} />
      </GlassPanel>

      <GlassPanel>
        <SectionTitle title="Actions" compact />
        <div className="grid grid-cols-2 gap-2">
          {sku.status === "borrowed" && <ActionButton label="Return" icon={RefreshCw} onClick={() => setScanAction({ title: "Scan to Return", endpoint: "return" })} />}
          {sku.status === "repairing" && canReturnFromRepair && <ActionButton label="Return" icon={RefreshCw} onClick={() => setScanAction({ title: "Scan to Return", endpoint: "return-after-repair" })} />}
          {sku.status === "available" && canRepair && <ActionButton label="Repair" tone="dark" icon={Wrench} onClick={() => setScanAction({ title: "Scan for Repair", endpoint: "repair", nextSheet: "repair" })} />}
          {sku.status === "available" && canManage && <ActionButton label="Transfer" tone="dark" icon={ArrowLeftRight} onClick={() => setSheet("transfer")} />}
          {sku.status === "available" && canRequestDisposal && <ActionButton label="Disposal" tone="danger" icon={Trash2} onClick={() => setSheet("disposal")} />}
          {sku.status === "available" && canEdit && <ActionButton label="Edit" tone="dark" icon={Pencil} onClick={() => setScanAction({ title: "Scan to Edit", nextSheet: "edit" })} />}
        </div>
      </GlassPanel>

      <GlassPanel>
        <SectionTitle title="Recent Activity (7 days)" compact />
        {recentRecords.length === 0 ? (
          <p className="text-sm text-white/44">No activity in the past 7 days.</p>
        ) : recentRecords.map((record) => (
          <DetailRow key={record.id} label={record.type} value={formatDateShort(record.createdAt)} />
        ))}
      </GlassPanel>

      <QrScannerSheet
        open={Boolean(scanAction)}
        title={scanAction?.title || "Confirm"}
        expectedCode={displaySkuCode(sku)}
        onClose={() => setScanAction(null)}
        onCode={() => {
          const action = scanAction;
          setScanAction(null);
          if (action?.nextSheet) setSheet(action.nextSheet);
          else skuAction(action.endpoint);
        }}
      />
      <RepairActionSheet
        open={sheet === "repair"}
        sku={sku}
        onClose={() => setSheet(null)}
        onSubmit={(body) => {
          setSheet(null);
          skuAction("repair", body);
        }}
      />
      <TransferActionSheet
        open={sheet === "transfer"}
        sku={sku}
        branchOptions={branchOptions}
        onClose={() => setSheet(null)}
        onSubmit={(body) => {
          setSheet(null);
          runAction("Transfer", () => api("transfer", {
            method: "POST",
            body: {
              skuId: sku.id,
              skuNumber: displaySkuCode(sku),
              targetBranchId: body.toBranchId,
              toBranchId: body.toBranchId,
              reason: body.reason
            }
          }), { message: "SKU transferred." })
            .then(clearSearchDetailAfterSuccess);
        }}
      />
      <DisposalActionSheet
        open={sheet === "disposal"}
        sku={sku}
        onClose={() => setSheet(null)}
        onSubmit={(body) => {
          setSheet(null);
          runAction("Disposal", () => api("disposal", {
            method: "POST",
            body: {
              skuId: sku.id,
              skuNumber: displaySkuCode(sku),
              reason: body.reason,
              netBookValue: body.netBookValue
            }
          }), { message: "Disposal requested." })
            .then(clearSearchDetailAfterSuccess);
        }}
      />
      <EditSkuActionSheet
        open={sheet === "edit"}
        sku={sku}
        data={data}
        onClose={() => setSheet(null)}
        onSubmit={(body) => {
          setSheet(null);
          runAction("Edit SKU", () => api(`skus/${sku.id}`, { method: "PATCH", body }), { message: "SKU edited." })
            .then(clearSearchDetailAfterSuccess);
        }}
      />
    </div>
  );
}

function RepairActionSheet({ open, sku, onClose, onSubmit }) {
  const [form, setForm] = useState({ reason: "", destination: "" });
  return (
    <BottomSheet open={open} title={`Repair ${displaySkuCode(sku)}`} onClose={onClose}>
      <div className="space-y-4">
        <SkuCard sku={sku} />
        <FormInput label="Reason" value={form.reason} onChange={(value) => setForm({ ...form, reason: value })} />
        <FormInput label="Send to" value={form.destination} onChange={(value) => setForm({ ...form, destination: value })} />
        <ActionButton label="Submit repair request" icon={Wrench} onClick={() => onSubmit(form)} />
      </div>
    </BottomSheet>
  );
}

function TransferActionSheet({ open, sku, branchOptions, onClose, onSubmit }) {
  const [targetBranchId, setTargetBranchId] = useState(branchOptions[0]?.id || "");
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) {
      setTargetBranchId(branchOptions[0]?.id || "");
      setReason("");
    }
  }, [open, branchOptions[0]?.id]);
  return (
    <BottomSheet open={open} title={`Transfer ${displaySkuCode(sku)}`} onClose={onClose}>
      <div className="space-y-4">
        <SkuCard sku={sku} />
        <SelectInput
          label="Target branch"
          value={targetBranchId}
          onChange={setTargetBranchId}
          options={branchOptions.map((branch) => ({ value: branch.id, label: `${branch.companyCode} · ${branch.name}` }))}
        />
        <FormInput label="Reason" value={reason} onChange={setReason} />
        <ActionButton
          label="Submit transfer"
          icon={ArrowLeftRight}
          disabled={!targetBranchId || !reason.trim()}
          onClick={() => onSubmit({ toBranchId: targetBranchId, reason: reason.trim() })}
        />
      </div>
    </BottomSheet>
  );
}

function DisposalActionSheet({ open, sku, onClose, onSubmit }) {
  const [form, setForm] = useState({ reason: "", netBookValue: "" });
  useEffect(() => {
    if (open) setForm({ reason: "", netBookValue: "" });
  }, [open]);
  return (
    <BottomSheet open={open} title={`Disposal ${displaySkuCode(sku)}`} onClose={onClose}>
      <div className="space-y-4">
        <SkuCard sku={sku} />
        <FormInput label="Reason" value={form.reason} onChange={(value) => setForm({ ...form, reason: value })} />
        <FormInput label="Net book value" value={form.netBookValue} onChange={(value) => setForm({ ...form, netBookValue: value })} />
        <ActionButton
          label="Submit disposal"
          tone="danger"
          icon={Trash2}
          disabled={!form.reason.trim() || !form.netBookValue.trim()}
          onClick={() => onSubmit({ reason: form.reason.trim(), netBookValue: form.netBookValue.trim() })}
        />
      </div>
    </BottomSheet>
  );
}

function EditSkuActionSheet({ open, sku, data, onClose, onSubmit }) {
  const [form, setForm] = useState(() => ({
    categoryId: sku.categoryId || "",
    branchId: sku.branchId || "",
    locationId: sku.locationId || "",
    skuNumber: displaySkuCode(sku).split("-").pop() || "",
    descriptionId: sku.descriptionId || "",
    descriptionText: sku.descriptionText || "",
    serialNumber: sku.serialNumber || ""
  }));
  useEffect(() => {
    if (!open) return;
    setForm({
      categoryId: sku.categoryId || "",
      branchId: sku.branchId || "",
      locationId: sku.locationId || "",
      skuNumber: displaySkuCode(sku).split("-").pop() || "",
      descriptionId: sku.descriptionId || "",
      descriptionText: sku.descriptionText || "",
      serialNumber: sku.serialNumber || ""
    });
  }, [open, sku.id]);
  const company = data.warehouses.find((item) => item.id === sku.warehouseId);
  const branch = company?.branches?.find((item) => item.id === form.branchId) || company?.branches?.[0];
  return (
    <BottomSheet open={open} title={`Edit ${displaySkuCode(sku)}`} onClose={onClose}>
      <div className="space-y-3">
        <SelectInput label="Category" value={form.categoryId} onChange={(value) => setForm({ ...form, categoryId: value })} options={(company?.categories || []).map((category) => ({ value: category.id, label: category.code }))} />
        <SelectInput label="Branch" value={form.branchId} onChange={(value) => setForm({ ...form, branchId: value, locationId: "" })} options={(company?.branches || []).map((item) => ({ value: item.id, label: item.name }))} />
        <SelectInput label="Location" value={form.locationId} onChange={(value) => setForm({ ...form, locationId: value })} options={(branch?.locations || []).map((location) => ({ value: location.id, label: location.name }))} optional />
        <FormInput label="SKU number" value={form.skuNumber} onChange={(value) => setForm({ ...form, skuNumber: value })} />
        <FormInput label="Description" value={form.descriptionText} onChange={(value) => setForm({ ...form, descriptionText: value })} />
        <FormInput label="Serial number" value={form.serialNumber} onChange={(value) => setForm({ ...form, serialNumber: value })} />
        <ActionButton label="Save SKU" icon={Pencil} onClick={() => onSubmit(compactObject(form))} />
      </div>
    </BottomSheet>
  );
}

function CompaniesScreen({ data, api, runAction }) {
  const [form, setForm] = useState({ name: "", code: "" });
  const [editForm, setEditForm] = useState({ name: "", code: "" });
  const [branchForms, setBranchForms] = useState({});
  const [sheet, setSheet] = useState(null);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const selectedBranchForm = selectedCompany ? (branchForms[selectedCompany.id] || { name: "" }) : { name: "" };
  const canDeleteCompany = data.currentUser?.role === "superadmin";
  async function createCompany() {
    await runAction("Create company", () => api("warehouses", { method: "POST", body: form }), { message: "Company created." });
    setForm({ name: "", code: "" });
    setSheet(null);
  }
  return (
    <div className="space-y-4">
      <ActionButton label="Add company" icon={Plus} onClick={() => setSheet("addCompany")} />
      <BottomSheet open={sheet === "addCompany"} title="Add company" onClose={() => setSheet(null)}>
        <FormInput label="Company name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
        <FormInput label="Code" value={form.code} onChange={(value) => setForm({ ...form, code: value.toUpperCase() })} />
        <ActionButton label="Create" onClick={createCompany} />
      </BottomSheet>
      {data.warehouses.map((company) => {
        const branchForm = branchForms[company.id] || { name: "" };
        return (
          <button
            key={company.id}
            type="button"
            onClick={() => {
              setSelectedCompany(company);
              setEditForm({ name: company.name || "", code: company.code || "" });
              setSheet("companyDetail");
            }}
            className="w-full text-left"
          >
            <GlassPanel>
              <p className="text-xl font-semibold">{company.name}</p>
              <p className="mt-1 text-sm text-white/42">{company.code} · {(company.branches || []).length} branches</p>
            </GlassPanel>
          </button>
        );
      })}

      <BottomSheet open={sheet === "companyDetail" && selectedCompany} title={selectedCompany?.name || "Company"} onClose={() => setSheet(null)}>
        {selectedCompany && (
          <div className="space-y-4">
            <InfoTile label="Code" value={selectedCompany.code} />
            <div className="grid grid-cols-2 gap-2">
              <ActionButton label="Edit" tone="dark" icon={Pencil} onClick={() => setSheet("editCompany")} />
              <ActionButton label="Delete" tone="danger" icon={Trash2} disabled={!canDeleteCompany} onClick={() => setSheet("deleteCompany")} />
            </div>
            <SectionTitle title="Branches" compact />
            <div className="space-y-2">
              {(selectedCompany.branches || []).map((branch) => <InfoTile key={branch.id} label={branch.name} value={`${(branch.locations || []).length} locations`} />)}
            </div>
            <div>
              <FormInput label="New branch" value={selectedBranchForm.name} onChange={(value) => setBranchForms({ ...branchForms, [selectedCompany.id]: { name: value } })} />
              <ActionButton
                label="Add branch"
                tone="dark"
                onClick={() => runAction("Add branch", () => api(`warehouses/${selectedCompany.id}/branches`, { method: "POST", body: selectedBranchForm }), { message: "Branch added." })}
              />
            </div>
          </div>
        )}
      </BottomSheet>
      <BottomSheet open={sheet === "editCompany" && Boolean(selectedCompany)} title="Edit company" onClose={() => setSheet("companyDetail")}>
        <FormInput label="Company name" value={editForm.name} onChange={(value) => setEditForm({ ...editForm, name: value })} />
        <FormInput label="Code" value={editForm.code} onChange={(value) => setEditForm({ ...editForm, code: value.toUpperCase() })} />
        <ActionButton
          label="Save"
          onClick={() => {
            const company = selectedCompany;
            setSheet(null);
            runAction("Edit company", () => api(`warehouses/${company.id}`, { method: "PATCH", body: editForm }), { message: "Company updated." });
          }}
        />
      </BottomSheet>
      <ConfirmSheet
        open={sheet === "deleteCompany" && Boolean(selectedCompany)}
        title="Delete company?"
        body={`Delete ${selectedCompany?.name || "this company"} if it has no inventory or assigned users.`}
        actionLabel="Delete"
        destructive
        onClose={() => setSheet("companyDetail")}
        onConfirm={() => {
          const company = selectedCompany;
          setSheet(null);
          runAction("Delete company", () => api(`warehouses/${company.id}`, { method: "DELETE" }), { message: "Company deleted." });
        }}
      />
    </div>
  );
}

function CategoriesScreen({ data, api, runAction }) {
  const [form, setForm] = useState({ companyId: data.warehouses[0]?.id || "", code: "", branchIds: [] });
  const [editForm, setEditForm] = useState({ companyId: "", categoryId: "", code: "", branchIds: [] });
  const [sheet, setSheet] = useState(null);
  const selected = data.warehouses.find((company) => company.id === form.companyId) || data.warehouses[0];
  const editCompany = data.warehouses.find((company) => company.id === editForm.companyId);
  const editingCategory = editCompany?.categories?.find((category) => category.id === editForm.categoryId);

  function openCategory(company, category) {
    setEditForm({
      companyId: company.id,
      categoryId: category.id,
      code: category.code || "",
      branchIds: category.branchIds || []
    });
    setSheet("edit");
  }

  return (
    <div className="space-y-4">
      <ActionButton label="Add category" icon={Plus} onClick={() => setSheet("add")} />
      <BottomSheet open={sheet === "add"} title="Add category" onClose={() => setSheet(null)}>
        <SelectInput label="Company" value={form.companyId} onChange={(value) => setForm({ ...form, companyId: value, branchIds: [] })} options={data.warehouses.map((company) => ({ value: company.id, label: company.name }))} />
        <FormInput label="Category code" value={form.code} onChange={(value) => setForm({ ...form, code: value.toUpperCase() })} />
        <MultiSelectInput label="Branch scope" values={form.branchIds} onChange={(branchIds) => setForm({ ...form, branchIds })} options={(selected?.branches || []).map((branch) => ({ value: branch.id, label: branch.name }))} />
        <ActionButton label="Create" onClick={() => {
          setSheet(null);
          runAction("Create category", () => api(`warehouses/${form.companyId}/categories`, { method: "POST", body: form }), { message: "Category created." });
          setForm({ companyId: data.warehouses[0]?.id || "", code: "", branchIds: [] });
        }} />
      </BottomSheet>
      <BottomSheet open={sheet === "edit" && Boolean(editingCategory)} title={`Edit ${editingCategory?.code || "Category"}`} onClose={() => setSheet(null)}>
        {editingCategory && (
          <div className="space-y-3">
            <FormInput label="Category code" value={editForm.code} onChange={(value) => setEditForm({ ...editForm, code: value.toUpperCase() })} />
            <MultiSelectInput label="Branch scope" values={editForm.branchIds} onChange={(branchIds) => setEditForm({ ...editForm, branchIds })} options={(editCompany?.branches || []).map((branch) => ({ value: branch.id, label: branch.name }))} />
            <div className="grid grid-cols-2 gap-2">
              <ActionButton
                label="Save"
                onClick={() => {
                  setSheet(null);
                  runAction("Edit category", () => api(`warehouses/${editForm.companyId}/categories/${editForm.categoryId}`, {
                    method: "PATCH",
                    body: { code: editForm.code, branchIds: editForm.branchIds }
                  }), { message: "Category updated." });
                }}
              />
              <ActionButton label="Delete" tone="danger" icon={Trash2} onClick={() => setSheet("delete")} />
            </div>
          </div>
        )}
      </BottomSheet>
      <ConfirmSheet
        open={sheet === "delete" && Boolean(editingCategory)}
        title="Delete category?"
        body={`Delete ${editingCategory?.code || "this category"} if no SKU still uses it.`}
        actionLabel="Delete"
        destructive
        onClose={() => setSheet("edit")}
        onConfirm={() => {
          const current = editForm;
          setSheet(null);
          runAction("Delete category", () => api(`warehouses/${current.companyId}/categories/${current.categoryId}`, { method: "DELETE" }), { message: "Category deleted." });
        }}
      />
      {data.warehouses.map((company) => (
        <GlassPanel key={company.id}>
          <p className="text-lg font-semibold">{company.name}</p>
          <div className="mt-3 grid gap-2">
            {(company.categories || []).map((category) => (
              <button key={category.id} type="button" onClick={() => openCategory(company, category)} className="rounded-[8px] border border-white/10 bg-white/[0.035] p-3 text-left">
                <div className="flex items-center justify-between gap-3">
                  <StatusBadge value={category.code} />
                  <ChevronLeft className="size-4 rotate-180 text-white/32" />
                </div>
                <p className="mt-2 text-xs text-white/42">
                  {(category.branchIds || []).length
                    ? `${category.branchIds.length} branch${category.branchIds.length > 1 ? "es" : ""}`
                    : "All branches"}
                </p>
              </button>
            ))}
          </div>
        </GlassPanel>
      ))}
    </div>
  );
}

function RecordsScreen({ data }) {
  return <RecordList records={data.records || []} emptyTitle="No records" />;
}

function UsersScreen({ data, api, runAction }) {
  const [form, setForm] = useState({ username: "", name: "", password: "", role: "staff", phone: "", phoneCountryCode: "+86", email: "", warehouseIds: [], branchIds: [] });
  const [editForm, setEditForm] = useState({ name: "", role: "staff", phone: "", phoneCountryCode: "+86", email: "" });
  const [sheet, setSheet] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  async function createUser() {
    await runAction("Create user", () => api("users", { method: "POST", body: compactObject(form) }), { message: "User created." });
    setForm({ username: "", name: "", password: "", role: "staff", phone: "", phoneCountryCode: "+86", email: "", warehouseIds: [], branchIds: [] });
  }
  function openUser(user) {
    setSelectedUser(user);
    setEditForm({
      name: user.name || "",
      role: user.role || "staff",
      phone: user.phone || "",
      phoneCountryCode: user.phoneCountryCode || "+86",
      email: user.email || ""
    });
    setSheet("detail");
  }
  const selectedBorrowedCount = selectedUser
    ? (data.skus || []).filter((sku) => sku.borrowedByUserId === selectedUser.id).length
    : 0;
  return (
    <div className="space-y-4">
      <GlassPanel>
        <SectionTitle title="Add user" compact />
        <FormInput label="Employee ID" value={form.username} onChange={(value) => setForm({ ...form, username: value })} />
        <FormInput label="Name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} />
        <FormInput type="password" label="Initial password (optional)" value={form.password} onChange={(value) => setForm({ ...form, password: value })} />
        <SelectInput label="Role" value={form.role} onChange={(value) => setForm({ ...form, role: value })} options={["staff", "warehouse_manager", "admin", "superadmin"].map((role) => ({ value: role, label: ROLE_LABELS[role] }))} />
        <FormInput label="Phone" value={form.phone} onChange={(value) => setForm({ ...form, phone: value })} />
        <FormInput label="Email" value={form.email} onChange={(value) => setForm({ ...form, email: value })} />
        <ActionButton label="Create user" onClick={createUser} />
      </GlassPanel>
      {(data.users || []).map((user) => (
        <button key={user.id} type="button" onClick={() => openUser(user)} className="w-full text-left">
          <GlassPanel>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-semibold">{user.name}</p>
                <p className="mt-1 text-sm text-white/46">{user.username} · {ROLE_LABELS[user.role] || user.role}</p>
                {user.isDisabled && <p className="mt-2 text-xs text-red-100">Disabled</p>}
              </div>
              <StatusBadge value={user.passwordResetRequired ? "reset required" : "active"} />
            </div>
          </GlassPanel>
        </button>
      ))}

      <BottomSheet open={sheet === "detail" && selectedUser} title={selectedUser?.name || "User"} onClose={() => setSheet(null)}>
        {selectedUser && (
          <div className="space-y-4">
            <InfoTile label="Employee ID" value={selectedUser.username} />
            <InfoTile label="Role" value={ROLE_LABELS[selectedUser.role] || selectedUser.role} />
            <InfoTile label="Phone" value={[selectedUser.phoneCountryCode, selectedUser.phone].filter(Boolean).join(" ") || "Not set"} />
            <InfoTile label="Email" value={selectedUser.email || "Not set"} />
            {selectedBorrowedCount > 0 && <InfoTile label="Borrowed items" value={`${selectedBorrowedCount} item${selectedBorrowedCount > 1 ? "s" : ""} must be returned before disabling.`} />}
            <ActionButton label="Edit user" tone="dark" icon={Pencil} onClick={() => setSheet("edit")} />
            <div className="grid grid-cols-2 gap-2">
              <ActionButton label="Reset" tone="dark" icon={KeyRound} onClick={() => setSheet("reset")} />
              <ActionButton
                label={selectedUser.isDisabled ? "Resume" : "Disable"}
                tone={selectedUser.isDisabled ? "dark" : "danger"}
                icon={selectedUser.isDisabled ? Check : X}
                disabled={!selectedUser.isDisabled && selectedBorrowedCount > 0}
                onClick={() => setSheet(selectedUser.isDisabled ? "resume" : "disable")}
              />
            </div>
          </div>
        )}
      </BottomSheet>

      <BottomSheet open={sheet === "edit" && Boolean(selectedUser)} title="Edit user" onClose={() => setSheet("detail")}>
        <FormInput label="Name" value={editForm.name} onChange={(value) => setEditForm({ ...editForm, name: value })} />
        <SelectInput label="Role" value={editForm.role} onChange={(value) => setEditForm({ ...editForm, role: value })} options={["staff", "warehouse_manager", "admin", "superadmin"].map((role) => ({ value: role, label: ROLE_LABELS[role] }))} />
        <FormInput label="Phone country code" value={editForm.phoneCountryCode} onChange={(value) => setEditForm({ ...editForm, phoneCountryCode: value })} />
        <FormInput label="Phone" value={editForm.phone} onChange={(value) => setEditForm({ ...editForm, phone: value })} />
        <FormInput label="Email" value={editForm.email} onChange={(value) => setEditForm({ ...editForm, email: value })} />
        <ActionButton
          label="Save user"
          onClick={() => {
            const user = selectedUser;
            setSheet(null);
            runAction("Edit user", () => api(`users/${user.id}`, { method: "PATCH", body: compactObject(editForm) }), { message: "User updated." });
          }}
        />
      </BottomSheet>

      <ConfirmSheet
        open={sheet === "reset"}
        title="Reset password?"
        body={`Require ${selectedUser?.name || "this user"} to register a new password next login.`}
        actionLabel="Reset Password"
        destructive
        onClose={() => setSheet("detail")}
        onConfirm={() => {
          const user = selectedUser;
          setSheet(null);
          runAction("Reset password", () => api(`users/${user.id}/reset-password-required`, { method: "POST", body: {} }), { message: "Password reset required." });
        }}
      />
      <ConfirmSheet
        open={sheet === "disable"}
        title="Disable user?"
        body={selectedBorrowedCount > 0 ? `${selectedUser?.name || "This user"} still has borrowed equipment.` : `Disable ${selectedUser?.name || "this user"} and clear active sessions.`}
        actionLabel="Disable"
        destructive
        onClose={() => setSheet("detail")}
        onConfirm={() => {
          const user = selectedUser;
          setSheet(null);
          runAction("Disable user", () => api(`users/${user.id}/disable`, { method: "PATCH", body: {} }), { message: "User disabled." });
        }}
      />
      <ConfirmSheet
        open={sheet === "resume"}
        title="Resume user?"
        body={`Resume ${selectedUser?.name || "this user"} account access.`}
        actionLabel="Resume"
        onClose={() => setSheet("detail")}
        onConfirm={() => {
          const user = selectedUser;
          setSheet(null);
          runAction("Resume user", () => api(`users/${user.id}/resume`, { method: "PATCH", body: {} }), { message: "User resumed." });
        }}
      />
    </div>
  );
}

function UserLogsScreen({ data }) {
  const logs = data.userLogs || [];
  return logs.length === 0 ? (
    <EmptyPanel icon={FileClock} title="No user logs" body="Security and admin actions will appear here." />
  ) : (
    <div className="space-y-2">
      {logs.map((log, index) => (
        <GlassPanel key={log.id || index}>
          <p className="text-sm font-semibold">{log.action || log.type || "Log"}</p>
          <p className="mt-2 text-sm leading-5 text-white/56">{log.message || log.summary || log.targetType || "Recorded action"}</p>
          <p className="mt-3 text-xs text-white/34">{formatDateTime(log.createdAt)}</p>
        </GlassPanel>
      ))}
    </div>
  );
}

function PingAlertsScreen({ data, api, runAction }) {
  const superadmins = (data.users || []).filter((user) => user.role === "superadmin" && user.email);
  const [selected, setSelected] = useState(data.pingAlerts?.recipientUserIds || []);
  function toggle(id) {
    setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }
  return (
    <div className="space-y-4">
      <GlassPanel>
        <p className="text-xl font-semibold">Backend alert recipients</p>
        <p className="mt-2 text-sm leading-5 text-white/48">Superadmins with email can receive node down/up alerts.</p>
      </GlassPanel>
      {superadmins.map((user) => (
        <button key={user.id} type="button" onClick={() => toggle(user.id)} className="w-full text-left">
          <GlassPanel>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold">{user.name}</p>
                <p className="mt-1 text-sm text-white/46">{user.email}</p>
              </div>
              {selected.includes(user.id) && <Check className="size-5 text-emerald-200" />}
            </div>
          </GlassPanel>
        </button>
      ))}
      <ActionButton label="Save recipients" onClick={() => runAction("Ping alerts", () => api("ping-alerts", { method: "PATCH", body: { recipientUserIds: selected } }), { message: "Ping alert recipients saved." })} />
    </div>
  );
}

function SmtpScreen({ api, runAction }) {
  const [smtp, setSmtp] = useState({ enabled: false, host: "", port: 587, secure: false, username: "", password: "", fromName: "", fromAddress: "" });
  const [testTo, setTestTo] = useState("");
  useEffect(() => {
    api("notification-settings").then((res) => setSmtp({ ...smtp, ...(res.notificationSettings?.smtp || {}) })).catch(() => {});
  }, []);
  return (
    <div className="space-y-4">
      <GlassPanel>
        <SectionTitle title="SMTP settings" compact />
        <ToggleInput label="Email alerts" checked={smtp.enabled} onChange={(enabled) => setSmtp({ ...smtp, enabled })} />
        <FormInput label="Host" value={smtp.host} onChange={(value) => setSmtp({ ...smtp, host: value })} />
        <FormInput label="Port" value={String(smtp.port || "")} onChange={(value) => setSmtp({ ...smtp, port: Number(value) || 587 })} />
        <ToggleInput label="Secure" checked={smtp.secure} onChange={(secure) => setSmtp({ ...smtp, secure })} />
        <FormInput label="Username" value={smtp.username} onChange={(value) => setSmtp({ ...smtp, username: value })} />
        <FormInput type="password" label="Password" value={smtp.password} onChange={(value) => setSmtp({ ...smtp, password: value })} />
        <FormInput label="From name" value={smtp.fromName} onChange={(value) => setSmtp({ ...smtp, fromName: value })} />
        <FormInput label="From address" value={smtp.fromAddress} onChange={(value) => setSmtp({ ...smtp, fromAddress: value })} />
        <ActionButton label="Save SMTP" onClick={() => runAction("SMTP", () => api("notification-settings", { method: "PATCH", body: { smtp } }), { message: "SMTP settings saved." })} />
      </GlassPanel>
      <GlassPanel>
        <SectionTitle title="Test email" compact />
        <FormInput label="Recipient email" value={testTo} onChange={setTestTo} />
        <ActionButton label="Send test" tone="dark" onClick={() => runAction("SMTP test", () => api("notification-settings/smtp-test", { method: "POST", body: { to: testTo } }), { message: "SMTP test completed." })} />
      </GlassPanel>
    </div>
  );
}

function RecordList({ records, emptyTitle }) {
  return records.length === 0 ? (
    <EmptyPanel icon={ClipboardList} title={emptyTitle} body="Records will appear after inventory actions." />
  ) : (
    <div className="space-y-2">
      {records.map((record) => (
        <GlassPanel key={record.id}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-lg font-semibold uppercase">{record.type === "return_after_repair" ? "REPAIRED" : record.type}</p>
              <p className="mt-1 text-sm text-white/56">{record.skuCode || record.serialNumber || record.note || "Inventory record"}</p>
            </div>
            <p className="shrink-0 text-right text-xs leading-5 text-white/34">{formatDateShort(record.createdAt)}</p>
          </div>
        </GlassPanel>
      ))}
    </div>
  );
}

function SkuForm({ form, setForm, data }) {
  const warehouses = data.warehouses || [];
  const selectedCompany = warehouses.find((company) => company.id === form.warehouseId) || warehouses[0];
  const branches = selectedCompany?.branches || [];
  const selectedBranch = branches.find((branch) => branch.id === form.branchId) || branches[0];
  const categories = selectedCompany?.categories || [];
  const locations = selectedBranch?.locations || [];
  return (
    <div className="space-y-3">
      <SelectInput label="Company" value={form.warehouseId} onChange={(value) => setForm({ ...form, warehouseId: value, branchId: "", categoryId: "", locationId: "" })} options={warehouses.map((company) => ({ value: company.id, label: company.name }))} />
      <SelectInput label="Branch" value={form.branchId} onChange={(value) => setForm({ ...form, branchId: value, locationId: "" })} options={branches.map((branch) => ({ value: branch.id, label: branch.name }))} />
      <SelectInput label="Category" value={form.categoryId} onChange={(value) => setForm({ ...form, categoryId: value })} options={categories.map((category) => ({ value: category.id, label: category.code }))} />
      <SelectInput label="Location" value={form.locationId} onChange={(value) => setForm({ ...form, locationId: value })} options={locations.map((location) => ({ value: location.id, label: location.name }))} optional />
      <FormInput label="SKU number / code" value={form.skuNumber} onChange={(value) => setForm({ ...form, skuNumber: value.toUpperCase() })} />
      <FormInput label="Description" value={form.descriptionText} onChange={(value) => setForm({ ...form, descriptionText: value })} />
      <FormInput label="Serial number" value={form.serialNumber} onChange={(value) => setForm({ ...form, serialNumber: value })} />
    </div>
  );
}

function InventoryBackdrop() {
  return (
    <div className="absolute inset-0">
      <video className="h-full w-full object-cover opacity-28 saturate-[.78] contrast-125" autoPlay muted loop playsInline>
        <source src="/status-cinematic.mp4" type="video/mp4" />
        <source src="https://videos.pexels.com/video-files/7565437/7565437-uhd_2560_1440_25fps.mp4" type="video/mp4" />
      </video>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,.16),transparent_18%),linear-gradient(180deg,rgba(0,0,0,.12),#030303_80%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,.035)_1px,transparent_1px),linear-gradient(rgba(255,255,255,.026)_1px,transparent_1px)] bg-[size:58px_58px] opacity-18" />
    </div>
  );
}

function ConnectionBar({ state, apiBaseUrl }) {
  if (state === "connected") return null;
  const routeLabel = String(apiBaseUrl || "").startsWith("/") ? "Cloudflare Hong Kong" : new URL(apiBaseUrl).hostname;
  return (
    <div className={`mx-auto mt-3 max-w-[430px] rounded-full px-3 py-2 text-xs font-semibold ${state === "lost" ? "bg-red-400 text-black" : "bg-white/10 text-white/62"}`}>
      {state === "lost" ? "Lost connection — Cloudflare Hong Kong" : `Connecting — ${routeLabel}`}
    </div>
  );
}

function GlassPanel({ children }) {
  return (
    <div className="rounded-[8px] border border-white/10 bg-black/34 p-4 shadow-glass backdrop-blur-2xl">
      {children}
    </div>
  );
}

function EmptyPanel({ icon: Icon, title, body, spinning = false }) {
  return (
    <GlassPanel>
      <div className="py-8 text-center">
        <Icon className={`mx-auto size-8 text-white/42 ${spinning ? "animate-spin" : ""}`} />
        <p className="mt-4 text-xl font-semibold">{title}</p>
        <p className="mx-auto mt-2 max-w-[260px] text-sm leading-5 text-white/48">{body}</p>
      </div>
    </GlassPanel>
  );
}

function Metric({ title, value }) {
  return (
    <div className="rounded-[8px] border border-white/10 bg-white/[0.035] p-3">
      <p className="text-xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-white/44">{title}</p>
    </div>
  );
}

function SectionTitle({ title, compact = false }) {
  return <p className={`${compact ? "mb-3" : ""} text-xs font-semibold uppercase tracking-[0.18em] text-white/38`}>{title}</p>;
}

function ListButton({ icon: Icon, title, subtitle, onClick }) {
  return (
    <button type="button" onClick={onClick} className="w-full text-left">
      <GlassPanel>
        <div className="flex items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full border border-white/10 bg-white/[0.04]">
            <Icon className="size-4 text-white/62" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{title}</p>
            <p className="mt-1 truncate text-sm text-white/42">{subtitle}</p>
          </div>
          <ChevronLeft className="size-4 rotate-180 text-white/32" />
        </div>
      </GlassPanel>
    </button>
  );
}

function SkuCard({ sku, date, onClick }) {
  const body = (
    <GlassPanel>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <StatusBadge value={sku.status} />
          <p className="mt-3 truncate text-xl font-semibold">{displaySkuCode(sku)}</p>
          <p className="mt-1 line-clamp-2 text-sm leading-5 text-white/52">{sku.descriptionText || sku.serialNumber || "No description"}</p>
          <p className="mt-2 truncate text-xs text-white/34">{[sku.companyName, sku.parkName, sku.locationName].filter(Boolean).join(" · ")}</p>
          {date && <p className="mt-2 text-xs text-white/34">{formatDateTime(date)} · {elapsedFrom(date)}</p>}
        </div>
      </div>
    </GlassPanel>
  );
  return onClick ? <button type="button" onClick={onClick} className="w-full text-left">{body}</button> : body;
}

function StatusBadge({ value }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold capitalize ${STATUS_TONE[value] || "border-white/10 bg-white/[0.04] text-white/54"}`}>
      {String(value || "unknown").replaceAll("_", " ")}
    </span>
  );
}

function InfoTile({ label, value }) {
  return (
    <div className="rounded-[8px] border border-white/10 bg-white/[0.035] p-3">
      <p className="text-xs text-white/38">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-white/78">{value}</p>
    </div>
  );
}

function DetailRow({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex gap-4 border-t border-white/8 py-3 text-sm first:border-t-0">
      <p className="w-24 shrink-0 text-white/38">{label}</p>
      <p className="min-w-0 flex-1 text-right text-white/74">{value}</p>
    </div>
  );
}

function ActionButton({ label, onClick, tone = "light", icon: Icon, disabled = false }) {
  const toneClass = tone === "light"
    ? "bg-white text-black hover:bg-white/90"
    : tone === "danger"
      ? "border border-red-200/20 bg-red-300/10 text-red-100 hover:bg-red-300/15"
      : "border border-white/12 bg-white/[0.04] text-white/72 hover:bg-white/10";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-11 w-full items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-45 ${toneClass}`}
    >
      {Icon && <Icon className="size-4" />}
      {label}
    </button>
  );
}

function FormInput({ label, value, onChange, type = "text" }) {
  return (
    <label className="mb-3 block">
      <span className="text-xs font-semibold text-white/38">{label}</span>
      <input
        type={type}
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 h-11 w-full rounded-[8px] border border-white/10 bg-white/[0.035] px-3 text-sm text-white outline-none placeholder:text-white/28"
      />
    </label>
  );
}

function SelectInput({ label, value, onChange, options, optional = false }) {
  return (
    <label className="mb-3 block">
      <span className="text-xs font-semibold text-white/38">{label}</span>
      <select
        value={value || ""}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 h-11 w-full rounded-[8px] border border-white/10 bg-black/70 px-3 text-sm text-white outline-none"
      >
        {optional && <option value="">None</option>}
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function MultiSelectInput({ label, values = [], onChange, options }) {
  function toggle(value) {
    onChange(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]);
  }
  return (
    <div className="mb-3">
      <p className="text-xs font-semibold text-white/38">{label}</p>
      <div className="mt-2 grid gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => toggle(option.value)}
            className={`flex min-h-11 items-center justify-between rounded-[8px] border px-3 text-left text-sm transition ${values.includes(option.value) ? "border-emerald-200/30 bg-emerald-300/10 text-emerald-100" : "border-white/10 bg-white/[0.035] text-white/72"}`}
          >
            <span>{option.label}</span>
            {values.includes(option.value) && <Check className="size-4" />}
          </button>
        ))}
      </div>
    </div>
  );
}

function ToggleInput({ label, checked, onChange }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="mb-3 flex h-11 w-full items-center justify-between rounded-[8px] border border-white/10 bg-white/[0.035] px-3 text-sm">
      <span className="text-white/72">{label}</span>
      <span className={`h-6 w-11 rounded-full p-1 transition ${checked ? "bg-emerald-300" : "bg-white/14"}`}>
        <span className={`block size-4 rounded-full bg-black transition ${checked ? "translate-x-5" : ""}`} />
      </span>
    </button>
  );
}

function SearchBox({ value, onChange, placeholder }) {
  return (
    <div className="flex h-12 items-center gap-3 rounded-[8px] border border-white/10 bg-black/34 px-4 shadow-glass backdrop-blur-2xl">
      <Search className="size-4 text-white/42" />
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-white/32" />
    </div>
  );
}

function normalizeBootstrap(bootstrap, fallbackUser) {
  const base = bootstrap || {};
  const skus = base.skus || [];
  const userObjectId = getBackendUserObjectId(base.currentUser) || getBackendUserObjectId(fallbackUser);
  const role = base.currentUser?.role || fallbackUser?.role;
  const canSeeAllRepairing = ["superadmin", "admin", "warehouse_manager"].includes(role);
  return {
    currentUser: base.currentUser || fallbackUser || null,
    permissions: base.permissions || {},
    warehouses: base.warehouses || [],
    skus,
    users: base.users || [],
    records: base.records || [],
    notifications: base.notifications || [],
    userLogs: base.userLogs || [],
    pingAlerts: base.pingAlerts || {},
    borrowedItems: skus.filter((sku) => sku.status === "borrowed" && sku.borrowedByUserId === userObjectId),
    repairingItems: skus.filter((sku) => sku.status === "repairing" && (canSeeAllRepairing || sku.repairRequestedByUserId === userObjectId))
  };
}

function displaySkuCode(sku) {
  return sku?.skuCode || sku?.skuNumber || "";
}

function extractSKUCode(value) {
  const up = String(value || "").trim().toUpperCase();
  const match = up.match(/[A-Z0-9]+-[A-Z0-9]+-\d{4}/);
  return match?.[0] || (up.match(/^[A-Z0-9]+-[A-Z0-9]+-\d{4}$/) ? up : null);
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatDateShort(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function elapsedFrom(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m`;
  return `${seconds}s`;
}

function shortcutSubtitle(id, data) {
  if (id === "inventory") return `${data.skus.length} SKUs`;
  if (id === "companies") return `${data.warehouses.length} companies`;
  if (id === "categories") return `${data.warehouses.reduce((sum, company) => sum + (company.categories || []).length, 0)} categories`;
  if (id === "records" || id === "recent") return `${data.records.length} records`;
  if (id === "users") return `${(data.users || []).length} users`;
  if (id === "userLogs") return `${(data.userLogs || []).length} logs`;
  if (id === "pingAlerts") return `${(data.pingAlerts?.recipientUserIds || []).length} recipients`;
  return "Settings";
}

function branchList(data) {
  return (data.warehouses || []).flatMap((company) => (company.branches || []).map((branch) => ({
    ...branch,
    warehouseId: company.id,
    companyCode: company.code,
    companyName: company.name
  })));
}

function emptySkuForm(data) {
  const company = data.warehouses?.[0];
  const branch = company?.branches?.[0];
  const category = company?.categories?.[0];
  return {
    warehouseId: company?.id || "",
    branchId: branch?.id || "",
    categoryId: category?.id || "",
    locationId: "",
    skuNumber: "",
    descriptionText: "",
    serialNumber: ""
  };
}

function compactObject(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== "" && value != null));
}

export default InventoryMobileApp;
