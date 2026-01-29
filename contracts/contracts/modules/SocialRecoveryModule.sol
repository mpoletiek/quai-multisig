// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../MultisigWallet.sol";

/**
 * @title SocialRecoveryModule
 * @dev Module for social recovery of multisig wallets
 * @notice Allows guardians to recover wallet access
 */
contract SocialRecoveryModule {
    // Custom errors (gas efficient)
    error MustBeCalledByWallet();
    error GuardiansRequired();
    error InvalidThreshold();
    error RecoveryPeriodTooShort();
    error CannotUpdateConfigWhileRecoveriesPending();
    error InvalidGuardianAddress();
    error DuplicateGuardian();
    error RecoveryNotConfigured();
    error NotAGuardian();
    error NewOwnersRequired();
    error RecoveryAlreadyInitiated();
    error RecoveryNotInitiated();
    error RecoveryAlreadyExecuted();
    error AlreadyApproved();
    error NotApproved();
    error NotEnoughApprovals();
    error RecoveryPeriodNotElapsed();
    error NotAnOwner();

    /// @notice Configuration for wallet recovery
    /// @dev Stored per-wallet, set by wallet owners
    struct RecoveryConfig {
        /// @notice Array of guardian addresses who can initiate/approve recovery
        address[] guardians;
        /// @notice Number of guardian approvals required to execute recovery
        uint256 threshold;
        /// @notice Time delay (in seconds) before recovery can be executed
        uint256 recoveryPeriod;
    }

    /// @notice Represents an initiated recovery process
    /// @dev Created when a guardian initiates recovery
    struct Recovery {
        /// @notice New owner addresses after recovery
        address[] newOwners;
        /// @notice New threshold after recovery
        uint256 newThreshold;
        /// @notice Number of guardians who have approved this recovery
        uint256 approvalCount;
        /// @notice Timestamp when recovery can be executed (after time delay)
        uint256 executionTime;
        /// @notice Threshold required at initiation time (prevents config manipulation attacks)
        uint256 requiredThreshold;
        /// @notice Whether this recovery has been executed
        bool executed;
    }

    /// @notice Mapping from wallet address to its recovery configuration
    /// @dev Each wallet has independent guardian configuration; cannot be modified while recoveries pending
    mapping(address => RecoveryConfig) public recoveryConfigs;

    /// @notice Mapping from wallet address to recovery hash to recovery details
    /// @dev Double mapping enables multiple concurrent recovery attempts per wallet with unique hashes
    mapping(address => mapping(bytes32 => Recovery)) public recoveries;

    /// @notice Mapping tracking which guardians have approved which recoveries
    /// @dev Triple nested mapping optimizes gas for approval tracking across wallets and recoveries
    mapping(address => mapping(bytes32 => mapping(address => bool))) public recoveryApprovals;

    /// @notice Nonce per wallet to ensure unique recovery hashes
    /// @dev Incremented on each recovery initiation to prevent hash collisions for identical parameters
    mapping(address => uint256) public recoveryNonces;

    /// @notice Array of pending recovery hashes per wallet
    /// @dev Used for efficient pending recovery checks; cleaned up on execution/cancellation via swap-and-pop
    mapping(address => bytes32[]) public pendingRecoveryHashes;

    /// @notice Emitted when recovery is configured for a wallet
    /// @param wallet Address of the multisig wallet
    /// @param guardians Array of guardian addresses
    /// @param threshold Number of approvals required
    /// @param recoveryPeriod Time delay before execution
    event RecoverySetup(
        address indexed wallet,
        address[] guardians,
        uint256 threshold,
        uint256 recoveryPeriod
    );

    /// @notice Emitted when a guardian initiates a recovery process
    /// @param wallet Address of the multisig wallet
    /// @param recoveryHash Unique hash identifying this recovery
    /// @param newOwners Proposed new owner addresses
    /// @param newThreshold Proposed new threshold
    /// @param initiator Guardian who initiated the recovery
    event RecoveryInitiated(
        address indexed wallet,
        bytes32 indexed recoveryHash,
        address[] newOwners,
        uint256 newThreshold,
        address indexed initiator
    );

    /// @notice Emitted when a guardian approves a recovery
    /// @param wallet Address of the multisig wallet
    /// @param recoveryHash Hash of the recovery being approved
    /// @param guardian Address of the approving guardian
    event RecoveryApproved(
        address indexed wallet,
        bytes32 indexed recoveryHash,
        address indexed guardian
    );

    /// @notice Emitted when a recovery is successfully executed
    /// @param wallet Address of the multisig wallet
    /// @param recoveryHash Hash of the executed recovery
    event RecoveryExecuted(
        address indexed wallet,
        bytes32 indexed recoveryHash
    );

    /// @notice Emitted when a recovery is cancelled by a wallet owner
    /// @param wallet Address of the multisig wallet
    /// @param recoveryHash Hash of the cancelled recovery
    event RecoveryCancelled(
        address indexed wallet,
        bytes32 indexed recoveryHash
    );

    /// @notice Emitted when a guardian revokes their approval
    /// @param wallet Address of the multisig wallet
    /// @param recoveryHash Hash of the recovery
    /// @param guardian Address of the guardian who revoked
    event RecoveryApprovalRevoked(
        address indexed wallet,
        bytes32 indexed recoveryHash,
        address indexed guardian
    );

    /**
     * @notice Set up recovery configuration
     * @param wallet Multisig wallet address
     * @param guardians Array of guardian addresses
     * @param threshold Number of guardian approvals required
     * @param recoveryPeriod Time delay before recovery can be executed
     * @dev SECURITY: Must be called through multisig transaction (msg.sender == wallet)
     *      This prevents a single owner from unilaterally configuring recovery
     *      Also prevents configuration updates when there are pending recoveries
     */
    function setupRecovery(
        address wallet,
        address[] memory guardians,
        uint256 threshold,
        uint256 recoveryPeriod
    ) external {
        // SECURITY FIX (H-2): Require multisig approval by checking msg.sender == wallet
        // Previously only required isOwner, allowing single owner bypass
        if (msg.sender != wallet) revert MustBeCalledByWallet();
        if (guardians.length == 0) revert GuardiansRequired();
        if (threshold == 0 || threshold > guardians.length) revert InvalidThreshold();
        if (recoveryPeriod < 1 days) revert RecoveryPeriodTooShort();

        // SECURITY: Prevent configuration updates when there are pending recoveries
        // This prevents manipulation attacks where an owner changes the threshold
        // after a recovery is initiated but before it executes
        if (hasPendingRecoveries(wallet)) revert CannotUpdateConfigWhileRecoveriesPending();

        // Validate guardians
        for (uint256 i = 0; i < guardians.length; i++) {
            if (guardians[i] == address(0)) revert InvalidGuardianAddress();
            // Check for duplicates
            for (uint256 j = i + 1; j < guardians.length; j++) {
                if (guardians[i] == guardians[j]) revert DuplicateGuardian();
            }
        }

        recoveryConfigs[wallet] = RecoveryConfig({
            guardians: guardians,
            threshold: threshold,
            recoveryPeriod: recoveryPeriod
        });

        emit RecoverySetup(wallet, guardians, threshold, recoveryPeriod);
    }

    /**
     * @notice Initiate recovery process
     * @param wallet Multisig wallet address
     * @param newOwners New owners after recovery
     * @param newThreshold New threshold after recovery
     * @return recoveryHash Hash of the recovery
     */
    function initiateRecovery(
        address wallet,
        address[] memory newOwners,
        uint256 newThreshold
    ) external returns (bytes32) {
        RecoveryConfig memory config = recoveryConfigs[wallet];
        if (config.guardians.length == 0) revert RecoveryNotConfigured();
        if (!isGuardian(wallet, msg.sender)) revert NotAGuardian();
        if (newOwners.length == 0) revert NewOwnersRequired();
        if (newThreshold == 0 || newThreshold > newOwners.length) revert InvalidThreshold();

        // Increment nonce to ensure unique recovery hash
        recoveryNonces[wallet]++;
        uint256 nonce = recoveryNonces[wallet];

        bytes32 recoveryHash = getRecoveryHash(wallet, newOwners, newThreshold, nonce);

        // Check if recovery with this hash already exists (shouldn't happen with nonce, but safety check)
        if (recoveries[wallet][recoveryHash].executionTime != 0) revert RecoveryAlreadyInitiated();

        recoveries[wallet][recoveryHash] = Recovery({
            newOwners: newOwners,
            newThreshold: newThreshold,
            approvalCount: 0,
            executionTime: block.timestamp + config.recoveryPeriod,
            requiredThreshold: config.threshold, // Store threshold at initiation time
            executed: false
        });

        // Add to pending recoveries list
        pendingRecoveryHashes[wallet].push(recoveryHash);

        emit RecoveryInitiated(
            wallet,
            recoveryHash,
            newOwners,
            newThreshold,
            msg.sender
        );

        return recoveryHash;
    }

    /**
     * @notice Approve a recovery
     * @param wallet Multisig wallet address
     * @param recoveryHash Recovery hash
     */
    function approveRecovery(address wallet, bytes32 recoveryHash) external {
        if (!isGuardian(wallet, msg.sender)) revert NotAGuardian();
        if (recoveries[wallet][recoveryHash].executionTime == 0) revert RecoveryNotInitiated();
        if (recoveries[wallet][recoveryHash].executed) revert RecoveryAlreadyExecuted();
        if (recoveryApprovals[wallet][recoveryHash][msg.sender]) revert AlreadyApproved();

        recoveryApprovals[wallet][recoveryHash][msg.sender] = true;
        recoveries[wallet][recoveryHash].approvalCount++;

        emit RecoveryApproved(wallet, recoveryHash, msg.sender);
    }

    /**
     * @notice Revoke approval for a recovery
     * @dev Allows guardians to change their mind before recovery is executed
     * @param wallet Multisig wallet address
     * @param recoveryHash Recovery hash
     */
    function revokeRecoveryApproval(address wallet, bytes32 recoveryHash) external {
        if (!isGuardian(wallet, msg.sender)) revert NotAGuardian();
        if (recoveries[wallet][recoveryHash].executionTime == 0) revert RecoveryNotInitiated();
        if (recoveries[wallet][recoveryHash].executed) revert RecoveryAlreadyExecuted();
        if (!recoveryApprovals[wallet][recoveryHash][msg.sender]) revert NotApproved();

        recoveryApprovals[wallet][recoveryHash][msg.sender] = false;
        recoveries[wallet][recoveryHash].approvalCount--;

        emit RecoveryApprovalRevoked(wallet, recoveryHash, msg.sender);
    }

    /**
     * @notice Execute recovery after threshold is met and time delay has passed
     * @param wallet Multisig wallet address
     * @param recoveryHash Recovery hash
     */
    function executeRecovery(address wallet, bytes32 recoveryHash) external {
        Recovery storage recovery = recoveries[wallet][recoveryHash];

        if (recovery.executionTime == 0) revert RecoveryNotInitiated();
        if (recovery.executed) revert RecoveryAlreadyExecuted();
        // SECURITY: Use threshold stored at initiation time, not current config
        // This prevents manipulation attacks where config is changed mid-recovery
        if (recovery.approvalCount < recovery.requiredThreshold) revert NotEnoughApprovals();
        if (block.timestamp < recovery.executionTime) revert RecoveryPeriodNotElapsed();

        recovery.executed = true;

        // Remove from pending recoveries
        _removePendingRecovery(wallet, recoveryHash);

        MultisigWallet multisig = MultisigWallet(payable(wallet));

        // Remove old owners and add new owners
        // Must use execTransactionFromModule since addOwner/removeOwner/changeThreshold have onlySelf modifier
        address[] memory oldOwners = multisig.getOwners();

        // Add new owners first (order matters for threshold validation)
        for (uint256 i = 0; i < recovery.newOwners.length; i++) {
            if (!multisig.isOwner(recovery.newOwners[i])) {
                bytes memory addOwnerData = abi.encodeWithSelector(
                    MultisigWallet.addOwner.selector,
                    recovery.newOwners[i]
                );
                multisig.execTransactionFromModule(wallet, 0, addOwnerData);
            }
        }

        // Remove old owners that are not in new owners list
        for (uint256 i = 0; i < oldOwners.length; i++) {
            bool keepOwner = false;
            for (uint256 j = 0; j < recovery.newOwners.length; j++) {
                if (oldOwners[i] == recovery.newOwners[j]) {
                    keepOwner = true;
                    break;
                }
            }
            if (!keepOwner) {
                bytes memory removeOwnerData = abi.encodeWithSelector(
                    MultisigWallet.removeOwner.selector,
                    oldOwners[i]
                );
                multisig.execTransactionFromModule(wallet, 0, removeOwnerData);
            }
        }

        // Update threshold
        bytes memory changeThresholdData = abi.encodeWithSelector(
            MultisigWallet.changeThreshold.selector,
            recovery.newThreshold
        );
        multisig.execTransactionFromModule(wallet, 0, changeThresholdData);

        emit RecoveryExecuted(wallet, recoveryHash);
    }

    /**
     * @notice Cancel a recovery (can be done by any current owner)
     * @param wallet Multisig wallet address
     * @param recoveryHash Recovery hash
     */
    function cancelRecovery(address wallet, bytes32 recoveryHash) external {
        MultisigWallet multisig = MultisigWallet(payable(wallet));
        if (!multisig.isOwner(msg.sender)) revert NotAnOwner();

        Recovery storage recovery = recoveries[wallet][recoveryHash];
        if (recovery.executionTime == 0) revert RecoveryNotInitiated();
        if (recovery.executed) revert RecoveryAlreadyExecuted();

        // Remove from pending recoveries
        _removePendingRecovery(wallet, recoveryHash);

        delete recoveries[wallet][recoveryHash];

        emit RecoveryCancelled(wallet, recoveryHash);
    }

    /**
     * @notice Get recovery hash
     * @param wallet Wallet address
     * @param newOwners New owners
     * @param newThreshold New threshold
     * @param nonce Unique nonce to ensure recovery hash uniqueness
     * @return Unique bytes32 hash identifying this specific recovery configuration
     */
    function getRecoveryHash(
        address wallet,
        address[] memory newOwners,
        uint256 newThreshold,
        uint256 nonce
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(wallet, newOwners, newThreshold, nonce));
    }

    /**
     * @notice Get recovery hash for current nonce (for frontend convenience)
     * @param wallet Wallet address
     * @param newOwners New owners
     * @param newThreshold New threshold
     * @return Recovery hash with current nonce
     */
    function getRecoveryHashForCurrentNonce(
        address wallet,
        address[] memory newOwners,
        uint256 newThreshold
    ) public view returns (bytes32) {
        return getRecoveryHash(wallet, newOwners, newThreshold, recoveryNonces[wallet] + 1);
    }

    /**
     * @notice Check if address is a guardian
     * @param wallet Wallet address
     * @param guardian Address to check
     * @return True if guardian
     */
    function isGuardian(address wallet, address guardian)
        public
        view
        returns (bool)
    {
        RecoveryConfig memory config = recoveryConfigs[wallet];
        for (uint256 i = 0; i < config.guardians.length; i++) {
            if (config.guardians[i] == guardian) {
                return true;
            }
        }
        return false;
    }

    /**
     * @notice Get recovery configuration
     * @param wallet Wallet address
     * @return config Recovery configuration
     */
    function getRecoveryConfig(address wallet)
        external
        view
        returns (RecoveryConfig memory)
    {
        return recoveryConfigs[wallet];
    }

    /**
     * @notice Get recovery details
     * @param wallet Wallet address
     * @param recoveryHash Recovery hash
     * @return recovery Recovery details
     */
    function getRecovery(address wallet, bytes32 recoveryHash)
        external
        view
        returns (Recovery memory)
    {
        return recoveries[wallet][recoveryHash];
    }

    /**
     * @notice Check if wallet has any pending recoveries
     * @param wallet Wallet address
     * @return True if there are pending recoveries
     */
    function hasPendingRecoveries(address wallet) public view returns (bool) {
        bytes32[] memory pending = pendingRecoveryHashes[wallet];
        for (uint256 i = 0; i < pending.length; i++) {
            Recovery memory recovery = recoveries[wallet][pending[i]];
            // Check if recovery exists and is not executed
            if (recovery.executionTime != 0 && !recovery.executed) {
                return true;
            }
        }
        return false;
    }

    /**
     * @notice Get all pending recovery hashes for a wallet
     * @param wallet Wallet address
     * @return Array of pending recovery hashes
     */
    function getPendingRecoveryHashes(address wallet)
        external
        view
        returns (bytes32[] memory)
    {
        return pendingRecoveryHashes[wallet];
    }

    /**
     * @notice Internal function to remove a recovery from pending list
     * @param wallet Wallet address
     * @param recoveryHash Recovery hash to remove
     */
    function _removePendingRecovery(address wallet, bytes32 recoveryHash) internal {
        bytes32[] storage pending = pendingRecoveryHashes[wallet];
        for (uint256 i = 0; i < pending.length; i++) {
            if (pending[i] == recoveryHash) {
                // Move last element to current position and pop
                pending[i] = pending[pending.length - 1];
                pending.pop();
                break;
            }
        }
    }
}
