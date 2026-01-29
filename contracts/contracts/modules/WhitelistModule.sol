// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../MultisigWallet.sol";

/**
 * @title WhitelistModule
 * @dev Module for whitelisting addresses that can receive funds without full approval
 * @notice Pre-approved addresses can be sent to with reduced friction
 */
contract WhitelistModule {
    // Custom errors (gas efficient)
    error MustBeCalledByWallet();
    error ModuleNotEnabled();
    error NotAnOwner();
    error InvalidAddress();
    error AddressNotWhitelisted();
    error ExceedsWhitelistLimit();
    error TransactionFailed();
    error ArrayLengthMismatch();

    /// @notice Mapping from wallet to address to whitelist status
    /// @dev Nested mapping allows each wallet to maintain independent whitelists
    mapping(address => mapping(address => bool)) public whitelist;

    /// @notice Mapping from wallet to address to per-transaction limit (0 = unlimited)
    /// @dev Zero value indicates unlimited transfers; limit checked per transaction, not cumulative
    mapping(address => mapping(address => uint256)) public whitelistLimits;

    /// @notice Emitted when an address is added to the whitelist
    /// @param wallet Address of the multisig wallet
    /// @param addr Address being whitelisted
    /// @param limit Maximum per-transaction amount (0 = unlimited)
    event AddressWhitelisted(
        address indexed wallet,
        address indexed addr,
        uint256 limit
    );

    /// @notice Emitted when an address is removed from the whitelist
    /// @param wallet Address of the multisig wallet
    /// @param addr Address being removed
    event AddressRemovedFromWhitelist(
        address indexed wallet,
        address indexed addr
    );

    /// @notice Emitted when a transaction is executed to a whitelisted address
    /// @param wallet Address of the multisig wallet
    /// @param to Destination address
    /// @param value Amount sent in wei
    event WhitelistTransactionExecuted(
        address indexed wallet,
        address indexed to,
        uint256 value
    );

    /**
     * @notice Add address to whitelist
     * @param wallet Multisig wallet address
     * @param addr Address to whitelist
     * @param limit Maximum amount that can be sent (0 = unlimited)
     * @dev SECURITY: Must be called through multisig transaction (msg.sender == wallet)
     *      This prevents a single owner from unilaterally adding addresses to whitelist
     */
    function addToWhitelist(
        address wallet,
        address addr,
        uint256 limit
    ) external {
        // SECURITY FIX (H-2): Require multisig approval by checking msg.sender == wallet
        // Previously only required isOwner, allowing single owner bypass
        if (msg.sender != wallet) revert MustBeCalledByWallet();
        MultisigWallet multisig = MultisigWallet(payable(wallet));
        if (!multisig.modules(address(this))) revert ModuleNotEnabled();
        if (addr == address(0)) revert InvalidAddress();

        whitelist[wallet][addr] = true;
        whitelistLimits[wallet][addr] = limit;

        emit AddressWhitelisted(wallet, addr, limit);
    }

    /**
     * @notice Remove address from whitelist
     * @param wallet Multisig wallet address
     * @param addr Address to remove
     * @dev SECURITY: Must be called through multisig transaction (msg.sender == wallet)
     */
    function removeFromWhitelist(address wallet, address addr) external {
        // SECURITY FIX (H-2): Require multisig approval by checking msg.sender == wallet
        if (msg.sender != wallet) revert MustBeCalledByWallet();
        MultisigWallet multisig = MultisigWallet(payable(wallet));
        if (!multisig.modules(address(this))) revert ModuleNotEnabled();

        whitelist[wallet][addr] = false;
        whitelistLimits[wallet][addr] = 0;

        emit AddressRemovedFromWhitelist(wallet, addr);
    }

    /**
     * @notice Execute transaction to whitelisted address
     * @param wallet Multisig wallet address
     * @param to Whitelisted destination address
     * @param value Amount to send
     * @param data Transaction data
     */
    function executeToWhitelist(
        address wallet,
        address to,
        uint256 value,
        bytes memory data
    ) external {
        MultisigWallet multisig = MultisigWallet(payable(wallet));
        if (!multisig.isOwner(msg.sender)) revert NotAnOwner();
        if (!multisig.modules(address(this))) revert ModuleNotEnabled();
        if (!whitelist[wallet][to]) revert AddressNotWhitelisted();

        // Check limit if set
        uint256 limit = whitelistLimits[wallet][to];
        if (limit > 0) {
            if (value > limit) revert ExceedsWhitelistLimit();
        }

        // Execute transaction through wallet
        bool success = multisig.execTransactionFromModule(to, value, data);
        if (!success) revert TransactionFailed();

        emit WhitelistTransactionExecuted(wallet, to, value);
    }

    /**
     * @notice Batch add addresses to whitelist
     * @param wallet Multisig wallet address
     * @param addresses Array of addresses to whitelist
     * @param limits Array of limits (0 = unlimited)
     * @dev SECURITY: Must be called through multisig transaction (msg.sender == wallet)
     */
    function batchAddToWhitelist(
        address wallet,
        address[] memory addresses,
        uint256[] memory limits
    ) external {
        if (addresses.length != limits.length) revert ArrayLengthMismatch();

        // SECURITY FIX (H-2): Require multisig approval by checking msg.sender == wallet
        if (msg.sender != wallet) revert MustBeCalledByWallet();
        MultisigWallet multisig = MultisigWallet(payable(wallet));
        if (!multisig.modules(address(this))) revert ModuleNotEnabled();

        for (uint256 i = 0; i < addresses.length; i++) {
            if (addresses[i] == address(0)) revert InvalidAddress();

            whitelist[wallet][addresses[i]] = true;
            whitelistLimits[wallet][addresses[i]] = limits[i];

            emit AddressWhitelisted(wallet, addresses[i], limits[i]);
        }
    }

    /**
     * @notice Check if address is whitelisted
     * @param wallet Multisig wallet address
     * @param addr Address to check
     * @return True if whitelisted
     */
    function isWhitelisted(address wallet, address addr)
        external
        view
        returns (bool)
    {
        return whitelist[wallet][addr];
    }

    /**
     * @notice Get whitelist limit for an address
     * @param wallet Multisig wallet address
     * @param addr Address to check
     * @return Limit (0 = unlimited or not whitelisted)
     */
    function getWhitelistLimit(address wallet, address addr)
        external
        view
        returns (uint256)
    {
        return whitelistLimits[wallet][addr];
    }
}
