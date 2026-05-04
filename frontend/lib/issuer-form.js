import { APP_CONFIG } from "../config.js";
import {
  credentialsMatch,
  isCredentialComplete,
  validateBytes32
} from "./credential-utils.js";

export function getBatchPayload(elements) {
  const form = new FormData(elements.issuerForm);
  const {
    batchId,
    issuedAt,
    issuerNote
  } = getBatchDraft(elements);
  const merkleRoot = validateBytes32(
    String(form.get("merkleRoot") || "").trim(),
    "Merkle root"
  );

  if (!batchId) {
    throw new Error("Batch ID is required.");
  }

  return {
    batchId,
    merkleRoot,
    issuedAt: issuedAt || null,
    issuerNote: issuerNote || null
  };
}

export function getBatchDraft(elements) {
  const form = new FormData(elements.issuerForm);

  return {
    batchId: String(form.get("batchId") || "").trim(),
    issuedAt: String(form.get("issuedAt") || "").trim(),
    issuerNote: String(form.get("issuerNote") || "").trim()
  };
}

export function getCredentialInput(elements) {
  const form = new FormData(elements.issuerForm);
  const values = Object.fromEntries(form.entries());

  return {
    holderName: String(values.holderName || "").trim(),
    credentialTitle: String(values.credentialTitle || "").trim(),
    recipient: String(values.recipient || "").trim(),
    credentialId: String(values.credentialId || "").trim(),
    achievementCode: String(values.achievementCode || "").trim(),
    issueDate: String(values.issueDate || "").trim(),
    issuerId: String(values.issuerId || "").trim()
  };
}

export function hydrateCredentialForm(elements, credential) {
  elements.holderNameInput.value = credential.holderName;
  elements.credentialTitleInput.value = credential.credentialTitle;
  elements.recipientInput.value = credential.recipient;
  elements.credentialIdInput.value = credential.credentialId;
  elements.achievementCodeInput.value = credential.achievementCode;
  elements.issueDateInput.value = credential.issueDate;
  elements.issuerIdInput.value = credential.issuerId;
}

export function parseBatchCredentialsText(rawInput) {
  const trimmedInput = rawInput.trim();
  if (!trimmedInput) {
    throw new Error("Batch credentials JSON is required before building the Merkle tree.");
  }

  let parsedBatch = null;

  try {
    parsedBatch = JSON.parse(trimmedInput);
  } catch {
    throw new Error("Batch credentials must be a valid JSON array.");
  }

  if (!Array.isArray(parsedBatch) || !parsedBatch.length) {
    throw new Error("Batch credentials JSON must contain at least one credential object.");
  }

  return parsedBatch.map((credential, index) => {
    return normalizeBatchCredential(credential, index);
  });
}

export function resolveProofTargetIndex(elements, credentials) {
  const form = new FormData(elements.issuerForm);
  const rawIndex = String(form.get("proofTargetIndex") || "").trim();
  if (rawIndex) {
    return getValidatedMerkleTargetIndex(rawIndex, credentials.length);
  }

  const draftCredential = getCredentialInput(elements);
  if (isCredentialComplete(draftCredential)) {
    try {
      const matchedIndex = credentials.findIndex((credential) => {
        return credentialsMatch(credential, draftCredential);
      });
      if (matchedIndex >= 0) {
        return matchedIndex;
      }
    } catch {
      // Ignore an invalid draft credential and fall back to the first batch entry.
    }
  }

  return 0;
}

export function getValidatedMerkleTargetIndex(value, credentialCount) {
  const parsedIndex = Number(value);

  if (!Number.isInteger(parsedIndex) || parsedIndex < 0 || parsedIndex >= credentialCount) {
    throw new Error(`Proof target index must be an integer between 0 and ${credentialCount - 1}.`);
  }

  return parsedIndex;
}

function normalizeBatchCredential(credential, index) {
  if (!credential || typeof credential !== "object" || Array.isArray(credential)) {
    throw new Error(`Batch credential ${index + 1} must be a JSON object.`);
  }

  const normalizedCredential = {};

  for (const field of APP_CONFIG.hashing.leafEncoding) {
    const explicitValue = String(credential[field.key] ?? "").trim();
    const value = explicitValue || deriveCredentialField(field.key, credential, index);
    if (!value) {
      throw new Error(`Batch credential ${index + 1} is missing ${field.label}.`);
    }

    normalizedCredential[field.key] = value;
  }

  return normalizedCredential;
}

function deriveCredentialField(fieldKey, credential, index) {
  if (fieldKey === "holderName") {
    return buildFallbackHolderName(credential, index);
  }

  if (fieldKey === "credentialTitle") {
    return buildFallbackCredentialTitle(credential);
  }

  return "";
}

function buildFallbackHolderName(credential, index) {
  const directName = String(
    credential.name
      ?? credential.fullName
      ?? credential.studentName
      ?? credential.learnerName
      ?? ""
  ).trim();

  if (directName) {
    return directName;
  }

  const credentialId = String(credential.credentialId ?? "").trim();
  return credentialId
    ? `Credential Holder ${credentialId}`
    : `Credential Holder ${index + 1}`;
}

function buildFallbackCredentialTitle(credential) {
  const directTitle = String(
    credential.title
      ?? credential.certificateTitle
      ?? credential.courseTitle
      ?? credential.programTitle
      ?? ""
  ).trim();

  if (directTitle) {
    return directTitle;
  }

  const sourceEducation = String(credential.sourceSummary?.education ?? "").trim();
  if (sourceEducation) {
    return `${formatCodeLabel(sourceEducation)} Credential`;
  }

  const achievementCode = String(credential.achievementCode ?? "").trim();
  if (achievementCode) {
    return `${formatCodeLabel(achievementCode)} Credential`;
  }

  return "Micro-Credential Certificate";
}

function formatCodeLabel(value) {
  return String(value)
    .replace(/^UCI[-_ ]ADULT[-_ ]?/i, "")
    .replace(/GT50K/gi, "Above 50K")
    .replace(/LTE50K/gi, "At Most 50K")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\b[a-z]/g, (character) => character.toUpperCase());
}
