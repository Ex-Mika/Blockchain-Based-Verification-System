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
      copy: "Scan the credential QR on a phone to open this page with the holder, proof, and on-chain root details.",
      chips: [
        "Phone scan flow",
        APP_CONFIG.network.name
      ]
    });
    renderDetailList(elements.verificationOwnerDetails, [
      ["Recipient Address", "No scanned credential loaded yet."],
      ["Credential ID", "No scanned credential loaded yet."],
      ["Achievement Code", "No scanned credential loaded yet."]
    ]);
    renderDetailList(elements.verificationBatchDetails, [
      ["Batch ID", "No verification link opened yet."],
      ["Payload Network", "No verification link opened yet."],
      ["Merkle Root", "No verification link opened yet."]
    ]);
    renderDetailList(elements.verificationProofDetails, [
      ["Verification Result", "Waiting for a scanned QR link."],
      ["Proof Items", "0"],
      ["Computed Root", "No verification link opened yet."]
    ]);
  }

  function renderLoadingState() {
    setStatus(
      elements.verificationMessage,
      "warning",
      `Checking the QR proof and ${APP_CONFIG.network.name} root...`
    );
    setVerificationStatusCard({
      variant: "neutral",
      title: "Verifying credential",
      copy: `The QR payload is being checked locally, then the configured ${APP_CONFIG.network.name} contract is queried for the anchored root.`,
      chips: [
        "Checking proof",
        "Checking chain"
      ]
    });
    renderDetailList(elements.verificationOwnerDetails, [
      ["Recipient Address", "Loading credential details..."]
    ]);
    renderDetailList(elements.verificationBatchDetails, [
      ["Batch ID", "Loading batch details..."]
    ]);
    renderDetailList(elements.verificationProofDetails, [
      ["Verification Result", "Checking proof and on-chain root..."]
    ]);
  }

  function renderUnavailableState() {
    setStatus(
      elements.verificationMessage,
      "error",
      "The ethers.js browser bundle did not load, so the verification view cannot validate scanned credentials."
    );
    setVerificationStatusCard({
      variant: "error",
      title: "Verification unavailable",
      copy: "This browser session cannot validate the QR payload because the hashing runtime did not load.",
      chips: [
        "Runtime missing"
      ]
    });
    renderDetailList(elements.verificationOwnerDetails, [
      ["Recipient Address", "Unavailable while the verification runtime is missing."]
    ]);
    renderDetailList(elements.verificationBatchDetails, [
      ["Batch ID", "Unavailable while the verification runtime is missing."]
    ]);
    renderDetailList(elements.verificationProofDetails, [
      ["Verification Result", "Unavailable while the verification runtime is missing."]
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
      chips: buildVerificationChips(verificationResult)
    });
    renderDetailList(
      elements.verificationOwnerDetails,
      buildOwnerDetailEntries(verificationResult.credential)
    );
    renderDetailList(
      elements.verificationBatchDetails,
      buildBatchDetailEntries(verificationResult)
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
      copy: "The page opened with a verification payload, but the data could not be decoded or validated.",
      chips: [
        "Invalid payload"
      ]
    });
    renderDetailList(elements.verificationOwnerDetails, [
      ["Owner Details", "The payload could not be decoded."]
    ]);
    renderDetailList(elements.verificationBatchDetails, [
      ["Batch Details", "The payload could not be decoded."]
    ]);
    renderDetailList(elements.verificationProofDetails, [
      ["Verification Result", "The payload could not be decoded."]
    ]);
  }

  function setVerificationStatusCard({ variant, title, copy, chips }) {
    elements.verificationStatusCard.className = `verification-status-card is-${variant}`;
    elements.verificationStatusTitle.textContent = title;
    elements.verificationStatusCopy.textContent = copy;
    renderChips(chips);
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
    return "The holder details were read from the QR link, but the credential data and proof did not resolve to the embedded Merkle root.";
  }

  if (!verificationResult.networkMatchesApp) {
    return `The credential is internally valid, but the payload declares chain ${verificationResult.payloadChainId || "unknown"} instead of ${APP_CONFIG.network.name}. Because the on-chain target does not match this verifier, the credential is treated as invalid.`;
  }

  if (!verificationResult.contractMatchesApp) {
    return "The credential data and proof are internally consistent, but the QR payload contract address does not match the configured verifier contract. Because the expected on-chain contract cannot be confirmed, the credential is treated as invalid.";
  }

  if (verificationResult.onChainError) {
    return `The credential data and proof are internally consistent, but the verifier could not read the configured ${APP_CONFIG.network.name} contract. If the root cannot be verified on-chain, the credential is treated as invalid.`;
  }

  if (verificationResult.onChainRootAnchored === false) {
    return "The credential data and proof resolve to the embedded Merkle root, but that root is not present in the configured on-chain registry.";
  }

  if (verificationResult.onChainRootActive === false) {
    return "The credential data and proof resolve to an anchored root, but that root is no longer active on-chain. Treat the credential as revoked.";
  }

  if (verificationResult.onChainBatchMatches === false) {
    return "The credential data and proof resolve to the embedded Merkle root, but the batch ID in the QR payload maps to a different on-chain root.";
  }

  return "The credential data recomputed to the expected leaf, resolved to the embedded Merkle root, and matched an active on-chain root in the configured verifier contract.";
}

