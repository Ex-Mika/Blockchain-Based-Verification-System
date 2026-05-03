/**
 * merkle-core.js — Shared Merkle tree logic.
 *
 * This module contains the pure algorithmic functions for building Merkle
 * trees and extracting proofs.  It has **no dependency on ethers.js** so
 * that both the browser bundle (`merkle.js`) and the Node server
 * (`server/merkle.mjs`) can import the same code and stay byte-identical.
 *
 * Hashing is injected via callback so each environment can supply its own
 * ethers-backed implementation.
 */

export const BYTES32_PATTERN = /^0x[a-fA-F0-9]{64}$/;

/**
 * Validate that `value` is a 32-byte hex string (`0x` + 64 hex chars).
 * Throws a plain `Error` on failure.
 */
export function normalizeBytes32(value, label) {
  if (!BYTES32_PATTERN.test(value)) {
    throw new Error(`${label} must be a 32-byte hex value.`);
  }

  return value;
}

/**
 * Validate and normalize the common Merkle option bag.
 */
export function normalizeMerkleOptions(options) {
  const pairing = options.pairing || "sorted";
  const oddLeafStrategy = options.oddLeafStrategy || "duplicate-last";
  const chunkSize = Number(options.chunkSize) || 1024;

  if (pairing !== "sorted" && pairing !== "left-right") {
    throw new Error(`Unsupported Merkle pairing mode: ${pairing}.`);
  }

  // The verifier consumes a plain sibling list, so odd leaves must duplicate themselves.
  if (oddLeafStrategy !== "duplicate-last") {
    throw new Error(`Unsupported odd-leaf strategy: ${oddLeafStrategy}.`);
  }

  return {
    pairing,
    oddLeafStrategy,
    chunkSize: Math.max(1, chunkSize),
    onProgress: typeof options.onProgress === "function" ? options.onProgress : null
  };
}

/**
 * Build all levels of a Merkle tree from an array of leaf hashes.
 *
 * @param {string[]} leaves          Validated bytes32 leaf hashes.
 * @param {(left: string, right: string) => string} hashPairFn
 *   A function that hashes two sibling nodes and returns the parent hash.
 * @returns {string[][]} An array of levels, where `levels[0]` is the
 *   leaves and `levels[levels.length - 1]` contains only the root.
 */
export function buildMerkleLevels(leaves, hashPairFn) {
  const levels = [leaves];

  while (levels[levels.length - 1].length > 1) {
    const currentLevel = levels[levels.length - 1];
    const nextLevel = [];

    for (let index = 0; index < currentLevel.length; index += 2) {
      const left = currentLevel[index];
      const right = currentLevel[index + 1] || left;
      nextLevel.push(hashPairFn(left, right));
    }

    levels.push(nextLevel);
  }

  return levels;
}

/**
 * Extract a Merkle proof (array of sibling hashes) for the leaf at
 * `leafIndex` from a pre-built set of levels.
 *
 * @param {string[][]} levels    Merkle tree levels as returned by `buildMerkleLevels`.
 * @param {number}     leafIndex Zero-based index of the target leaf.
 * @returns {string[]} The proof — one sibling hash per tree level.
 */
export function buildMerkleProof(levels, leafIndex) {
  if (!Number.isInteger(leafIndex) || leafIndex < 0 || leafIndex >= levels[0].length) {
    throw new Error(`Leaf index ${leafIndex} is out of range for the current Merkle tree.`);
  }

  const proof = [];
  let currentIndex = leafIndex;

  for (let depth = 0; depth < levels.length - 1; depth += 1) {
    const currentLevel = levels[depth];
    const siblingIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
    const siblingHash = currentLevel[siblingIndex] || currentLevel[currentIndex];

    proof.push(siblingHash);
    currentIndex = Math.floor(currentIndex / 2);
  }

  return proof;
}
