const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const testStatePath = path.join(os.tmpdir(), `inventory-api-test-${Date.now()}.json`);
process.env.STATE_FILE = testStatePath;

const { requestListener } = require("../src/server");

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer(requestListener);
    server.listen(0, () => resolve(server));
  });
}

function request(server, method, path, body, token, extraHeaders = {}) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : "";
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...extraHeaders
        }
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null });
        });
      }
    );
    req.on("error", reject);
    req.end(payload);
  });
}

test("login, bootstrap, lookup and borrow flow", async () => {
  const server = await startServer();
  try {
    const login = await request(server, "POST", "/api/login", { username: "admin", password: "admin" });
    assert.equal(login.status, 200);
    assert.ok(login.body.token);

    const bootstrap = await request(server, "GET", "/api/bootstrap", null, login.body.token);
    assert.equal(bootstrap.status, 200);
    assert.equal(bootstrap.body.currentUser.username, "admin");
    assert.ok(Array.isArray(bootstrap.body.skus));

    const scan = await request(server, "GET", "/api/scan/PWBJ-CAM-0001", null, login.body.token);
    assert.equal(scan.status, 200);
    assert.equal(scan.body.sku.status, "available");

    const borrow = await request(server, "POST", "/api/borrow", { skuNumber: "PWBJ-CAM-0001" }, login.body.token);
    assert.equal(borrow.status, 200);
    assert.equal(borrow.body.sku.status, "borrowed");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(testStatePath, { force: true });
  }
});

test("health reports Cloudflare edge node when cf-ray is present", async () => {
  const server = await startServer();
  try {
    const health = await request(server, "GET", "/api/health", null, null, {
      "cf-ray": "8f44c92a5d66a1b2-HKG"
    });
    assert.equal(health.status, 200);
    assert.equal(health.body.cloudflareNode.colo, "HKG");
    assert.equal(health.body.cloudflareNode.ray, "8f44c92a5d66a1b2-HKG");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(testStatePath, { force: true });
  }
});
