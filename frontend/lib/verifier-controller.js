import { APP_CONFIG } from "../config.js";
import {
  decodeVerificationPackage,
  getVerificationPayloadQueryValue,
  verifyVerificationPackageAgainstChain
} from "./credential-utils.js";
import { getRuntime } from "./runtime.js";
import { humanizeError, resetStatus, setStatus } from "./ui.js";

export function createVerifierController({ elements }) {
  let activeRenderToken = 0;

  function bindEvents() {
    window.addEventListener("popstate", () => {
      void renderFromCurrentLocation();
    });
  }

  function initialize() {
    void renderFromCurrentLocation();
  }

  async function renderFromCurrentLocation() {
    const renderToken = ++activeRenderToken;
    const { ethers } = getRuntime();
    if (!ethers) {
      renderUnavailableState();
      return;
    }

    if (!getVerificationPayloadQueryValue(window.location.href)) {
      renderIdleState();
      return;
    }

    renderLoadingState();

    try {
      const verificationPackage = decodeVerificationPackage(window.location.href);
      const verificationResult = await verifyVerificationPackageAgainstChain(verificationPackage);
      if (renderToken !== activeRenderToken) {
        return;
      }
      renderVerificationResult(verificationResult);
    } catch (error) {
      if (renderToken !== activeRenderToken) {
        return;
      }
      renderErrorState(humanizeError(error));
    }
  }

  function renderIdleState() {
    resetStatus(elements.verificationMessage);
    setVerificationStatusCard({
      variant: "neutral",
      title: "Awaiting credential scan",
      copy: "Scan a credential QR code to verify its Merkle proof and on-chain root.",
      chips: [APP_CONFIG.network.name],
      icon: "waiting"
    });
    renderDetailList(elements.verificationOwnerDetails, [
      ["Holder Name", "N/A"],
      ["Credential Title", "N/A"],
      ["Recipient", "N/A"],
      ["Credential ID", "N/A"],
      ["Achievement", "N/A"],
      ["Issue Date", "N/A"]
    ]);
    renderDetailList(elements.verificationProofDetails, [
      ["Result", "Waiting for scan"],
      ["Batch ID", "N/A"],
      ["Network", "N/A"],
      ["Merkle Root", "N/A"]
    ]);
  }

  function renderLoadingState() {
    setStatus(
      elements.verificationMessage,
      "warning",
      `Checking proof and ${APP_CONFIG.network.name} root...`
    );
    setVerificationStatusCard({
      variant: "warning",
      title: "Verifying credential...",
      copy: `Checking the QR payload locally and querying the ${APP_CONFIG.network.name} contract.`,
      chips: ["Checking proof", "Checking chain"],
      icon: "loading"
    });
    renderDetailList(elements.verificationOwnerDetails, [
      ["Recipient", "Loading..."]
    ]);
    renderDetailList(elements.verificationProofDetails, [
      ["Result", "Checking..."]
    ]);
  }

  function renderUnavailableState() {
    setStatus(
      elements.verificationMessage,
      "error",
      "The ethers.js runtime did not load. Verification is unavailable."
    );
    setVerificationStatusCard({
      variant: "error",
      title: "Verification unavailable",
      copy: "The hashing runtime failed to load. Reload the page or try a different browser.",
      chips: ["Runtime missing"],
      icon: "error"
    });
    renderDetailList(elements.verificationOwnerDetails, [
      ["Status", "Runtime unavailable"]
    ]);
    renderDetailList(elements.verificationProofDetails, [
      ["Status", "Runtime unavailable"]
    ]);
  }

  function renderVerificationResult(verificationResult) {
    const statusVariant = resolveVerificationVariant(verificationResult);
    const summary = buildVerificationSummary(verificationResult);

    setStatus(elements.verificationMessage, statusVariant, summary);
    setVerificationStatusCard({
      variant: statusVariant,
      title: buildVerificationTitle(verificationResult),
      copy: buildVerificationCopy(verificationResult),
      chips: buildVerificationChips(verificationResult),
      icon: verificationResult.valid ? "success" : "error"
    });
    renderDetailList(
      elements.verificationOwnerDetails,
      buildOwnerDetailEntries(verificationResult.credential)
    );
    renderDetailList(
      elements.verificationProofDetails,
      buildProofDetailEntries(verificationResult)
    );
  }

  function renderErrorState(message) {
    setStatus(elements.verificationMessage, "error", message);
    setVerificationStatusCard({
      variant: "error",
      title: "Credential link could not be read",
      copy: "The QR data could not be decoded. The link may be corrupted or incomplete.",
      chips: ["Invalid payload"],
      icon: "error"
    });
    renderDetailList(elements.verificationOwnerDetails, [
      ["Status", "Payload could not be decoded"]
    ]);
    renderDetailList(elements.verificationProofDetails, [
      ["Status", "Payload could not be decoded"]
    ]);
  }

  function setVerificationStatusCard({ variant, title, copy, chips, icon }) {
    elements.verificationStatusCard.className = `verify-status-card is-${variant}`;
    elements.verificationStatusTitle.textContent = title;
    elements.verificationStatusCopy.textContent = copy;
    setStatusIcon(icon);
    renderChips(chips);
  }

  function setStatusIcon(type) {
    const iconEl = elements.verificationStatusIcon;
    if (!iconEl) return;

    const icons = {
      success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>`,
      error: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="15" y1="9" x2="9" y2="15"/>
        <line x1="9" y1="9" x2="15" y2="15"/>
      </svg>`,
      warning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>`,
      waiting: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12 6 12 12 16 14"/>
      </svg>`,
      loading: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="2" x2="12" y2="6"/>
        <line x1="12" y1="18" x2="12" y2="22"/>
        <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/>
        <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
        <line x1="2" y1="12" x2="6" y2="12"/>
        <line x1="18" y1="12" x2="22" y2="12"/>
        <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/>
        <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
      </svg>`
    };

    iconEl.innerHTML = icons[type] || icons.waiting;
  }

  function renderChips(chips) {
    elements.verificationChipRow.replaceChildren();

    for (const chipLabel of chips.filter(Boolean)) {
      const chip = document.createElement("span");
      chip.className = "verification-chip";
      chip.textContent = chipLabel;
      elements.verificationChipRow.append(chip);
    }
  }

  function renderDetailList(container, entries) {
    container.replaceChildren();

    for (const [label, value] of entries) {
      const row = document.createElement("div");
      const term = document.createElement("dt");
      const description = document.createElement("dd");

      row.className = "detail-row";
      term.textContent = label;
      description.textContent = value;

      row.append(term, description);
      container.append(row);
    }
  }

  return {
    bindEvents,
    initialize
  };
}

function resolveVerificationVariant(verificationResult) {
  if (verificationResult.valid) {
    return "success";
  }

  if (!verificationResult.localProofValid) {
    return "error";
  }

  if (!verificationResult.networkMatchesApp || !verificationResult.contractMatchesApp) {
    return "error";
  }

  if (verificationResult.onChainError) {
    return "error";
  }

  return "error";
}

function buildVerificationSummary(verificationResult) {
  if (verificationResult.valid) {
    return `Credential proof is valid and the root is active on ${APP_CONFIG.network.name}.`;
  }

  if (!verificationResult.localProofValid) {
    return "The scanned credential payload failed local Merkle proof verification.";
  }

  if (!verificationResult.networkMatchesApp) {
    return `Credential proof is locally valid, but the payload targets chain ${verificationResult.payloadChainId || "unknown"}, so this credential is invalid in the configured verifier.`;
  }

  if (!verificationResult.contractMatchesApp) {
    return "Credential proof is locally valid, but the payload contract does not match the configured verifier contract, so the credential is invalid.";
  }

  if (verificationResult.onChainError) {
    return `Credential proof is locally valid, but the ${APP_CONFIG.network.name} root could not be confirmed on-chain, so the credential is invalid.`;
  }

  if (verificationResult.onChainRootAnchored === false) {
    return "Credential proof is locally valid, but the Merkle root is not anchored on-chain, so the credential is invalid.";
  }

  if (verificationResult.onChainRootActive === false) {
    return "Credential proof is locally valid, but the Merkle root is revoked or inactive on-chain, so the credential is invalid.";
  }

  if (verificationResult.onChainBatchMatches === false) {
    return "Credential proof is locally valid, but the batch ID does not resolve to this root on-chain, so the credential is invalid.";
  }

  return "Credential verification could not be completed.";
}

function buildVerificationTitle(verificationResult) {
  if (verificationResult.valid) {
    return "Credential verified";
  }

  return "Credential invalid";
}

function buildVerificationCopy(verificationResult) {
  if (!verificationResult.localProofValid) {
    return "The credential data and proof did not resolve to the embedded Merkle root.";
  }

  if (!verificationResult.networkMatchesApp) {
    return `The credential targets chain ${verificationResult.payloadChainId || "unknown"} instead of ${APP_CONFIG.network.name}. The credential is treated as invalid.`;
  }

  if (!verificationResult.contractMatchesApp) {
    return "The QR payload contract address does not match the configured verifier contract.";
  }

  if (verificationResult.onChainError) {
    return `Could not read the ${APP_CONFIG.network.name} contract. The root cannot be verified on-chain.`;
  }

  if (verificationResult.onChainRootAnchored === false) {
    return "The proof resolves to the embedded root, but that root is not present in the on-chain registry.";
  }

  if (verificationResult.onChainRootActive === false) {
    return "The root is anchored but no longer active on-chain. Treat the credential as revoked.";
  }

  if (verificationResult.onChainBatchMatches === false) {
    return "The batch ID in the QR payload maps to a different on-chain root.";
  }

  return "The credential data recomputed to the expected leaf, resolved to the embedded Merkle root, and matched an active on-chain root.";
}

function buildVerificationChips(verificationResult) {
  return [
    verificationResult.localProofValid ? "Proof valid" : "Proof invalid",
    buildOnChainChip(verificationResult),
    verificationResult.batchId ? `Batch ${verificationResult.batchId}` : null,
    !verificationResult.contractMatchesApp
      ? "Contract mismatch"
      : verificationResult.networkMatchesApp
        ? APP_CONFIG.network.name
        : `Chain ${verificationResult.payloadChainId || "unknown"}`
  ];
}

function buildOwnerDetailEntries(credential) {
  const orderedKeys = APP_CONFIG.hashing.leafEncoding.map((field) => field.key);
  const usedKeys = new Set();
  const detailEntries = [];

  for (const field of APP_CONFIG.hashing.leafEncoding) {
    if (credential[field.key] === undefined || credential[field.key] === null || credential[field.key] === "") {
      continue;
    }

    usedKeys.add(field.key);
    detailEntries.push([field.label, formatDetailValue(credential[field.key])]);
  }

  for (const [key, value] of Object.entries(credential)) {
    if (usedKeys.has(key) || isEmptyDetailValue(value)) {
      continue;
    }

    if (!orderedKeys.includes(key)) {
      detailEntries.push([formatDetailLabel(key), formatDetailValue(value)]);
    }
  }

  return detailEntries.length
    ? detailEntries
    : [["Status", "No credential fields were embedded in the payload."]];
}

function buildProofDetailEntries(verificationResult) {
  const entries = [
    ["Result", verificationResult.valid ? "Valid" : "Invalid"],
    ["Batch ID", verificationResult.batchId || "Not provided"],
    ["Network", verificationResult.networkName
      ? `${verificationResult.networkName} (${verificationResult.payloadChainId || "N/A"})`
      : (verificationResult.payloadChainId || "Not provided")],
    ["On-Chain Root", formatOnChainRootStatus(verificationResult)],
    ["Proof Items", String(verificationResult.proofLength)],
    ["Leaf Hash", verificationResult.leafHash],
    ["Merkle Root", verificationResult.expectedRoot]
  ];

  return entries;
}

function formatOnChainRootStatus(verificationResult) {
  if (verificationResult.onChainError) {
    return "Check failed";
  }
  if (verificationResult.onChainRootAnchored === false) {
    return "Not anchored";
  }
  if (verificationResult.onChainRootActive === false) {
    return "Revoked";
  }
  if (verificationResult.onChainRootActive === true && verificationResult.onChainBatchMatches !== false) {
    return "Active";
  }
  if (verificationResult.onChainBatchMatches === false) {
    return "Batch mismatch";
  }
  return "Pending";
}

function buildOnChainChip(verificationResult) {
  if (verificationResult.onChainError) {
    return "Chain check failed";
  }

  if (verificationResult.onChainRootActive === true && verificationResult.onChainBatchMatches !== false) {
    return "Root active on-chain";
  }

  if (verificationResult.onChainRootAnchored === false) {
    return "Root not anchored";
  }

  if (verificationResult.onChainRootActive === false) {
    return "Root inactive on-chain";
  }

  if (verificationResult.onChainBatchMatches === false) {
    return "Batch mismatch";
  }

  return "Chain status pending";
}

function formatDetailLabel(rawKey) {
  return rawKey
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatDetailValue(value) {
  if (Array.isArray(value)) {
    return value.join(", ");
  }

  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function isEmptyDetailValue(value) {
  return value === null || value === undefined || String(value).trim() === "";
}
