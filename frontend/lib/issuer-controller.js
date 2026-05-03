import { APP_CONFIG } from "../config.js";
import {
  buildMerkleArtifactsAsync,
  buildMerkleProof
} from "../merkle.js";
import {
  computeLeafHash,
  createVerificationPackage,
  encodeVerificationPackage,
  getActiveHashingSpec,
  parseProof
} from "./credential-utils.js";
import {
  getBatchDraft,
  getBatchPayload,
  getCredentialInput,
  getValidatedMerkleTargetIndex,
  hydrateCredentialForm,
  parseBatchCredentialsText,
  resolveProofTargetIndex
} from "./issuer-form.js";
import {
  buildBatchQrSummary,
  buildCredentialQrFileName,
  buildQrArchive,
  renderQrCanvas
} from "./qr-batch.js";
import { getRuntime } from "./runtime.js";
import { humanizeError, resetStatus, setStatus, showToast } from "./ui.js";

export function createIssuerController({
  state,
  elements,
  merkleTreeView,
  issuerWorkspaceController
}) {
  let batchCredentialsDragDepth = 0;

  function bindEvents() {
    elements.buildMerkleTree.addEventListener("click", handleMerkleTreeBuild);
    elements.generateQr.addEventListener("click", handleQrGeneration);
    elements.submitRoot.addEventListener("click", handleRootSubmission);
    elements.downloadQr.addEventListener("click", handleQrDownload);
    elements.proofTargetIndex.addEventListener("change", handleProofTargetIndexChange);
    elements.proofIndexPrev.addEventListener("click", handleProofIndexPrev);
    elements.proofIndexNext.addEventListener("click", handleProofIndexNext);
    elements.batchCredentialsFileInput.addEventListener("change", handleBatchCredentialsFileSelect);
    elements.batchCredentialsDropzone.addEventListener("dragenter", handleBatchCredentialsDragEnter);
    elements.batchCredentialsDropzone.addEventListener("dragover", handleBatchCredentialsDragOver);
    elements.batchCredentialsDropzone.addEventListener("dragleave", handleBatchCredentialsDragLeave);
    elements.batchCredentialsDropzone.addEventListener("drop", handleBatchCredentialsDrop);
    elements.proofIndexDisplay.addEventListener("change", handleProofIndexDisplayChange);
  }

  function clearQrCanvas() {
    const context = elements.qrCodeCanvas.getContext("2d");
    context.fillStyle = "#fff8ef";
    context.fillRect(0, 0, elements.qrCodeCanvas.width, elements.qrCodeCanvas.height);
  }

  function handleProofIndexPrev() {
    if (!state.merkleBuild) return;
    const current = Number(elements.proofTargetIndex.value) || 0;
    const next = Math.max(0, current - 1);
    elements.proofTargetIndex.value = String(next);
    elements.proofTargetIndex.dispatchEvent(new Event("change"));
  }

  function handleProofIndexNext() {
    if (!state.merkleBuild) return;
    const current = Number(elements.proofTargetIndex.value) || 0;
    const max = state.merkleBuild.credentials.length - 1;
    const next = Math.min(max, current + 1);
    elements.proofTargetIndex.value = String(next);
    elements.proofTargetIndex.dispatchEvent(new Event("change"));
  }

  function syncProofIndexDisplay(value) {
    elements.proofIndexDisplay.value = value === "" ? "0" : value;
  }

  function handleProofIndexDisplayChange() {
    const typed = Number(elements.proofIndexDisplay.value);
    if (!state.merkleBuild || isNaN(typed)) return;
    const max = state.merkleBuild.credentials.length - 1;
    const clamped = Math.max(0, Math.min(max, Math.floor(typed)));
    elements.proofTargetIndex.value = String(clamped);
    elements.proofTargetIndex.dispatchEvent(new Event("change"));
  }

  function handleProofTargetIndexChange() {
    if (!state.merkleBuild) {
      return;
    }

    try {
      const credentialCount = state.merkleBuild.credentials.length;
      const targetIndex = getValidatedMerkleTargetIndex(
        elements.proofTargetIndex.value,
        credentialCount
      );
      syncMerkleSelection(targetIndex, {
        channel: "inline",
        message: `Proof target changed to leaf ${targetIndex}.`,
        variant: "neutral"
      });
    } catch (error) {
      showToast("error", humanizeError(error));
    }
  }

  async function handleMerkleTreeBuild() {
    const { ethers } = getRuntime();
    if (!ethers || state.isMerkleBuildInProgress) {
      return;
    }

    const startedAt = performance.now();
    try {
      state.isMerkleBuildInProgress = true;
      elements.buildMerkleTree.disabled = true;
      clearGeneratedQrBatch();
      setMerkleBuildProgress(6, "Preparing batch credentials...");

      const { batchId } = getBatchDraft(elements);
      if (!batchId) {
        elements.batchIdInput?.focus();
        throw new Error("Batch ID is required before building the Merkle tree.");
      }

      const credentials = resolveBatchCredentials();
      const targetIndex = resolveProofTargetIndex(elements, credentials);
      const totalTreeLevels = getMerkleTreeLevelCount(credentials.length);
      const hashing = getActiveHashingSpec();
      const leafHashes = await computeLeafHashesInChunks(credentials, hashing, {
        onProgress: ({ completed, total }) => {
          const progressMessage = `Hashing credentials ${completed.toLocaleString()} / ${total.toLocaleString()}...`;
          setMerkleBuildProgress(
            interpolateProgress(completed / total, 12, 68),
            progressMessage
          );
        }
      });
      setMerkleBuildProgress(
        totalTreeLevels ? 72 : 96,
        totalTreeLevels ? "Building Merkle levels..." : "Finalizing Merkle root..."
      );
      const merkleArtifacts = await buildMerkleArtifactsAsync(leafHashes, {
        pairing: hashing.pairing,
        oddLeafStrategy: APP_CONFIG.hashing.oddLeafStrategy,
        chunkSize: APP_CONFIG.performance.treeChunkSize,
        onProgress: ({ levelIndex, levelWidth }) => {
          const progressMessage = totalTreeLevels
            ? `Building Merkle level ${levelIndex} of ${totalTreeLevels} with ${levelWidth.toLocaleString()} node${levelWidth === 1 ? "" : "s"}...`
            : "Finalizing Merkle root...";
          const levelProgress = totalTreeLevels
            ? interpolateProgress(levelIndex / totalTreeLevels, 72, 96)
            : 96;
          setMerkleBuildProgress(levelProgress, progressMessage);
        }
      });
      const selectedProof = buildMerkleProof(merkleArtifacts.levels, targetIndex);

      state.merkleBuild = {
        credentials,
        merkleArtifacts,
        selectedProof,
        targetIndex
      };

      const durationMs = Math.round(performance.now() - startedAt);
      setMerkleBuildProgress(100, "Merkle tree ready.");
      syncMerkleSelection(targetIndex);
      await yieldToBrowser();
      issuerWorkspaceController?.showView("tree");
      resetStatus(elements.issuanceMessage);
      showToast(
        "success",
        `Merkle tree built for ${credentials.length.toLocaleString()} credential${credentials.length === 1 ? "" : "s"} in ${durationMs.toLocaleString()} ms.`
      );
    } catch (error) {
      state.merkleBuild = null;
      merkleTreeView.clear();
      clearGeneratedQrBatch();
      resetStatus(elements.issuanceMessage);
      showToast("error", humanizeError(error));
    } finally {
      state.isMerkleBuildInProgress = false;
      elements.buildMerkleTree.disabled = false;
      resetMerkleBuildProgress();
    }
  }

  function handleBatchCredentialsDragEnter(event) {
    if (!hasDraggedFiles(event)) {
      return;
    }

    event.preventDefault();
    batchCredentialsDragDepth += 1;
    setBatchCredentialsDropzoneActive(true);
  }

  function handleBatchCredentialsDragOver(event) {
    if (!hasDraggedFiles(event)) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setBatchCredentialsDropzoneActive(true);
  }

  function handleBatchCredentialsDragLeave(event) {
    if (!elements.batchCredentialsDropzone.classList.contains("is-dragover")) {
      return;
    }

    event.preventDefault();
    batchCredentialsDragDepth = Math.max(0, batchCredentialsDragDepth - 1);

    if (batchCredentialsDragDepth === 0) {
      setBatchCredentialsDropzoneActive(false);
    }
  }

  async function handleBatchCredentialsDrop(event) {
    if (!hasDraggedFiles(event)) {
      return;
    }

    event.preventDefault();
    batchCredentialsDragDepth = 0;
    setBatchCredentialsDropzoneActive(false);

    const file = event.dataTransfer.files[0];
    if (!file) {
      return;
    }

    await loadBatchCredentialsFile(file);
  }

  async function handleBatchCredentialsFileSelect(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      await loadBatchCredentialsFile(file);
    } finally {
      event.target.value = "";
    }
  }

  function syncMerkleSelection(targetIndex, options = {}) {
    if (!state.merkleBuild) {
      return;
    }

    const { credentials, merkleArtifacts } = state.merkleBuild;
    const validatedTargetIndex = getValidatedMerkleTargetIndex(
      targetIndex,
      credentials.length
    );
    const selectedCredential = credentials[validatedTargetIndex];
    const selectedProof = buildMerkleProof(merkleArtifacts.levels, validatedTargetIndex);

    state.merkleBuild.targetIndex = validatedTargetIndex;
    state.merkleBuild.selectedProof = selectedProof;
    hydrateCredentialForm(elements, selectedCredential);
    elements.proofTargetIndex.value = String(validatedTargetIndex);
    syncProofIndexDisplay(String(validatedTargetIndex));
    elements.merkleRootInput.value = merkleArtifacts.root;
    elements.issuerProofInput.value = JSON.stringify(selectedProof, null, 2);

    merkleTreeView.render(state.merkleBuild);

    if (state.qrBatch) {
      void refreshSelectedQrPreview();
    }

    if (options.message) {
      if (options.channel === "toast") {
        resetStatus(elements.issuanceMessage);
        showToast(options.variant || "success", options.message);
        return;
      }

      setStatus(elements.issuanceMessage, options.variant || "neutral", options.message);
    }
  }

  function setBatchCredentialsDropzoneActive(isActive) {
    elements.batchCredentialsDropzone.classList.toggle("is-dragover", isActive);
  }

  async function handleQrGeneration() {
    const { ethers } = getRuntime();

    if (!ethers) {
      showToast(
        "warning",
        "The ethers runtime did not load, so QR generation is unavailable."
      );
      return;
    }

    if (!state.merkleBuild) {
      showToast("warning", "Build the Merkle tree before generating the QR archive.");
      return;
    }

    try {
      elements.generateQr.disabled = true;
      elements.downloadQr.disabled = true;
      setQrGenerationProgress(8, "Preparing QR archive...");

      const batchPayload = getBatchPayload(elements);

      resetStatus(elements.issuanceMessage);

      state.qrBatch = await buildQrArchive({
        batchPayload,
        merkleBuild: state.merkleBuild,
        onProgress: ({ progress, message }) => {
          const progressLabel = message || "Generating QR archive...";
          setQrGenerationProgress(progress ?? 16, progressLabel);
        }
      });

      setQrGenerationProgress(96, "Rendering selected QR preview...");
      await refreshSelectedQrPreview();
      elements.downloadQr.disabled = false;
      setQrGenerationProgress(100, "QR archive ready.");
      await yieldToBrowser();
      resetStatus(elements.issuanceMessage);
      showToast(
        "success",
        `QR archive ready with ${state.qrBatch.credentialCount.toLocaleString()} credential QR file${state.qrBatch.credentialCount === 1 ? "" : "s"}.`
      );

      if (isLocalOnlyVerificationOrigin(window.location)) {
        showToast(
          "warning",
          "This QR archive points to a local-only address. Host the site on a phone-reachable URL before testing the scan flow."
        );
      }
    } catch (error) {
      clearGeneratedQrBatch();
      resetStatus(elements.issuanceMessage);
      showToast("error", humanizeError(error));
    } finally {
      elements.generateQr.disabled = false;
      resetQrGenerationProgress();
    }
  }

  async function handleRootSubmission() {
    const { ethers } = getRuntime();
    if (!ethers) {
      return;
    }

    try {
      const payload = getBatchPayload(elements);

      if (!state.account || !state.signer) {
        throw new Error("Connect a wallet before submitting a batch root.");
      }

      if (state.chainId !== BigInt(APP_CONFIG.network.chainId)) {
        throw new Error(`Switch the wallet to chain ${APP_CONFIG.network.chainId} before submitting.`);
      }

      if (!APP_CONFIG.contract.address) {
        throw new Error("Set the deployed Sepolia contract address in frontend/config.js before submitting on-chain.");
      }

      const anchorConfig = APP_CONFIG.contract.anchorRoot;
      const contract = new ethers.Contract(
        APP_CONFIG.contract.address,
        anchorConfig.abi,
        state.signer
      );

      setStatus(
        elements.issuanceMessage,
        "warning",
        "Submitting Merkle root transaction to Sepolia..."
      );
      const tx = await contract[anchorConfig.functionName](payload.merkleRoot, payload.batchId);
      const receipt = await tx.wait();

      resetStatus(elements.issuanceMessage);
      showToast(
        "success",
        `Root anchored successfully on Sepolia in transaction ${tx.hash} at block ${receipt.blockNumber}.`
      );
    } catch (error) {
      resetStatus(elements.issuanceMessage);
      showToast("error", humanizeError(error));
    }
  }

  function handleQrDownload() {
    if (!state.qrBatch?.downloadUrl) {
      showToast("warning", "Generate the QR archive before downloading it.");
      return;
    }

    try {
      const downloadLink = document.createElement("a");

      downloadLink.href = state.qrBatch.downloadUrl;
      downloadLink.download = state.qrBatch.archiveFileName;
      downloadLink.click();

      showToast("success", "QR ZIP download started.");
    } catch (error) {
      showToast("error", humanizeError(error));
    }
  }

  async function loadBatchCredentialsFile(file) {
    try {
      const rawText = await file.text();
      const credentials = parseBatchCredentialsText(rawText);
      state.batchCredentialsCache = {
        credentials,
        fileName: file.name
      };
      clearLoadedMerkleBuild();
      elements.batchCredentialsDropzone.classList.add("has-loaded-file");
      elements.batchCredentialsFileName.textContent = `${file.name} / ${credentials.length.toLocaleString()} entr${credentials.length === 1 ? "y" : "ies"}`;
      elements.batchCredentialsSummary.textContent = buildBatchCredentialsSummary(file.name, credentials.length);
      renderBatchPreviewTable(credentials, elements);
      resetStatus(elements.issuanceMessage);
      showToast(
        "success",
        `Loaded ${credentials.length.toLocaleString()} batch credential${credentials.length === 1 ? "" : "s"} from ${file.name}.`
      );
    } catch (error) {
      resetStatus(elements.issuanceMessage);
      showToast("error", humanizeError(error));
    }
  }

  function hasDraggedFiles(event) {
    const dataTransferTypes = Array.from(event.dataTransfer?.types || []);
    return dataTransferTypes.includes("Files") || Boolean(event.dataTransfer?.files?.length);
  }

  function resolveBatchCredentials() {
    const cachedBatch = state.batchCredentialsCache;
    if (cachedBatch) {
      return cachedBatch.credentials;
    }

    throw new Error("Load a batch JSON file before building the Merkle tree.");
  }

  function clearLoadedMerkleBuild() {
    clearGeneratedQrBatch();
    state.merkleBuild = null;
    merkleTreeView.clear();
    elements.proofTargetIndex.value = "";
    syncProofIndexDisplay("");
    elements.merkleRootInput.value = "";
    elements.issuerProofInput.value = "";
    resetMerkleBuildProgress();
  }

  function setMerkleBuildProgress(value, label) {
    renderProgressState({
      container: elements.merkleBuildProgress,
      bar: elements.merkleBuildProgressBar,
      label: elements.merkleBuildProgressLabel
    }, value, label);
  }

  function resetMerkleBuildProgress() {
    resetProgressState({
      container: elements.merkleBuildProgress,
      bar: elements.merkleBuildProgressBar,
      label: elements.merkleBuildProgressLabel
    }, "Preparing batch credentials... 0%");
  }

  function setQrGenerationProgress(value, label) {
    renderProgressState({
      container: elements.qrGenerationProgress,
      bar: elements.qrGenerationProgressBar,
      label: elements.qrGenerationProgressLabel
    }, value, label);
  }

  function resetQrGenerationProgress() {
    resetProgressState({
      container: elements.qrGenerationProgress,
      bar: elements.qrGenerationProgressBar,
      label: elements.qrGenerationProgressLabel
    }, "Preparing QR archive... 0%");
  }

  function clearGeneratedQrBatch() {
    state.qrBatch = null;
    state.qrPayload = "";
    elements.downloadQr.disabled = true;
    elements.qrPayloadOutput.value = "";
    clearQrCanvas();
    resetQrGenerationProgress();
  }

  async function refreshSelectedQrPreview() {
    if (!state.qrBatch) {
      return;
    }

    const verificationPackage = buildSelectedVerificationPackage(state.qrBatch.generatedAt);
    const qrPayload = encodeVerificationPackage(verificationPackage);

    await renderQrCanvas(elements.qrCodeCanvas, qrPayload);
    state.qrPayload = qrPayload;
    elements.qrPayloadOutput.value = buildBatchQrSummary({
      archiveFileName: state.qrBatch.archiveFileName,
      credentialCount: state.qrBatch.credentialCount,
      selectedFileName: getSelectedQrFileName(),
      qrPayload
    });
  }

  function buildSelectedVerificationPackage(generatedAt) {
    const batchPayload = getBatchPayload(elements);
    const credential = getCredentialInput(elements);
    const proof = parseProof(
      String(new FormData(elements.issuerForm).get("proofInput") || ""),
      { allowEmpty: true }
    );

    return createVerificationPackage({
      batchPayload,
      credential,
      proof,
      hashing: getActiveHashingSpec(),
      generatedAt
    });
  }

  function getSelectedQrFileName() {
    const credential = getCredentialInput(elements);
    const totalCount = state.merkleBuild?.credentials.length || 1;
    const targetIndex = state.merkleBuild?.targetIndex || 0;
    return buildCredentialQrFileName(credential, targetIndex, totalCount);
  }

  return {
    bindEvents,
    clearQrCanvas,
    syncMerkleSelection
  };
}

