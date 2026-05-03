import { APP_CONFIG } from "../config.js";
import { shortenAddress, shortenHash } from "./ui.js";

export function createMerkleTreeView({ state, elements }) {
  let onLeafSelect = null;

  function bindEvents(handleLeafSelect) {
    onLeafSelect = handleLeafSelect;
    elements.merkleTreeStage.addEventListener("click", handleStageClick);
    elements.merkleTreeStage.addEventListener("keydown", handleStageKeydown);
    window.addEventListener("resize", scheduleLineRender);
  }

  function render(build) {
    if (!build) {
      clear();
      return;
    }

    const { credentials, merkleArtifacts, targetIndex, selectedProof } = build;
    if (!shouldRenderVisualMerkleTree(merkleArtifacts.leaves.length)) {
      renderTextSummary(credentials, merkleArtifacts, targetIndex, selectedProof);
      return;
    }

    const selectedPathKeys = buildSelectedPathKeys(merkleArtifacts.levels, targetIndex);
    const visualLevels = buildVisualMerkleLevels(
      credentials,
      merkleArtifacts,
      selectedPathKeys,
      targetIndex
    );
    const fragment = document.createDocumentFragment();

    elements.merkleLegend.hidden = false;
    elements.merkleTreeStage.textContent = "";
    elements.merkleTreeLines.textContent = "";
    elements.merkleTreeText.textContent = "";
    elements.merkleTreeShell.classList.remove("is-text-mode");

    for (const levelNodes of visualLevels) {
      const levelElement = document.createElement("div");
      levelElement.className = "merkle-tree-level";

      for (const node of levelNodes) {
        levelElement.append(createMerkleNodeElement(node));
      }

      fragment.append(levelElement);
    }

    elements.merkleTreeStage.append(fragment);
    elements.merkleTreeShell.classList.remove("is-empty");
    elements.merkleTreeShell.classList.toggle(
      "is-compact",
      merkleArtifacts.leaves.length <= APP_CONFIG.ui.visualMerkleLeafLimit
    );
    scheduleLineRender();
  }

  function clear() {
    if (state.merkleRenderFrameId) {
      cancelAnimationFrame(state.merkleRenderFrameId);
      state.merkleRenderFrameId = null;
    }

    elements.merkleLegend.hidden = false;
    elements.merkleTreeStage.textContent = "";
    elements.merkleTreeLines.textContent = "";
    elements.merkleTreeText.textContent = "";
    elements.merkleTreeShell.classList.add("is-empty");
    elements.merkleTreeShell.classList.remove("is-text-mode");
  }

  function handleStageClick(event) {
    if (!state.merkleBuild || !onLeafSelect) {
      return;
    }

    const leafNode = event.target.closest("[data-leaf-index]");
    if (!leafNode) {
      return;
    }

    const targetIndex = Number(leafNode.dataset.leafIndex);
    onLeafSelect(targetIndex, {
      message: `Loaded proof for leaf ${targetIndex} from the visual tree.`
    });
  }

  function handleStageKeydown(event) {
    if ((event.key !== "Enter" && event.key !== " ") || !state.merkleBuild || !onLeafSelect) {
      return;
    }

    const leafNode = event.target.closest("[data-leaf-index]");
    if (!leafNode) {
      return;
    }

    event.preventDefault();
    const targetIndex = Number(leafNode.dataset.leafIndex);
    onLeafSelect(targetIndex, {
      message: `Loaded proof for leaf ${targetIndex} from the visual tree.`
    });
  }

  function renderTextSummary(credentials, merkleArtifacts, targetIndex, selectedProof) {
    const leafCount = merkleArtifacts.leaves.length;
    const selectedCredential = credentials[targetIndex];
    const proof = selectedProof;
    const sampleIndexes = buildTextSummarySampleIndexes(leafCount, targetIndex);
    const lines = [
      `Text mode enabled because leaf count ${leafCount} exceeds the visual limit ${APP_CONFIG.ui.visualMerkleLeafLimit}.`,
      "",
      `Merkle root: ${merkleArtifacts.root}`,
      `Leaf count: ${leafCount}`,
      `Level widths: ${merkleArtifacts.levels.map((level) => level.length).join(" -> ")}`,
      `Selected proof target: ${targetIndex}`,
      `Selected credential: ${selectedCredential.credentialId}`,
      `Recipient: ${selectedCredential.recipient}`,
      `Achievement code: ${selectedCredential.achievementCode}`,
      `Selected leaf hash: ${merkleArtifacts.leaves[targetIndex]}`,
      `Proof depth: ${proof.length}`,
      `Leaf sample size: ${sampleIndexes.length} of ${leafCount}`,
      "",
      "Proof siblings:",
      ...proof.map((hash, index) => `  [${index}] ${hash}`),
      "",
      "Leaf summary:",
      ...sampleIndexes.map((index) => {
        const credential = credentials[index];
        const marker = index === targetIndex ? "*" : "-";
        return `${marker} [${index}] ${credential.credentialId} | ${shortenAddress(credential.recipient)} | ${shortenHash(merkleArtifacts.leaves[index])}`;
      }),
      "",
      `Omitted leaves: ${leafCount - sampleIndexes.length}`
    ];

    if (state.merkleRenderFrameId) {
      cancelAnimationFrame(state.merkleRenderFrameId);
      state.merkleRenderFrameId = null;
    }

    elements.merkleLegend.hidden = true;
    elements.merkleTreeStage.textContent = "";
    elements.merkleTreeLines.textContent = "";
    elements.merkleTreeText.textContent = lines.join("\n");
    elements.merkleTreeShell.classList.remove("is-empty");
    elements.merkleTreeShell.classList.add("is-text-mode");
  }

  function scheduleLineRender() {
    if (!state.merkleBuild) {
      return;
    }

    const leafCount = state.merkleBuild.merkleArtifacts.leaves.length;
    if (!shouldRenderVisualMerkleTree(leafCount)) {
      return;
    }

    if (state.merkleRenderFrameId) {
      cancelAnimationFrame(state.merkleRenderFrameId);
    }

    state.merkleRenderFrameId = requestAnimationFrame(() => {
      state.merkleRenderFrameId = null;
      drawMerkleTreeLines();
    });
  }

  function drawMerkleTreeLines() {
    if (!state.merkleBuild || !elements.merkleTreeStage.children.length) {
      elements.merkleTreeLines.textContent = "";
      return;
    }

    const { merkleArtifacts, targetIndex } = state.merkleBuild;
    const stageRect = elements.merkleTreeStage.getBoundingClientRect();
    const stageWidth = Math.ceil(elements.merkleTreeStage.offsetWidth);
    const stageHeight = Math.ceil(elements.merkleTreeStage.offsetHeight);
    const selectedPathKeys = buildSelectedPathKeys(merkleArtifacts.levels, targetIndex);

    elements.merkleTreeLines.textContent = "";
    elements.merkleTreeLines.setAttribute("viewBox", `0 0 ${stageWidth} ${stageHeight}`);
    elements.merkleTreeLines.setAttribute("width", String(stageWidth));
    elements.merkleTreeLines.setAttribute("height", String(stageHeight));

    for (
      let originalLevelIndex = merkleArtifacts.levels.length - 1;
      originalLevelIndex > 0;
      originalLevelIndex -= 1
    ) {
      const level = merkleArtifacts.levels[originalLevelIndex];

      for (let nodeIndex = 0; nodeIndex < level.length; nodeIndex += 1) {
        const parentKey = makeMerkleNodeKey(originalLevelIndex, nodeIndex);
        const parentElement = findMerkleNodeElement(parentKey);

        if (!parentElement) {
          continue;
        }

        for (const childIndex of [nodeIndex * 2, (nodeIndex * 2) + 1]) {
          const childHash = merkleArtifacts.levels[originalLevelIndex - 1][childIndex];
          if (!childHash) {
            continue;
          }

          const childKey = makeMerkleNodeKey(originalLevelIndex - 1, childIndex);
          const childElement = findMerkleNodeElement(childKey);

          if (!childElement) {
            continue;
          }

          const isPath = selectedPathKeys.has(parentKey) && selectedPathKeys.has(childKey);
          elements.merkleTreeLines.append(
            createMerkleLinePath(stageRect, parentElement, childElement, isPath)
          );
        }
      }
    }
  }

  function findMerkleNodeElement(nodeKey) {
    return elements.merkleTreeStage.querySelector(`[data-node-key="${nodeKey}"]`);
  }

  function createMerkleLinePath(stageRect, parentElement, childElement, isPath) {
    const parentRect = parentElement.getBoundingClientRect();
    const childRect = childElement.getBoundingClientRect();
    const startX = parentRect.left - stageRect.left + (parentRect.width / 2);
    const startY = parentRect.top - stageRect.top + parentRect.height;
    const endX = childRect.left - stageRect.left + (childRect.width / 2);
    const endY = childRect.top - stageRect.top;
    const controlY = startY + ((endY - startY) * 0.45);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");

    path.setAttribute(
      "d",
      `M ${startX} ${startY} C ${startX} ${controlY}, ${endX} ${controlY}, ${endX} ${endY}`
    );
    path.setAttribute("class", isPath ? "merkle-line is-path" : "merkle-line");

    return path;
  }

  function buildVisualMerkleLevels(credentials, merkleArtifacts, selectedPathKeys, targetIndex) {
    const visualLevels = [];

    for (
      let originalLevelIndex = merkleArtifacts.levels.length - 1;
      originalLevelIndex >= 0;
      originalLevelIndex -= 1
    ) {
      const nodes = merkleArtifacts.levels[originalLevelIndex].map((hash, nodeIndex) => {
        const isRoot = originalLevelIndex === merkleArtifacts.levels.length - 1;
        const isLeaf = originalLevelIndex === 0;
        const key = makeMerkleNodeKey(originalLevelIndex, nodeIndex);
        const duplicatesLastChild = !isLeaf
          && !merkleArtifacts.levels[originalLevelIndex - 1][(nodeIndex * 2) + 1];

        return {
          key,
          originalLevelIndex,
          nodeIndex,
          hash,
          isRoot,
          isLeaf,
          isPath: selectedPathKeys.has(key),
          isSelectedLeaf: isLeaf && nodeIndex === targetIndex,
          duplicatesLastChild,
          credential: isLeaf ? credentials[nodeIndex] : null
        };
      });

      visualLevels.push(nodes);
    }

    return visualLevels;
  }

  function createMerkleNodeElement(node) {
    const nodeElement = document.createElement("article");
    const nodeClasses = ["merkle-node"];

    if (node.isRoot) {
      nodeClasses.push("is-root");
    }

    if (node.isLeaf) {
      nodeClasses.push("is-leaf");
    }

    if (node.isPath) {
      nodeClasses.push("is-path");
    }

    if (node.isSelectedLeaf) {
      nodeClasses.push("is-selected-leaf");
    }

    nodeElement.className = nodeClasses.join(" ");
    nodeElement.dataset.nodeKey = node.key;
    nodeElement.title = node.hash;

    if (node.isLeaf) {
      nodeElement.dataset.leafIndex = String(node.nodeIndex);
      nodeElement.tabIndex = 0;
      nodeElement.setAttribute("role", "button");
      nodeElement.setAttribute("aria-pressed", node.isSelectedLeaf ? "true" : "false");
      nodeElement.setAttribute("aria-label", `Select proof target leaf ${node.nodeIndex}`);
    }

    if (node.duplicatesLastChild) {
      const badge = document.createElement("span");
      badge.className = "merkle-node-badge";
      badge.textContent = "dup";
      nodeElement.append(badge);
    }

    const kicker = document.createElement("span");
    kicker.className = "merkle-node-kicker";
    kicker.textContent = getMerkleNodeKicker(node);

    const title = document.createElement("strong");
    title.className = "merkle-node-title";
    title.textContent = getMerkleNodeTitle(node);

    const meta = document.createElement("span");
    meta.className = "merkle-node-meta";
    meta.textContent = getMerkleNodeMeta(node);

    const hash = document.createElement("code");
    hash.className = "merkle-node-hash";
    hash.textContent = shortenHash(node.hash);

    nodeElement.append(kicker, title, meta, hash);
    return nodeElement;
  }

  return {
    bindEvents,
    clear,
    render
  };
}

