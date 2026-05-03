import "dotenv/config";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createReadStream, createWriteStream, existsSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import { cpus, networkInterfaces, tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { ethers } from "ethers";
import QRCode from "qrcode";
import { APP_CONFIG } from "./config.js";

const host = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 4173);
const rootDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const maxArchiveRequestBytes = 64 * 1024 * 1024;
const archiveJobTtlMs = 6 * 60 * 60 * 1000;
const maxZipEntryCount = 0xffff;
const maxZipFileBytes = 0xffffffff;
const bytes32Pattern = /^0x[a-fA-F0-9]{64}$/;
const crc32Table = buildCrc32Table();
const qrLeafEncodingFields = APP_CONFIG.hashing.leafEncoding;
const qrLeafEncodingTypes = qrLeafEncodingFields.map((field) => field.type);
const qrVerificationFieldKeys = qrLeafEncodingFields.map((field) => field.key);
const serverSideSepoliaRpcUrl = String(process.env.SEPOLIA_RPC_URL || "").trim()
  || APP_CONFIG.network.rpcUrls.find(Boolean)
  || "";
const archiveJobs = new Map();
let verifierReadProvider = null;
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
const qrArchiveRenderPool = createQrRenderPool({
  concurrency: resolveQrRenderConcurrency(APP_CONFIG.performance.qrRenderConcurrency),
  renderOptions: qrArchiveRenderOptions,
  workerUrl: new URL("./qr-render-worker.mjs", import.meta.url)
});

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(
    request.url || "/",
    `http://${request.headers.host || `${host}:${port}`}`
  );

  if (request.method === "POST" && requestUrl.pathname === "/api/qr-archive") {
    await handleQrArchiveRequest(request, response, requestUrl.origin);
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
    await handleQrPreviewRequest(request, response);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/on-chain-root-status") {
    await handleOnChainRootStatusRequest(response, requestUrl);
    return;
  }

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

