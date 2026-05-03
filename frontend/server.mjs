/**
 * server.mjs — Lightweight HTTP server and static-file handler.
 *
 * All domain logic lives in the `server/` sub-modules:
 *   - server/qr-archive.mjs     QR archive creation, status, download, preview
 *   - server/on-chain-status.mjs On-chain root status proxy
 *   - server/merkle.mjs          Server-side Merkle utilities
 *   - server/qr-render-pool.mjs  Worker-thread QR render pool
 *   - server/zip-writer.mjs      Minimal streaming ZIP writer
 *   - server/http-utils.mjs      Shared HTTP helpers
 */

import "dotenv/config";
import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import { networkInterfaces } from "node:os";
import { extname, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { APP_CONFIG } from "./config.js";
import { handleOnChainRootStatusRequest } from "./server/on-chain-status.mjs";
import {
  handleQrArchiveDownloadRequest,
  handleQrArchiveRequest,
  handleQrArchiveStatusRequest,
  handleQrPreviewRequest
} from "./server/qr-archive.mjs";
import {
  createQrRenderPool,
  resolveQrArchiveImageWidth,
  resolveQrRenderConcurrency
} from "./server/qr-render-pool.mjs";

// ---------------------------------------------------------------------------
// Server configuration
// ---------------------------------------------------------------------------

const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 4173);
const rootDir = resolve(fileURLToPath(new URL(".", import.meta.url)));

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

// ---------------------------------------------------------------------------
// QR render options
// ---------------------------------------------------------------------------

const qrBaseRenderOptions = {
  margin: 2,
  errorCorrectionLevel: "L",
  color: {
    dark: "#13131a",
    light: "#fff8ef"
  }
};

const qrArchiveRenderOptions = {
  ...qrBaseRenderOptions,
  type: "svg",
  width: resolveQrArchiveImageWidth(APP_CONFIG.performance.qrArchiveImageWidth)
};

const qrPreviewRenderOptions = {
  ...qrBaseRenderOptions,
  type: "png",
  width: 420
};

const qrRenderPool = createQrRenderPool({
  concurrency: resolveQrRenderConcurrency(APP_CONFIG.performance.qrRenderConcurrency),
  renderOptions: qrArchiveRenderOptions,
  workerUrl: new URL("./qr-render-worker.mjs", import.meta.url)
});

// ---------------------------------------------------------------------------
// Shared context passed to route handlers
// ---------------------------------------------------------------------------

function buildRequestContext(requestOrigin) {
  return {
    config: APP_CONFIG,
    qrRenderPool,
    requestOrigin
  };
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(
    request.url || "/",
    `http://${request.headers.host || `${host}:${port}`}`
  );

  // ----- API routes --------------------------------------------------------

  if (request.method === "POST" && requestUrl.pathname === "/api/qr-archive") {
    await handleQrArchiveRequest(request, response, buildRequestContext(requestUrl.origin));
    return;
  }

  if (request.method === "GET" && requestUrl.pathname.startsWith("/api/qr-archive-status/")) {
    await handleQrArchiveStatusRequest(response, requestUrl);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname.startsWith("/api/qr-archive/")) {
    await handleQrArchiveDownloadRequest(response, requestUrl);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/qr-preview") {
    await handleQrPreviewRequest(request, response, qrPreviewRenderOptions);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/on-chain-root-status") {
    await handleOnChainRootStatusRequest(response, requestUrl, APP_CONFIG);
    return;
  }

  // ----- Static file serving -----------------------------------------------

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Method not allowed");
    return;
  }

  const pathname = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const safePath = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = resolve(rootDir, `.${safePath}`);

  if (!filePath.startsWith(rootDir)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
    "Cache-Control": "no-store"
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  createReadStream(filePath).pipe(response);
});

server.listen(port, host, () => {
  for (const url of resolveListenUrls(host, port)) {
    console.log(`Frontend server listening at ${url}`);
  }
});

// ---------------------------------------------------------------------------
// Network helpers
// ---------------------------------------------------------------------------

function resolveListenUrls(bindHost, bindPort) {
  if (!isWildcardHost(bindHost)) {
    return [`http://${formatHostForUrl(bindHost)}:${bindPort}`];
  }

  const urls = new Set([`http://127.0.0.1:${bindPort}`]);

  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.internal || entry.family !== "IPv4") {
        continue;
      }

      urls.add(`http://${entry.address}:${bindPort}`);
    }
  }

  return Array.from(urls);
}

function isWildcardHost(value) {
  return value === "0.0.0.0" || value === "::";
}

function formatHostForUrl(value) {
  return value.includes(":") ? `[${value}]` : value;
}
