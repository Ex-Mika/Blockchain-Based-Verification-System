# AGENTS.md

## Project Overview

This project is an Ethereum-based micro-credential verification system.

The system issues tamper-evident credentials by hashing credential data off-chain, organizing credential hashes into a Merkle tree, and anchoring the Merkle root on-chain. Verification is done by recomputing the leaf hash and validating a Merkle proof against an on-chain root.

The main goals are:

- tamper evidence
- low gas cost for issuance
- simple credential verification
- clean separation between frontend, backend, and smart contract logic
- secure and auditable Solidity code

## Tech Stack

### Frontend
- HTML
- CSS
- JavaScript

### Backend / Blockchain
- Node.js
- Hardhat
- Solidity

### Wallet / Chain Interaction
- ethers.js

## Core System Design

### Credential Issuance Flow
1. Credential data is prepared off-chain.
2. A canonical hash of each credential is generated.
3. Credential hashes are used as Merkle tree leaves.
4. A Merkle root is computed off-chain.
5. The Merkle root is anchored on-chain through a smart contract transaction.
6. Optional metadata such as batch ID, issuer address, issuance timestamp, and revocation state may also be stored.

### Verification Flow
1. A verifier receives:
   - credential data
   - leaf hash or recomputed hash
   - Merkle proof
   - batch/root reference
2. The frontend or backend verifies:
   - the leaf hash matches the credential data
   - the Merkle proof resolves to the anchored root
   - the root is valid and not revoked if revocation is supported

## Agent Goals

When working on this repository, always optimize for:

- correctness first
- security second
- gas efficiency third
- readability and maintainability fourth

Do not trade safety for minor gas savings.

## Rules for Agents

### General
- Preserve the Merkle-root anchoring architecture.
- Do not redesign the system into full on-chain credential storage unless explicitly asked.
- Keep credential payloads off-chain unless a requirement says otherwise.
- Prefer deterministic and canonical hashing.
- Keep contract interfaces minimal and well documented.
- Make small, reviewable changes.
- Do not use Deprecated Code.

### Frontend
- Use plain HTML, CSS, and JavaScript unless explicitly told to add a framework.
- Keep UI logic modular even without a framework.
- Do not hardcode contract addresses across multiple files; centralize config.
- Show clear status messages for:
  - wallet connection
  - network mismatch
  - issuance success/failure
  - verification success/failure
- Always use Toast for feedbacks, loading, or any small system responses.
### Smart Contracts
- Use Solidity version pinned in `hardhat.config`.
- Prioritize simple, auditable contracts over clever patterns.
- Avoid unbounded loops in state-changing functions.
- Avoid storing unnecessary strings or large structs on-chain.
- Prefer events for audit trails when full storage is not required.
- Validate access control on issuance and revocation functions.
- Consider replay, duplicate root submission, and unauthorized issuer risks.

### Hardhat / Scripts
- Keep deployment scripts idempotent where possible.
- Separate deployment, seeding, issuance, and verification scripts.
- Never commit private keys or secrets.
- Use `.env` for RPC URLs, private keys, and API keys.

## Recommended Repository Structure

