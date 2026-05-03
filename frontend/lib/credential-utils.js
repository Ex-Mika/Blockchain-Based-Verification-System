import { APP_CONFIG } from "../config.js";
import { getRuntime } from "./runtime.js";

const BYTES32_PATTERN = /^0x[a-fA-F0-9]{64}$/;

export function getActiveHashingSpec() {
  return {
    method: "solidityPackedKeccak256",
    pairing: APP_CONFIG.hashing.pairing,
    fields: APP_CONFIG.hashing.leafEncoding.map((field) => ({
      key: field.key,
      label: field.label,
      type: field.type
    }))
  };
}

export function summarizeHashingSpec(hashingSpec) {
  const fieldSummary = hashingSpec.fields
    .map((field) => `${field.key}:${field.type}`)
    .join(" | ");

  return `keccak256(solidityPacked(${fieldSummary}))`;
}

export function computeLeafHash(credential, hashingSpec) {
  const { ethers } = getRuntime();
  if (!ethers) {
    throw new Error("The ethers.js browser bundle did not load.");
  }

  const types = [];
  const values = [];

  for (const field of hashingSpec.fields) {
    const rawValue = credential[field.key];
    if (!rawValue) {
      throw new Error(`${field.label} is required to compute the leaf hash.`);
    }

    if (field.type === "address") {
      values.push(ethers.getAddress(rawValue));
    } else {
      values.push(rawValue);
    }

    types.push(field.type);
  }

  return ethers.solidityPackedKeccak256(types, values);
}

