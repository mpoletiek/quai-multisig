# Quai Network Shard-Aware Addressing

## The Problem

Quai Network uses a sharded architecture where addresses are prefixed based on the shard they belong to:

- **Cyprus1**: Addresses start with `0x00`
- **Cyprus2**: Addresses start with `0x01`
- **Cyprus3**: Addresses start with `0x02`
- **Paxos1**: Addresses start with `0x10`
- **Paxos2**: Addresses start with `0x11`
- **Paxos3**: Addresses start with `0x12`
- **Hydra1**: Addresses start with `0x20`
- **Hydra2**: Addresses start with `0x21`
- **Hydra3**: Addresses start with `0x22`

This means that the traditional Ethereum CREATE2 address computation (which produces a deterministic address from bytecode hash) **does not work correctly** on Quai Network. The computed address will not have the correct shard prefix.

## The Error

When attempting to call `computeAddress()` with a CREATE2-computed address, quais.js throws:

```
no matching fragment (operation="fragment", info={ "args": [...], "key": "computeAddress" },
code=UNSUPPORTED_OPERATION, version=1.0.0-alpha.52)
```

This occurs because the computed address doesn't match Quai's shard-aware address format.

## The Solution

### 1. Contract Changes

We updated the `ProxyFactory.sol` contract to include a warning in the `computeAddress` function documentation:

```solidity
/**
 * @notice Compute the address of a wallet before deployment
 * @dev WARNING: This function does not work correctly on Quai Network due to shard-aware addressing.
 *      Instead, retrieve the deployed wallet address from the WalletCreated event.
 * ...
 */
```

The function is kept for reference but should not be used in production on Quai Network.

### 2. Frontend Changes

We modified `MultisigService.deployWallet()` to:

1. **Remove** the pre-computation of the address using `computeAddress()`
2. **Deploy** the wallet directly with `createWallet()`
3. **Extract** the actual deployed address from the `WalletCreated` event emitted during deployment

#### Before (Incorrect):
```typescript
// This doesn't work on Quai Network
const predictedAddress = await this.factoryContract.computeAddress(walletSalt);
const tx = await this.factoryContract.createWallet(owners, threshold, walletSalt);
await tx.wait();
return predictedAddress;
```

#### After (Correct):
```typescript
// Deploy and get address from event
const tx = await this.factoryContract.createWallet(owners, threshold, walletSalt);
const receipt = await tx.wait();

// Extract wallet address from WalletCreated event
const event = receipt.logs.find(
  (log: any) => {
    try {
      const parsed = this.factoryContract.interface.parseLog(log);
      return parsed?.name === 'WalletCreated';
    } catch {
      return false;
    }
  }
);

const parsedEvent = this.factoryContract.interface.parseLog(event);
return parsedEvent?.args.wallet;
```

## Key Takeaways

1. **Don't rely on CREATE2 address prediction** on Quai Network
2. **Always get deployed addresses from events** rather than pre-computing them
3. **Addresses are shard-specific** and include a shard prefix in the first byte
4. The `WalletCreated` event provides the actual deployed address that will work correctly with the shard

## Testing

To verify this works correctly:

1. Deploy a wallet on a specific shard (e.g., cyprus1)
2. Verify the returned address starts with `0x00`
3. Confirm the wallet is accessible at that address
4. Ensure all subsequent operations use the event-derived address

## Future Considerations

If deterministic addresses are needed in the future:
- Consider implementing a shard-aware CREATE2 mechanism
- Work with Quai Network team to understand proper address generation
- Document any shard-specific deployment requirements
