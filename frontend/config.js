export const APP_CONFIG = {
  appName: "Sepolia Credential Console",
  network: {
    chainId: 11155111,
    name: "Ethereum Sepolia",
    explorerUrl: "https://sepolia.etherscan.io",
    rpcUrls: ["https://rpc.sepolia.org"],
    nativeCurrency: {
      name: "Sepolia Ether",
      symbol: "SEP",
      decimals: 18
    }
  },
  contract: {
    address:  "0x25419aB77fB4C747FC45e1291F4CDfd11cF73FeD",
    anchorRoot: {
      functionName: "anchorRoot",
      abi: [
        "function anchorRoot(bytes32 root, string batchId) external",
        "function revokeRoot(bytes32 root) external",
        "function isRootActive(bytes32 root) external view returns (bool)",
        "function isRootAnchored(bytes32 root) external view returns (bool)",
        "function getBatchRoot(string batchId) external view returns (bytes32)",
        "function getRootRecord(bytes32 root) external view returns ((address issuer,uint64 anchoredAt,uint64 revokedAt,bool revoked,bytes32 batchIdHash))",
        "function owner() external view returns (address)",
        "function isAuthorizedIssuer(address issuer) external view returns (bool)"
      ]
    }
  },
  hashing: {
    pairing: "sorted",
    oddLeafStrategy: "duplicate-last",
    leafEncoding: [
      { key: "recipient", label: "Recipient Address", type: "address" },
      { key: "credentialId", label: "Credential ID", type: "string" },
      { key: "achievementCode", label: "Achievement Code", type: "string" },
      { key: "issueDate", label: "Issue Date", type: "string" },
      { key: "issuerId", label: "Issuer Identifier", type: "string" }
    ]
  },
  qr: {
    schema: "eth-micro-credential-proof",
    version: 1,
    verificationPage: "./verify.html",
    payloadQueryParam: "p",
    verificationHash: "",
    legacyPayloadPrefix: "ethcred://verify?p="
  },
  ui: {
    visualMerkleLeafLimit: 5,
    proofPlaceholder: [
      "Paste a JSON array of bytes32 hashes, for example:",
      '["0xabc...", "0xdef..."]',
      "",
      "Or use one sibling hash per line.",
      "",
      "Use the Merkle tree maker to fill this automatically."
    ].join("\n")
  },
  performance: {
    hashChunkSize: 512,
    treeChunkSize: 1024,
    qrArchiveImageWidth: 640,
    qrRenderConcurrency: null,
    textSummaryLeafSampleSize: 18
  }
};
