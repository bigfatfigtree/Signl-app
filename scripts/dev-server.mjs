// Local development server for SIGNL.
// Serves public/ and runs the exact Netlify Function handler from
// netlify/functions/api.js against the file-backed local store.
// Usage: SIGNL_LOCAL=1 ADMIN_PASSWORD=... node scripts/dev-server.mjs [port]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

process.env.SIGNL_LOCAL = process.env.SIGNL_LOCAL || "1";
process.env.APP_URL = process.env.APP_URL || "http://localhost:8899";

const require = createRequire(import.meta.url);
const { handler } = require("../netlify/functions/api.js");

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(root, "public");
const port = parseInt(process.argv[2] || process.env.PORT || "8899", 10);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".ico": "image/x-icon",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  // Mirror the production netlify.toml /c/* rewrite: profile
  // paths are served by the api function, and Netlify hands the
  // function the ORIGINAL request path for a rewrite (verified
  // live 2026-10-23), so pass the pathname through untouched
  // and let the router tell page requests from API calls.
  if (url.pathname.startsWith("/c/")) {
    const event = {
      httpMethod: "GET",
      path: url.pathname,
      headers: req.headers,
      queryStringParameters: Object.fromEntries(url.searchParams.entries()),
      body: null,
      isBase64Encoded: false,
    };
    try {
      const out = await handler(event);
      res.writeHead(out.statusCode, out.headers || {});
      res.end(out.body || "");
    } catch (e) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(String(e));
    }
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const event = {
        httpMethod: req.method,
        path: url.pathname,
        headers: req.headers,
        queryStringParameters: Object.fromEntries(url.searchParams.entries()),
        body: chunks.length ? Buffer.concat(chunks).toString("utf8") : null,
        isBase64Encoded: false,
      };
      try {
        const out = await handler(event);
        res.writeHead(out.statusCode, out.headers || {});
        // Netlify honors isBase64Encoded (binary payloads like photos);
        // decode here so local behavior matches production.
        if (out.isBase64Encoded && out.body) res.end(Buffer.from(out.body, "base64"));
        else res.end(out.body || "");
      } catch (e) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    });
    return;
  }
  let filePath = path.join(publicDir, url.pathname === "/" ? "index.html" : url.pathname);
  if (!filePath.startsWith(publicDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(publicDir, "index.html"); // SPA fallback
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(port, () => {
  console.log(`SIGNL dev server on http://localhost:${port} (store: ${process.env.SIGNL_LOCAL_DB || ".localdb.json"})`);
});
