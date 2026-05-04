# Panel Explanation Notes

## System In One Minute

This project issues micro-credentials off-chain, groups them into a Merkle tree, stores only the Merkle root on Ethereum Sepolia, and lets a verifier recompute the leaf and proof from a scanned QR payload. The main design goal is to keep gas usage and on-chain exposure low while still making each credential cryptographically verifiable.

## End-To-End Flow

1. A batch JSON file of credentials is loaded in the issuer UI.
2. Each credential is hashed into one leaf using a fixed field order.
3. All leaf hashes are combined into a Merkle tree, producing one Merkle root.
4. The selected credential gets a Merkle proof, which is embedded into a QR payload.
5. The Merkle root and batch ID are anchored on Sepolia.
6. The verification page recomputes the leaf hash and root from the QR payload and checks whether they match.

## Important Files To Explain

- `frontend/config.js`
- `frontend/lib/credential-utils.js`
- `frontend/merkle.js`
- `frontend/lib/issuer-controller.js`
- `contracts/CredentialAnchor.sol`
- `frontend/lib/verifier-controller.js`
- `test/CredentialAnchor.js`

## 1. Configuration Defines The Rules

### `frontend/config.js`

- Lines `3-12` set the target network to Ethereum Sepolia, chain ID `11155111`.
- Lines `14-28` define the deployed contract address and the read/write ABI used by the frontend.
- Lines `30-41` are critical because they define the exact credential fields and their order in the leaf hash:
  - `holderName`
  - `credentialTitle`
  - `recipient`
  - `credentialId`
  - `achievementCode`
  - `issueDate`
  - `issuerId`
- Lines `31-32` set the Merkle strategy:
  - `pairing: "sorted"`
  - `oddLeafStrategy: "duplicate-last"`

What to say:

"The config is not just UI metadata. It defines the cryptographic schema. If I change the field order or Merkle pairing rule, the same credential will produce a different root and all existing proofs will stop matching."

## 2. How One Credential Becomes One Leaf Hash

### `frontend/lib/credential-utils.js`

- Lines `6-16` build the active hashing specification from the config.
- Lines `26-50` are the core leaf hash logic in `computeLeafHash(...)`.
- Line `50` uses `ethers.solidityPackedKeccak256(types, values)`, which matches Ethereum-style hashing.
- Lines `35-48` iterate through the configured fields in order and normalize addresses with `ethers.getAddress(...)`.

What to say:

"Each credential is turned into a single deterministic leaf hash. Deterministic means that the same fields in the same order always produce the same hash. That is why the verifier can independently recompute it."

Why this matters:

- It prevents manual tampering with credential fields.
- It makes issuer-side and verifier-side computation consistent.
- Address normalization avoids false mismatches caused by checksum formatting.

## 3. How The Merkle Tree And Proof Are Built

### `frontend/merkle.js`

- Lines `5-25` build a full Merkle artifact object containing `root`, `leaves`, and `levels`.
- Lines `28-70` do the same asynchronously for large batches so the browser stays responsive.
- Lines `43-50` combine each pair of child nodes into a parent hash.
- Line `49` duplicates the last node if a level has an odd number of leaves.
- Lines `73-90` generate the proof for one selected credential by collecting sibling hashes up the tree.
- Lines `134-140` define `hashPair(...)`.
- Lines `135-137` sort the pair before hashing when `pairing` is `"sorted"`.

What to say:

"The Merkle root is the fingerprint of the whole batch. The proof is just the list of sibling hashes needed to rebuild the path from one credential leaf to that root."

Important design choice:

- Because pairing is sorted, the proof does not need explicit left/right direction flags.
- Because odd leaves are duplicated, both issuer and verifier can reconstruct the same tree shape.

## 4. How The Issuer UI Builds The Batch

### `frontend/lib/issuer-controller.js`

- Lines `73-136` are the main batch build flow in `handleMerkleTreeBuild()`.
- Lines `87-90` load the credential list and hashing rules.
- Lines `90-98` compute all leaf hashes in chunks for large datasets.
- Lines `99-110` build the Merkle tree asynchronously.
- Line `111` creates the selected credential's proof.
- Lines `113-118` store the entire Merkle build in state.
- Lines `201-235` keep the selected credential, root, and proof in sync with the UI.
- Lines `218-219` put the computed root and selected proof into the form fields.

What to say:

"The issuer page does not rely on a backend to build the tree. The browser computes every leaf, builds the Merkle levels, picks a proof for the selected credential, and then prepares the root for anchoring."

## 5. How QR Payloads Are Validated Before They Are Created

### `frontend/lib/credential-utils.js`

- Lines `159-190` build the verification package.
- Line `166` computes the credential's leaf hash.
- Line `168` calls `assertProofMatchesRoot(...)` before the QR payload is accepted.
- Lines `170-189` include the Merkle root, proof, credential fields, network, contract address, and metadata.
- Lines `192-204` turn that object into a verification URL.
- Lines `351-365` compact the payload into a smaller structure for QR efficiency.

What to say:

"The issuer side does not blindly package data into a QR code. It first proves to itself that the selected credential and proof really reconstruct the chosen Merkle root."

Why this matters:

- It reduces the chance of issuing invalid QR codes.
- It ensures the verifier receives a self-consistent package.

## 6. What Actually Goes On-Chain

### `contracts/CredentialAnchor.sol`

- Lines `20-25` define the stored record:
  - issuer address
  - anchor timestamp
  - revoke timestamp
  - revoke flag
  - hashed batch ID
- Lines `28-31` define the main storage mappings:
  - `rootRecords[root]`
  - `batchRoots[batchIdHash]`
