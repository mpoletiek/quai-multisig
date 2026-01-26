// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../MultisigWallet.sol";

/**
 * @title WhitelistModule
 * @dev Module for whitelisting addresses that can receive funds without full approval
 * @notice Pre-approved addresses can be sent to with reduced friction
 */
contract WhitelistModule {
    /// @notice Mapping from wallet to address to whitelist status
    mapping(address => mapping(address => bool)) public whitelist;

    /// @notice Mapping from wallet to address to per-transaction limit (0 = unlimited)
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
     */
    function addToWhitelist(
        address wallet,
        address addr,
        uint256 limit
    ) external {
        MultisigWallet multisig = MultisigWallet(payable(wallet));
        require(multisig.isOwner(msg.sender), "Not an owner");
        require(multisig.modules(address(this)), "Module not enabled");
        require(addr != address(0), "Invalid address");

        whitelist[wallet][addr] = true;
        whitelistLimits[wallet][addr] = limit;

        emit AddressWhitelisted(wallet, addr, limit);
    }

    /**
     * @notice Remove address from whitelist
     * @param wallet Multisig wallet address
     * @param addr Address to remove
     */
    function removeFromWhitelist(address wallet, address addr) external {
        MultisigWallet multisig = MultisigWallet(payable(wallet));
        require(multisig.isOwner(msg.sender), "Not an owner");

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
        require(multisig.isOwner(msg.sender), "Not an owner");
        require(multisig.modules(address(this)), "Module not enabled");
        require(whitelist[wallet][to], "Address not whitelisted");

        // Check limit if set
        uint256 limit = whitelistLimits[wallet][to];
        if (limit > 0) {
            require(value <= limit, "Exceeds whitelist limit");
        }

        // Execute transaction through wallet
        bool success = multisig.execTransactionFromModule(to, value, data);
        require(success, "Transaction failed");

        emit WhitelistTransactionExecuted(wallet, to, value);
    }

    /**
     * @notice Batch add addresses to whitelist
     * @param wallet Multisig wallet address
     * @param addresses Array of addresses to whitelist
     * @param limits Array of limits (0 = unlimited)
     */
    function batchAddToWhitelist(
        address wallet,
        address[] memory addresses,
        uint256[] memory limits
    ) external {
        require(addresses.length == limits.length, "Array length mismatch");

        MultisigWallet multisig = MultisigWallet(payable(wallet));
        require(multisig.isOwner(msg.sender), "Not an owner");
        require(multisig.modules(address(this)), "Module not enabled");

        for (uint256 i = 0; i < addresses.length; i++) {
            require(addresses[i] != address(0), "Invalid address");

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
