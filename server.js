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
  if (!filePath) {
    return sendJson(res, 400, { error: "Invalid path." });
  }

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
      "permissions-policy": "camera=(), microphone=(), geolocation=()"
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
      mode: "unified-internet-experience"
    });
  }

  if (url.pathname === "/api/status") {
    const carrierPartnerConfigured = Boolean(
      process.env.CARRIER_CONNECTIVITY_API_URL &&
      process.env.CARRIER_CONNECTIVITY_API_KEY
    );
    return sendJson(res, 200, {
      service: "Expert eSIM",
      mode: "unified-internet-experience",
      countryCatalogueEnabled: false,
      internetBrowsing: "device-current-internet-connection",
      preferredNetwork: "saved-app-preference-only",
      speedTest: "Cloudflare edge measurement",
      carrierPartnerConfigured,
      cellularDataProvisioning: "not-connected",
      liveMobileDataService: false,
      note: "The web app can browse through the phone's active data or Wi-Fi connection. A carrier/wholesale partner must issue a real eSIM profile before Expert eSIM can provide its own cellular data service."
    });
  }

  return servePublicFile(req, res, url.pathname);
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Expert eSIM listening on port " + PORT + " (unified internet experience)");
});

server.on("error", (error) => {
  console.error("Expert eSIM server error:", error.message);
  process.exitCode = 1;
});
