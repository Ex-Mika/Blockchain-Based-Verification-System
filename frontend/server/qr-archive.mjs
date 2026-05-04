/**
 * qr-archive.mjs — Handlers for QR archive creation, status polling,
 * download, and single-QR preview.
 */

import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import QRCode from "qrcode";

import {
  createHttpError,
  normalizeOptionalString,
  normalizeRequiredString,
  readJsonBody,
  validateBytes32
} from "./http-utils.mjs";
import {
  assertProofMatchesRoot,
  buildMerkleProof,
  computeLeafHash
} from "./merkle.mjs";
import {
  cloneQrRenderOptions,
  resolveQrRenderBatchSize
} from "./qr-render-pool.mjs";
import { createZipFileWriter } from "./zip-writer.mjs";

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

const archiveJobTtlMs = 6 * 60 * 60 * 1000;
const maxArchiveRequestBytes = 64 * 1024 * 1024;
const maxZipEntryCount = 0xffff;
const maxZipFileBytes = 0xffffffff;
const archiveJobs = new Map();

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/**
 * `POST /api/qr-archive` — Start an asynchronous QR-archive generation job.
 */
export async function handleQrArchiveRequest(request, response, context) {
  try {
    await cleanupExpiredArchiveJobs();

    const payload = await readJsonBody(request, maxArchiveRequestBytes);
    const archiveJob = createQrArchiveJob(payload, context);
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

/**
 * `GET /api/qr-archive-status/:jobId` — Poll job progress.
 */
export async function handleQrArchiveStatusRequest(response, requestUrl) {
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

/**
 * `GET /api/qr-archive/:jobId` — Download the completed ZIP archive.
 */
export async function handleQrArchiveDownloadRequest(response, requestUrl) {
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

/**
 * `POST /api/qr-preview` — Render a single QR code as a PNG.
 */
export async function handleQrPreviewRequest(request, response, previewRenderOptions) {
  try {
    const payload = await readJsonBody(request, 1024 * 1024);
    if (!payload || typeof payload.payload !== "string" || !payload.payload.trim()) {
      throw createHttpError(400, "QR preview payload must include a verification link.");
    }

    const pngBuffer = await renderQrPngBuffer(payload.payload, previewRenderOptions);
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

// ---------------------------------------------------------------------------
// Job lifecycle
// ---------------------------------------------------------------------------

function createQrArchiveJob(payload, context) {
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

  void runQrArchiveJob(archiveJob, normalizedPayload, context);
  return archiveJob;
}

async function runQrArchiveJob(archiveJob, payload, context) {
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
      context,
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
  context,
  onProgress = null
}) {
  const manifestEntries = [];
  const credentialCount = credentials.length;
  const renderBatchSize = resolveQrRenderBatchSize(credentialCount, context.qrRenderPool.concurrency);
  const zipWriter = createZipFileWriter(archivePath, {
    maxEntryCount: maxZipEntryCount,
    maxFileBytes: maxZipFileBytes
  });

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
            context,
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

// ---------------------------------------------------------------------------
// Payload normalisation
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// QR entry building
// ---------------------------------------------------------------------------

async function buildQrArchiveEntry({
  archiveBaseName,
  batchPayload,
  credential,
  generatedAt,
  index,
  merkleLevels,
  context,
  totalCount
}) {
  const { config, qrRenderPool } = context;
  const leafEncodingFields = config.hashing.leafEncoding;
  const proof = buildMerkleProof(merkleLevels, index);
  const leafHash = computeLeafHash(credential, leafEncodingFields);

  assertProofMatchesRoot(leafHash, proof, batchPayload.merkleRoot, config.hashing.pairing);

  const verificationLink = buildVerificationLink({
    batchPayload,
    credential,
    generatedAt,
    proof,
    config,
    requestOrigin: context.requestOrigin
  });
  const fileName = buildCredentialQrFileName(credential, index, totalCount);
  const fileBuffer = await qrRenderPool.render(verificationLink);

  return {
    manifestEntry: {
      index,
      fileName,
      holderName: credential.holderName,
      credentialTitle: credential.credentialTitle,
      credentialId: credential.credentialId,
      achievementCode: credential.achievementCode,
      issueDate: credential.issueDate,
      recipient: credential.recipient
    },
    fileBuffer,
    zipPath: `${archiveBaseName}/${fileName}`
  };
}

function buildVerificationLink({
  batchPayload,
  credential,
  generatedAt,
  proof,
  config,
  requestOrigin
}) {
  const fieldKeys = config.hashing.leafEncoding.map((field) => field.key);
  const compactPackage = {
    s: config.qr.schema,
    v: config.qr.version,
    b: batchPayload.batchId,
    r: batchPayload.merkleRoot,
    p: proof,
    c: fieldKeys.map((fieldKey) => credential[fieldKey] || ""),
    m: [
      batchPayload.issuedAt || null,
      batchPayload.issuerNote || null,
      generatedAt || null
    ]
  };
  const verificationUrl = new URL(config.qr.verificationPage, requestOrigin);

  verificationUrl.search = "";
  verificationUrl.searchParams.set(
    config.qr.payloadQueryParam,
    encodeBase64Url(JSON.stringify(compactPackage))
  );
  verificationUrl.hash = config.qr.verificationHash || "";

  return verificationUrl.toString();
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

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

function yieldToEventLoop() {
  return new Promise((resolve) => {
    setImmediate(resolve);
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
