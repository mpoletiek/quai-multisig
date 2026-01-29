# JSDoc Documentation Template Guide

## Overview

This guide provides templates for documenting service methods consistently across the codebase.

## Standard JSDoc Structure

```typescript
/**
 * Brief one-line description of what the method does
 *
 * Optional longer description providing context, usage notes, or important details.
 * Mention security considerations, performance implications, or common gotchas.
 *
 * @param paramName - Description of parameter
 * @param optionalParam - Description (optional parameter)
 * @returns Description of return value including type structure
 * @throws {ErrorType} When this specific error occurs
 *
 * @example
 * ```typescript
 * // Example usage showing typical case
 * const result = await service.method(param1, param2);
 * ```
 */
```

## Templates by Method Type

### Read Operations (Getters)

```typescript
/**
 * Get [resource name] from the blockchain
 *
 * @param walletAddress - Address of the multisig wallet
 * @param [additionalParam] - Additional parameter if needed
 * @returns [Description of return value and structure]
 *
 * @example
 * ```typescript
 * const data = await service.getData(walletAddress);
 * // data = { field1: value1, field2: value2 }
 * ```
 */
async getData(walletAddress: string, additionalParam?: string): Promise<DataType>
```

### Write Operations (Transactions)

```typescript
/**
 * [Action verb] [resource] via multisig transaction
 *
 * This operation requires multisig approval. Use propose[Action]() to create
 * a multisig proposal that requires threshold signatures.
 *
 * @param walletAddress - Address of the multisig wallet
 * @param param1 - First parameter description
 * @param param2 - Second parameter description
 * @returns Transaction hash for tracking the operation
 * @throws {Error} If user rejects transaction or validation fails
 * @throws {Error} If insufficient balance or gas
 *
 * @example
 * ```typescript
 * const txHash = await service.doAction(
 *   walletAddress,
 *   param1Value,
 *   param2Value
 * );
 * console.log(`Transaction proposed: ${txHash}`);
 * ```
 */
async doAction(
  walletAddress: string,
  param1: Type1,
  param2: Type2
): Promise<string>
```

### Proposal Operations (Multisig)

```typescript
/**
 * Propose [action] requiring multisig approval
 *
 * Creates a multisig proposal that must be approved by threshold owners
 * before execution. Use approve() and execute() to complete the operation.
 *
 * @param walletAddress - Address of the multisig wallet
 * @param param - Parameter description
 * @returns Transaction hash of the multisig proposal
 * @throws {Error} If user rejects or wallet configuration invalid
 *
 * @example
 * ```typescript
 * // Step 1: Propose
 * const txHash = await service.proposeAction(walletAddress, paramValue);
 *
 * // Step 2: Approve (by threshold owners)
 * await service.approveTransaction(walletAddress, txHash);
 *
 * // Step 3: Execute
 * await service.executeTransaction(walletAddress, txHash);
 * ```
 */
async proposeAction(walletAddress: string, param: Type): Promise<string>
```

### Validation/Check Operations

```typescript
/**
 * Check if [condition] is met
 *
 * @param walletAddress - Address of the multisig wallet
 * @param param - Parameter to validate
 * @returns Object containing validation result and optional reason
 * @returns result.canExecute - Whether the operation can proceed
 * @returns result.reason - Human-readable reason if operation cannot proceed
 *
 * @example
 * ```typescript
 * const { canExecute, reason } = await service.canDoAction(walletAddress, value);
 * if (!canExecute) {
 *   console.error(`Cannot execute: ${reason}`);
 * }
 * ```
 */
async canDoAction(
  walletAddress: string,
  param: Type
): Promise<{ canExecute: boolean; reason?: string }>
```

### Module Operations

```typescript
/**
 * Execute [action] via [ModuleName] module
 *
 * This operation bypasses normal multisig approval by using the [ModuleName]
 * module. Requirements: [list requirements like limits, whitelist, etc.]
 *
 * @param walletAddress - Address of the multisig wallet
 * @param param1 - First parameter
 * @param param2 - Second parameter
 * @returns Transaction hash
 * @throws {Error} If module not enabled or limits exceeded
 *
 * @example
 * ```typescript
 * // Execute via module (single owner approval)
 * const txHash = await service.executeViaModule(
 *   walletAddress,
 *   recipientAddress,
 *   amount
 * );
 * ```
 */
async executeViaModule(
  walletAddress: string,
  param1: Type1,
  param2: Type2
): Promise<string>
```

## Common Parameter Descriptions

Use these standard descriptions for consistency:

