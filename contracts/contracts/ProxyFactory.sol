// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./MultisigWalletProxy.sol";
import "./MultisigWallet.sol";

/**
 * @title ProxyFactory
 * @dev Factory contract for deploying new multisig wallet proxies
 * @notice Uses CREATE2 for deterministic addresses
 */
contract ProxyFactory {
    /// @notice Address of the MultisigWallet implementation contract
    address public immutable implementation;

    /// @notice Array of all deployed wallet addresses
    address[] public deployedWallets;

    /// @notice Mapping to check if an address is a registered wallet
    mapping(address => bool) public isWallet;

    /// @notice Emitted when a new wallet is created through the factory
    /// @param wallet Address of the newly created wallet
    /// @param owners Array of owner addresses
    /// @param threshold Number of required approvals
    /// @param creator Address that created the wallet
    /// @param salt Salt used for CREATE2 deployment
    event WalletCreated(
        address indexed wallet,
        address[] owners,
        uint256 threshold,
        address indexed creator,
        bytes32 salt
    );

    /// @notice Emitted when an externally deployed wallet is registered
    /// @param wallet Address of the registered wallet
    /// @param registrar Address of the owner who registered the wallet
    event WalletRegistered(
        address indexed wallet,
        address indexed registrar
    );

    /**
     * @notice Constructor
     * @param _implementation Address of the MultisigWallet implementation
     */
    constructor(address _implementation) {
        require(_implementation != address(0), "Invalid implementation address");
        implementation = _implementation;
    }

    /**
     * @notice Create a new multisig wallet
     * @param owners Array of owner addresses
     * @param threshold Number of required approvals
     * @param salt Salt for CREATE2
     * @return wallet Address of the created wallet
     */
    function createWallet(
        address[] memory owners,
        uint256 threshold,
        bytes32 salt
    ) external returns (address wallet) {
        require(owners.length > 0, "Owners required");
        require(
            threshold > 0 && threshold <= owners.length,
            "Invalid threshold"
        );

        // Encode initialization data
        bytes memory initData = abi.encodeWithSelector(
            MultisigWallet.initialize.selector,
            owners,
            threshold
        );

        // Deploy proxy with CREATE2
        bytes32 fullSalt = keccak256(abi.encodePacked(msg.sender, salt));
        wallet = address(
            new MultisigWalletProxy{salt: fullSalt}(implementation, initData)
        );

        // Register wallet
        deployedWallets.push(wallet);
        isWallet[wallet] = true;

        emit WalletCreated(wallet, owners, threshold, msg.sender, salt);

        return wallet;
    }

    /**
     * @notice Register an externally deployed wallet
     * @dev Allows users to register wallets they deployed directly (without factory)
     * @param wallet Address of the wallet to register
     */
    function registerWallet(address wallet) external {
        require(wallet != address(0), "Invalid wallet address");
        require(!isWallet[wallet], "Wallet already registered");

        MultisigWallet multisig = MultisigWallet(payable(wallet));

        // Verify caller is an owner of the wallet
        require(multisig.isOwner(msg.sender), "Caller is not an owner");

        // Register wallet
        deployedWallets.push(wallet);
        isWallet[wallet] = true;

        emit WalletRegistered(wallet, msg.sender);
    }

    /**
     * @notice Compute the address of a wallet before deployment
     * @dev WARNING: This function does not work correctly on Quai Network due to shard-aware addressing.
     *      On Quai Network, addresses are prefixed based on the shard (e.g., 0x00 for cyprus1, 0x01 for cyprus2).
     *      The actual deployed address will differ from the computed address.
     *      This function is kept for reference but should not be relied upon.
     *      Instead, retrieve the deployed wallet address from the WalletCreated event.
     * @param deployer Address that will deploy the wallet
     * @param salt Salt for CREATE2
     * @return Address the wallet will be deployed at (NOTE: Not accurate on Quai Network)
     */
    function computeAddress(
        address deployer,
        bytes32 salt
    ) external view returns (address) {
        bytes32 fullSalt = keccak256(abi.encodePacked(deployer, salt));

        bytes32 hash = keccak256(
            abi.encodePacked(
                bytes1(0xff),
                address(this),
                fullSalt,
                keccak256(
                    abi.encodePacked(
                        type(MultisigWalletProxy).creationCode,
                        abi.encode(implementation, "")
                    )
                )
            )
        );

        return address(uint160(uint256(hash)));
    }

    /**
     * @notice Get all deployed wallets
     * @return Array of wallet addresses
     */
    function getWallets() external view returns (address[] memory) {
        return deployedWallets;
    }

    /**
     * @notice Get total number of deployed wallets
     * @return Count of wallets
     */
    function getWalletCount() external view returns (uint256) {
        return deployedWallets.length;
    }

    /**
     * @notice Get wallets created by a specific address
     * @param creator Creator address
     * @return Array of wallet addresses
     */
    function getWalletsByCreator(address creator)
        external
        view
        returns (address[] memory)
    {
        uint256 count = 0;

        // First pass: count wallets
        for (uint256 i = 0; i < deployedWallets.length; i++) {
            MultisigWallet wallet = MultisigWallet(payable(deployedWallets[i]));
            if (wallet.isOwner(creator)) {
                count++;
            }
        }

        // Second pass: populate array
        address[] memory result = new address[](count);
        uint256 index = 0;

        for (uint256 i = 0; i < deployedWallets.length; i++) {
            MultisigWallet wallet = MultisigWallet(payable(deployedWallets[i]));
            if (wallet.isOwner(creator)) {
                result[index] = deployedWallets[i];
                index++;
            }
        }

        return result;
    }
}