- Lines `56-60` make the deployer the initial owner and authorized issuer.
- Lines `63-75` define access control modifiers.
- Lines `111-148` implement `anchorRoot(...)`.
- Lines `115-127` reject bad inputs, duplicate roots, and reused batch IDs.
- Lines `130-139` store the record and batch lookup.
- Lines `141-147` emit the `RootAnchored` event for auditability.

What to say:

"The smart contract stores only the root and compact metadata, not the raw credential JSON and not the full proofs. That keeps the design cheaper, more private, and more scalable."

## 7. Revocation And Read Queries

### `contracts/CredentialAnchor.sol`

- Lines `153-175` implement `revokeRoot(...)`.
- Lines `161-162` allow revocation only by the owner or original issuer.
- Lines `165-166` mark the root as revoked and store the revocation time.
- Lines `179-181` expose `isRootActive(...)`.
- Lines `186-187` expose `isRootAnchored(...)`.
- Lines `192-195` expose `getBatchRoot(...)`.
- Lines `200-208` expose `getRootRecord(...)`.

What to say:

"Anchoring is not permanent trust without controls. A batch can be revoked, and the contract has direct read methods for checking whether a root exists, whether it is still active, and which root belongs to a batch ID."

## 8. How The Root Is Submitted To Sepolia

### `frontend/lib/issuer-controller.js`

- Lines `323-368` handle on-chain submission.
- Lines `332-337` require a connected wallet on the correct chain.
- Lines `340-348` build an `ethers.Contract` instance from the configured address and ABI.
- Lines `356-357` call `anchorRoot(payload.merkleRoot, payload.batchId)` and wait for the receipt.
- Lines `360-363` show the transaction hash and mined block number.

What to say:

"The frontend sends only two values on-chain: the Merkle root and the human-readable batch ID. The contract hashes the batch ID internally for compact storage, but also emits the raw batch ID in the event log for auditability."

## 9. How Verification Works On The Scan Page

### `frontend/lib/verifier-controller.js`

- Lines `19-37` read the QR payload from the URL and trigger verification.
- Lines `32-33` decode the package and verify it.
- Lines `93-121` render the result for the user.

### `frontend/lib/credential-utils.js`

- Lines `210-219` decode and validate the QR payload.
- Lines `221-253` validate the required structure.
- Lines `256-296` perform the actual proof verification.
- Lines `263-268` recompute the root from the credential and proof.
- Line `272` checks whether the recomputed root matches the embedded Merkle root.

What to say:

"The verifier does not need the original dataset. It only needs the credential fields, the proof, and the Merkle root from the QR payload. From that, it can recompute the leaf and reconstruct the root independently."

## 10. Important Limitation To State Clearly

The current scan-page verifier validates the QR payload locally, but it does **not** automatically query Sepolia to confirm that the root is anchored and still active.

Evidence in code:

- `verifyVerificationPackage(...)` in `frontend/lib/credential-utils.js:256-296` only checks cryptographic consistency of the payload.
- `frontend/lib/verifier-controller.js:19-37` decodes and verifies locally, then renders the result.
- There is no RPC call in the verifier flow to `isRootAnchored(...)` or `isRootActive(...)`.

What to say:

"At the moment, verification on the page proves the credential is internally consistent with the embedded Merkle root. On-chain status checking is a separate step through the contract read methods or Etherscan."

Do not overclaim:

- Do not say the current verifier automatically confirms blockchain anchoring.
- Do not say raw credential data is stored on-chain.

## 11. Why This Design Makes Sense

### Privacy

Only the Merkle root and compact metadata are anchored. The detailed credential contents stay off-chain.

### Gas Efficiency

One transaction anchors an entire batch instead of one transaction per credential.

### Scalability

The tree lets many credentials share one root while keeping each credential individually provable.

### Auditability

The contract emits `RootAnchored` and `RootRevoked` events and supports batch/root lookups.

## 12. Testing Evidence

### `test/CredentialAnchor.js`

- Lines `20-25` confirm deployer ownership and issuer authorization.
- Lines `35-41` prove unauthorized issuers cannot anchor roots.
- Lines `44-58` verify root anchoring, metadata storage, and read methods.
- Lines `60-72` test duplicate root and duplicate batch ID rejection.
- Lines `75-97` test revocation behavior.
- Lines `99-108` confirm unrelated accounts cannot revoke.

What to say:

"The contract behavior is covered by automated tests for authorization, duplicate prevention, storage, and revocation. So the main trust assumptions are not only demonstrated manually in the UI."

## 13. Short Defense Script

If you need a compact explanation during the panel:

"A credential is hashed into a leaf using a fixed Ethereum-compatible field order. All leaves are combined into a Merkle tree, and only the Merkle root is anchored on Sepolia. The QR code carries one credential plus its Merkle proof. On scan, the verifier recomputes the leaf and walks up the proof to reconstruct the root. If the recomputed root matches the embedded root, the credential is cryptographically consistent with the anchored batch design. The blockchain stores only compact metadata, which keeps the system cheaper and more privacy-preserving than storing every credential on-chain."

## 14. Questions You Should Be Ready For

### Why not store the full credential on-chain?

Because it would be expensive, less private, and unnecessary. The root is enough to prove batch membership.

### Why does field order matter?

Because hashing is deterministic. Changing the order changes the hash, which changes the root.

### Why use sorted pair hashing?

It removes the need to store left/right direction flags in the proof and simplifies verification.

### What happens if one credential is changed?

Its leaf hash changes, which changes the path and ultimately changes the Merkle root.

### How do you check if the root is really on-chain?

Use `getBatchRoot`, `isRootAnchored`, `isRootActive`, or inspect the `RootAnchored` event on Etherscan.

### What does revocation mean here?

The root remains historically recorded, but `isRootActive` becomes false, so the anchored batch should no longer be trusted as valid.
