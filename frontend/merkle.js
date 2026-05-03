const { ethers } = window;

const BYTES32_PATTERN = /^0x[a-fA-F0-9]{64}$/;

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
  const levels = buildMerkleLevels(leaves, pairing);

  return {
    root: levels[levels.length - 1][0],
    leaves,
    levels
  };
}

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

function buildMerkleLevels(leaves, pairing) {
  const levels = [leaves];

  while (levels[levels.length - 1].length > 1) {
    const currentLevel = levels[levels.length - 1];
    const nextLevel = [];

    for (let index = 0; index < currentLevel.length; index += 2) {
      const left = currentLevel[index];
      const right = currentLevel[index + 1] || left;
      nextLevel.push(hashPair(left, right, pairing));
    }

    levels.push(nextLevel);
  }

  return levels;
}

function normalizeMerkleOptions(options) {
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

function hashPair(left, right, pairing) {
  const pair = pairing === "sorted"
    ? [left.toLowerCase(), right.toLowerCase()].sort()
    : [left, right];

  return ethers.solidityPackedKeccak256(["bytes32", "bytes32"], pair);
}

function normalizeBytes32(value, label) {
  if (!BYTES32_PATTERN.test(value)) {
    throw new Error(`${label} must be a 32-byte hex value.`);
  }

  return value;
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