async function computeLeafHashesInChunks(credentials, hashing, options = {}) {
  const chunkSize = Math.max(1, APP_CONFIG.performance.hashChunkSize);
  const leafHashes = new Array(credentials.length);

  for (let index = 0; index < credentials.length; index += 1) {
    leafHashes[index] = computeLeafHash(credentials[index], hashing);

    if ((index + 1) % chunkSize === 0 || index === credentials.length - 1) {
      options.onProgress?.({
        completed: index + 1,
        total: credentials.length
      });
      await yieldToBrowser();
    }
  }

  return leafHashes;
}

function buildBatchCredentialsSummary(fileName, credentialCount) {
  return [
    `Batch file: ${fileName}`,
    `Credential count: ${credentialCount.toLocaleString()}`,
    "Source: drag and drop intake",
    "Status: ready for Merkle build"
  ].join("\n");
}

function renderBatchPreviewTable(credentials, elements) {
  const shell = elements.batchPreviewShell;
  const tbody = elements.batchPreviewTableBody;
  const countBadge = elements.batchPreviewCount;

  if (!shell || !tbody) {
    return;
  }

  tbody.innerHTML = "";

  const previewLimit = 50;
  const visibleCredentials = credentials.slice(0, previewLimit);

  for (let i = 0; i < visibleCredentials.length; i++) {
    const cred = visibleCredentials[i];
    const tr = document.createElement("tr");

    const indexTd = document.createElement("td");
    indexTd.textContent = String(i + 1);

    const recipientTd = document.createElement("td");
    const addr = cred.recipient || "";
    recipientTd.textContent = addr.length > 14
      ? `${addr.slice(0, 8)}…${addr.slice(-4)}`
      : addr;
    recipientTd.title = addr;

    const credIdTd = document.createElement("td");
    credIdTd.textContent = cred.credentialId || "";

    const achieveTd = document.createElement("td");
    achieveTd.textContent = cred.achievementCode || "";

    const dateTd = document.createElement("td");
    dateTd.textContent = cred.issueDate || "";

    tr.append(indexTd, recipientTd, credIdTd, achieveTd, dateTd);
    tbody.appendChild(tr);
  }

  if (countBadge) {
    const suffix = credentials.length > previewLimit
      ? ` (showing first ${previewLimit})`
      : "";
    countBadge.textContent = `${credentials.length.toLocaleString()} credential${credentials.length === 1 ? "" : "s"}${suffix}`;
  }

  shell.classList.remove("is-empty");
}