\`\`\`
/contracts
  CredentialAnchor.sol
  interfaces/
  libraries/

/scripts
  deploy.js
  issueBatch.js
  verifyCredential.js
  revokeBatch.js

/test
  CredentialAnchor.test.js
  MerkleProof.test.js
  AccessControl.test.js
  EdgeCases.test.js

/frontend
  index.html
  style.css
  app.js
  config.js

/utils
  merkle.js
  hashing.js
  encoding.js

/artifacts
/cache
\`\`\`

## Smart Contract Expectations

The contract should usually support these responsibilities only:

- anchoring Merkle roots
- mapping root or batch IDs to issuer metadata
- optional revocation or invalidation
- exposing verification-related getters
- emitting issuance and revocation events

The contract should usually not:

- store raw credential contents
- store full credential JSON
- perform expensive batch leaf processing on-chain
- generate Merkle trees on-chain

## Hashing and Merkle Rules

Agents must keep hashing logic consistent across frontend, backend, tests, and contracts.

### Requirements
- Use a canonical field order for credential hashing.
- Never hash raw JSON strings unless the serialization format is fixed and documented.
- Prefer explicit encoding such as:
  - recipient address
  - credential ID
  - course or achievement code
  - issue date
  - issuer identifier
- Document whether leaf hashing uses:
  - `keccak256(abi.encode(...))`
  - `keccak256(abi.encodePacked(...))`

### Important
Mismatch between:
- JS hashing
- Solidity hashing
- Merkle leaf construction

will break verification.

Whenever changing hashing logic, update:
- smart contracts
- JS utilities
- tests
- sample proofs
- frontend verification flow

## Gas Efficiency Guidance

Agents should prefer:
- one root per batch instead of one transaction per credential
- compact storage
- events where storage is unnecessary
- custom errors over long revert strings when appropriate
- immutable variables when useful
- minimal writes to storage

Agents should avoid:
- storing full proofs on-chain
- per-credential on-chain insertion
- redundant mappings
- large dynamic arrays in storage unless clearly required

## Security Requirements

Always check for:

- unauthorized credential issuance
- duplicate root submission
- invalid Merkle proof assumptions
- improper revocation permissions
- chain/network misconfiguration
- signature spoofing if signatures are used
- hash collisions caused by ambiguous encoding
- upgradeability risks if proxies are introduced

If a change touches contract security, add or update tests.

## Testing Standards

Any meaningful change should include tests.

### Minimum test categories
- successful root anchoring
- unauthorized anchoring rejected
- duplicate or invalid root handling
- proof verification success
- proof verification failure with wrong leaf
- proof verification failure with wrong proof
- revocation behavior if implemented
- edge cases for empty inputs or malformed data

### Test Principles
- prefer explicit test names
- cover happy path and failure path
- keep fixtures small and readable
- ensure JS Merkle generation matches contract expectations

## Frontend Behavior Expectations

The frontend should provide:

- wallet connect button
- current network display
- contract address display
- credential form or upload flow
- batch root submission flow for issuer
- verification form for verifier
- proof and result display
- user-friendly error messages

Do not expose raw internal errors directly unless in debug mode.

## Environment Variables

Typical `.env` values may include:

- `PRIVATE_KEY`
- `RPC_URL`
- `ETHERSCAN_API_KEY`
- `CONTRACT_ADDRESS`

Never hardcode secrets in source files.

## Commands

Agents should prefer and maintain working support for commands like:

\`\`\`bash
npm install
npx hardhat compile
npx hardhat test
npx hardhat run scripts/deploy.js --network localhost
npx hardhat node
\`\`\`

If new scripts are added, document them in `README.md`.

## Coding Style

### JavaScript
- Use clear, small functions.
- Avoid deeply nested callback logic.
- Prefer async/await.
- Keep blockchain interaction separated from DOM manipulation.

### Solidity
- Follow checks-effects-interactions where relevant.
- Use NatSpec on public/external functions.
- Use custom errors when it improves clarity and gas usage.
- Keep modifiers simple.
- Avoid premature optimization that hurts readability.

### CSS / HTML
- Keep styling simple and maintainable.
- Prefer semantic HTML.
- Keep IDs/classes predictable for JS hooks.

## Definition of Done

A task is complete when:

- code builds successfully
- tests pass
- hashing logic remains consistent across layers
- no secrets are introduced
- contract changes are documented
- frontend changes are usable and understandable
- gas or security tradeoffs are explained in comments or PR notes when relevant

## What Agents Should Do First

Before making major changes, inspect:

- contract responsibilities
- current leaf hashing logic
- Merkle tree construction utility
- deployment config
- frontend contract integration
- existing tests

## What Agents Must Not Do

- Do not replace Merkle anchoring with full credential storage without explicit instruction.
- Do not introduce a frontend framework unless requested.
- Do not add upgradeable proxies unless explicitly required.
- Do not change hash encoding casually.
- Do not break proof compatibility without clearly documenting migration impact.
- Do not remove tests to make builds pass.

## Preferred Next Improvements

Unless told otherwise, useful improvements include:

1. issuer role-based access control
2. batch metadata events
3. revocation support
4. proof generation utility scripts
5. frontend verification UX improvements
6. test coverage for hash consistency
7. deployment and config cleanup
8. README usage examples

## Project Intent Summary

This repository is meant to demonstrate and implement a practical micro-credential verification system that is:

- verifiable
- tamper-evident
- gas-efficient
- understandable by auditors, developers, and evaluators

Agents should preserve that intent in every change.