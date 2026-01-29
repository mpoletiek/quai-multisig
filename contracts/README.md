# Quai Multisig Contracts

Smart contracts for the Quai Network multisig wallet solution.

## Setup

### Install Dependencies

```bash
npm install
```

### Configure Environment

Copy the `.env.example` from the project root and fill in your values:

```bash
cp ../.env.example ../.env
```

**Important:** Each Quai zone requires a different private key. Make sure to configure:
- `CYPRUS1_PK`, `CYPRUS2_PK`, `CYPRUS3_PK` (Cyprus region)
- `PAXOS1_PK`, `PAXOS2_PK`, `PAXOS3_PK` (Paxos region)
- `HYDRA1_PK`, `HYDRA2_PK`, `HYDRA3_PK` (Hydra region)

## Compilation

Compile all contracts:

```bash
npm run compile
```

## Testing

Run the test suite:

```bash
npm test
```

Run tests with gas reporting:

```bash
npm run test:gas
```

Run test coverage:

```bash
npm run test:coverage
```

## Deployment

### Deploy to Local Network

Start a local Hardhat node:

```bash
npx hardhat node
```

In another terminal, deploy:

```bash
npm run deploy:local
```

### Deploy to Quai Network (Cyprus1)

```bash
npm run deploy:cyprus1
```

### Deploy to Quai Network (Cyprus2)

```bash
npm run deploy:cyprus2
```

### Deploy to Other Zones

```bash
npx hardhat run scripts/deploy.ts --network paxos1
npx hardhat run scripts/deploy.ts --network hydra1
# etc...
```

## Contract Addresses

After deployment, contract addresses will be saved to `deployments/deployment-{network}-{timestamp}.json`

## Available Networks

- `hardhat` - Local Hardhat network
- `localhost` - Local node
- `cyprus1`, `cyprus2`, `cyprus3` - Cyprus region
- `paxos1`, `paxos2`, `paxos3` - Paxos region
- `hydra1`, `hydra2`, `hydra3` - Hydra region

## Supported Solidity Versions

Quai Network EVM supports Solidity versions up to **0.8.20**. This project uses 0.8.20.

## Contract Architecture

### Core Contracts

- **MultisigWallet.sol** - Main multisig implementation (upgradeable)
- **MultisigWalletProxy.sol** - ERC1967 proxy for each wallet instance
- **ProxyFactory.sol** - Factory for deploying new wallets with CREATE2

### Modules

- **SocialRecoveryModule.sol** - Guardian-based wallet recovery
- **DailyLimitModule.sol** - Daily spending limits
- **WhitelistModule.sol** - Pre-approved addresses

## Security

See [SECURITY_ANALYSIS.md](../SECURITY_ANALYSIS.md) for the complete security review.

### Security Features

- All contracts use OpenZeppelin's battle-tested implementations
- ReentrancyGuard protection on execution functions
- Comprehensive access control with `onlyOwner`, `onlySelf`, `onlyModule` modifiers
- Upgradeable via proxy pattern
- Chain ID included in transaction hashes (prevents cross-chain replay)
- Maximum 50 owners limit (prevents gas limit issues)

### Module Access Control (H-2 Security Fix)

**Important**: Module configuration functions require multisig approval (via `onlyWallet` modifier):

| Module | Configuration Functions | Execution Functions |
|--------|------------------------|---------------------|
| DailyLimitModule | `setDailyLimit()`, `resetDailyLimit()` | `executeBelowLimit()` (single owner) |
| WhitelistModule | `addToWhitelist()`, `removeFromWhitelist()`, `batchAddToWhitelist()` | `executeToWhitelist()` (single owner) |
| SocialRecoveryModule | `setupRecovery()` | Guardian functions (guardians only) |

Configuration functions must be called through the multisig wallet (propose → approve → execute).

### Test Coverage

Run the full test suite:

```bash
npm run test -- --network hardhat
```

**123 tests passing** covering:
- Core MultisigWallet operations
- All module functionality
- Security fix verification (H-1, H-2)
- Integration scenarios

## Additional Commands

Clean build artifacts:

```bash
npm run clean
```

Lint Solidity files:

```bash
npm run lint
```

Format Solidity files:

```bash
npm run format
```

## Notes

- The deployment script uses `quais.js` SDK for Quai Network compatibility
- Contract metadata is automatically uploaded to IPFS during deployment
- Make sure you have sufficient QUAI in your deployment account
- Transaction confirmations may take longer on Quai Network due to multi-chain architecture
