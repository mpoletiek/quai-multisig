// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/**
 * @title MultisigWalletProxy
 * @dev Minimal proxy contract for each multisig wallet instance
 * @notice Uses ERC1967 transparent proxy pattern for upgradeability
 */
contract MultisigWalletProxy is ERC1967Proxy {
    /**
     * @notice Event emitted when QUAI is received
     * @dev This matches the Received event from MultisigWallet implementation
     */
    event Received(address indexed sender, uint256 value);
    /**
     * @notice Constructor for the proxy
     * @param implementation Address of the MultisigWallet implementation
     * @param data Initialization data (encoded initialize function call)
     */
    constructor(
        address implementation,
        bytes memory data
    ) ERC1967Proxy(implementation, data) {}

    /**
     * @notice Get the current implementation address
     * @return Implementation contract address
     */
    function getImplementation() external view returns (address) {
        return _implementation();
    }

    /**
     * @notice Receive function to accept native QUAI transfers
     * @dev Emits Received event when QUAI is sent to the proxy
     *      The value is stored in the proxy's balance, which is correct for proxy pattern
     *      No need to delegatecall since the implementation's receive() only emits the same event
     */
    receive() external payable {
        // Emit Received event (value is already in proxy balance)
        emit Received(msg.sender, msg.value);
    }
}
