# Ethereum Thesis

Ethereum micro-credential verification system with a plain-JS frontend and a Sepolia-ready smart contract.

## Current Scope

The repository currently includes:

- a plain HTML/CSS/JavaScript issuer frontend
- in-browser Merkle tree generation from credential batch JSON
- QR packaging that sends a phone scan to a dedicated verification page
- client-side leaf hashing and proof checking
- a Sepolia-ready `CredentialAnchor` contract for root anchoring and revocation
- a Hardhat workspace with deployment and test commands

## Smart Contract

[`contracts/CredentialAnchor.sol`](/C:/Users/georg/Desktop/Ethereum%20Thesis/contracts/CredentialAnchor.sol) provides:

- authorized issuer access control
- unique root protection
- unique batch ID protection
- revocation by the contract owner or original issuer
- compact on-chain metadata for anchored roots

The contract stores:

- the Merkle root
- the issuer address
- the anchoring timestamp
- the revocation state and timestamp
- the `keccak256` hash of the batch ID

The raw credential JSON and Merkle proofs remain off-chain.

## Environment

Create a `.env` file from [`.env.example`](/C:/Users/georg/Desktop/Ethereum%20Thesis/.env.example) and set:

- `SEPOLIA_RPC_URL`
- `SEPOLIA_PRIVATE_KEY`

Use a Sepolia-only private key. Do not reuse a mainnet key for a demo deployment.

## Install And Test

```powershell
npm.cmd install
npx hardhat compile
npx hardhat test
```

## Deploy To Sepolia

```powershell
npx hardhat run scripts/deploy.js --network sepolia
```

After deployment:

1. Copy the deployed address.
2. Update [`frontend/config.js`](/C:/Users/georg/Desktop/Ethereum%20Thesis/frontend/config.js).
3. Start the frontend and connect the same Sepolia issuer wallet in MetaMask.

## Run The Frontend

### PowerShell

```powershell
node frontend/server.mjs
```

### Using npm on Windows PowerShell

```powershell
npm.cmd start
```

Then open `http://127.0.0.1:4173`.

The frontend server now listens on all IPv4 interfaces by default, so you can also open it from another device using your machine's LAN or ZeroTier IPv4 address, for example `http://<zerotier-ip>:4173`.

## Frontend Config

Update [`frontend/config.js`](/C:/Users/georg/Desktop/Ethereum%20Thesis/frontend/config.js) after deploying the contract:

- set the deployed contract address
- keep the hashing schema aligned with the final contract and utility layer
- keep the QR schema stable once real verifier payloads are issued

The current verification flow assumes sorted-pair Merkle hashing with `keccak256`, duplicates odd leaves when building the tree, and packages the proof into a QR payload targeted at Sepolia.

## Dataset

The workspace now includes a transformed public dataset for Merkle-tree testing:

- [`datasets/adult-uci/adult-credentials-full.json`](/C:/Users/georg/Desktop/Ethereum%20Thesis/datasets/adult-uci/adult-credentials-full.json)
- [`datasets/adult-uci/adult-credentials-sample-2048.json`](/C:/Users/georg/Desktop/Ethereum%20Thesis/datasets/adult-uci/adult-credentials-sample-2048.json)
- [`datasets/adult-uci/README.md`](/C:/Users/georg/Desktop/Ethereum%20Thesis/datasets/adult-uci/README.md)

You can regenerate those files with [`scripts/transform-adult-dataset.mjs`](/C:/Users/georg/Desktop/Ethereum%20Thesis/scripts/transform-adult-dataset.mjs).
