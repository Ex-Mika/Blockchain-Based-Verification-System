// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

/// @title CredentialAnchor
/// @notice Anchors Merkle roots for off-chain micro-credential batches.
/// @dev The raw credential contents and Merkle proofs remain off-chain.
contract CredentialAnchor {
    error NotOwner(address caller);
    error NotAuthorizedIssuer(address caller);
    error ZeroAddress();
    error ZeroRoot();
    error EmptyBatchId();
    error RootAlreadyAnchored(bytes32 root);
    error BatchIdAlreadyUsed(bytes32 batchIdHash);
    error RootNotAnchored(bytes32 root);
    error RootAlreadyRevoked(bytes32 root);
    error RevocationNotAllowed(address caller, bytes32 root);
    error IssuerAuthorizationUnchanged(address issuer, bool authorized);

    struct RootRecord {
        address issuer;
        uint64 anchoredAt;
        uint64 revokedAt;
        bool revoked;
        bytes32 batchIdHash;
    }

    address public owner;
    mapping(address issuer => bool authorized) public isAuthorizedIssuer;
    mapping(bytes32 root => RootRecord record) private rootRecords;
    mapping(bytes32 batchIdHash => bytes32 root) private batchRoots;

    event OwnershipTransferred(
        address indexed previousOwner,
        address indexed newOwner
    );
    event IssuerAuthorizationUpdated(
        address indexed issuer,
        bool authorized
    );
    event RootAnchored(
        bytes32 indexed root,
        bytes32 indexed batchIdHash,
        address indexed issuer,
        string batchId,
        uint256 anchoredAt
    );
    event RootRevoked(
        bytes32 indexed root,
        bytes32 indexed batchIdHash,
        address indexed issuer,
        address revokedBy,
        uint256 revokedAt
    );

    constructor() {
        owner = msg.sender;
        isAuthorizedIssuer[msg.sender] = true;
        emit OwnershipTransferred(address(0), msg.sender);
        emit IssuerAuthorizationUpdated(msg.sender, true);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) {
            revert NotOwner(msg.sender);
        }
        _;
    }

    modifier onlyAuthorizedIssuer() {
        if (!isAuthorizedIssuer[msg.sender]) {
            revert NotAuthorizedIssuer(msg.sender);
        }
        _;
    }

    /// @notice Grants or removes issuer authorization.
    /// @param issuer Address whose permission should be updated.
    /// @param authorized New issuer authorization state.
    function setIssuerAuthorization(
        address issuer,
        bool authorized
    ) external onlyOwner {
        if (issuer == address(0)) {
            revert ZeroAddress();
        }
        if (isAuthorizedIssuer[issuer] == authorized) {
            revert IssuerAuthorizationUnchanged(issuer, authorized);
        }

        isAuthorizedIssuer[issuer] = authorized;
        emit IssuerAuthorizationUpdated(issuer, authorized);
    }

    /// @notice Transfers contract ownership.
    /// @param newOwner Address that should become the new owner.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) {
            revert ZeroAddress();
        }

        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    /// @notice Anchors a new batch Merkle root.
    /// @dev The batch identifier is hashed for compact storage and emitted raw for auditability.
    /// @param root Merkle root for the off-chain credential batch.
    /// @param batchId Human-readable batch identifier.
    function anchorRoot(
        bytes32 root,
        string calldata batchId
    ) external onlyAuthorizedIssuer {
        if (root == bytes32(0)) {
            revert ZeroRoot();
        }
        if (bytes(batchId).length == 0) {
            revert EmptyBatchId();
        }
        if (_isRootAnchored(root)) {
            revert RootAlreadyAnchored(root);
        }

        bytes32 batchIdHash = keccak256(bytes(batchId));
        if (batchRoots[batchIdHash] != bytes32(0)) {
            revert BatchIdAlreadyUsed(batchIdHash);
        }

        RootRecord memory record = RootRecord({
            issuer: msg.sender,
            anchoredAt: uint64(block.timestamp),
            revokedAt: 0,
            revoked: false,
            batchIdHash: batchIdHash
        });

        rootRecords[root] = record;
        batchRoots[batchIdHash] = root;

        emit RootAnchored(
            root,
            batchIdHash,
            msg.sender,
            batchId,
            block.timestamp
        );
    }

    /// @notice Revokes a previously anchored batch root.
    /// @dev The contract owner or the original issuer can revoke a root.
    /// @param root Anchored Merkle root to revoke.
    function revokeRoot(bytes32 root) external {
        RootRecord storage record = rootRecords[root];
        if (record.anchoredAt == 0) {
            revert RootNotAnchored(root);
        }
        if (record.revoked) {
            revert RootAlreadyRevoked(root);
        }
        if (msg.sender != owner && msg.sender != record.issuer) {
            revert RevocationNotAllowed(msg.sender, root);
        }

        record.revoked = true;
        record.revokedAt = uint64(block.timestamp);

        emit RootRevoked(
            root,
            record.batchIdHash,
            record.issuer,
            msg.sender,
            block.timestamp
        );
    }

    /// @notice Returns true if the root has been anchored and not revoked.
    /// @param root Merkle root to query.
    function isRootActive(bytes32 root) external view returns (bool) {
        RootRecord memory record = rootRecords[root];
        return record.anchoredAt != 0 && !record.revoked;
    }

    /// @notice Returns true if the root has been anchored.
    /// @param root Merkle root to query.
    function isRootAnchored(bytes32 root) external view returns (bool) {
        return _isRootAnchored(root);
    }

    /// @notice Looks up the anchored root for a given batch identifier.
    /// @param batchId Human-readable batch identifier.
    function getBatchRoot(
        string calldata batchId
    ) external view returns (bytes32) {
        return batchRoots[keccak256(bytes(batchId))];
    }

    /// @notice Returns the stored compact record for an anchored root.
    /// @param root Merkle root to query.
    function getRootRecord(
        bytes32 root
    ) external view returns (RootRecord memory) {
        RootRecord memory record = rootRecords[root];
        if (record.anchoredAt == 0) {
            revert RootNotAnchored(root);
        }

        return record;
    }

    function _isRootAnchored(bytes32 root) private view returns (bool) {
        return rootRecords[root].anchoredAt != 0;
    }
}