function buildVerificationChips(verificationResult) {
  return [
    verificationResult.localProofValid ? "Proof valid" : "Proof invalid",
    buildOnChainChip(verificationResult),
    verificationResult.batchId ? `Batch ${verificationResult.batchId}` : "No batch ID",
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
    : [["Owner Details", "No credential fields were embedded in the payload."]];
}

function buildBatchDetailEntries(verificationResult) {
  const metadata = verificationResult.metadata || {};
  const payloadNetwork = verificationResult.networkName
    ? `${verificationResult.networkName} (${verificationResult.payloadChainId || "unknown"})`
    : (verificationResult.payloadChainId || "Not provided");

  return [
    ["Batch ID", verificationResult.batchId || "Not provided"],
    ["Payload Network", payloadNetwork],
    ["Payload Contract", verificationResult.contractAddress || "Not provided"],
    ["Verified Contract", verificationResult.verificationContractAddress || APP_CONFIG.contract.address || "Not configured"],
    ["Merkle Root", verificationResult.expectedRoot],
    ["On-Chain Issuer", verificationResult.onChainIssuer || "Not available"],
    ["On-Chain Anchored At", verificationResult.onChainAnchoredAt || "Not available"],
    ["On-Chain Revoked At", formatRevokedAt(verificationResult)],
    ["Issued At", metadata.issuedAt || "Not provided"],
    ["Issuer Note", metadata.issuerNote || "Not provided"],
    ["QR Generated At", metadata.generatedAt || "Not provided"]
  ];
}

function buildProofDetailEntries(verificationResult) {
  return [
    ["Verification Result", formatVerificationResult(verificationResult)],
    ["Local Proof Match", verificationResult.localProofValid ? "Yes" : "No"],
    ["Root Match", verificationResult.rootMatches ? "Yes" : "No"],
    ["Embedded Leaf Match", formatLeafMatch(verificationResult.embeddedLeafMatches)],
    ["App Network Match", verificationResult.networkMatchesApp ? "Yes" : "No"],
    ["Configured Contract Match", verificationResult.contractMatchesApp ? "Yes" : "No"],
    ["On-Chain Check", formatOnChainCheck(verificationResult)],
    ["On-Chain Root Anchored", formatYesNoUnknown(verificationResult.onChainRootAnchored)],
    ["On-Chain Root Active", formatYesNoUnknown(verificationResult.onChainRootActive)],
    ["On-Chain Batch Match", formatYesNoUnknown(verificationResult.onChainBatchMatches)],
    ["Proof Items", String(verificationResult.proofLength)],
    ["Leaf Hash", verificationResult.leafHash],
    ["Computed Root", verificationResult.computedRoot]
  ];
}

function formatLeafMatch(embeddedLeafMatches) {
  if (embeddedLeafMatches === null) {
    return "No embedded leaf hash";
  }

  return embeddedLeafMatches ? "Yes" : "No";
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

function formatOnChainCheck(verificationResult) {
  if (verificationResult.onChainError) {
    return verificationResult.onChainError;
  }

  if (!verificationResult.onChainCheckPerformed) {
    return "Not performed";
  }

  return verificationResult.onChainRpcUrl || "Completed";
}

function formatYesNoUnknown(value) {
  if (value === null) {
    return "Not checked";
  }

  return value ? "Yes" : "No";
}

function formatRevokedAt(verificationResult) {
  if (verificationResult.onChainRevokedAt) {
    return verificationResult.onChainRevokedAt;
  }

  if (verificationResult.onChainRootAnchored === true && verificationResult.onChainRootActive === true) {
    return "Not revoked";
  }

  return "Not available";
}

function formatVerificationResult(verificationResult) {
  if (verificationResult.valid) {
    return "Valid";
  }

  return "Invalid";
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
