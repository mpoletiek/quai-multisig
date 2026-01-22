# Quai Network CREATE2 + IPFS Metadata Limitation

## The Problem

We discovered that **CREATE2 contract deployments from within contracts do not work on Quai Network** when IPFS metadata is required.

### Root Cause

1. Quai Network requires all contract deployments to include IPFS metadata
2. The metadata hash is passed to the ContractFactory constructor
3. When deploying contracts using CREATE2 from within another contract (like our ProxyFactory), there's no way to provide the IPFS hash
4. Result: The deployment fails with "missing revert data" during gas estimation

### Evidence

```bash
# Direct proxy deployment WITHOUT IPFS hash - FAILS
const proxy = await ProxyFactory.deploy(implementation, initData);
# Error: IPFSHash is null not set or not 46 characters long

# Direct proxy deployment WITH IPFS hash - SUCCESS
const ipfsHash = await pushMetadataToIPFSWithBytecode(bytecode);
const factory = new ContractFactory(abi, bytecode, wallet, ipfsHash);
const proxy = await factory.deploy(implementation, initData);
# ✅ Works!

# Factory CREATE2 deployment - FAILS
new MultisigWalletProxy{salt: salt}(implementation, initData)
# Error: missing revert data (CALL_EXCEPTION)
```

## The Solution

We have two viable options:

### Option 1: Remove CREATE2 from Factory (Simple)

**Pros:**
- Minimal code changes
- Keeps factory-based deployment pattern
- Simple for users

**Cons:**
- Loses deterministic addresses
- Still have limitation of deploying from contract

**Implementation:**
```solidity
// Change from:
wallet = address(new MultisigWalletProxy{salt: fullSalt}(implementation, initData));

// To:
wallet = address(new MultisigWalletProxy(implementation, initData));
```

But this still won't work because we're deploying from within a contract!

### Option 2: Frontend Direct Deployment (Recommended) ✅

**Pros:**
- Works with Quai's IPFS requirements
- Users get full IPFS metadata benefits
- More gas-efficient (no factory overhead)
- Users have direct control

**Cons:**
- Need to update frontend deployment flow
- Factory becomes optional for discovery only

**Implementation:**

1. **Frontend deploys proxy directly:**
```typescript
// Get IPFS hash
const proxyIpfsHash = await uploadProxyMetadata();

// Deploy proxy with metadata
const ProxyFactory = new quais.ContractFactory(
  ProxyABI,
  ProxyBytecode,
  signer,
  proxyIpfsHash
);

const proxy = await ProxyFactory.deploy(implementationAddress, initData);
const walletAddress = await proxy.getAddress();
```

2. **Optional: Register with factory for discovery:**
```typescript
// Register wallet in factory's registry
await factoryContract.registerWallet(walletAddress);
```

3. **Add registration function to factory:**
```solidity
function registerWallet(address wallet) external {
    MultisigWallet multisig = MultisigWallet(payable(wallet));
    require(multisig.isOwner(msg.sender), "Not an owner");

    deployedWallets.push(wallet);
    isWallet[wallet] = true;

    emit WalletRegistered(wallet, msg.sender);
}
```

## Recommendation

**Implement Option 2** - Frontend direct deployment with optional factory registration.

This approach:
- Works with Quai's architecture
- Provides better user experience
- More decentralized (users deploy their own wallets)
- Still allows wallet discovery through factory registry
- Future-proof for Quai Network

## Next Steps

1. Update frontend MultisigService to deploy proxies directly
2. Add factory registration step (optional)
3. Update factory contract with registration function
4. Redeploy factory
5. Update documentation

## Files to Update

- `frontend/src/services/MultisigService.ts` - Add direct proxy deployment
- `contracts/contracts/ProxyFactory.sol` - Add registration function
- `contracts/scripts/deploy.ts` - Redeploy factory
- `frontend/src/config/abi/` - Add MultisigWalletProxy ABI

