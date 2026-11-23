const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const PORT = Number(process.env.PORT || 8080);
const PUBLIC_DIR = path.resolve(__dirname, "public");

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin"
  });
  res.end(JSON.stringify(payload));
}

function safePublicPath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const resolved = path.resolve(PUBLIC_DIR, relative);
  if (resolved !== PUBLIC_DIR && !resolved.startsWith(PUBLIC_DIR + path.sep)) {
    return null;
  }
  return resolved;
}

function servePublicFile(req, res, urlPath) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  const filePath = safePublicPath(urlPath);
  if (!filePath) return sendJson(res, 400, { error: "Invalid path." });

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === "ENOENT" || error.code === "EISDIR") {
        return sendJson(res, 404, { error: "Not found." });
      }
      console.error("Static file read failed:", error.message);
      return sendJson(res, 500, { error: "Could not read the requested file." });
    }

    const extension = path.extname(filePath).toLowerCase();
    const cacheControl =
      urlPath === "/" || extension === ".html" || urlPath === "/sw.js"
        ? "no-cache"
        : extension === ".webmanifest"
          ? "public, max-age=3600"
          : "public, max-age=86400";

    res.writeHead(200, {
      "content-type": CONTENT_TYPES[extension] || "application/octet-stream",
      "cache-control": cacheControl,
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://speed.cloudflare.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    });
    if (req.method === "HEAD") return res.end();
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  } catch {
    return sendJson(res, 400, { error: "Invalid request URL." });
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, { "cache-control": "no-store" });
    return res.end();
  }

  if (url.pathname === "/health") {
    return sendJson(res, 200, {
      ok: true,
      service: "Expert eSIM",
      mode: "one-button-esim-control"
    });
  }

  if (url.pathname === "/api/status" && req.method === "GET") {
    return sendJson(res, 200, {
      service: "Expert eSIM",
      mode: "one-button-esim-control",
      countryCatalogueEnabled: false,
      primaryAction: "connect-disconnect",
      speedTest: "Cloudflare edge measurement",
      nativeAndroidControl: "required",
      eSimProvider: "not-configured",
      eSimProfile: "not-issued",
      cellularDataProvisioning: "not-active",
      connected: false
    });
  }

  if (url.pathname === "/api/esim/status" && req.method === "GET") {
    return sendJson(res, 200, {
      ok: true,
      connected: false,
      nativeAndroidControlRequired: true,
      providerConfigured: false,
      profileIssued: false,
      message: "A real eSIM provider and an issued profile are required before Expert eSIM can connect."
    });
  }

  if (url.pathname === "/api/esim/connect" && req.method === "POST") {
    return sendJson(res, 503, {
      ok: false,
      connected: false,
      code: "ESIM_PROVIDER_NOT_CONFIGURED",
      message: "Expert eSIM is not connected yet. A mobile-network provider must issue an eSIM profile, and the native Android app must complete activation."
    });
  }

  if (url.pathname === "/api/esim/disconnect" && req.method === "POST") {
    return sendJson(res, 409, {
      ok: false,
      connected: false,
      code: "NO_ACTIVE_EXPERT_ESIM_SESSION",
      message: "There is no active Expert eSIM session to disconnect from this web app."
    });
  }

  return servePublicFile(req, res, url.pathname);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Expert eSIM listening on port " + PORT + " (one-button eSIM control)");
});

server.on("error", (error) => {
  console.error("Expert eSIM server error:", error.message);
  process.exitCode = 1;
});
