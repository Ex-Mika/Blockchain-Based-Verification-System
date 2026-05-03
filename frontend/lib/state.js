export function createAppState() {
  return {
    provider: null,
    signer: null,
    account: "",
    chainId: null,
    networkName: "",
    qrPayload: "",
    qrBatch: null,
    batchCredentialsCache: null,
    isMerkleBuildInProgress: false,
    merkleBuild: null,
    merkleRenderFrameId: null,
    issuerWorkbenchView: "batch",
    isWalletWidgetMinimized: false,
    walletWidgetPosition: null
  };
}