function shouldRenderVisualMerkleTree(leafCount) {
  return leafCount <= APP_CONFIG.ui.visualMerkleLeafLimit;
}

function buildTextSummarySampleIndexes(totalCount, targetIndex) {
  const sampleSize = APP_CONFIG.performance.textSummaryLeafSampleSize;

  if (totalCount <= sampleSize) {
    return Array.from({ length: totalCount }, (_, index) => index);
  }

  const indexes = new Set();
  const edgeSize = Math.max(3, Math.floor(sampleSize / 3));
  const aroundTargetSize = Math.max(4, sampleSize - (edgeSize * 2));
  const halfWindow = Math.floor(aroundTargetSize / 2);
  const windowStart = Math.max(0, targetIndex - halfWindow);
  const windowEnd = Math.min(totalCount, windowStart + aroundTargetSize);

  for (let index = 0; index < edgeSize; index += 1) {
    indexes.add(index);
  }

  for (let index = windowStart; index < windowEnd; index += 1) {
    indexes.add(index);
  }

  for (let index = totalCount - edgeSize; index < totalCount; index += 1) {
    indexes.add(index);
  }

  indexes.add(targetIndex);
  return Array.from(indexes).sort((left, right) => left - right);
}

function buildSelectedPathKeys(levels, leafIndex) {
  const pathKeys = new Set();
  let currentIndex = leafIndex;

  for (let originalLevelIndex = 0; originalLevelIndex < levels.length; originalLevelIndex += 1) {
    pathKeys.add(makeMerkleNodeKey(originalLevelIndex, currentIndex));
    currentIndex = Math.floor(currentIndex / 2);
  }

  return pathKeys;
}

function makeMerkleNodeKey(originalLevelIndex, nodeIndex) {
  return `${originalLevelIndex}:${nodeIndex}`;
}

function getMerkleNodeKicker(node) {
  if (node.isRoot) {
    return "Root";
  }

  if (node.isLeaf) {
    return `Leaf ${node.nodeIndex}`;
  }

  return `Branch ${node.originalLevelIndex}.${node.nodeIndex}`;
}

function getMerkleNodeTitle(node) {
  if (node.isRoot) {
    return "Merkle Root";
  }

  if (node.isLeaf) {
    return node.credential?.credentialId || `Leaf ${node.nodeIndex}`;
  }

  return `Intermediate Hash ${node.nodeIndex}`;
}

function getMerkleNodeMeta(node) {
  if (node.isRoot) {
    return "Computed batch root";
  }

  if (node.isLeaf) {
    return `${shortenAddress(node.credential.recipient)} | ${node.credential.achievementCode}`;
  }

  if (node.duplicatesLastChild) {
    return "Mirrors the last child because this level had an odd node count";
  }

  return "Parent hash from two child nodes";
}