function clearBatchPreviewTable(elements) {
  const shell = elements.batchPreviewShell;
  const tbody = elements.batchPreviewTableBody;
  const countBadge = elements.batchPreviewCount;

  if (tbody) {
    tbody.innerHTML = "";
  }

  if (countBadge) {
    countBadge.textContent = "";
  }

  if (shell) {
    shell.classList.add("is-empty");
  }
}

function getMerkleTreeLevelCount(leafCount) {
  let levelCount = 0;
  let width = Math.max(1, Number(leafCount) || 1);

  while (width > 1) {
    width = Math.ceil(width / 2);
    levelCount += 1;
  }

  return levelCount;
}

function interpolateProgress(ratio, start, end) {
  const safeRatio = Math.max(0, Math.min(1, Number(ratio) || 0));
  return start + ((end - start) * safeRatio);
}

function clampProgress(value) {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

function renderProgressState(target, value, label) {
  if (!target.container || !target.bar || !target.label) {
    return;
  }

  const safeValue = clampProgress(value);
  const progressText = label ? `${label} ${safeValue}%` : `${safeValue}%`;
  target.container.hidden = false;
  target.container.setAttribute("aria-valuenow", String(safeValue));
  target.container.setAttribute("aria-valuetext", progressText);
  target.bar.style.width = `${safeValue}%`;
  target.label.textContent = progressText;
}

function resetProgressState(target, defaultLabel) {
  if (!target.container || !target.bar || !target.label) {
    return;
  }

  target.container.hidden = true;
  target.container.setAttribute("aria-valuenow", "0");
  target.container.removeAttribute("aria-valuetext");
  target.bar.style.width = "0%";
  target.label.textContent = defaultLabel;
}

function yieldToBrowser() {
  return new Promise((resolve) => {
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => {
        resolve();
      });
      return;
    }

    window.setTimeout(resolve, 0);
  });
}

function isLocalOnlyVerificationOrigin(location) {
  return location.protocol === "file:"
    || location.hostname === "localhost"
    || location.hostname === "127.0.0.1";
}
