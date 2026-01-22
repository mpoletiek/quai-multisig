// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

/**
 * @title MultisigWallet
 * @dev Core multisig wallet implementation with upgradeable proxy pattern
 * @notice This is the implementation contract used by all proxy instances
 */
contract MultisigWallet is Initializable, ReentrancyGuardUpgradeable {
    // Transaction structure
    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        bool executed;
        bool cancelled;
        uint256 numApprovals;
        uint256 timestamp;
        address proposer; // Track who proposed the transaction
    }

    // State variables
    mapping(address => bool) public isOwner;
    address[] public owners;
    uint256 public threshold;
    uint256 public nonce;

    mapping(bytes32 => Transaction) public transactions;
    mapping(bytes32 => mapping(address => bool)) public approvals;
    mapping(address => bool) public modules;

    // Events
    event TransactionProposed(
        bytes32 indexed txHash,
        address indexed proposer,
        address indexed to,
        uint256 value,
        bytes data
    );

    event TransactionApproved(
        bytes32 indexed txHash,
        address indexed approver
    );

    event TransactionExecuted(
        bytes32 indexed txHash,
        address indexed executor
    );

    event ApprovalRevoked(
        bytes32 indexed txHash,
        address indexed owner
    );

    event TransactionCancelled(
        bytes32 indexed txHash,
        address indexed canceller
    );

    event OwnerAdded(address indexed owner);
    event OwnerRemoved(address indexed owner);
    event ThresholdChanged(uint256 threshold);
    event ModuleEnabled(address indexed module);
    event ModuleDisabled(address indexed module);
    event Received(address indexed sender, uint256 amount);

    // Modifiers
    modifier onlyOwner() {
        require(isOwner[msg.sender], "Not an owner");
        _;
    }

    modifier onlySelf() {
        require(msg.sender == address(this), "Only self");
        _;
    }

    modifier onlyModule() {
        require(modules[msg.sender], "Not an authorized module");
        _;
    }

    modifier txExists(bytes32 txHash) {
        require(transactions[txHash].to != address(0), "Transaction does not exist");
        _;
    }

    modifier notExecuted(bytes32 txHash) {
        require(!transactions[txHash].executed, "Transaction already executed");
        _;
    }

    modifier notCancelled(bytes32 txHash) {
        require(!transactions[txHash].cancelled, "Transaction already cancelled");
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @notice Initialize the multisig wallet
     * @param _owners Array of owner addresses
     * @param _threshold Number of required approvals
     */
    function initialize(
        address[] memory _owners,
        uint256 _threshold
    ) external initializer {
        require(_owners.length > 0, "Owners required");
        require(
            _threshold > 0 && _threshold <= _owners.length,
            "Invalid threshold"
        );

        __ReentrancyGuard_init();

        // Validate and set owners
        for (uint256 i = 0; i < _owners.length; i++) {
            address owner = _owners[i];

            require(owner != address(0), "Invalid owner address");
            require(!isOwner[owner], "Duplicate owner");

            isOwner[owner] = true;
            owners.push(owner);
        }

        threshold = _threshold;
        nonce = 0;
    }

    /**
     * @notice Propose a new transaction
     * @param to Destination address
     * @param value Amount of Quai to send
     * @param data Transaction data
     * @return txHash The transaction hash
     */
    function proposeTransaction(
        address to,
        uint256 value,
        bytes memory data
    ) external onlyOwner returns (bytes32) {
        require(to != address(0), "Invalid destination address");

        bytes32 txHash = getTransactionHash(to, value, data, nonce);

        // Check if transaction already exists
        Transaction storage existingTx = transactions[txHash];
        bool isOverwritingCancelled = false;
        
        // If transaction exists and is not cancelled, reject
        if (existingTx.to != address(0)) {
            require(existingTx.cancelled, "Transaction already exists");
            // If cancelled, we'll overwrite it below (treat as new proposal)
            isOverwritingCancelled = true;
        }

        // If overwriting a cancelled transaction, clear all existing approvals
        // This is necessary because approveTransaction checks if an owner has already approved
        if (isOverwritingCancelled) {
            for (uint256 i = 0; i < owners.length; i++) {
                approvals[txHash][owners[i]] = false;
            }
        }

        // Create or overwrite transaction (if it was cancelled)
        transactions[txHash] = Transaction({
            to: to,
            value: value,
            data: data,
            executed: false,
            cancelled: false,
            numApprovals: 0,
            timestamp: block.timestamp,
            proposer: msg.sender
        });

        emit TransactionProposed(txHash, msg.sender, to, value, data);

        return txHash;
    }

    /**
     * @notice Approve a pending transaction
     * @param txHash Transaction hash to approve
     */
    function approveTransaction(bytes32 txHash)
        external
        onlyOwner
        txExists(txHash)
        notExecuted(txHash)
        notCancelled(txHash)
    {
        require(!approvals[txHash][msg.sender], "Already approved");

        approvals[txHash][msg.sender] = true;
        transactions[txHash].numApprovals++;

        emit TransactionApproved(txHash, msg.sender);
    }

    /**
     * @notice Execute a transaction after threshold is met
     * @param txHash Transaction hash to execute
     */
    function executeTransaction(bytes32 txHash)
        external
        onlyOwner
        txExists(txHash)
        notExecuted(txHash)
        notCancelled(txHash)
        nonReentrant
    {
        Transaction storage transaction = transactions[txHash];

        // Explicit check: cancelled transactions cannot be executed
        // (Defense-in-depth: modifier already checks this, but explicit for clarity)
        require(!transaction.cancelled, "Transaction has been cancelled");

        require(
            transaction.numApprovals >= threshold,
            "Not enough approvals"
        );

        transaction.executed = true;
        nonce++;

        // Handle self-calls (owner management) differently to avoid reentrancy guard issues
        if (transaction.to == address(this)) {
            // For self-calls, decode and execute using internal functions
            // This avoids the reentrancy guard blocking external calls
            bytes4 selector = bytes4(transaction.data);
            
            if (selector == this.addOwner.selector) {
                // Decode addOwner(address)
                bytes memory dataSlice = new bytes(transaction.data.length - 4);
                for (uint256 i = 4; i < transaction.data.length; i++) {
                    dataSlice[i - 4] = transaction.data[i];
                }
                address newOwner = abi.decode(dataSlice, (address));
                _addOwner(newOwner);
            } else if (selector == this.removeOwner.selector) {
                // Decode removeOwner(address)
                bytes memory dataSlice = new bytes(transaction.data.length - 4);
                for (uint256 i = 4; i < transaction.data.length; i++) {
                    dataSlice[i - 4] = transaction.data[i];
                }
                address ownerToRemove = abi.decode(dataSlice, (address));
                _removeOwner(ownerToRemove);
            } else if (selector == this.changeThreshold.selector) {
                // Decode changeThreshold(uint256)
                bytes memory dataSlice = new bytes(transaction.data.length - 4);
                for (uint256 i = 4; i < transaction.data.length; i++) {
                    dataSlice[i - 4] = transaction.data[i];
                }
                uint256 newThreshold = abi.decode(dataSlice, (uint256));
                _changeThreshold(newThreshold);
            } else {
                // Unknown self-call function - try using call anyway
                (bool success, ) = transaction.to.call{value: transaction.value}(
                    transaction.data
                );
                require(success, "Transaction execution failed");
            }
        } else {
            // External call - use standard call mechanism
            (bool success, ) = transaction.to.call{value: transaction.value}(
                transaction.data
            );
            require(success, "Transaction execution failed");
        }

        emit TransactionExecuted(txHash, msg.sender);
    }

    /**
     * @notice Revoke approval for a pending transaction
     * @param txHash Transaction hash
     */
    function revokeApproval(bytes32 txHash)
        external
        onlyOwner
        txExists(txHash)
        notExecuted(txHash)
        notCancelled(txHash)
    {
        require(approvals[txHash][msg.sender], "Not approved");

        approvals[txHash][msg.sender] = false;
        transactions[txHash].numApprovals--;

        emit ApprovalRevoked(txHash, msg.sender);
    }

    /**
     * @notice Cancel a pending transaction
     * @dev Can be cancelled by the proposer immediately, or by threshold approvals
     * @param txHash Transaction hash to cancel
     */
    function cancelTransaction(bytes32 txHash)
        external
        onlyOwner
        txExists(txHash)
        notExecuted(txHash)
        notCancelled(txHash)
    {
        Transaction storage transaction = transactions[txHash];
        
        // Check if caller is the proposer
        bool isProposer = transaction.proposer == msg.sender;
        
        // If not proposer, require threshold approvals
        if (!isProposer) {
            require(
                transaction.numApprovals >= threshold,
                "Not proposer and not enough approvals to cancel"
            );
        }

        // Mark as cancelled
        transaction.cancelled = true;

        // Clear all approvals (clean up state)
        // Note: We don't need to iterate through all owners since approvals mapping
        // will just be ignored for cancelled transactions, but we reset numApprovals
        // for clarity and potential gas savings in future reads
        transaction.numApprovals = 0;

        emit TransactionCancelled(txHash, msg.sender);
    }

    /**
     * @notice Internal function to add a new owner
     * @param owner Address of new owner
     */
    function _addOwner(address owner) internal {
        require(owner != address(0), "Invalid owner address");
        require(!isOwner[owner], "Already an owner");

        isOwner[owner] = true;
        owners.push(owner);

        emit OwnerAdded(owner);
    }

    /**
     * @notice Add a new owner (requires multisig approval)
     * @param owner Address of new owner
     */
    function addOwner(address owner) external onlySelf {
        _addOwner(owner);
    }

    /**
     * @notice Internal function to remove an owner
     * @param owner Address of owner to remove
     */
    function _removeOwner(address owner) internal {
        require(isOwner[owner], "Not an owner");
        require(owners.length - 1 >= threshold, "Cannot remove owner: would fall below threshold");

        isOwner[owner] = false;

        // Remove from owners array
        for (uint256 i = 0; i < owners.length; i++) {
            if (owners[i] == owner) {
                owners[i] = owners[owners.length - 1];
                owners.pop();
                break;
            }
        }

        emit OwnerRemoved(owner);
    }

    /**
     * @notice Remove an owner (requires multisig approval)
     * @param owner Address of owner to remove
     */
    function removeOwner(address owner) external onlySelf {
        _removeOwner(owner);
    }

    /**
     * @notice Internal function to change the approval threshold
     * @param _threshold New threshold value
     */
    function _changeThreshold(uint256 _threshold) internal {
        require(
            _threshold > 0 && _threshold <= owners.length,
            "Invalid threshold"
        );

        threshold = _threshold;

        emit ThresholdChanged(_threshold);
    }

    /**
     * @notice Change the approval threshold (requires multisig approval)
     * @param _threshold New threshold value
     */
    function changeThreshold(uint256 _threshold) external onlySelf {
        _changeThreshold(_threshold);
    }

    /**
     * @notice Enable a module
     * @param module Module address to enable
     */
    function enableModule(address module) external onlySelf {
        require(module != address(0), "Invalid module address");
        require(!modules[module], "Module already enabled");

        modules[module] = true;

        emit ModuleEnabled(module);
    }

    /**
     * @notice Disable a module
     * @param module Module address to disable
     */
    function disableModule(address module) external onlySelf {
        require(modules[module], "Module not enabled");

        modules[module] = false;

        emit ModuleDisabled(module);
    }

    /**
     * @notice Execute transaction from authorized module
     * @param to Destination address
     * @param value Amount to send
     * @param data Transaction data
     */
    function execTransactionFromModule(
        address to,
        uint256 value,
        bytes memory data
    ) external onlyModule nonReentrant returns (bool) {
        require(to != address(0), "Invalid destination address");

        (bool success, ) = to.call{value: value}(data);
        return success;
    }

    /**
     * @notice Get transaction hash
     * @param to Destination address
     * @param value Amount
     * @param data Transaction data
     * @param _nonce Nonce value
     * @return Transaction hash
     */
    function getTransactionHash(
        address to,
        uint256 value,
        bytes memory data,
        uint256 _nonce
    ) public view returns (bytes32) {
        return keccak256(
            abi.encodePacked(
                address(this),
                to,
                value,
                data,
                _nonce,
                block.chainid
            )
        );
    }

    /**
     * @notice Get all owners
     * @return Array of owner addresses
     */
    function getOwners() external view returns (address[] memory) {
        return owners;
    }

    /**
     * @notice Get owner count
     * @return Number of owners
     */
    function getOwnerCount() external view returns (uint256) {
        return owners.length;
    }

    /**
     * @notice Get transaction details
     * @param txHash Transaction hash
     * @return Transaction struct
     */
    function getTransaction(bytes32 txHash)
        external
        view
        returns (Transaction memory)
    {
        return transactions[txHash];
    }

    /**
     * @notice Check if address has approved transaction
     * @param txHash Transaction hash
     * @param owner Owner address
     * @return True if approved
     */
    function hasApproved(bytes32 txHash, address owner)
        external
        view
        returns (bool)
    {
        return approvals[txHash][owner];
    }

    /**
     * @notice Receive function to accept Quai
     */
    receive() external payable {
        emit Received(msg.sender, msg.value);
    }

    /**
     * @notice Fallback function
     */
    fallback() external payable {
        emit Received(msg.sender, msg.value);
    }
}