async function handleQrArchiveRequest(request, response, requestOrigin) {
  try {
    await cleanupExpiredArchiveJobs();

    const payload = await readJsonBody(request, maxArchiveRequestBytes);
    const archiveJob = createQrArchiveJob(payload, requestOrigin);
    archiveJobs.set(archiveJob.id, archiveJob);

    response.writeHead(202, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end(JSON.stringify({
      jobId: archiveJob.id,
      archiveFileName: archiveJob.archiveFileName,
      credentialCount: archiveJob.credentialCount,
      statusUrl: `/api/qr-archive-status/${archiveJob.id}`
    }));
  } catch (error) {
    response.writeHead(error.statusCode || 400, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end(error.message || "The QR archive request failed.");
  }
}

async function handleQrArchiveStatusRequest(response, requestUrl) {
  await cleanupExpiredArchiveJobs();

  const jobId = decodeURIComponent(requestUrl.pathname.slice("/api/qr-archive-status/".length));
  const archiveJob = archiveJobs.get(jobId);

  if (!archiveJob) {
    response.writeHead(404, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end(JSON.stringify({
      status: "error",
      message: "QR archive job not found."
    }));
    return;
  }

  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify({
    status: archiveJob.status,
    progress: archiveJob.progress,
    message: archiveJob.message,
    archiveFileName: archiveJob.archiveFileName,
    credentialCount: archiveJob.credentialCount,
    downloadUrl: archiveJob.status === "ready" ? `/api/qr-archive/${archiveJob.id}` : null
  }));
}

async function handleQrArchiveDownloadRequest(response, requestUrl) {
  await cleanupExpiredArchiveJobs();

  const jobId = decodeURIComponent(requestUrl.pathname.slice("/api/qr-archive/".length));
  const archiveJob = archiveJobs.get(jobId);

  if (!archiveJob || archiveJob.status !== "ready" || !existsSync(archiveJob.archivePath)) {
    response.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end("QR archive download not found.");
    return;
  }

  const archiveStats = statSync(archiveJob.archivePath);
  response.writeHead(200, {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${archiveJob.archiveFileName}"`,
    "Content-Length": String(archiveStats.size),
    "Cache-Control": "no-store"
  });

  createReadStream(archiveJob.archivePath)
    .on("error", () => {
      if (!response.headersSent) {
        response.writeHead(500, {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store"
        });
        response.end("The QR archive download failed.");
        return;
      }

      response.destroy();
    })
    .pipe(response);
}

async function handleQrPreviewRequest(request, response) {
  try {
    const payload = await readJsonBody(request, 1024 * 1024);
    if (!payload || typeof payload.payload !== "string" || !payload.payload.trim()) {
      throw createHttpError(400, "QR preview payload must include a verification link.");
    }

    const pngBuffer = await renderQrPngBuffer(payload.payload, qrPreviewRenderOptions);
    response.writeHead(200, {
      "Content-Type": "image/png",
      "Cache-Control": "no-store"
    });
    response.end(pngBuffer);
  } catch (error) {
    response.writeHead(error.statusCode || 400, {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end(error.message || "The QR preview request failed.");
  }
}

async function handleOnChainRootStatusRequest(response, requestUrl) {
  try {
    const root = validateBytes32(
      String(requestUrl.searchParams.get("root") || "").trim(),
      "Merkle root"
    );
    const batchId = normalizeOptionalString(requestUrl.searchParams.get("batchId"));
    const contractAddress = normalizeVerificationContractAddress(
      requestUrl.searchParams.get("contractAddress")
    );

    if (!contractAddress) {
      throw createHttpError(500, "The verifier contract address is not configured.");
    }

    const provider = getVerifierReadProvider();
    const network = await provider.getNetwork();
    if (BigInt(network.chainId) !== BigInt(APP_CONFIG.network.chainId)) {
      throw createHttpError(
        502,
        `The server RPC returned chain ${network.chainId.toString()} instead of ${APP_CONFIG.network.chainId}.`
      );
    }

    const contract = new ethers.Contract(
      contractAddress,
      APP_CONFIG.contract.anchorRoot.abi,
      provider
    );
    const [rootAnchored, rootActive, batchRoot] = await Promise.all([
      contract.isRootAnchored(root),
      contract.isRootActive(root),
      batchId
        ? contract.getBatchRoot(batchId)
        : Promise.resolve(null)
    ]);

    let rootRecord = null;
    if (rootAnchored) {
      rootRecord = await contract.getRootRecord(root);
    }

    const normalizedBatchRoot = batchRoot
      ? validateBytes32(String(batchRoot), "On-chain batch root")
      : null;

    sendJson(response, 200, {
      contractAddress,
      source: "Server RPC",
      rootAnchored: Boolean(rootAnchored),
      rootActive: Boolean(rootActive),
      batchRoot: normalizedBatchRoot,
      batchMatches: batchId
        ? normalizedBatchRoot?.toLowerCase() === root.toLowerCase()
        : null,
      issuer: rootRecord ? ethers.getAddress(rootRecord.issuer) : null,
      anchoredAt: formatUnixTimestamp(rootRecord?.anchoredAt),
      revokedAt: rootRecord?.revoked ? formatUnixTimestamp(rootRecord.revokedAt) : null
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, {
      message: error.message || `Unable to read the ${APP_CONFIG.network.name} verifier contract.`
    });
  }
}

function createQrArchiveJob(payload, requestOrigin) {
  const normalizedPayload = normalizeQrArchiveJobPayload(payload);
  const archiveJob = {
    id: randomUUID(),
    archiveFileName: normalizedPayload.archiveFileName,
    archivePath: null,
    createdAt: Date.now(),
    credentialCount: normalizedPayload.credentials.length,
    directoryPath: null,
    message: "Preparing QR archive...",
    progress: 4,
    status: "processing"
  };

  void runQrArchiveJob(archiveJob, normalizedPayload, requestOrigin);
  return archiveJob;
}

function normalizeQrArchiveJobPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw createHttpError(400, "QR archive payload must be a JSON object.");
  }

  const credentials = normalizeCredentialList(payload.credentials);
  const batchPayload = normalizeBatchPayload(payload.batchPayload);
  const merkleLevels = normalizeMerkleLevels(payload.merkleLevels, credentials.length);
  const archiveBaseName = sanitizeArchiveSegment(payload.archiveBaseName) || "credential-batch-qr";
  const archiveFileName = sanitizeArchiveFileName(payload.archiveFileName);
  const generatedAt = normalizeOptionalString(payload.generatedAt) || new Date().toISOString();

  if (credentials.length + 1 > maxZipEntryCount) {
    throw createHttpError(400, "This batch is too large to package into a single ZIP archive.");
  }

  return {
    archiveBaseName,
    archiveFileName,
    batchPayload,
    credentials,
    generatedAt,
    merkleLevels
  };
}

async function runQrArchiveJob(archiveJob, payload, requestOrigin) {
  try {
    const directoryPath = await mkdtemp(join(tmpdir(), "eth-qr-archive-"));
    const archivePath = join(directoryPath, payload.archiveFileName);
    archiveJob.directoryPath = directoryPath;
    archiveJob.message = "Generating QR archive files...";
    archiveJob.progress = 8;

    await writeQrArchiveFile({
      archiveBaseName: payload.archiveBaseName,
      archivePath,
      batchPayload: payload.batchPayload,
      credentials: payload.credentials,
      generatedAt: payload.generatedAt,
      merkleLevels: payload.merkleLevels,
      requestOrigin,
      onProgress: ({ progress, message }) => {
        archiveJob.progress = progress;
        archiveJob.message = message;
      }
    });
    archiveJob.archivePath = archivePath;
    archiveJob.status = "ready";
    archiveJob.progress = 92;
    archiveJob.message = "QR archive package ready.";
  } catch (error) {
    await safeRemoveDirectory(archiveJob.directoryPath);
    archiveJob.archivePath = null;
    archiveJob.directoryPath = null;
    archiveJob.status = "error";
    archiveJob.message = error.message || "The QR archive request failed.";
  }
}

async function writeQrArchiveFile({
  archiveBaseName,
  archivePath,
  batchPayload,
  credentials,
  generatedAt,
  merkleLevels,
  requestOrigin,
  onProgress = null
}) {
  const manifestEntries = [];
  const credentialCount = credentials.length;
  const renderBatchSize = resolveQrRenderBatchSize(credentialCount);
  const zipWriter = createZipFileWriter(archivePath);

  try {
    for (let startIndex = 0; startIndex < credentialCount; startIndex += renderBatchSize) {
      const batchCredentials = credentials.slice(startIndex, startIndex + renderBatchSize);
      const batchEntries = await Promise.all(
        batchCredentials.map((credential, batchOffset) => {
          return buildQrArchiveEntry({
            archiveBaseName,
            batchPayload,
            credential,
            generatedAt,
            index: startIndex + batchOffset,
            merkleLevels,
            requestOrigin,
            totalCount: credentialCount
          });
        })
      );

      for (const batchEntry of batchEntries) {
        await zipWriter.addFile(batchEntry.zipPath, batchEntry.fileBuffer);
        manifestEntries.push(batchEntry.manifestEntry);
      }

      const completedCount = startIndex + batchEntries.length;
      onProgress?.({
        progress: interpolateArchiveProgress(completedCount / credentialCount, 12, 86),
        message: `Generating QR ${completedCount} / ${credentialCount}...`
      });
      await yieldToEventLoop();
    }

    onProgress?.({
      progress: 90,
      message: "Writing QR archive manifest..."
    });
    const manifestBuffer = Buffer.from(JSON.stringify({
      batchId: batchPayload.batchId,
      merkleRoot: batchPayload.merkleRoot,
      issuedAt: batchPayload.issuedAt,
      issuerNote: batchPayload.issuerNote,
      generatedAt,
      credentialCount: credentials.length,
      files: manifestEntries
    }, null, 2), "utf8");

    await zipWriter.addFile(`${archiveBaseName}/manifest.json`, manifestBuffer);
    await zipWriter.close();
    onProgress?.({
      progress: 92,
      message: "QR archive package ready."
    });
  } catch (error) {
    await zipWriter.abort();
    throw error;
  }
}

function normalizeCredentialList(credentials) {
  if (!Array.isArray(credentials) || !credentials.length) {
    throw createHttpError(400, "QR archive payload must include at least one credential.");
  }

  return credentials.map((credential, index) => {
    if (!credential || typeof credential !== "object" || Array.isArray(credential)) {
      throw createHttpError(400, `Credential ${index + 1} must be a JSON object.`);
    }

    return credential;
  });
}

function normalizeBatchPayload(batchPayload) {
  if (!batchPayload || typeof batchPayload !== "object" || Array.isArray(batchPayload)) {
    throw createHttpError(400, "QR archive payload must include batch metadata.");
  }

  const batchId = normalizeRequiredString(batchPayload.batchId, "Batch ID");
  const merkleRoot = validateBytes32(String(batchPayload.merkleRoot || "").trim(), "Merkle root");

  return {
    batchId,
    merkleRoot,
    issuedAt: normalizeOptionalString(batchPayload.issuedAt),
    issuerNote: normalizeOptionalString(batchPayload.issuerNote)
  };
}

function normalizeMerkleLevels(levels, credentialCount) {
  if (!Array.isArray(levels) || !levels.length) {
    throw createHttpError(400, "QR archive payload must include Merkle levels.");
  }

  if (!Array.isArray(levels[0]) || levels[0].length !== credentialCount) {
    throw createHttpError(400, "Merkle leaves must match the credential count.");
  }

  if (!Array.isArray(levels[levels.length - 1]) || levels[levels.length - 1].length !== 1) {
    throw createHttpError(400, "Merkle levels must terminate in a single root node.");
  }

  return levels;
}

function normalizeRequiredString(value, label) {
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue) {
    throw createHttpError(400, `${label} is required.`);
  }

  return normalizedValue;
}

function normalizeOptionalString(value) {
  const normalizedValue = String(value || "").trim();
  return normalizedValue || null;
}

function normalizeVerificationContractAddress(rawAddress) {
  const requestedAddress = normalizeOptionalString(rawAddress);
  if (requestedAddress) {
    return ethers.getAddress(requestedAddress);
  }

  if (!APP_CONFIG.contract.address) {
    return null;
  }

  return ethers.getAddress(APP_CONFIG.contract.address);
}

function computeLeafHash(credential) {
  const values = [];

  for (const field of qrLeafEncodingFields) {
    const rawValue = credential[field.key];
    if (!rawValue) {
      throw createHttpError(400, `${field.label} is required to compute the leaf hash.`);
    }

    values.push(field.type === "address" ? ethers.getAddress(rawValue) : rawValue);
  }

  return ethers.solidityPackedKeccak256(qrLeafEncodingTypes, values);
}

function assertProofMatchesRoot(leafHash, proof, expectedRoot, pairing) {
  const computedRoot = computeRootFromProof(leafHash, proof, pairing);
  if (computedRoot.toLowerCase() !== expectedRoot.toLowerCase()) {
    throw createHttpError(400, "The current Merkle proof does not resolve to the provided root.");
  }
}

function computeRootFromProof(leafHash, proof, pairing) {
  let current = validateBytes32(leafHash, "Leaf hash");

  for (const sibling of proof) {
    const pair = pairing === "sorted"
      ? sortPair(current, sibling)
      : [current, validateBytes32(String(sibling), "Proof item")];

    current = ethers.solidityPackedKeccak256(["bytes32", "bytes32"], pair);
  }

  return current;
}

function buildMerkleProof(levels, leafIndex) {
  if (!Number.isInteger(leafIndex) || leafIndex < 0 || leafIndex >= levels[0].length) {
    throw createHttpError(400, `Leaf index ${leafIndex} is out of range for the current Merkle tree.`);
  }

  const proof = [];
  let currentIndex = leafIndex;

  for (let depth = 0; depth < levels.length - 1; depth += 1) {
    const currentLevel = levels[depth];
    const siblingIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
    const siblingHash = currentLevel[siblingIndex] || currentLevel[currentIndex];

    proof.push(validateBytes32(String(siblingHash), `Proof item ${depth + 1}`));
    currentIndex = Math.floor(currentIndex / 2);
  }

  return proof;
}

function buildVerificationLink({
  batchPayload,
  credential,
  generatedAt,
  proof,
  requestOrigin
}) {
  const compactPackage = {
    s: APP_CONFIG.qr.schema,
    v: APP_CONFIG.qr.version,
    b: batchPayload.batchId,
    r: batchPayload.merkleRoot,
    p: proof,
    c: qrVerificationFieldKeys.map((fieldKey) => credential[fieldKey] || ""),
    m: [
      batchPayload.issuedAt || null,
      batchPayload.issuerNote || null,
      generatedAt || null
    ]
  };
  const verificationUrl = new URL(APP_CONFIG.qr.verificationPage, requestOrigin);

  verificationUrl.search = "";
  verificationUrl.searchParams.set(
    APP_CONFIG.qr.payloadQueryParam,
    encodeBase64Url(JSON.stringify(compactPackage))
  );
  verificationUrl.hash = APP_CONFIG.qr.verificationHash || "";

  return verificationUrl.toString();
}

function encodeBase64Url(value) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function buildCredentialQrFileName(credential, index, totalCount) {
  const paddedIndex = String(index + 1).padStart(String(totalCount).length, "0");
  const credentialSlug = sanitizeFileSegment(credential.credentialId) || `credential-${index + 1}`;
  return `${paddedIndex}-${credentialSlug}.svg`;
}

async function renderQrPngBuffer(payload, renderOptions) {
  try {
    return await QRCode.toBuffer(payload, cloneQrRenderOptions(renderOptions));
  } catch {
    throw createHttpError(
      400,
      "The verification payload is too large for a scannable QR code."
    );
  }
}

async function buildQrArchiveEntry({
  archiveBaseName,
  batchPayload,
  credential,
  generatedAt,
  index,
  merkleLevels,
  requestOrigin,
  totalCount
}) {
  const proof = buildMerkleProof(merkleLevels, index);
  const leafHash = computeLeafHash(credential);

  assertProofMatchesRoot(leafHash, proof, batchPayload.merkleRoot, APP_CONFIG.hashing.pairing);

  const verificationLink = buildVerificationLink({
    batchPayload,
    credential,
    generatedAt,
    proof,
    requestOrigin
  });
  const fileName = buildCredentialQrFileName(credential, index, totalCount);
  const fileBuffer = await qrArchiveRenderPool.render(verificationLink);

  return {
    manifestEntry: {
      index,
      fileName,
      credentialId: credential.credentialId,
      achievementCode: credential.achievementCode,
      issueDate: credential.issueDate,
      recipient: credential.recipient
    },
    fileBuffer,
    zipPath: `${archiveBaseName}/${fileName}`
  };
}

function resolveQrArchiveImageWidth(configuredWidth) {
  const parsedWidth = Number(configuredWidth);
  if (!Number.isFinite(parsedWidth) || parsedWidth < 256) {
    return 640;
  }

  return Math.round(parsedWidth);
}

function resolveQrRenderConcurrency(configuredConcurrency) {
  const parsedConcurrency = Number(configuredConcurrency);
  if (Number.isFinite(parsedConcurrency) && parsedConcurrency > 0) {
    return Math.max(1, Math.round(parsedConcurrency));
  }

  const cpuCount = cpus().length || 1;
  return Math.max(1, Math.min(cpuCount, 6));
}

function resolveQrRenderBatchSize(credentialCount) {
  return Math.max(1, Math.min(credentialCount, qrArchiveRenderPool.concurrency));
}

function cloneQrRenderOptions(renderOptions) {
  return {
    ...renderOptions,
    color: renderOptions.color ? { ...renderOptions.color } : undefined,
    rendererOpts: renderOptions.rendererOpts ? { ...renderOptions.rendererOpts } : undefined
  };
}

function createQrRenderPool({
  concurrency,
  renderOptions,
  workerUrl
}) {
  const queue = [];
  const workers = [];
  let nextTaskId = 1;

  for (let index = 0; index < concurrency; index += 1) {
    workers.push(spawnWorkerState(index));
  }

  return {
    concurrency,
    render(payload) {
      return new Promise((resolve, reject) => {
        queue.push({
          id: nextTaskId,
          payload,
          reject,
          resolve
        });
        nextTaskId += 1;
        dispatch();
      });
    }
  };

  function spawnWorkerState(workerIndex) {
    const state = {
      busy: false,
      currentTask: null,
      index: workerIndex,
      worker: null
    };

    attachWorker(state);
    return state;
  }

  function attachWorker(state) {
    const worker = new Worker(workerUrl, { type: "module" });
    state.worker = worker;

    worker.on("message", (message) => {
      const currentTask = state.currentTask;
      state.busy = false;
      state.currentTask = null;

      if (!currentTask || message?.taskId !== currentTask.id) {
        dispatch();
        return;
      }

      if (message?.error) {
        currentTask.reject(createHttpError(400, message.error));
      } else {
        currentTask.resolve(
          Buffer.from(
            message.fileBytes.buffer,
            message.fileBytes.byteOffset,
            message.fileBytes.byteLength
          )
        );
      }

      dispatch();
    });

    worker.on("error", (error) => {
      const currentTask = state.currentTask;
      state.busy = false;
      state.currentTask = null;

      if (currentTask) {
        currentTask.reject(error);
      }
    });

    worker.on("exit", (code) => {
      const currentTask = state.currentTask;
      state.busy = false;
      state.currentTask = null;

      if (currentTask) {
        currentTask.reject(
          createHttpError(500, `QR renderer worker ${state.index + 1} stopped unexpectedly.`)
        );
      }

      if (code !== 0) {
        attachWorker(state);
      }

      dispatch();
    });
  }

  function dispatch() {
    for (const state of workers) {
      if (state.busy || !queue.length) {
        continue;
      }

      const task = queue.shift();
      state.busy = true;
      state.currentTask = task;
      state.worker.postMessage({
        payload: task.payload,
        renderOptions,
        taskId: task.id
      });
    }
  }
}

function createZipFileWriter(filePath) {
  const output = createWriteStream(filePath);
  const records = [];
  let currentOffset = 0;
  let isClosed = false;

  output.on("error", () => {
    isClosed = true;
  });

  return {
    async addFile(fileName, fileBuffer) {
      if (isClosed) {
        throw createHttpError(500, "The QR archive writer is no longer available.");
      }

      if (!Buffer.isBuffer(fileBuffer)) {
        throw createHttpError(500, "QR archive entries must be written as binary buffers.");
      }

      const normalizedFileName = fileName.replace(/\\/g, "/");
      const fileNameBuffer = Buffer.from(normalizedFileName, "utf8");
      const { dosDate, dosTime } = getDosDateTimeParts(new Date());
      const headerOffset = currentOffset;
      const header = Buffer.alloc(30);
      const checksum = crc32(fileBuffer);

      header.writeUInt32LE(0x04034b50, 0);
      header.writeUInt16LE(20, 4);
      header.writeUInt16LE(0, 6);
      header.writeUInt16LE(0, 8);
      header.writeUInt16LE(dosTime, 10);
      header.writeUInt16LE(dosDate, 12);
      header.writeUInt32LE(checksum >>> 0, 14);
      header.writeUInt32LE(fileBuffer.length >>> 0, 18);
      header.writeUInt32LE(fileBuffer.length >>> 0, 22);
      header.writeUInt16LE(fileNameBuffer.length, 26);
      header.writeUInt16LE(0, 28);

      await writeStreamBuffer(output, header);
      await writeStreamBuffer(output, fileNameBuffer);
      await writeStreamBuffer(output, fileBuffer);
      currentOffset += header.length + fileNameBuffer.length + fileBuffer.length;

      if (currentOffset > maxZipFileBytes) {
        throw createHttpError(413, "The QR archive ZIP is too large to package as a single file.");
      }

      records.push({
        checksum,
        compressedSize: fileBuffer.length,
        dosDate,
        dosTime,
        fileName: normalizedFileName,
        fileNameBuffer,
        headerOffset,
        uncompressedSize: fileBuffer.length
      });
    },
    async close() {
      if (isClosed) {
        return;
      }

      const centralDirectoryOffset = currentOffset;
      let centralDirectorySize = 0;

      for (const record of records) {
        const centralHeader = Buffer.alloc(46);

        centralHeader.writeUInt32LE(0x02014b50, 0);
        centralHeader.writeUInt16LE(20, 4);
        centralHeader.writeUInt16LE(20, 6);
        centralHeader.writeUInt16LE(0, 8);
        centralHeader.writeUInt16LE(0, 10);
        centralHeader.writeUInt16LE(record.dosTime, 12);
        centralHeader.writeUInt16LE(record.dosDate, 14);
        centralHeader.writeUInt32LE(record.checksum >>> 0, 16);
        centralHeader.writeUInt32LE(record.compressedSize >>> 0, 20);
        centralHeader.writeUInt32LE(record.uncompressedSize >>> 0, 24);
        centralHeader.writeUInt16LE(record.fileNameBuffer.length, 28);
        centralHeader.writeUInt16LE(0, 30);
        centralHeader.writeUInt16LE(0, 32);
        centralHeader.writeUInt16LE(0, 34);
        centralHeader.writeUInt16LE(0, 36);
        centralHeader.writeUInt32LE(0, 38);
        centralHeader.writeUInt32LE(record.headerOffset >>> 0, 42);

        await writeStreamBuffer(output, centralHeader);
        await writeStreamBuffer(output, record.fileNameBuffer);
        currentOffset += centralHeader.length + record.fileNameBuffer.length;
        centralDirectorySize += centralHeader.length + record.fileNameBuffer.length;
      }

      if (records.length > maxZipEntryCount || currentOffset > maxZipFileBytes) {
        throw createHttpError(413, "The QR archive ZIP is too large to package as a single file.");
      }

      const endOfCentralDirectory = Buffer.alloc(22);
      endOfCentralDirectory.writeUInt32LE(0x06054b50, 0);
      endOfCentralDirectory.writeUInt16LE(0, 4);
      endOfCentralDirectory.writeUInt16LE(0, 6);
      endOfCentralDirectory.writeUInt16LE(records.length, 8);
      endOfCentralDirectory.writeUInt16LE(records.length, 10);
      endOfCentralDirectory.writeUInt32LE(centralDirectorySize >>> 0, 12);
      endOfCentralDirectory.writeUInt32LE(centralDirectoryOffset >>> 0, 16);
      endOfCentralDirectory.writeUInt16LE(0, 20);

      await writeStreamBuffer(output, endOfCentralDirectory);
      output.end();
      await once(output, "finish");
      isClosed = true;
    },
    async abort() {
      if (isClosed) {
        return;
      }

      output.destroy();
      try {
        await once(output, "close");
      } catch {
        // Ignore close races during abort cleanup.
      }
      isClosed = true;
    }
  };
}

async function writeStreamBuffer(stream, buffer) {
  if (stream.write(buffer)) {
    return;
  }

  await once(stream, "drain");
}

function getDosDateTimeParts(date) {
  const year = Math.max(1980, date.getFullYear());
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  return {
    dosDate: ((year - 1980) << 9) | (month << 5) | day,
    dosTime: (hours << 11) | (minutes << 5) | seconds
  };
}

function crc32(buffer) {
  let checksum = 0xffffffff;

  for (const value of buffer) {
    checksum = (checksum >>> 8) ^ crc32Table[(checksum ^ value) & 0xff];
  }

  return (checksum ^ 0xffffffff) >>> 0;
}

function buildCrc32Table() {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1
        ? 0xedb88320 ^ (value >>> 1)
        : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
}

function validateBytes32(value, label) {
  if (!bytes32Pattern.test(value)) {
    throw createHttpError(400, `${label} must be a 32-byte hex value.`);
  }

  return value;
}

function sortPair(left, right) {
  return [
    validateBytes32(left, "Proof item").toLowerCase(),
    validateBytes32(String(right), "Proof item").toLowerCase()
  ].sort();
}

function sanitizeArchiveFileName(fileName) {
  const safeName = sanitizeArchiveSegment(fileName).replace(/\.zip$/i, "");
  return `${safeName || "credential-batch-qr"}.zip`;
}

function sanitizeArchiveSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sanitizeFileSegment(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

function interpolateArchiveProgress(ratio, start, end) {
  const safeRatio = Math.max(0, Math.min(1, Number(ratio) || 0));
  return Math.round(start + ((end - start) * safeRatio));
}

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function getVerifierReadProvider() {
  if (!serverSideSepoliaRpcUrl) {
    throw createHttpError(500, `Set SEPOLIA_RPC_URL before starting the frontend server.`);
  }

  if (!verifierReadProvider) {
    verifierReadProvider = new ethers.JsonRpcProvider(
      serverSideSepoliaRpcUrl,
      APP_CONFIG.network.chainId,
      { staticNetwork: true }
    );
  }

  return verifierReadProvider;
}

function formatUnixTimestamp(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  return new Date(seconds * 1000).toISOString();
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function readJsonBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalBytes = 0;
    let settled = false;

    request.on("data", (chunk) => {
      if (settled) {
        return;
      }

      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        settled = true;
        reject(createHttpError(413, "QR archive request is too large."));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });

    request.on("end", () => {
      if (settled) {
        return;
      }

      try {
        const rawBody = Buffer.concat(chunks).toString("utf8");
        resolve(JSON.parse(rawBody || "{}"));
      } catch {
        reject(createHttpError(400, "QR archive request body must be valid JSON."));
      }
    });

    request.on("error", (error) => {
      if (settled) {
        return;
      }

      reject(error);
    });
  });
}

async function cleanupExpiredArchiveJobs() {
  const cutoff = Date.now() - archiveJobTtlMs;

  for (const [jobId, archiveJob] of archiveJobs.entries()) {
    if (archiveJob.createdAt >= cutoff) {
      continue;
    }

    archiveJobs.delete(jobId);
    await safeRemoveDirectory(archiveJob.directoryPath);
  }
}

async function safeRemoveDirectory(directoryPath) {
  if (!directoryPath) {
    return;
  }

  await rm(directoryPath, { force: true, recursive: true });
}

function yieldToEventLoop() {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

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