- `walletAddress` - Address of the multisig wallet
- `to` - Destination address for the transaction
- `value` - Amount of QUAI to send (in wei)
- `data` - Encoded transaction data (use TransactionBuilderService to construct)
- `txHash` - Transaction hash identifying the multisig transaction
- `moduleAddress` - Address of the module contract
- `threshold` - Number of required approvals (must be > 0 and <= owner count)
- `limit` - Maximum amount allowed (0 = unlimited)
- `guardians` - Array of guardian addresses for recovery

## Common Error Documentation

Standard @throws documentation:

```typescript
@throws {Error} If user rejects the transaction
@throws {Error} If transaction validation fails
@throws {Error} If wallet address is invalid
@throws {Error} If insufficient balance or gas
@throws {Error} If module not enabled
@throws {Error} If threshold not met
@throws {Error} If transaction already executed
@throws {Error} If transaction already cancelled
```

## Priority for Documentation

### Immediate (Critical Public API)
1. MultisigService: proposeTransaction, approveTransaction, executeTransaction ✅
2. MultisigService: deployWallet, getWalletInfo
3. MultisigService: Module operations (whitelist, daily limit, recovery)
4. TransactionBuilderService: build methods
5. TransactionService: core transaction lifecycle methods

### Short-term (Supporting APIs)
6. BaseService: signer management, contract getters
7. BaseModuleService: proposal helpers
8. Individual module services: public methods

### Low Priority (Internal/Utility)
9. Private helper methods
10. Type definitions and interfaces

## Tips for Writing Good JSDoc

1. **Start with action verbs**: "Get", "Set", "Execute", "Validate", "Check"
2. **Be specific**: Instead of "Gets data", write "Gets daily spending limit configuration"
3. **Document structure**: For complex return types, document field meanings
4. **Include examples**: For any method with >2 parameters or complex workflow
5. **Mention security**: Call out security implications (e.g., "requires multisig approval")
6. **Link related methods**: Use @see tag to link to related operations
7. **Document edge cases**: Mention null returns, zero values, or special conditions

## Example: Complete Method Documentation

```typescript
/**
 * Deploy a new multisig wallet using the factory contract
 *
 * Creates a new multisig wallet proxy with the specified owners and threshold.
 * The wallet is automatically registered with the factory for discovery.
 *
 * @param owners - Array of owner addresses (must be non-zero addresses)
 * @param threshold - Number of required approvals (must be > 0 and <= owners.length)
 * @param salt - Optional salt for CREATE2 deployment (for deterministic addresses)
 * @param onProgress - Optional callback for deployment progress updates
 * @returns Address of the newly deployed wallet
 * @throws {Error} If owners array is empty
 * @throws {Error} If threshold is invalid
 * @throws {Error} If owner addresses are invalid
 * @throws {Error} If user rejects the transaction
 *
 * @example
 * ```typescript
 * // Deploy a 2-of-3 multisig wallet
 * const walletAddress = await multisigService.deployWallet(
 *   [owner1, owner2, owner3],
 *   2, // threshold
 *   undefined, // random salt
 *   (step) => console.log(`Progress: ${step}`)
 * );
 * console.log(`Wallet deployed at: ${walletAddress}`);
 * ```
 *
 * @see {@link getWalletInfo} to retrieve wallet configuration after deployment
 */
async deployWallet(
  owners: string[],
  threshold: number,
  salt?: string,
  onProgress?: (step: string) => void
): Promise<string>
```

## Automated Documentation

Future consideration: Use a tool like TypeDoc to generate API documentation from JSDoc comments.

```bash
# Generate HTML documentation
npm run docs:generate

# Serve documentation locally
npm run docs:serve
```

## Completion Checklist

Track JSDoc progress:

- [ ] MultisigService.ts (43 methods)
  - [x] proposeTransaction
  - [x] approveTransaction
  - [x] revokeApproval
  - [x] cancelTransaction
  - [x] executeTransaction
  - [ ] deployWallet
  - [ ] getWalletInfo
  - [ ] (remaining 36 methods)
- [ ] TransactionBuilderService.ts (15 methods)
- [ ] TransactionService.ts (10 methods)
- [ ] BaseService.ts (5 methods)
- [ ] BaseModuleService.ts (4 methods)
- [ ] DailyLimitModuleService.ts (8 methods)
- [ ] WhitelistModuleService.ts (9 methods)
- [ ] SocialRecoveryModuleService.ts (12 methods)

---

*Last updated: Documentation effort in progress*
