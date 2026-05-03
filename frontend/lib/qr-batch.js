export async function buildQrArchive({
  batchPayload,
  merkleBuild,
  generatedAt = new Date().toISOString(),
  onProgress = null
}) {
  const credentialCount = merkleBuild.credentials.length;
  const archiveBaseName = buildArchiveBaseName(batchPayload.batchId);
  const archiveJob = await requestArchiveBuild({
    archiveBaseName,
    archiveFileName: `${archiveBaseName}.zip`,
    batchPayload,
    generatedAt,
    credentials: merkleBuild.credentials,
    merkleLevels: merkleBuild.merkleArtifacts.levels
  });
  const archiveMeta = await waitForArchiveBuild(archiveJob, { onProgress });

  return {
    downloadUrl: archiveMeta.downloadUrl,
    archiveFileName: archiveMeta.archiveFileName || `${archiveBaseName}.zip`,
    credentialCount: archiveMeta.credentialCount || credentialCount,
    generatedAt
  };
}

export function buildBatchQrSummary({
  archiveFileName,
  credentialCount,
  selectedFileName,
  qrPayload
}) {
  return [
    "Batch QR archive ready.",
    `Archive file: ${archiveFileName}`,
    `Credential count: ${credentialCount.toLocaleString()}`,
    `Selected preview: ${selectedFileName}`,
    "",
    "Selected verification link:",
    qrPayload
  ].join("\n");
}

export function buildCredentialQrFileName(credential, index, totalCount) {
  const paddedIndex = String(index + 1).padStart(String(totalCount).length, "0");
  const credentialSlug = sanitizeFileSegment(credential.credentialId) || `credential-${index + 1}`;
  return `${paddedIndex}-${credentialSlug}.svg`;
}

export async function renderQrCanvas(canvas, qrPayload) {
  const pngBlob = await requestQrPreviewBlob(qrPayload);
  const objectUrl = URL.createObjectURL(pngBlob);

  try {
    const image = await loadImage(objectUrl);
    const context = canvas.getContext("2d");

    context.fillStyle = "#fff8ef";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function requestArchiveBuild(payload) {
  const response = await fetch("/api/qr-archive", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(await response.text() || "The QR archive request failed.");
  }

  const result = await response.json();
  if (!result?.jobId || !result?.statusUrl) {
    throw new Error("The QR archive response did not include a status job.");
  }

  return result;
}

async function waitForArchiveBuild(archiveJob, options = {}) {
  let pollDelayMs = 220;

  while (true) {
    const status = await requestArchiveBuildStatus(archiveJob.statusUrl);

    options.onProgress?.({
      progress: status.progress,
      message: status.message
    });

    if (status.status === "ready") {
      return status;
    }

    if (status.status === "error") {
      throw new Error(status.message || "The QR archive job failed.");
    }

    await delay(pollDelayMs);
    pollDelayMs = Math.min(1200, Math.round(pollDelayMs * 1.18));
  }
}

async function requestArchiveBuildStatus(statusUrl) {
  const response = await fetch(statusUrl, {
    method: "GET",
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(await response.text() || "The QR archive status request failed.");
  }

  return response.json();
}

async function requestQrPreviewBlob(qrPayload) {
  const response = await fetch("/api/qr-preview", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ payload: qrPayload })
  });

  if (!response.ok) {
    throw new Error(await response.text() || "The QR preview request failed.");
  }

  return response.blob();
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      resolve(image);
    };
    image.onerror = () => {
      reject(new Error("The QR preview image could not be loaded."));
    };
    image.src = source;
  });
}

function delay(durationMs) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}

function buildArchiveBaseName(batchId) {
  const normalizedBatchId = sanitizeFileSegment(batchId) || "credential-batch";
  return `${normalizedBatchId}-qr-batch`;
}

function sanitizeFileSegment(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}
