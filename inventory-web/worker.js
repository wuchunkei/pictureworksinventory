const API_ORIGIN = "https://inventory-cloudflare.wuchunkei.com";
const SESSION_COOKIE = "pwi_session";

function parseCloudflareColo(cfRay) {
  return String(cfRay || "").match(/-([a-z]{3})(?:\b|$)/i)?.[1]?.toUpperCase() || null;
}

function getCookie(request, name) {
  const cookie = request.headers.get("cookie") || "";
  return cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(name + "="))?.slice(name.length + 1) || "";
}

function sessionCookie(token, expiresAt) {
  const parts = [SESSION_COOKIE + "=" + encodeURIComponent(token), "Path=/", "HttpOnly", "Secure", "SameSite=Lax"];
  const expiry = expiresAt ? new Date(expiresAt) : null;
  if (expiry && !Number.isNaN(expiry.getTime())) parts.push("Expires=" + expiry.toUTCString());
  return parts.join("; ");
}

function clearSessionCookie() {
  return SESSION_COOKIE + "=; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT";
}

function authResponsePath(pathname) {
  return ["/api/login", "/api/register", "/api/reset-password", "/api/login/biometric"].includes(pathname);
}

async function proxyApi(request) {
  const target = new URL(request.url);
  target.protocol = "https:";
  target.hostname = new URL(API_ORIGIN).hostname;
  target.port = "";
  const headersIn = new Headers(request.headers);
  const cookieToken = getCookie(request, SESSION_COOKIE);
  if (cookieToken && !headersIn.has("authorization")) headersIn.set("Authorization", "Bearer " + decodeURIComponent(cookieToken));
  const upstream = await fetch(new Request(target.toString(), { method: request.method, headers: headersIn, body: request.body, redirect: "manual" }));
  const headers = new Headers(upstream.headers);
  const apiRay = upstream.headers.get("cf-ray");
  const apiColo = parseCloudflareColo(apiRay);
  if (apiRay) headers.set("X-API-CF-Ray", apiRay);
  if (apiColo) headers.set("X-API-CF-Colo", apiColo);
  headers.append("Access-Control-Expose-Headers", "CF-Ray, X-API-CF-Ray, X-API-CF-Colo");
  headers.delete("set-cookie");
  if (target.pathname === "/api/logout") headers.append("Set-Cookie", clearSessionCookie());
  const contentType = upstream.headers.get("content-type") || "";
  if (authResponsePath(target.pathname) && contentType.includes("application/json")) {
    const data = await upstream.json().catch(() => null);
    if (data?.token) {
      headers.append("Set-Cookie", sessionCookie(data.token, data.expiresAt));
      delete data.token;
    }
    return Response.json(data || {}, { status: upstream.status, statusText: upstream.statusText, headers });
  }
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
        service: "pictureworks-inventory-web",
        cloudflareNode: {
          colo: request.cf?.colo || null,
          ray: request.headers.get("cf-ray") || null
        },
        time: new Date().toISOString()
      });
    }

    const response = await env.ASSETS.fetch(request);
    if (response.status !== 404) return response;

    url.pathname = "/";
    return env.ASSETS.fetch(new Request(url, request));
  }
};
