/**
 * merkle.js — Browser-side Merkle tree builder.
 *
 * Tree-building and proof-extraction algorithms are imported from the
 * shared `merkle-core.js` so that the browser and server always use the
 * **exact same** logic.  Only the ethers-backed hash function is defined
 * locally (via `window.ethers`).
 */

import {
  buildMerkleLevels,
  buildMerkleProof,
  normalizeBytes32,
  normalizeMerkleOptions
} from "./merkle-core.js";

const { ethers } = window;

// Re-export the shared proof builder so existing consumers keep working.
export { buildMerkleProof };

/**
 * Synchronously build all Merkle artifacts (root, leaves, levels) from
 * an array of leaf hashes.
 */
export function buildMerkleArtifacts(leafHashes, options = {}) {
  if (!ethers) {
    throw new Error("The ethers.js browser bundle is required before building a Merkle tree.");
  }

  const { pairing } = normalizeMerkleOptions(options);

  if (!Array.isArray(leafHashes) || !leafHashes.length) {
    throw new Error("At least one leaf hash is required to build a Merkle tree.");
  }

  const leaves = leafHashes.map((leafHash, index) =>
    normalizeBytes32(String(leafHash), `Leaf ${index + 1}`)
  );
  const levels = buildMerkleLevels(leaves, (left, right) => hashPair(left, right, pairing));

  return {
    root: levels[levels.length - 1][0],
    leaves,
    levels
  };
}

/**
 * Asynchronously build Merkle artifacts, yielding to the browser between
 * chunks so the UI stays responsive for large batches.
 */
export async function buildMerkleArtifactsAsync(leafHashes, options = {}) {
  if (!ethers) {
    throw new Error("The ethers.js browser bundle is required before building a Merkle tree.");
  }

  if (!Array.isArray(leafHashes) || !leafHashes.length) {
    throw new Error("At least one leaf hash is required to build a Merkle tree.");
  }

  const { pairing, chunkSize, onProgress } = normalizeMerkleOptions(options);
  const leaves = leafHashes.map((leafHash, index) => {
    return normalizeBytes32(String(leafHash), `Leaf ${index + 1}`);
  });
  const levels = [leaves];

  while (levels[levels.length - 1].length > 1) {
    const currentLevel = levels[levels.length - 1];
    const nextLevel = new Array(Math.ceil(currentLevel.length / 2));

    for (let index = 0; index < currentLevel.length; index += 2) {
      const left = currentLevel[index];
      const right = currentLevel[index + 1] || left;
      nextLevel[Math.floor(index / 2)] = hashPair(left, right, pairing);

      if (((index / 2) + 1) % chunkSize === 0) {
        await yieldToBrowser();
      }
    }

    levels.push(nextLevel);
    onProgress?.({
      phase: "tree",
      levelIndex: levels.length - 1,
      levelWidth: nextLevel.length
    });
    await yieldToBrowser();
  }

  return {
    root: levels[levels.length - 1][0],
    leaves,
    levels
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function hashPair(left, right, pairing) {
  const pair = pairing === "sorted"
    ? [left.toLowerCase(), right.toLowerCase()].sort()
    : [left, right];

  return ethers.solidityPackedKeccak256(["bytes32", "bytes32"], pair);
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
