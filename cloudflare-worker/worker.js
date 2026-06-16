// Cloudflare Worker for the Inventory web SPA (production).
//
// Serves the static SPA from Cloudflare's edge for overseas users and proxies
// same-origin /api/* to the production Cloudflare backend. The visitor's real
// country (request.cf.country) is forwarded as CF-IPCountry so the backend's
// geolocation logic (node gating + per-operation logging) sees the end user.
const BACKEND = "https://inventory-cloudflare.wuchunkei.com";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      const target = BACKEND + url.pathname + url.search;
      const headers = new Headers(request.headers);
      const country = request.cf && request.cf.country;
      if (country) headers.set("CF-IPCountry", country);
      const realIp = request.headers.get("cf-connecting-ip");
      if (realIp) headers.set("X-Real-IP", realIp);
      headers.set("Host", new URL(BACKEND).host);
      const init = { method: request.method, headers, redirect: "manual" };
      if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;
      return fetch(target, init);
    }
    return env.ASSETS.fetch(request);
  },
};