export function parseProof(rawProof, options = {}) {
  const allowEmpty = Boolean(options.allowEmpty);
  const trimmed = rawProof.trim();
  if (!trimmed) {
    if (allowEmpty) {
      return [];
    }

    throw new Error("Merkle proof is required.");
  }

  let proof = [];

  try {
    proof = JSON.parse(trimmed);
  } catch {
    proof = trimmed
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (!Array.isArray(proof)) {
    throw new Error("Merkle proof must be a list of bytes32 hashes.");
  }

  if (!proof.length && !allowEmpty) {
    throw new Error("Merkle proof must be a non-empty list of bytes32 hashes.");
  }

  return proof.map((item, index) => {
    return validateBytes32(String(item), `Proof item ${index + 1}`);
  });
}

export function assertProofMatchesRoot(leafHash, proof, expectedRoot, pairing) {
  const computedRoot = computeRootFromProof(leafHash, proof, pairing);
  if (computedRoot.toLowerCase() !== expectedRoot.toLowerCase()) {
    throw new Error("The current Merkle proof does not resolve to the provided root.");
  }
}

export function computeRootFromProof(leafHash, proof, pairing) {
  const { ethers } = getRuntime();
  if (!ethers) {
    throw new Error("The ethers.js browser bundle did not load.");
  }

  let current = validateBytes32(leafHash, "Leaf hash");

  for (const sibling of proof) {
    const pair = pairing === "sorted"
      ? sortPair(current, sibling)
      : [current, sibling];

    current = ethers.solidityPackedKeccak256(["bytes32", "bytes32"], pair);
  }

  return current;
}

export function validateBytes32(value, label) {
  if (!BYTES32_PATTERN.test(value)) {
    throw new Error(`${label} must be a 32-byte hex value.`);
  }

  return value;
}

export function isCredentialComplete(credential) {
  return APP_CONFIG.hashing.leafEncoding.every((field) => {
    return Boolean(String(credential[field.key] || "").trim());
  });
}

export function credentialsMatch(leftCredential, rightCredential) {
  const { ethers } = getRuntime();
  if (!ethers) {
    throw new Error("The ethers.js browser bundle did not load.");
  }

  return APP_CONFIG.hashing.leafEncoding.every((field) => {
    const leftValue = String(leftCredential[field.key] || "").trim();
    const rightValue = String(rightCredential[field.key] || "").trim();

    if (field.type === "address") {
      return ethers.getAddress(leftValue) === ethers.getAddress(rightValue);
    }

    return leftValue === rightValue;
  });
}

export function normalizeConfiguredContractAddress() {
  const { ethers } = getRuntime();
  if (!APP_CONFIG.contract.address) {
    return null;
  }

  if (!ethers) {
    throw new Error("The ethers.js browser bundle did not load.");
  }

  return ethers.getAddress(APP_CONFIG.contract.address);
}

export function createVerificationPackage({
  batchPayload,
  credential,
  proof,
  hashing = getActiveHashingSpec(),
  generatedAt = new Date().toISOString()
}) {
  const leafHash = computeLeafHash(credential, hashing);

  assertProofMatchesRoot(leafHash, proof, batchPayload.merkleRoot, hashing.pairing);

  return {
    schema: APP_CONFIG.qr.schema,
    version: APP_CONFIG.qr.version,
    network: {
      chainId: APP_CONFIG.network.chainId,
      name: APP_CONFIG.network.name
    },
    contractAddress: normalizeConfiguredContractAddress(),
    batchId: batchPayload.batchId,
    merkleRoot: batchPayload.merkleRoot,
    leafHash,
    proof,
    hashing,
    credential,
    metadata: {
      issuedAt: batchPayload.issuedAt,
      issuerNote: batchPayload.issuerNote,
      generatedAt
    }
  };
}

export function encodeVerificationPackage(verificationPackage, options = {}) {
  const encodedPayload = serializeVerificationPackage(verificationPackage);
  const baseUrl = new URL(
    APP_CONFIG.qr.verificationPage,
    options.baseUrl || window.location.href
  );

  baseUrl.search = "";
  baseUrl.searchParams.set(APP_CONFIG.qr.payloadQueryParam, encodedPayload);
  baseUrl.hash = APP_CONFIG.qr.verificationHash || "";

  return baseUrl.toString();
}

export function getVerificationPayloadQueryValue(locationHref = window.location.href) {
  return extractPayloadQueryValue(locationHref);
}

export function decodeVerificationPackage(rawPayload) {
  const trimmed = rawPayload.trim();
  if (!trimmed) {
    throw new Error("QR payload is required.");
  }

  const json = resolveVerificationPackageJson(trimmed);
  const verificationPackage = expandVerificationPackage(JSON.parse(json));
  return validateVerificationPackage(verificationPackage);
}

export function validateVerificationPackage(verificationPackage) {
  if (verificationPackage.schema !== APP_CONFIG.qr.schema) {
    throw new Error(`Unsupported QR schema: ${verificationPackage.schema || "missing"}.`);
  }

  if (!verificationPackage.credential || typeof verificationPackage.credential !== "object") {
    throw new Error("QR payload is missing credential data.");
  }

  verificationPackage.hashing = normalizeVerificationHashing(verificationPackage.hashing);
  verificationPackage.network = normalizeVerificationNetwork(verificationPackage.network);

  verificationPackage.merkleRoot = validateBytes32(
    verificationPackage.merkleRoot,
    "Merkle root"
  );

  if (!Array.isArray(verificationPackage.proof)) {
    throw new Error("QR payload proof must be an array.");
  }

  verificationPackage.proof = verificationPackage.proof.map((item, index) => {
    return validateBytes32(String(item), `Proof item ${index + 1}`);
  });

  if (verificationPackage.leafHash) {
    verificationPackage.leafHash = validateBytes32(
      verificationPackage.leafHash,
      "Leaf hash"
    );
  }

  return verificationPackage;
}

export function verifyVerificationPackage(verificationPackage) {
  const { ethers } = getRuntime();
  if (!ethers) {
    throw new Error("The ethers.js browser bundle did not load.");
  }

  const hashingSpec = verificationPackage.hashing;
  const leafHash = computeLeafHash(verificationPackage.credential, hashingSpec);
  const computedRoot = computeRootFromProof(
    leafHash,
    verificationPackage.proof,
    hashingSpec.pairing || "sorted"
  );
  const embeddedLeafMatches = verificationPackage.leafHash
    ? verificationPackage.leafHash.toLowerCase() === leafHash.toLowerCase()
    : null;
  const rootMatches = computedRoot.toLowerCase() === verificationPackage.merkleRoot.toLowerCase();
  const payloadChainId = normalizeChainId(verificationPackage.network?.chainId);
  const networkMatchesApp = payloadChainId === BigInt(APP_CONFIG.network.chainId);
  const contractMatchesApp = !APP_CONFIG.contract.address || !verificationPackage.contractAddress
    ? true
    : ethers.getAddress(verificationPackage.contractAddress) === normalizeConfiguredContractAddress();

  return {
    localProofValid: rootMatches && embeddedLeafMatches !== false,
    valid: rootMatches && embeddedLeafMatches !== false,
    rootMatches,
    embeddedLeafMatches,
    computedRoot,
    expectedRoot: verificationPackage.merkleRoot,
    payloadChainId: payloadChainId?.toString() || null,
    networkMatchesApp,
    contractMatchesApp,
    contractAddress: verificationPackage.contractAddress || null,
    batchId: verificationPackage.batchId || null,
    networkName: verificationPackage.network?.name || null,
    leafHash,
    proofLength: verificationPackage.proof.length,
    credential: verificationPackage.credential,
    metadata: verificationPackage.metadata || null
  };
}

export async function verifyVerificationPackageAgainstChain(verificationPackage) {
  const localResult = verifyVerificationPackage(verificationPackage);
  const verificationContractAddress = resolveVerificationContractAddress(verificationPackage);

  const verificationResult = {
    ...localResult,
    valid: false,
    verificationContractAddress,
    onChainCheckPerformed: false,
    onChainError: null,
    onChainRpcUrl: null,
    onChainRootAnchored: null,
    onChainRootActive: null,
    onChainBatchRoot: null,
    onChainBatchMatches: null,
    onChainIssuer: null,
    onChainAnchoredAt: null,
    onChainRevokedAt: null
  };

  if (!localResult.networkMatchesApp) {
    return {
      ...verificationResult,
      onChainError: `The QR payload targets chain ${localResult.payloadChainId || "unknown"}, but this verifier is configured for ${APP_CONFIG.network.name}.`
    };
  }

  if (!verificationContractAddress) {
    return {
      ...verificationResult,
      onChainError: "The verifier contract address is not configured."
    };
  }

  try {
    const chainStatus = await readVerificationStatusFromChain(
      verificationPackage,
      verificationContractAddress
    );

    return {
      ...verificationResult,
      ...chainStatus,
      valid: localResult.localProofValid
        && localResult.contractMatchesApp
        && chainStatus.onChainRootActive === true
        && chainStatus.onChainBatchMatches !== false
    };
  } catch (error) {
    return {
      ...verificationResult,
      onChainError: humanizeVerificationReadError(error)
    };
  }
}

export function normalizeChainId(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  try {
    return BigInt(value);
  } catch {
    throw new Error("QR payload contains an invalid chain ID.");
  }
}

function sortPair(left, right) {
  return [left.toLowerCase(), right.toLowerCase()].sort();
}

function serializeVerificationPackage(verificationPackage) {
  const json = JSON.stringify(compactVerificationPackage(verificationPackage));
  return bytesToBase64Url(new TextEncoder().encode(json));
}

function resolveVerificationPackageJson(rawPayload) {
  if (rawPayload.startsWith("{")) {
    return rawPayload;
  }

  if (rawPayload.startsWith(APP_CONFIG.qr.legacyPayloadPrefix)) {
    return base64UrlToString(rawPayload.slice(APP_CONFIG.qr.legacyPayloadPrefix.length));
  }

  if (rawPayload.startsWith("ethcred://verify?payload=")) {
    return base64UrlToString(rawPayload.slice("ethcred://verify?payload=".length));
  }

  const encodedPayload = extractPayloadQueryValue(rawPayload);
  if (encodedPayload) {
    return base64UrlToString(encodedPayload);
  }

  return rawPayload;
}

function extractPayloadQueryValue(rawPayload) {
  try {
    const payloadUrl = new URL(rawPayload, window.location.href);
    return payloadUrl.searchParams.get(APP_CONFIG.qr.payloadQueryParam)
      || payloadUrl.searchParams.get("payload")
      || payloadUrl.searchParams.get("p");
  } catch {
    return null;
  }
}

function compactVerificationPackage(verificationPackage) {
  return {
    s: verificationPackage.schema,
    v: verificationPackage.version,
    b: verificationPackage.batchId,
    r: verificationPackage.merkleRoot,
    p: verificationPackage.proof,
    c: APP_CONFIG.hashing.leafEncoding.map((field) => verificationPackage.credential[field.key] || ""),
    m: [
      verificationPackage.metadata?.issuedAt || null,
      verificationPackage.metadata?.issuerNote || null,
      verificationPackage.metadata?.generatedAt || null
    ]
  };
}

function expandVerificationPackage(rawPackage) {
  if (!isCompactVerificationPackage(rawPackage)) {
    return rawPackage;
  }

  const metadata = Array.isArray(rawPackage.m)
    ? {
        issuedAt: rawPackage.m[0] || null,
        issuerNote: rawPackage.m[1] || null,
        generatedAt: rawPackage.m[2] || null
      }
    : null;

  return {
    schema: rawPackage.s,
    version: rawPackage.v,
    batchId: rawPackage.b,
    merkleRoot: rawPackage.r,
    proof: rawPackage.p,
    credential: expandCompactCredential(rawPackage.c),
    metadata,
    network: {
      chainId: APP_CONFIG.network.chainId,
      name: APP_CONFIG.network.name
    }
  };
}

function isCompactVerificationPackage(rawPackage) {
  return Boolean(rawPackage)
    && typeof rawPackage === "object"
    && !Array.isArray(rawPackage)
    && typeof rawPackage.s === "string"
    && Array.isArray(rawPackage.c)
    && Array.isArray(rawPackage.p);
}

function expandCompactCredential(rawCredential) {
  return APP_CONFIG.hashing.leafEncoding.reduce((credential, field, index) => {
    credential[field.key] = String(rawCredential[index] || "").trim();
    return credential;
  }, {});
}

function normalizeVerificationHashing(rawHashing) {
  if (rawHashing && Array.isArray(rawHashing.fields)) {
    return rawHashing;
  }

  return getActiveHashingSpec();
}

function normalizeVerificationNetwork(rawNetwork) {
  if (rawNetwork && rawNetwork.chainId !== undefined && rawNetwork.chainId !== null) {
    return rawNetwork;
  }

  return {
    chainId: APP_CONFIG.network.chainId,
    name: APP_CONFIG.network.name
  };
}

function bytesToBase64Url(bytes) {
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlToString(encoded) {
  const normalized = encoded
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const paddingLength = (4 - (normalized.length % 4)) % 4;
  const padded = `${normalized}${"=".repeat(paddingLength)}`;
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function resolveVerificationContractAddress(verificationPackage) {
  const { ethers } = getRuntime();
  if (!ethers) {
    throw new Error("The ethers.js browser bundle did not load.");
  }

  const configuredAddress = normalizeConfiguredContractAddress();
  if (configuredAddress) {
    return configuredAddress;
  }

  if (!verificationPackage.contractAddress) {
    return null;
  }

  return ethers.getAddress(verificationPackage.contractAddress);
}

async function readVerificationStatusFromChain(verificationPackage, contractAddress) {
  const statusUrl = new URL("/api/on-chain-root-status", window.location.href);
  statusUrl.searchParams.set("root", verificationPackage.merkleRoot);
  statusUrl.searchParams.set("contractAddress", contractAddress);

  if (verificationPackage.batchId) {
    statusUrl.searchParams.set("batchId", verificationPackage.batchId);
  }

  let response;
  try {
    response = await fetch(statusUrl, {
      headers: {
        Accept: "application/json"
      }
    });
  } catch {
    throw new Error(`Unable to reach the local verifier server for ${APP_CONFIG.network.name} root checks.`);
  }

  const payload = await readOnChainStatusResponse(response);
  if (!response.ok) {
    throw new Error(payload.message || `Unable to read the ${APP_CONFIG.network.name} verifier contract.`);
  }

  return {
    onChainCheckPerformed: true,
    onChainError: null,
    onChainRpcUrl: payload.source || "Server RPC",
    onChainRootAnchored: Boolean(payload.rootAnchored),
    onChainRootActive: Boolean(payload.rootActive),
    onChainBatchRoot: payload.batchRoot ? validateBytes32(String(payload.batchRoot), "On-chain batch root") : null,
    onChainBatchMatches: payload.batchMatches === null || payload.batchMatches === undefined
      ? null
      : Boolean(payload.batchMatches),
    onChainIssuer: payload.issuer || null,
    onChainAnchoredAt: payload.anchoredAt || null,
    onChainRevokedAt: payload.revokedAt || null
  };
}

async function readOnChainStatusResponse(response) {
  const responseText = await response.text();
  if (!responseText) {
    return {};
  }

  try {
    return JSON.parse(responseText);
  } catch {
    if (!response.ok) {
      return { message: responseText };
    }

    throw new Error("The local verifier server returned an invalid JSON response.");
  }
}

function humanizeVerificationReadError(error) {
  if (!error) {
    return `Unable to read the ${APP_CONFIG.network.name} verifier contract.`;
  }

  if (typeof error === "string") {
    return error;
  }

  if (error.shortMessage) {
    return error.shortMessage;
  }

  if (error.message) {
    return error.message;
  }

  return `Unable to read the ${APP_CONFIG.network.name} verifier contract.`;
}
