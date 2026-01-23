// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../MultisigWallet.sol";

/**
 * @title SocialRecoveryModule
 * @dev Module for social recovery of multisig wallets
 * @notice Allows guardians to recover wallet access
 */
contract SocialRecoveryModule {
    struct RecoveryConfig {
        address[] guardians;
        uint256 threshold;
        uint256 recoveryPeriod; // Time delay before execution
    }

    struct Recovery {
        address[] newOwners;
        uint256 newThreshold;
        uint256 approvalCount;
        uint256 executionTime;
        bool executed;
    }

    // Wallet => RecoveryConfig
    mapping(address => RecoveryConfig) public recoveryConfigs;

    // Wallet => RecoveryHash => Recovery
    mapping(address => mapping(bytes32 => Recovery)) public recoveries;

    // Wallet => RecoveryHash => Guardian => Approved
    mapping(address => mapping(bytes32 => mapping(address => bool))) public recoveryApprovals;

    // Wallet => Nonce (incremented for each recovery initiation)
    mapping(address => uint256) public recoveryNonces;

    // Events
    event RecoverySetup(
        address indexed wallet,
        address[] guardians,
        uint256 threshold,
        uint256 recoveryPeriod
    );

    event RecoveryInitiated(
        address indexed wallet,
        bytes32 indexed recoveryHash,
        address[] newOwners,
        uint256 newThreshold,
        address indexed initiator
    );

    event RecoveryApproved(
        address indexed wallet,
        bytes32 indexed recoveryHash,
        address indexed guardian
    );

    event RecoveryExecuted(
        address indexed wallet,
        bytes32 indexed recoveryHash
    );

    event RecoveryCancelled(
        address indexed wallet,
        bytes32 indexed recoveryHash
    );

    /**
     * @notice Set up recovery configuration
     * @param wallet Multisig wallet address
     * @param guardians Array of guardian addresses
     * @param threshold Number of guardian approvals required
     * @param recoveryPeriod Time delay before recovery can be executed
     */
    function setupRecovery(
        address wallet,
        address[] memory guardians,
        uint256 threshold,
        uint256 recoveryPeriod
    ) external {
        MultisigWallet multisig = MultisigWallet(payable(wallet));
        require(multisig.isOwner(msg.sender), "Not an owner");
        require(guardians.length > 0, "Guardians required");
        require(
            threshold > 0 && threshold <= guardians.length,
            "Invalid threshold"
        );
        require(recoveryPeriod >= 1 days, "Recovery period too short");

        // Validate guardians
        for (uint256 i = 0; i < guardians.length; i++) {
            require(guardians[i] != address(0), "Invalid guardian address");
            // Check for duplicates
            for (uint256 j = i + 1; j < guardians.length; j++) {
                require(guardians[i] != guardians[j], "Duplicate guardian");
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
        require(config.guardians.length > 0, "Recovery not configured");
        require(isGuardian(wallet, msg.sender), "Not a guardian");
        require(newOwners.length > 0, "New owners required");
        require(
            newThreshold > 0 && newThreshold <= newOwners.length,
            "Invalid threshold"
        );

        // Increment nonce to ensure unique recovery hash
        recoveryNonces[wallet]++;
        uint256 nonce = recoveryNonces[wallet];

        bytes32 recoveryHash = getRecoveryHash(wallet, newOwners, newThreshold, nonce);

        // Check if recovery with this hash already exists (shouldn't happen with nonce, but safety check)
        require(
            recoveries[wallet][recoveryHash].executionTime == 0,
            "Recovery already initiated"
        );

        recoveries[wallet][recoveryHash] = Recovery({
            newOwners: newOwners,
            newThreshold: newThreshold,
            approvalCount: 0,
            executionTime: block.timestamp + config.recoveryPeriod,
            executed: false
        });

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
        require(isGuardian(wallet, msg.sender), "Not a guardian");
        require(
            recoveries[wallet][recoveryHash].executionTime != 0,
            "Recovery not initiated"
        );
        require(
            !recoveries[wallet][recoveryHash].executed,
            "Recovery already executed"
        );
        require(
            !recoveryApprovals[wallet][recoveryHash][msg.sender],
            "Already approved"
        );

        recoveryApprovals[wallet][recoveryHash][msg.sender] = true;
        recoveries[wallet][recoveryHash].approvalCount++;

        emit RecoveryApproved(wallet, recoveryHash, msg.sender);
    }

    /**
     * @notice Execute recovery after threshold is met and time delay has passed
     * @param wallet Multisig wallet address
     * @param recoveryHash Recovery hash
     */
    function executeRecovery(address wallet, bytes32 recoveryHash) external {
        RecoveryConfig memory config = recoveryConfigs[wallet];
        Recovery storage recovery = recoveries[wallet][recoveryHash];

        require(recovery.executionTime != 0, "Recovery not initiated");
        require(!recovery.executed, "Recovery already executed");
        require(
            recovery.approvalCount >= config.threshold,
            "Not enough approvals"
        );
        require(
            block.timestamp >= recovery.executionTime,
            "Recovery period not elapsed"
        );

        recovery.executed = true;

        MultisigWallet multisig = MultisigWallet(payable(wallet));

        // Remove old owners and add new owners
        address[] memory oldOwners = multisig.getOwners();

        // Add new owners
        for (uint256 i = 0; i < recovery.newOwners.length; i++) {
            if (!multisig.isOwner(recovery.newOwners[i])) {
                multisig.addOwner(recovery.newOwners[i]);
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
                multisig.removeOwner(oldOwners[i]);
            }
        }

        // Update threshold
        multisig.changeThreshold(recovery.newThreshold);

        emit RecoveryExecuted(wallet, recoveryHash);
    }

    /**
     * @notice Cancel a recovery (can be done by any current owner)
     * @param wallet Multisig wallet address
     * @param recoveryHash Recovery hash
     */
    function cancelRecovery(address wallet, bytes32 recoveryHash) external {
        MultisigWallet multisig = MultisigWallet(payable(wallet));
        require(multisig.isOwner(msg.sender), "Not an owner");

        Recovery storage recovery = recoveries[wallet][recoveryHash];
        require(recovery.executionTime != 0, "Recovery not initiated");
        require(!recovery.executed, "Recovery already executed");

        delete recoveries[wallet][recoveryHash];

        emit RecoveryCancelled(wallet, recoveryHash);
    }

    /**
     * @notice Get recovery hash
     * @param wallet Wallet address
     * @param newOwners New owners
     * @param newThreshold New threshold
     * @return Recovery hash
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
}
