import { APP_CONFIG } from "./config.js";
import { getElements } from "./lib/elements.js";
import { createIssuerController } from "./lib/issuer-controller.js";
import { createIssuerWorkspaceController } from "./lib/issuer-workspace-controller.js";
import { createMerkleTreeView } from "./lib/merkle-tree-view.js";
import { getRuntime } from "./lib/runtime.js";
import { createAppState } from "./lib/state.js";
import { setStatus } from "./lib/ui.js";
import { createWalletController } from "./lib/wallet-controller.js";
import { createWalletWidgetController } from "./lib/wallet-widget-controller.js";

const state = createAppState();
const elements = getElements();
const merkleTreeView = createMerkleTreeView({ state, elements });
const issuerWorkspaceController = createIssuerWorkspaceController({
  state,
  elements,
  merkleTreeView
});
const issuerController = createIssuerController({
  state,
  elements,
  merkleTreeView,
  issuerWorkspaceController
});
const walletController = createWalletController({ state, elements });
const walletWidgetController = createWalletWidgetController({ state, elements });

function init() {
  renderConfig();
  seedDateDefaults();
  bindControllers();
  issuerWorkspaceController.initialize();
  walletWidgetController.initialize();
  applyRuntimeAvailability();
  issuerController.clearQrCanvas();
  merkleTreeView.clear();
  void walletController.initialize();
}

function renderConfig() {
  elements.contractAddress.textContent = APP_CONFIG.contract.address || "Not configured";
  elements.issuerProofInput.placeholder = APP_CONFIG.ui.proofPlaceholder;
}

function seedDateDefaults() {
  const today = getLocalDateInputValue(new Date());

  if (elements.issuedAtInput && !elements.issuedAtInput.value) {
    elements.issuedAtInput.value = today;
  }

  if (elements.issueDateInput && !elements.issueDateInput.value) {
    elements.issueDateInput.value = today;
  }
}

function bindControllers() {
  issuerWorkspaceController.bindEvents();
  merkleTreeView.bindEvents(issuerController.syncMerkleSelection);
  walletController.bindEvents();
  walletWidgetController.bindEvents();
  issuerController.bindEvents();
}

function applyRuntimeAvailability() {
  const {
    ethereum,
    ethers
  } = getRuntime();

  if (!ethereum) {
    setStatus(
      elements.connectionMessage,
      "warning",
      "No injected Ethereum wallet was detected. Install MetaMask or another compatible wallet to submit Sepolia roots."
    );
  }

  if (!ethers) {
    elements.buildMerkleTree.disabled = true;
    elements.generateQr.disabled = true;
    elements.submitRoot.disabled = true;
    return;
  }
}

function getLocalDateInputValue(date) {
  const localDate = new Date(date);
  localDate.setMinutes(localDate.getMinutes() - localDate.getTimezoneOffset());
  return localDate.toISOString().slice(0, 10);
}

init();
