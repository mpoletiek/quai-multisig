# Quai Network Multisig Wallet

A Gnosis Safe-inspired multisig wallet solution for Quai Network's account-based (EVM) layer.

## Project Structure

```
quai-multisig/
├── contracts/          # Smart contracts (Hardhat)
├── frontend/          # React frontend application
├── backend/           # Optional backend services (indexer, WebSocket)
└── docs/             # Additional documentation
```

## Key Features

- **Decentralized-First**: All core functionality works directly via RPC without backend dependencies
- **Upgradeable**: Proxy pattern for future multi-shard support
- **Modular**: Extensible module system for additional features
- **Secure**: Built with security best practices and comprehensive testing

## Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- Access to Quai Network RPC endpoint

### Installation

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration
```

### Development

```bash
# Start frontend development server
npm run frontend:dev

# Compile smart contracts
npm run contracts:compile

# Run contract tests
npm run contracts:test

# Start backend services (optional)
npm run backend:dev
```

## Documentation

For detailed documentation, see [quai-multisig.md](./quai-multisig.md)

## Architecture

- **Smart Contracts**: Upgradeable multisig wallet with proxy pattern
- **Frontend**: React + TypeScript + Quais.js
- **Backend** (Optional): Event indexer and WebSocket notifications

## Development Roadmap

- [x] Phase 0: Project setup and architecture
- [ ] Phase 1: MVP - Core multisig functionality
- [ ] Phase 2: Enhanced features and modules
- [ ] Phase 3: Polish and optimization
- [ ] Phase 4: Multi-shard support

## Contributing

Contributions are welcome! Please read the contribution guidelines before submitting PRs.

## License

MIT License - See LICENSE file for details
