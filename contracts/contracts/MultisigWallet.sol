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
    // Custom errors (gas efficient)
    error NotAnOwner();
    error OnlySelf();
    error NotAnAuthorizedModule();
    error TransactionDoesNotExist();
    error TransactionAlreadyExecuted();
    error TransactionAlreadyCancelled();
    error OwnersRequired();
    error TooManyOwners();
    error InvalidThreshold();
    error InvalidOwnerAddress();
    error DuplicateOwner();
    error InvalidDestinationAddress();
    error TransactionAlreadyExists();
    error AlreadyApproved();
    error TransactionExecutionFailed();
    error TransactionHasBeenCancelled();
    error NotEnoughApprovals();
    error NotApproved();
    error NotProposerAndNotEnoughApprovalsToCancel();
    error AlreadyAnOwner();
    error MaxOwnersReached();
    error CannotRemoveOwnerWouldFallBelowThreshold();
    error InvalidModuleAddress();
    error ModuleAlreadyEnabled();
    error ModuleNotEnabled();
    error ModuleCannotModifyModulePermissions();

    /// @notice Maximum number of owners allowed (prevents DoS from gas-intensive loops)
    uint256 public constant MAX_OWNERS = 50;

    /// @notice Structure representing a multisig transaction
    /// @dev Stores all transaction details including approval state
    struct Transaction {
        /// @notice Destination address for the transaction
        address to;
        /// @notice Amount of QUAI to send
        uint256 value;
        /// @notice Calldata to execute at destination
        bytes data;
        /// @notice Whether the transaction has been executed
        bool executed;
        /// @notice Whether the transaction has been cancelled
        bool cancelled;
        /// @notice Current number of owner approvals
        uint256 numApprovals;
        /// @notice Block timestamp when transaction was proposed
        uint256 timestamp;
        /// @notice Address of the owner who proposed the transaction
        address proposer;
    }

    /// @notice Mapping of address to owner status
    /// @dev O(1) lookup for owner verification, more gas-efficient than iterating through owners array
    mapping(address => bool) public isOwner;

    /// @notice Array of all owner addresses
    /// @dev Used for iteration when needed (e.g., clearing approvals), kept in sync with isOwner mapping
    address[] public owners;

    /// @notice Number of approvals required to execute a transaction
    /// @dev Must satisfy: 1 <= threshold <= owners.length
    uint256 public threshold;

    /// @notice Transaction nonce used for hash generation
    /// @dev Incremented on each proposal to ensure unique transaction hashes, prevents replay attacks
    uint256 public nonce;

    /// @notice Mapping of transaction hash to transaction data
    /// @dev Uses bytes32 key instead of array for O(1) lookup and to support non-sequential proposals
    mapping(bytes32 => Transaction) public transactions;

    /// @notice Mapping of transaction hash to owner approvals
    /// @dev Nested mapping structure optimizes gas for approval checks and prevents approval manipulation
    mapping(bytes32 => mapping(address => bool)) public approvals;

    /// @notice Mapping of enabled module addresses
    /// @dev Modules can execute transactions via execTransactionFromModule but cannot modify module permissions
    mapping(address => bool) public modules;

    /// @notice Emitted when a new transaction is proposed
    /// @param txHash Unique hash identifying the transaction
    /// @param proposer Address of the owner who proposed the transaction
    /// @param to Destination address for the transaction
    /// @param value Amount of QUAI to send
    /// @param data Calldata to execute at destination
    event TransactionProposed(
        bytes32 indexed txHash,
        address indexed proposer,
        address indexed to,
        uint256 value,
        bytes data
    );

    /// @notice Emitted when an owner approves a transaction
    /// @param txHash Hash of the approved transaction
    /// @param approver Address of the owner who approved
    event TransactionApproved(
        bytes32 indexed txHash,
        address indexed approver
    );

    /// @notice Emitted when a transaction is successfully executed
    /// @param txHash Hash of the executed transaction
    /// @param executor Address of the owner who triggered execution
    event TransactionExecuted(
        bytes32 indexed txHash,
        address indexed executor
    );

    /// @notice Emitted when an owner revokes their approval
    /// @param txHash Hash of the transaction
    /// @param owner Address of the owner who revoked approval
    event ApprovalRevoked(
        bytes32 indexed txHash,
        address indexed owner
    );

    /// @notice Emitted when a transaction is cancelled
    /// @param txHash Hash of the cancelled transaction
    /// @param canceller Address of the owner who cancelled
    event TransactionCancelled(
        bytes32 indexed txHash,
        address indexed canceller
    );

    /// @notice Emitted when a new owner is added to the wallet
    /// @param owner Address of the new owner
    event OwnerAdded(address indexed owner);

    /// @notice Emitted when an owner is removed from the wallet
    /// @param owner Address of the removed owner
    event OwnerRemoved(address indexed owner);

    /// @notice Emitted when the approval threshold is changed
    /// @param threshold New threshold value
    event ThresholdChanged(uint256 threshold);

    /// @notice Emitted when a module is enabled
    /// @param module Address of the enabled module
    event ModuleEnabled(address indexed module);

    /// @notice Emitted when a module is disabled
    /// @param module Address of the disabled module
    event ModuleDisabled(address indexed module);

    /// @notice Emitted when the wallet receives QUAI
    /// @param sender Address that sent the QUAI
    /// @param amount Amount of QUAI received
    event Received(address indexed sender, uint256 amount);

    /// @notice Restricts function access to wallet owners only
    modifier onlyOwner() {
        if (!isOwner[msg.sender]) revert NotAnOwner();
        _;
    }

    /// @notice Restricts function access to the wallet itself (for multisig-approved actions)
    modifier onlySelf() {
        if (msg.sender != address(this)) revert OnlySelf();
        _;
    }

    /// @notice Restricts function access to enabled modules only
    modifier onlyModule() {
        if (!modules[msg.sender]) revert NotAnAuthorizedModule();
        _;
    }

    /// @notice Ensures the specified transaction exists
    /// @param txHash Transaction hash to check
    modifier txExists(bytes32 txHash) {
        if (transactions[txHash].to == address(0)) revert TransactionDoesNotExist();
        _;
    }

    /// @notice Ensures the specified transaction has not been executed
    /// @param txHash Transaction hash to check
    modifier notExecuted(bytes32 txHash) {
        if (transactions[txHash].executed) revert TransactionAlreadyExecuted();
        _;
    }

    /// @notice Ensures the specified transaction has not been cancelled
    /// @param txHash Transaction hash to check
    modifier notCancelled(bytes32 txHash) {
        if (transactions[txHash].cancelled) revert TransactionAlreadyCancelled();
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
        if (_owners.length == 0) revert OwnersRequired();
        if (_owners.length > MAX_OWNERS) revert TooManyOwners();
        if (_threshold == 0 || _threshold > _owners.length) revert InvalidThreshold();

        __ReentrancyGuard_init();

        // Validate and set owners
        for (uint256 i = 0; i < _owners.length; i++) {
            address owner = _owners[i];

            if (owner == address(0)) revert InvalidOwnerAddress();
            if (isOwner[owner]) revert DuplicateOwner();

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
        if (to == address(0)) revert InvalidDestinationAddress();

        bytes32 txHash = getTransactionHash(to, value, data, nonce);

        // Check if transaction already exists
        Transaction storage existingTx = transactions[txHash];
        bool isOverwritingCancelled = false;

        // If transaction exists and is not cancelled, reject
        if (existingTx.to != address(0)) {
            if (!existingTx.cancelled) revert TransactionAlreadyExists();
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

        // Increment nonce on proposal to prevent hash collisions
        // This ensures each proposal gets a unique hash even if cancelled and re-proposed
        nonce++;

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
        if (approvals[txHash][msg.sender]) revert AlreadyApproved();

        approvals[txHash][msg.sender] = true;
        transactions[txHash].numApprovals++;

        emit TransactionApproved(txHash, msg.sender);
    }

    /**
     * @notice Approve and execute a transaction in one call if threshold is met
     * @dev Prevents frontrunning by combining approval and execution atomically
     * @param txHash Transaction hash to approve and potentially execute
     * @return executed Whether the transaction was executed
     */
    function approveAndExecute(bytes32 txHash)
        external
        onlyOwner
        txExists(txHash)
        notExecuted(txHash)
        notCancelled(txHash)
        nonReentrant
        returns (bool executed)
    {
        // First, approve if not already approved
        if (!approvals[txHash][msg.sender]) {
            approvals[txHash][msg.sender] = true;
            transactions[txHash].numApprovals++;
            emit TransactionApproved(txHash, msg.sender);
        }

        // Check if threshold is met
        Transaction storage transaction = transactions[txHash];
        if (transaction.numApprovals >= threshold) {
            // Execute the transaction
            transaction.executed = true;

            // Handle self-calls (owner management) differently
            if (transaction.to == address(this)) {
                bytes4 selector = bytes4(transaction.data);

                if (selector == this.addOwner.selector) {
                    bytes memory dataSlice = new bytes(transaction.data.length - 4);
                    for (uint256 i = 4; i < transaction.data.length; i++) {
                        dataSlice[i - 4] = transaction.data[i];
                    }
                    address newOwner = abi.decode(dataSlice, (address));
                    _addOwner(newOwner);
                } else if (selector == this.removeOwner.selector) {
                    bytes memory dataSlice = new bytes(transaction.data.length - 4);
                    for (uint256 i = 4; i < transaction.data.length; i++) {
                        dataSlice[i - 4] = transaction.data[i];
                    }
                    address ownerToRemove = abi.decode(dataSlice, (address));
                    _removeOwner(ownerToRemove);
                } else if (selector == this.changeThreshold.selector) {
                    bytes memory dataSlice = new bytes(transaction.data.length - 4);
                    for (uint256 i = 4; i < transaction.data.length; i++) {
                        dataSlice[i - 4] = transaction.data[i];
                    }
                    uint256 newThreshold = abi.decode(dataSlice, (uint256));
                    _changeThreshold(newThreshold);
                } else {
                    (bool success, ) = transaction.to.call{value: transaction.value}(
                        transaction.data
                    );
                    if (!success) revert TransactionExecutionFailed();
                }
            } else {
                (bool success, ) = transaction.to.call{value: transaction.value}(
                    transaction.data
                );
                if (!success) revert TransactionExecutionFailed();
            }

            emit TransactionExecuted(txHash, msg.sender);
            return true;
        }

        return false;
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
        if (transaction.cancelled) revert TransactionHasBeenCancelled();

        if (transaction.numApprovals < threshold) revert NotEnoughApprovals();

        transaction.executed = true;

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
                if (!success) revert TransactionExecutionFailed();
            }
        } else {
            // External call - use standard call mechanism
            (bool success, ) = transaction.to.call{value: transaction.value}(
                transaction.data
            );
            if (!success) revert TransactionExecutionFailed();
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
        if (!approvals[txHash][msg.sender]) revert NotApproved();

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
            if (transaction.numApprovals < threshold) revert NotProposerAndNotEnoughApprovalsToCancel();
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
        if (owner == address(0)) revert InvalidOwnerAddress();
        if (isOwner[owner]) revert AlreadyAnOwner();
        if (owners.length >= MAX_OWNERS) revert MaxOwnersReached();

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
        if (!isOwner[owner]) revert NotAnOwner();
        if (owners.length - 1 < threshold) revert CannotRemoveOwnerWouldFallBelowThreshold();

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
        if (_threshold == 0 || _threshold > owners.length) revert InvalidThreshold();

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
        if (module == address(0)) revert InvalidModuleAddress();
        if (modules[module]) revert ModuleAlreadyEnabled();

        modules[module] = true;

        emit ModuleEnabled(module);
    }

    /**
     * @notice Disable a module
     * @param module Module address to disable
     */
    function disableModule(address module) external onlySelf {
        if (!modules[module]) revert ModuleNotEnabled();

        modules[module] = false;

        emit ModuleDisabled(module);
    }

    /**
     * @notice Execute transaction from authorized module
     * @dev Modules cannot call enableModule/disableModule (prevents privilege escalation)
     *      Owner management functions (addOwner, removeOwner, changeThreshold) are allowed
     *      for legitimate use cases like social recovery
     * @param to Destination address
     * @param value Amount to send
     * @param data Transaction data
     * @return success True if the transaction succeeded, false otherwise
     */
    function execTransactionFromModule(
        address to,
        uint256 value,
        bytes memory data
    ) external onlyModule nonReentrant returns (bool) {
        if (to == address(0)) revert InvalidDestinationAddress();

        // Security: Prevent modules from modifying module permissions
        // This prevents a compromised module from enabling/disabling other modules
        // Owner management functions ARE allowed for legitimate recovery scenarios
        if (to == address(this) && data.length >= 4) {
            bytes4 selector = bytes4(data);
            if (selector == this.enableModule.selector || selector == this.disableModule.selector) {
                revert ModuleCannotModifyModulePermissions();
            }
        }

        (bool success, ) = to.call{value: value}(data);
        return success;
    }

    /**
     * @notice Get transaction hash
     * @param to Destination address
     * @param value Amount
     * @param data Transaction data
     * @param _nonce Nonce value
     * @return Unique bytes32 hash computed from wallet address, transaction parameters, nonce, and chain ID
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
