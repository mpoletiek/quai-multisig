// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../MultisigWallet.sol";

/**
 * @title DailyLimitModule
 * @dev Module for setting daily spending limits on multisig wallets
 * @notice Allows automatic execution of transactions below the daily limit
 */
contract DailyLimitModule {
    /// @notice Structure representing a wallet's daily spending limit
    /// @dev Reset automatically after 24 hours
    struct DailyLimit {
        /// @notice Maximum amount that can be spent per day (in wei)
        uint256 limit;
        /// @notice Amount already spent in current period (in wei)
        uint256 spent;
        /// @notice Timestamp of last limit reset
        uint256 lastReset;
    }

    // Custom errors (gas efficient)
    error MustBeCalledByWallet();
    error ModuleNotEnabled();
    error NotAnOwner();
    error InvalidDestination();
    error DailyLimitNotSet();
    error ExceedsDailyLimit();
    error TransactionFailed();

    /// @notice Mapping from wallet address to its daily limit configuration
    /// @dev Each wallet has independent limit tracking; automatically resets after 24 hours from lastReset
    mapping(address => DailyLimit) public dailyLimits;

    /// @notice Emitted when a daily limit is set or updated
    /// @param wallet Address of the multisig wallet
    /// @param limit New daily limit in wei
    event DailyLimitSet(address indexed wallet, uint256 limit);

    /// @notice Emitted when a transaction is executed within the daily limit
    /// @param wallet Address of the multisig wallet
    /// @param to Destination address
    /// @param value Amount sent in wei
    /// @param remainingLimit Remaining daily limit after transaction
    event TransactionExecuted(
        address indexed wallet,
        address indexed to,
        uint256 value,
        uint256 remainingLimit
    );

    /// @notice Emitted when the daily limit is reset
    /// @param wallet Address of the multisig wallet
    event DailyLimitReset(address indexed wallet);

    /**
     * @notice Set daily spending limit
     * @param wallet Multisig wallet address
     * @param limit Daily limit in wei
     * @dev SECURITY: Must be called through multisig transaction (msg.sender == wallet)
     *      This prevents a single owner from unilaterally setting limits
     */
    function setDailyLimit(address wallet, uint256 limit) external {
        // SECURITY FIX (H-2): Require multisig approval by checking msg.sender == wallet
        // Previously only required isOwner, allowing single owner bypass
        if (msg.sender != wallet) revert MustBeCalledByWallet();
        MultisigWallet multisig = MultisigWallet(payable(wallet));
        if (!multisig.modules(address(this))) revert ModuleNotEnabled();

        dailyLimits[wallet].limit = limit;

        // Initialize lastReset if not set
        if (dailyLimits[wallet].lastReset == 0) {
            dailyLimits[wallet].lastReset = block.timestamp;
        }

        emit DailyLimitSet(wallet, limit);
    }

    /**
     * @notice Execute transaction if below daily limit
     * @param wallet Multisig wallet address
     * @param to Destination address
     * @param value Amount to send
     */
    function executeBelowLimit(
        address wallet,
        address to,
        uint256 value
    ) external {
        MultisigWallet multisig = MultisigWallet(payable(wallet));
        if (!multisig.isOwner(msg.sender)) revert NotAnOwner();
        if (!multisig.modules(address(this))) revert ModuleNotEnabled();
        if (to == address(0)) revert InvalidDestination();

        DailyLimit storage limit = dailyLimits[wallet];
        if (limit.limit == 0) revert DailyLimitNotSet();

        // Reset if 24 hours have passed
        if (block.timestamp >= limit.lastReset + 1 days) {
            limit.spent = 0;
            limit.lastReset = block.timestamp;
            emit DailyLimitReset(wallet);
        }

        // Check if transaction is within limit
        if (limit.spent + value > limit.limit) revert ExceedsDailyLimit();

        // Update spent amount
        limit.spent += value;

        // Execute transaction through wallet
        bool success = multisig.execTransactionFromModule(to, value, "");
        if (!success) revert TransactionFailed();

        emit TransactionExecuted(
            wallet,
            to,
            value,
            limit.limit - limit.spent
        );
    }

    /**
     * @notice Manually reset daily limit
     * @param wallet Multisig wallet address
     * @dev SECURITY: Must be called through multisig transaction (msg.sender == wallet)
     *      This prevents a single owner from unilaterally resetting the limit
     */
    function resetDailyLimit(address wallet) external {
        // SECURITY FIX (H-2): Require multisig approval by checking msg.sender == wallet
        if (msg.sender != wallet) revert MustBeCalledByWallet();
        MultisigWallet multisig = MultisigWallet(payable(wallet));
        if (!multisig.modules(address(this))) revert ModuleNotEnabled();

        DailyLimit storage limit = dailyLimits[wallet];
        limit.spent = 0;
        limit.lastReset = block.timestamp;

        emit DailyLimitReset(wallet);
    }

    /**
     * @notice Get remaining daily limit
     * @param wallet Multisig wallet address
     * @return Remaining limit in wei
     */
    function getRemainingLimit(address wallet) external view returns (uint256) {
        DailyLimit memory limit = dailyLimits[wallet];

        if (limit.limit == 0) {
            return 0;
        }

        // Check if limit should be reset
        if (block.timestamp >= limit.lastReset + 1 days) {
            return limit.limit;
        }

        if (limit.spent >= limit.limit) {
            return 0;
        }

        return limit.limit - limit.spent;
    }

    /**
     * @notice Get time until limit resets
     * @param wallet Multisig wallet address
     * @return Seconds until reset
     */
    function getTimeUntilReset(address wallet) external view returns (uint256) {
        DailyLimit memory limit = dailyLimits[wallet];

        if (limit.lastReset == 0) {
            return 0;
        }

        uint256 resetTime = limit.lastReset + 1 days;

        if (block.timestamp >= resetTime) {
            return 0;
        }

        return resetTime - block.timestamp;
    }

    /**
     * @notice Get daily limit configuration
     * @param wallet Multisig wallet address
     * @return Daily limit details
     */
    function getDailyLimit(address wallet)
        external
        view
        returns (DailyLimit memory)
    {
        return dailyLimits[wallet];
    }
}
