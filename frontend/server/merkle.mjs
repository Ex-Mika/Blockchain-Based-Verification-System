/**
 * merkle.mjs — Server-side Merkle utilities.
 *
 * Wraps the shared `merkle-core.js` with ethers-backed hashing so the
 * server and browser always use the **same** tree-building and proof-
 * extraction algorithms.
 */

import { ethers } from "ethers";

import { buildMerkleProof as buildMerkleProofCore } from "../merkle-core.js";
import { createHttpError, validateBytes32 } from "./http-utils.mjs";

/**
 * Compute the keccak256 leaf hash for a single credential using the field
 * encoding defined in `leafEncodingFields`.
 *
 * @param {object}   credential          Credential object.
 * @param {object[]} leafEncodingFields  Array of `{ key, label, type }`.
 */
export function computeLeafHash(credential, leafEncodingFields) {
  const types = [];
  const values = [];

  for (const field of leafEncodingFields) {
    const rawValue = credential[field.key];
    if (!rawValue) {
      throw createHttpError(400, `${field.label} is required to compute the leaf hash.`);
    }

    types.push(field.type);
    values.push(field.type === "address" ? ethers.getAddress(rawValue) : rawValue);
  }

  return ethers.solidityPackedKeccak256(types, values);
}

/**
 * Assert that a Merkle proof resolves to the expected root.
 */
export function assertProofMatchesRoot(leafHash, proof, expectedRoot, pairing) {
  const computedRoot = computeRootFromProof(leafHash, proof, pairing);
  if (computedRoot.toLowerCase() !== expectedRoot.toLowerCase()) {
    throw createHttpError(400, "The current Merkle proof does not resolve to the provided root.");
  }
}

/**
 * Walk a proof path from a leaf hash up to a computed root.
 */
export function computeRootFromProof(leafHash, proof, pairing) {
  let current = validateBytes32(leafHash, "Leaf hash");

  for (const sibling of proof) {
    const pair = pairing === "sorted"
      ? sortPair(current, sibling)
      : [current, validateBytes32(String(sibling), "Proof item")];

    current = ethers.solidityPackedKeccak256(["bytes32", "bytes32"], pair);
  }

  return current;
}

/**
 * Extract a Merkle proof from pre-built levels.  Delegates to the shared
 * `merkle-core.js` implementation so the algorithm is identical to the
 * browser version.
 */
export function buildMerkleProof(levels, leafIndex) {
  return buildMerkleProofCore(levels, leafIndex);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sortPair(left, right) {
  return [
    validateBytes32(left, "Proof item").toLowerCase(),
    validateBytes32(String(right), "Proof item").toLowerCase()
  ].sort();
}
