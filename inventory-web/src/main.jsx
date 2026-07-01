import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChevronDown } from "lucide-react";
import LoginPage, { clearAuth, getBackendUserObjectId, saveAuth, storedAuth, storedNodeUrl } from "./LoginPage.jsx";
import InventoryMobileApp from "./InventoryMobileApp.jsx";
import "./index.css";

function App() {
  const path = window.location.pathname;
  if (path === "/login" || path === "/login/") {
    return <LoginPage />;
  }
  if (isInventoryAppPath(path)) {
    return <InventoryHomeRoute />;
  }

  return <InventoryRoot />;
}

function isInventoryAppPath(path) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return false;
  if (["home", "search", "notify", "status", "me"].includes(parts[0])) return true;
  if (parts[0] === "u" && parts.length >= 3 && ["home", "search", "notify", "status", "me"].includes(parts[2])) return true;
  return parts.length >= 2 && ["home", "search", "notify", "status", "me"].includes(parts[1]);
}

function inventoryRouteParts(path) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return { legacy: true, view: "home" };
  if (["home", "search", "notify", "status", "me"].includes(parts[0])) {
    return { legacy: true, view: parts[0], rest: parts.slice(1) };
  }
  if (parts[0] === "u") {
    return { objectId: parts[1], view: parts[2] || "home", rest: parts.slice(3), hasPrefix: true };
  }
  return { objectId: parts[0], view: parts[1] || "home", rest: parts.slice(2) };
}

function InventoryHomeRoute() {
  const [session, setSession] = useState(() => storedAuth());
  const route = inventoryRouteParts(window.location.pathname);

  useEffect(() => {
    if (!session?.currentUser) {
      window.location.replace("/login");
      return;
    }
    const objectId = getBackendUserObjectId(session.currentUser);
    if (!objectId) {
      clearAuth();
      window.location.replace("/login");
      return;
    }
    if (route.legacy) {
      const suffix = [route.view, ...(route.rest || [])].join("/");
      window.location.replace(`/u/${objectId}/${suffix}`);
      return;
    }
    if (!route.hasPrefix) {
      const suffix = [route.view, ...(route.rest || [])].join("/");
      window.location.replace(`/u/${objectId}/${suffix}`);
      return;
    }
    if (route.objectId !== objectId) {
      clearAuth();
      window.location.replace("/login");
      return;
    }
    saveAuth(session);
  }, [session?.currentUser, route.objectId, route.legacy, route.view]);

  if (!session?.currentUser) {
    return (
      <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-black px-5 text-white">
        <BackgroundCinema />
        <div className="relative z-10 rounded-[8px] border border-white/10 bg-black/34 p-5 text-sm text-white/62 shadow-glass backdrop-blur-2xl">
          Redirecting to login...
        </div>
      </main>
    );
  }

  return (
    <InventoryMobileApp
      session={session}
      apiBaseUrl={session.apiBaseUrl || storedNodeUrl()}
      onLogout={async () => {
        try {
          await fetch("/api/logout", {
            method: "POST",
            cache: "no-store",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" }
          });
        } catch {
          // Local sign-out still proceeds even if the server cannot be reached.
        }
        clearAuth();
        setSession(null);
        window.location.replace("/login");
      }}
      onSessionUpdate={(nextSession) => {
        saveAuth(nextSession);
        setSession(nextSession);
      }}
    />
  );
}

function InventoryRoot() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-black text-white">
      <BackgroundCinema />
      <HomeNavigation />
      <section className="relative z-10 flex min-h-screen items-end px-5 pb-16 pt-32 sm:px-8 lg:px-12">
        <div className="mx-auto w-full max-w-7xl">
          <div className="max-w-3xl">
            <p className="mb-4 inline-flex rounded-full border border-white/12 bg-white/[0.045] px-4 py-2 text-xs font-medium text-white/62 backdrop-blur-xl">
              Pictureworks inventory system
            </p>
            <h1 className="font-serif text-6xl leading-[0.92] tracking-normal sm:text-7xl lg:text-8xl">
              Inventory,
              <br />
              under glass.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-white/58">
              A mobile-first web workspace for the Pictureworks inventory flow.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

function HomeNavigation() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="fixed inset-x-0 top-0 z-30 px-5 py-5 sm:px-8 lg:px-12">
      <div className="mx-auto flex max-w-7xl items-center justify-between rounded-full border border-white/10 bg-black/28 px-4 py-3 shadow-glass backdrop-blur-2xl">
        <a href="/" className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full border border-white/14 bg-white/8">
            <img src="/pictureworks-status-icon.svg" alt="" className="size-8" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium leading-none">Pictureworks Inventory</p>
            <p className="mt-1 text-xs text-white/46">Home Page</p>
          </div>
        </a>
        <nav className="hidden shrink-0 items-center gap-2 sm:flex">
          <a
            href="https://inventory-status.wuchunkei.com/"
            className="inline-flex h-9 items-center justify-center rounded-full border border-white/12 bg-white/[0.04] px-4 text-xs font-semibold text-white/72 transition hover:bg-white/10 hover:text-white"
          >
            Status
          </a>
          <a
            href="/login"
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
                href="https://inventory-status.wuchunkei.com/"
                className="flex h-10 items-center justify-center rounded-full border border-white/12 bg-white/[0.04] text-xs font-semibold text-white/76 transition hover:bg-white/10 hover:text-white"
              >
                Status
              </a>
              <a
                href="/login"
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

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
