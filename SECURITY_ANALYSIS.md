# Smart Contract Security Analysis

**Date:** 2026-01-27
**Analyzed By:** Claude Security Review
**Contracts Version:** Solidity ^0.8.20

---

## Executive Summary

This security analysis covers the Quai Network multisig wallet smart contracts. The codebase demonstrates good security practices overall, with proper use of OpenZeppelin libraries, reentrancy guards, and access control. However, several issues of varying severity were identified that should be addressed before mainnet deployment.

### Risk Summary

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 0 | - |
| High | 2 | **All Fixed** |
| Medium | 5 | **All Fixed** |
| Low | 6 | Open |
| Informational | 4 | Open |

---

## Findings

### HIGH SEVERITY (ALL FIXED)

#### H-1: SocialRecoveryModule `execTransactionFromModule` Calls Target Wallet Instead of `address(this)` ✅ VERIFIED

**File:** [SocialRecoveryModule.sol:270-341](contracts/contracts/modules/SocialRecoveryModule.sol#L270-L341)

**Description:**
In `executeRecovery()`, the module calls `multisig.execTransactionFromModule(wallet, 0, addOwnerData)` where the first parameter is `wallet`. The pattern is that `execTransactionFromModule` does a low-level call to the wallet address with the encoded function call data.

**Verification:**
Integration tests added to verify this pattern works correctly:
- `should complete full recovery flow (H-1 verification)` - Tests complete owner replacement
- `should handle partial owner replacement via execTransactionFromModule (H-1)` - Tests mixed owner retention/replacement

The pattern works because when the wallet executes `wallet.call(data)`, it's calling itself, so `msg.sender == address(this)` passes the `onlySelf` modifier on `addOwner`, `removeOwner`, and `changeThreshold`.

---

#### H-2: Single Owner Can Bypass Multisig for Module Operations ✅ FIXED

**File:** [DailyLimitModule.sol:52-65](contracts/contracts/modules/DailyLimitModule.sol#L52-L65), [WhitelistModule.sol:52-66](contracts/contracts/modules/WhitelistModule.sol#L52-L66), [SocialRecoveryModule.sol:125-161](contracts/contracts/modules/SocialRecoveryModule.sol#L125-L161)

**Description:**
`setDailyLimit()`, `addToWhitelist()`, `setupRecovery()` and other module configuration functions only required `isOwner(msg.sender)` check, allowing ANY single owner to configure modules without multisig approval.

**Fix Applied:**
Changed access control from `require(multisig.isOwner(msg.sender), "Not an owner")` to `require(msg.sender == wallet, "Must be called by wallet")` for all configuration functions:

- `DailyLimitModule.setDailyLimit()` - Now requires multisig approval
- `DailyLimitModule.resetDailyLimit()` - Now requires multisig approval
- `WhitelistModule.addToWhitelist()` - Now requires multisig approval
- `WhitelistModule.removeFromWhitelist()` - Now requires multisig approval
- `WhitelistModule.batchAddToWhitelist()` - Now requires multisig approval
- `SocialRecoveryModule.setupRecovery()` - Now requires multisig approval

**Note:** Execution functions like `executeBelowLimit()` and `executeToWhitelist()` remain callable by single owners as intended - these are the convenience functions that operate within pre-approved limits. Only configuration changes require multisig approval.

---

### MEDIUM SEVERITY (ALL FIXED)

#### M-1: No Maximum Owner Limit ✅ FIXED

**File:** [MultisigWallet.sol:175-200](contracts/contracts/modules/MultisigWallet.sol#L175-L200)

**Description:**
There is no limit on the number of owners that can be added. An extremely large owner list could cause `getOwners()` to exceed block gas limits, and operations that iterate over owners (like clearing approvals in `proposeTransaction()`) would become prohibitively expensive or fail.

**Fix Applied:**
Added `MAX_OWNERS = 50` constant and checks in `initialize()` and `_addOwner()`:
```solidity
uint256 public constant MAX_OWNERS = 50;
require(_owners.length <= MAX_OWNERS, "Too many owners");
require(owners.length < MAX_OWNERS, "Max owners reached");
```

---

#### M-2: Frontrunning Risk in Transaction Approval ✅ FIXED

**File:** [MultisigWallet.sol:277-345](contracts/contracts/modules/MultisigWallet.sol#L277-L345)

**Description:**
Between `approveTransaction()` reaching threshold and `executeTransaction()` being called, an attacker could frontrun the execution. While the impact is limited (execution still requires owner), there's a race condition where the executor may not be who was intended.

**Fix Applied:**
Added `approveAndExecute()` function that atomically approves and executes in a single transaction when threshold is met:
```solidity
function approveAndExecute(bytes32 txHash) external onlyOwner ... returns (bool executed)
```

---

#### M-3: Transaction Hash Collision Potential with Nonce Reuse ✅ FIXED

**File:** [MultisigWallet.sol:209-252](contracts/contracts/modules/MultisigWallet.sol#L209-L252)

**Description:**
The nonce was only incremented when a transaction is EXECUTED, not when proposed. This meant if a transaction was cancelled, the next proposal with the same parameters would generate the same hash.

**Fix Applied:**
Moved `nonce++` from `executeTransaction()` to `proposeTransaction()`. Each proposal now gets a unique hash regardless of execution or cancellation:
```solidity
// In proposeTransaction():
nonce++;  // Increment on proposal, not execution
```

---

#### M-4: Module Self-Destruct Risk ✅ FIXED

**File:** [MultisigWallet.sol:509-518](contracts/contracts/modules/MultisigWallet.sol#L509-L518)

**Description:**
`execTransactionFromModule` allows modules to execute arbitrary transactions with arbitrary data. A malicious or compromised module could modify module permissions.

**Fix Applied:**
Added blacklist preventing modules from calling `enableModule` and `disableModule`:
```solidity
if (to == address(this) && data.length >= 4) {
    bytes4 selector = bytes4(data);
    require(
        selector != this.enableModule.selector &&
        selector != this.disableModule.selector,
        "Module cannot modify module permissions"
    );
}
```
Note: Owner management functions (addOwner, removeOwner, changeThreshold) are intentionally allowed for legitimate recovery scenarios.

---

#### M-5: Missing Event for Guardian Approval Revocation ✅ FIXED

**File:** [SocialRecoveryModule.sol](contracts/contracts/modules/SocialRecoveryModule.sol)

**Description:**
There was no function for guardians to revoke their recovery approval, and no corresponding event.

**Fix Applied:**
Added `revokeRecoveryApproval()` function and `RecoveryApprovalRevoked` event:
```solidity
event RecoveryApprovalRevoked(
    address indexed wallet,
    bytes32 indexed recoveryHash,
    address indexed guardian
);

function revokeRecoveryApproval(address wallet, bytes32 recoveryHash) external;
```

---

### LOW SEVERITY

#### L-1: Missing Zero-Address Check in `executeTransaction`

**File:** [MultisigWallet.sol:277-345](contracts/contracts/modules/MultisigWallet.sol#L277-L345)

**Description:**
While `proposeTransaction` validates `to != address(0)`, the execution doesn't re-validate. In theory, an upgrade could introduce a bug where invalid transactions get created.

**Recommendation:**
Defense-in-depth: add zero-address check in execution as well.

---

#### L-2: Gas-Inefficient Owner Removal

**File:** [MultisigWallet.sol:429-445](contracts/contracts/modules/MultisigWallet.sol#L429-L445)

**Description:**
Owner removal uses array shifting which is O(n). With many owners, this becomes expensive.

```solidity
for (uint256 i = 0; i < owners.length; i++) {
    if (owners[i] == owner) {
        owners[i] = owners[owners.length - 1];
        owners.pop();
        break;
    }
}
```

**Recommendation:**
This is acceptable given the expected owner count, but document the gas implications for large owner sets.

---

#### L-3: No Timelock for Critical Operations

**File:** [MultisigWallet.sol](contracts/contracts/modules/MultisigWallet.sol)

**Description:**
Critical operations like `addOwner`, `removeOwner`, and `changeThreshold` execute immediately once threshold is met. There's no timelock to allow owners to detect and prevent potentially malicious changes.

**Recommendation:**
Consider adding optional timelock for owner management operations.

---

#### L-4: `resetDailyLimit` Lacks Module Check

**File:** [DailyLimitModule.sol:118-127](contracts/contracts/modules/DailyLimitModule.sol#L118-L127)

**Description:**
`resetDailyLimit()` only requires `isOwner()` but doesn't check if the module is enabled for that wallet. While resetting a disabled module's limit is harmless, it's inconsistent with other functions.

**Recommendation:**
Add module enabled check for consistency.

---

#### L-5: No Protection Against Duplicate Guardians in Recovery Config Update

**File:** [SocialRecoveryModule.sol:136-142](contracts/contracts/modules/SocialRecoveryModule.sol#L136-L142)

**Description:**
The duplicate guardian check uses O(n²) comparison:
```solidity
for (uint256 i = 0; i < guardians.length; i++) {
    for (uint256 j = i + 1; j < guardians.length; j++) {
        require(guardians[i] != guardians[j], "Duplicate guardian");
    }
}
```

This becomes expensive with many guardians and could theoretically be used for griefing by passing a long array.

**Recommendation:**
Consider limiting maximum guardian count or using a more efficient deduplication method.

---

#### L-6: Proxy `receive()` Doesn't Delegate to Implementation

**File:** [MultisigWalletProxy.sol:41-44](contracts/contracts/MultisigWalletProxy.sol#L41-L44)

**Description:**
The proxy's `receive()` function emits its own `Received` event rather than delegating to the implementation. This creates a situation where there are two `Received` events that could be emitted (one in proxy, one in implementation via fallback).

The current implementation is correct (proxy handles receive directly), but the comment mentions "No need to delegatecall since the implementation's receive() only emits the same event" - this is a design decision that should be documented more thoroughly.

**Recommendation:**
Document this design decision clearly. Consider whether the implementation's receive() should be removed to avoid confusion.

---

### INFORMATIONAL

#### I-1: Missing NatSpec Documentation in Some Functions

Several functions lack complete NatSpec documentation, particularly around return values and potential revert conditions.

---

#### I-2: Console.log Imports May Exist in Production Code

Ensure all `console.log` imports from Hardhat are removed before production deployment.

---

#### I-3: Consider Using Custom Errors

Solidity 0.8.4+ supports custom errors which are more gas-efficient than revert strings. Consider migrating:

```solidity
// Current
require(isOwner[msg.sender], "Not an owner");

// Recommended
error NotOwner();
if (!isOwner[msg.sender]) revert NotOwner();
```

---

#### I-4: Magic Numbers in Recovery Period

**File:** [SocialRecoveryModule.sol:128](contracts/contracts/modules/SocialRecoveryModule.sol#L128)

```solidity
require(recoveryPeriod >= 1 days, "Recovery period too short");
```

Consider using a named constant:
```solidity
uint256 public constant MIN_RECOVERY_PERIOD = 1 days;
```

---

## Positive Security Patterns Observed

1. **ReentrancyGuard**: Properly used on execution functions
2. **OpenZeppelin Libraries**: Using audited implementations
3. **Initializer Pattern**: Correctly disabling constructors for upgradeable contracts
4. **Access Control**: Clear modifiers (`onlyOwner`, `onlySelf`, `onlyModule`)
5. **Chain ID in Hashes**: Transaction hashes include `block.chainid` preventing cross-chain replay
6. **Threshold Snapshot**: SocialRecoveryModule stores threshold at initiation time to prevent manipulation
7. **Pending Recovery Block**: Configuration updates blocked while recoveries are pending

---

## Recommendations Summary

### Before Testnet (High Priority)
1. ~~Investigate H-2 (single owner module control) and decide on governance model~~ ✅ Fixed
2. ~~Add maximum owner limit (M-1)~~ ✅ Fixed
3. ~~Add comprehensive integration tests for recovery flow (H-1)~~ ✅ Added

### Before Mainnet
1. ~~Address H-2 (single owner module control)~~ ✅ Fixed - Module configuration now requires multisig approval
2. Add timelocks for critical operations (L-3)
3. Consider custom errors for gas optimization (I-3)
4. Complete NatSpec documentation (I-1)
5. Professional security audit by third party

### Gas Optimizations
1. Custom errors instead of revert strings
2. Consider packed structs where applicable
3. Use unchecked blocks for safe arithmetic

### High Severity Fixes Applied (2026-01-27)
1. ✅ H-1: Verified `execTransactionFromModule` pattern works correctly with integration tests
2. ✅ H-2: Module configuration now requires multisig approval (`msg.sender == wallet`)

### Medium Severity Fixes Applied (2026-01-27)
1. ✅ M-1: Added MAX_OWNERS = 50 limit
2. ✅ M-2: Added `approveAndExecute()` atomic function
3. ✅ M-3: Nonce now increments on proposal (prevents hash collisions)
4. ✅ M-4: Added module permission blacklist in `execTransactionFromModule`
5. ✅ M-5: Added `revokeRecoveryApproval()` for guardians

---

## Files Analyzed

| File | Lines | Status |
|------|-------|--------|
| MultisigWallet.sol | 602 | Reviewed |
| MultisigWalletProxy.sol | 45 | Reviewed |
| ProxyFactory.sol | 198 | Reviewed |
| SocialRecoveryModule.sol | 451 | Reviewed |
| DailyLimitModule.sol | 186 | Reviewed |
| WhitelistModule.sol | 168 | Reviewed |

**Total Lines Analyzed:** ~1,650

---

## Disclaimer

This security analysis is provided for informational purposes only. It is not a comprehensive audit and does not guarantee the absence of vulnerabilities. A professional security audit by a reputable firm is recommended before mainnet deployment.
