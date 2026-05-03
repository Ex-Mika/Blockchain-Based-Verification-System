import { APP_CONFIG } from "../config.js";
import { getRuntime } from "./runtime.js";
import {
  formatNetworkName,
  humanizeError,
  setStatus,
  showToast,
  shortenAddress
} from "./ui.js";

export function createWalletController({ state, elements }) {
  function bindEvents() {
    elements.connectWallet.addEventListener("click", connectWallet);
    elements.refreshNetwork.addEventListener("click", handleRefreshNetworkClick);
    elements.copyAccount?.addEventListener("click", handleCopyAccountClick);
    elements.copyContract?.addEventListener("click", handleCopyContractClick);
  }

  async function initialize() {
    updateCopyActionState();
    await syncAuthorizedWallet();
    attachWalletListeners();
  }

  async function syncAuthorizedWallet() {
    const { ethereum, ethers } = getRuntime();
    if (!ethereum || !ethers) {
      return;
    }

    try {
      const accounts = await ethereum.request({ method: "eth_accounts" });
      if (!accounts.length) {
        await refreshConnectionState();
        return;
      }

      await connectWallet(false);
    } catch (error) {
      setStatus(elements.connectionMessage, "warning", humanizeError(error));
    }
  }

  function attachWalletListeners() {
    const { ethereum } = getRuntime();
    if (!ethereum) {
      return;
    }

    ethereum.on?.("accountsChanged", () => {
      void refreshConnectionState();
    });

    ethereum.on?.("chainChanged", () => {
      void refreshConnectionState();
    });
  }

  async function handleRefreshNetworkClick() {
    const { ethereum } = getRuntime();
    if (!ethereum) {
      return;
    }

    try {
      const switched = await ensureExpectedNetwork();
      await refreshConnectionState({ errorChannel: "toast" });

      if (switched) {
        showToast("success", `Wallet switched to ${APP_CONFIG.network.name}.`);
      }
    } catch (error) {
      showToast("error", humanizeError(error));
    }
  }

  async function connectWallet(promptUser = true) {
    const { ethereum, ethers } = getRuntime();
    if (!ethereum || !ethers) {
      return;
    }

    try {
      if (promptUser) {
        await ethereum.request({ method: "eth_requestAccounts" });
      }

      await ensureExpectedNetwork({ silentIfAlreadyMatched: true });
      state.provider = new ethers.BrowserProvider(ethereum);
      state.signer = await state.provider.getSigner();
      state.account = await state.signer.getAddress();

      const refreshed = await refreshConnectionState({ errorChannel: "toast" });
      if (!refreshed) {
        return;
      }

      showToast("success", "Wallet connected and ready.");
    } catch (error) {
      showToast("error", humanizeError(error));
    }
  }

  async function handleCopyAccountClick() {
    await copyTextToClipboard(
      state.account,
      "Account address copied.",
      "Connect a wallet before copying the account address."
    );
  }

  async function handleCopyContractClick() {
    await copyTextToClipboard(
      APP_CONFIG.contract.address,
      "Contract address copied.",
      "Set the deployed contract address before copying it."
    );
  }

  async function refreshConnectionState(options = {}) {
    const { ethereum, ethers } = getRuntime();
    if (!ethereum || !ethers) {
      renderConnectionState();
      return false;
    }

    try {
      state.provider = new ethers.BrowserProvider(ethereum);
      const accounts = await ethereum.request({ method: "eth_accounts" });
      state.account = accounts[0] || "";
      state.signer = state.account ? await state.provider.getSigner() : null;

      const network = await state.provider.getNetwork();
      state.chainId = network.chainId;
      state.networkName = network.name || "";

      renderConnectionState();
      return true;
    } catch (error) {
      const errorMessage = humanizeError(error);
      if (options.errorChannel === "toast") {
        showToast("error", errorMessage);
        return false;
      }

      setStatus(elements.connectionMessage, "error", errorMessage);
      return false;
    }
  }

  async function ensureExpectedNetwork(options = {}) {
    const { ethereum, ethers } = getRuntime();
    if (!ethereum || !ethers) {
      return false;
    }

    const provider = new ethers.BrowserProvider(ethereum);
    const network = await provider.getNetwork();
    const currentChainId = network.chainId;
    const expectedChainId = BigInt(APP_CONFIG.network.chainId);

    if (currentChainId === expectedChainId) {
      return false;
    }

    await switchToExpectedNetwork(ethereum);

    if (!options.silentIfAlreadyMatched) {
      setStatus(
        elements.connectionMessage,
        "neutral",
        `Wallet switched to ${APP_CONFIG.network.name}.`
      );
    }

    return true;
  }

  function renderConnectionState() {
    const networkName = state.chainId
      ? `${formatNetworkName(state.networkName)} (chain ${state.chainId.toString()})`
      : "Unknown";
    const matchesExpected = state.chainId === BigInt(APP_CONFIG.network.chainId);
    const connectionState = !state.account
      ? "disconnected"
      : matchesExpected
        ? "connected"
        : "warning";

    const walletStatusText = state.account ? "Connected" : "Not connected";

    if (elements.walletStatusLabel) {
      elements.walletStatusLabel.textContent = walletStatusText;
    } else {
      elements.walletStatus.textContent = walletStatusText;
    }

    elements.walletStatus.dataset.state = connectionState;
    elements.networkValue.textContent = networkName;
    elements.accountValue.textContent = state.account
      ? shortenAddress(state.account)
      : "No account";
    updateCopyActionState();

    if (!state.chainId) {
      elements.refreshNetwork.textContent = "Refresh";
      return;
    }

    elements.refreshNetwork.textContent = matchesExpected
      ? "Refresh"
      : `Switch to ${APP_CONFIG.network.name}`;

    if (matchesExpected) {
      setStatus(elements.connectionMessage, "neutral", `Wallet is on ${APP_CONFIG.network.name}.`);
      return;
    }

    setStatus(
      elements.connectionMessage,
      "warning",
      `Network mismatch. Expected chain ${APP_CONFIG.network.chainId} (${APP_CONFIG.network.name}). Click "${elements.refreshNetwork.textContent}" to change it in the wallet.`
    );
  }

  function updateCopyActionState() {
    if (elements.copyAccount) {
      elements.copyAccount.disabled = !state.account;
    }

    if (elements.copyContract) {
      elements.copyContract.disabled = !APP_CONFIG.contract.address;
    }
  }

  return {
    bindEvents,
    initialize,
    refreshConnectionState
  };
}

async function copyTextToClipboard(value, successMessage, missingValueMessage) {
  if (!value) {
    showToast("warning", missingValueMessage);
    return;
  }

  if (!navigator.clipboard?.writeText) {
    showToast("error", "Clipboard access is unavailable in this browser context.");
    return;
  }

  try {
    await navigator.clipboard.writeText(value);
    showToast("success", successMessage);
  } catch (error) {
    showToast("error", humanizeError(error));
  }
}

async function switchToExpectedNetwork(ethereum) {
  const chainIdHex = `0x${APP_CONFIG.network.chainId.toString(16)}`;

  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chainIdHex }]
    });
  } catch (error) {
    if (error?.code !== 4902) {
      throw error;
    }

    await ethereum.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: chainIdHex,
        chainName: APP_CONFIG.network.name,
        rpcUrls: APP_CONFIG.network.rpcUrls,
        nativeCurrency: APP_CONFIG.network.nativeCurrency,
        blockExplorerUrls: [APP_CONFIG.network.explorerUrl]
      }]
    });
  }
}
