const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const PORT = Number(process.env.WEB_PORT || 5173);
const API_TARGET = process.env.API_TARGET || "http://127.0.0.1:4000";
const WEB_ROOT = process.env.WEB_ROOT || path.join(__dirname, "..", "public");

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json"
};

function proxyApi(req, res) {
  const target = new URL(req.url, API_TARGET);
  // CF-Connecting-IP is set by cloudflared/Cloudflare and contains the real client IP
  const realIp = req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress || "";
  const forwardedFor = realIp;
  const proxyReq = http.request(
    target,
    {
      method: req.method,
      headers: {
        ...req.headers,
        host: target.host,
        "x-forwarded-for": forwardedFor,
        "x-forwarded-host": req.headers.host || "",
        "x-forwarded-proto": "https"
      }
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on("error", () => {
    res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "API gateway could not reach backend.", code: "bad_gateway" }));
  });

  req.pipe(proxyReq);
}

function sendStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const decodedPath = decodeURIComponent(url.pathname);
  const requestedPath = decodedPath === "/" ? "/index.html" : decodedPath;
  const filePath = path.normalize(path.join(WEB_ROOT, requestedPath));
  const rootPath = path.normalize(WEB_ROOT);

  if (!filePath.startsWith(rootPath)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (!err) {
      res.writeHead(200, { "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream" });
      res.end(data);
      return;
    }

    fs.readFile(path.join(WEB_ROOT, "index.html"), (fallbackErr, fallbackData) => {
      if (!fallbackErr) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(fallbackData);
        return;
      }

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Inventory</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #111; color: #f5f5f7; }
    main { max-width: 560px; padding: 32px; }
    h1 { margin: 0 0 12px; font-size: 40px; }
    p { color: #a1a1aa; line-height: 1.5; }
    code { color: #7dd3fc; }
  </style>
</head>
<body>
  <main>
    <h1>Inventory</h1>
    <p>The single-port gateway is running on <code>:5173</code>. Put the web frontend build into <code>${WEB_ROOT}</code>; API requests under <code>/api</code> are proxied to <code>${API_TARGET}</code>.</p>
  </main>
</body>
</html>`);
    });
  });
}

http
  .createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ ok: true, service: "inventory-borrowing-gateway", apiTarget: API_TARGET }));
      return;
    }

    if (req.url === "/api" || req.url.startsWith("/api/")) {
      proxyApi(req, res);
      return;
    }

    sendStatic(req, res);
  })
  .listen(PORT, () => {
    console.log(`Inventory gateway listening on http://localhost:${PORT}`);
    console.log(`Proxying /api to ${API_TARGET}`);
    console.log(`Serving web root ${WEB_ROOT}`);
  });
