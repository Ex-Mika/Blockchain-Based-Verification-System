/**
 * on-chain-status.mjs — Handler for the `/api/on-chain-root-status` endpoint.
 *
 * Reads an anchored root's status from Sepolia via a server-side JSON-RPC
 * provider so the browser verifier does not need its own RPC connection.
 */

import { ethers } from "ethers";

import {
  createHttpError,
  formatUnixTimestamp,
  normalizeOptionalString,
  sendJson,
  validateBytes32
} from "./http-utils.mjs";

let verifierReadProvider = null;

/**
 * Handle `GET /api/on-chain-root-status?root=0x…&batchId=…&contractAddress=…`.
 *
 * @param {import("node:http").ServerResponse} response
 * @param {URL}    requestUrl
 * @param {object} config  The `APP_CONFIG` object.
 */
export async function handleOnChainRootStatusRequest(response, requestUrl, config) {
  try {
    const root = validateBytes32(
      String(requestUrl.searchParams.get("root") || "").trim(),
      "Merkle root"
    );
    const batchId = normalizeOptionalString(requestUrl.searchParams.get("batchId"));
    const contractAddress = normalizeVerificationContractAddress(
      requestUrl.searchParams.get("contractAddress"),
      config
    );

    if (!contractAddress) {
      throw createHttpError(500, "The verifier contract address is not configured.");
    }

    const provider = getVerifierReadProvider(config);
    const network = await provider.getNetwork();
    if (BigInt(network.chainId) !== BigInt(config.network.chainId)) {
      throw createHttpError(
        502,
        `The server RPC returned chain ${network.chainId.toString()} instead of ${config.network.chainId}.`
      );
    }

    const contract = new ethers.Contract(
      contractAddress,
      config.contract.anchorRoot.abi,
      provider
    );
    const [rootAnchored, rootActive, batchRoot] = await Promise.all([
      contract.isRootAnchored(root),
      contract.isRootActive(root),
      batchId
        ? contract.getBatchRoot(batchId)
        : Promise.resolve(null)
    ]);

    let rootRecord = null;
    if (rootAnchored) {
      rootRecord = await contract.getRootRecord(root);
    }

    const normalizedBatchRoot = batchRoot
      ? validateBytes32(String(batchRoot), "On-chain batch root")
      : null;

    sendJson(response, 200, {
      contractAddress,
      source: "Server RPC",
      rootAnchored: Boolean(rootAnchored),
      rootActive: Boolean(rootActive),
      batchRoot: normalizedBatchRoot,
      batchMatches: batchId
        ? normalizedBatchRoot?.toLowerCase() === root.toLowerCase()
        : null,
      issuer: rootRecord ? ethers.getAddress(rootRecord.issuer) : null,
      anchoredAt: formatUnixTimestamp(rootRecord?.anchoredAt),
      revokedAt: rootRecord?.revoked ? formatUnixTimestamp(rootRecord.revokedAt) : null
    });
  } catch (error) {
    sendJson(response, error.statusCode || 500, {
      message: error.message || `Unable to read the ${config.network.name} verifier contract.`
    });
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function normalizeVerificationContractAddress(rawAddress, config) {
  const requestedAddress = normalizeOptionalString(rawAddress);
  if (requestedAddress) {
    return ethers.getAddress(requestedAddress);
  }

  if (!config.contract.address) {
    return null;
  }

  return ethers.getAddress(config.contract.address);
}

function getVerifierReadProvider(config) {
  const rpcUrl = String(process.env.SEPOLIA_RPC_URL || "").trim()
    || config.network.rpcUrls.find(Boolean)
    || "";

  if (!rpcUrl) {
    throw createHttpError(500, "Set SEPOLIA_RPC_URL before starting the frontend server.");
  }

  if (!verifierReadProvider) {
    verifierReadProvider = new ethers.JsonRpcProvider(
      rpcUrl,
      config.network.chainId,
      { staticNetwork: true }
    );
  }

  return verifierReadProvider;
}
