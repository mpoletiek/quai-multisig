# Installation Instructions

## Quick Start

```bash
# From the contracts directory
npm install
```

This will install all required dependencies including:

- `hardhat` - Development framework
- `quais` - Quai Network SDK
- `@quai/hardhat-deploy-metadata` - IPFS metadata deployment
- `@quai/quais-upgrades` - Upgradeable contract support
- `@openzeppelin/contracts` - Security-audited contract library
- TypeScript and testing dependencies

## Post-Installation

After installing dependencies, TypeScript errors in the IDE should resolve automatically.

### Verify Installation

```bash
# Compile contracts
npm run compile

# Run tests
npm test
```

### Expected Output

Compilation should succeed with output like:
```
Compiled 15 Solidity files successfully (evm target: london).
```

Tests should pass:
```
  MultisigWallet
    Initialization
      ✔ should initialize with correct owners and threshold
      ✔ should set owner flags correctly
      ...

  47 passing (2s)
```

## Dependencies Explanation

### Production Dependencies

- **quais** (^1.0.0-alpha.36): JavaScript SDK for Quai Network, similar to ethers.js but adapted for Quai's multi-chain architecture
- **@quai/hardhat-deploy-metadata** (^1.0.8): Automatically uploads contract metadata to IPFS during deployment
- **@quai/quais-upgrades** (^3.8.14): Tools for deploying upgradeable contracts on Quai Network
- **@openzeppelin/contracts** (^5.0.0): Battle-tested smart contract implementations
- **@openzeppelin/contracts-upgradeable** (^5.0.0): Upgradeable versions of OpenZeppelin contracts
- **dotenv** (^16.4.5): Secure environment variable management

### Development Dependencies

- **@nomicfoundation/hardhat-toolbox** (^5.0.0): Bundle of Hardhat plugins for development
- **hardhat** (^2.19.5): Ethereum/Quai development environment
- **typescript** (^5.3.3): TypeScript language support
- **@typechain/hardhat** (^9.1.0): TypeScript bindings for contracts
- Testing libraries: **chai**, **mocha**
- **solhint** (^4.1.1): Solidity linter
- **prettier-plugin-solidity** (^1.3.1): Code formatter for Solidity

## Troubleshooting

### "Cannot find module 'quais'"

This error appears before `npm install` is run. Solution:
```bash
npm install
```

### "ERR_PNPM_OUTDATED_LOCKFILE"

If using pnpm:
```bash
pnpm install --no-frozen-lockfile
```

### Node version issues

Ensure Node.js 18+ is installed:
```bash
node --version  # Should be v18.x or higher
```

### TypeScript errors persist

Try:
```bash
npm run clean
npm install
npm run compile
```

## Next Steps

After successful installation:

1. Configure `.env` file (see [SETUP.md](../SETUP.md))
2. Compile contracts: `npm run compile`
3. Run tests: `npm test`
4. Deploy: `npm run deploy:cyprus1`
