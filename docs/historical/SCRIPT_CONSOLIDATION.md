# Script Consolidation Report

## Executive Summary

Reviewed 12 contract utility scripts and 8 frontend utility files. Identified significant duplication and hardcoded values in test/debug scripts. Recommending elimination of 3 duplicate scripts and consolidation of 4 others.

## Script Inventory

### Production Scripts (contracts/scripts/) - KEEP ALL

These are essential for deployment and development workflow:

1. **[deploy.ts](contracts/scripts/deploy.ts)** (224 lines)
   - Purpose: Main deployment script for all contracts
   - Status: ✅ Keep - Production critical
   - Used by: `npm run deploy --workspace=contracts`

2. **[update-env-and-abis.ts](contracts/scripts/update-env-and-abis.ts)** (154 lines)
   - Purpose: Post-deployment - updates .env files and copies ABIs to frontend
   - Status: ✅ Keep - Essential post-deployment utility
   - Usage: Manual execution after deployment

3. **[copy-abis.ts](contracts/scripts/copy-abis.ts)** (122 lines)
   - Purpose: Automatic ABI copying on compile (Hardhat task hook)
   - Status: ✅ Keep - Automates ABI sync during development
   - Usage: Runs automatically on `hardhat compile`

### Debug/Test Scripts (contracts/scripts/) - CONSOLIDATE

4. **[test-factory.ts](contracts/scripts/test-factory.ts)** (84 lines)
   - Purpose: Test ProxyFactory wallet creation
   - Issue: ⚠️ Hardcoded factory address `0x004DB8c5e4a264A800A76Ac46127DB781C4d0E4E`
   - Recommendation: Update to use env vars or command-line args
   - Action: ⚠️ Update hardcoded values

5. **[test-transfer.ts](contracts/scripts/test-transfer.ts)** (269 lines)
   - Purpose: Comprehensive transfer testing with RPC fallback and detailed error reporting
   - Status: ✅ Keep - Most comprehensive transfer test
   - Features: Timeout handling, multiple RPC endpoints, detailed diagnostics

6. **[test-transfer-new.ts](contracts/test-transfer-new.ts)** (157 lines)
   - Purpose: Simpler transfer test (duplicate of test-transfer.ts)
   - Issue: ❌ Location: In contracts root instead of contracts/scripts/
   - Issue: ❌ Duplicate functionality with less features than test-transfer.ts
   - Recommendation: **DELETE** - Redundant with test-transfer.ts
   - Action: 🗑️ Delete

7. **[simple-test.ts](contracts/scripts/simple-test.ts)** (26 lines)
   - Purpose: Basic wallet balance/code check
   - Issue: ⚠️ Hardcoded wallet address `0x007D207798636d4Df2B45A0BDC052436eFA20a2A`
   - Issue: ❌ Minimal functionality, duplicate of check-wallet.ts
   - Recommendation: **DELETE** - Consolidate into check-wallet.ts
   - Action: 🗑️ Delete

8. **[check-wallet.ts](contracts/check-wallet.ts)** (87 lines)
   - Purpose: Check wallet deployment and read basic info
   - Issue: ⚠️ Location: In contracts root instead of contracts/scripts/
   - Issue: ⚠️ Hardcoded wallet address `0x007D207798636d4Df2B45A0BDC052436eFA20a2A`
   - Recommendation: Move to scripts/, update to accept command-line args
   - Action: 📦 Consolidate with simple-test.ts functionality, move to scripts/

9. **[debug-proxy.ts](contracts/scripts/debug-proxy.ts)** (89 lines)
   - Purpose: Debug proxy deployment with IPFS metadata
   - Issue: ⚠️ Hardcoded implementation address `0x001813BB8D3C54BF9Da93aCf873dCb56f41Ad0b4`
   - Recommendation: Update to use env vars or command-line args
   - Action: ⚠️ Update hardcoded values

10. **[verify-bytecode.ts](contracts/scripts/verify-bytecode.ts)** (84 lines)
    - Purpose: Verify deployed proxy bytecode matches expected
    - Status: ✅ Keep - Useful for debugging deployment issues
    - Features: IPFS hash comparison, receive() function detection

11. **[check-transaction-state.ts](contracts/scripts/check-transaction-state.ts)** (90 lines)
    - Purpose: Check transaction state with wallet address and tx hash
    - Status: ✅ Keep - Essential debugging utility
    - Features: Accepts command-line args, shows wallet owners and threshold

12. **[quick-check-tx.ts](contracts/scripts/quick-check-tx.ts)** (45 lines)
    - Purpose: Quick transaction state check
    - Issue: ⚠️ Hardcoded wallet `0x0047126ec7fbe515AbCE1b36ce97f838469e3bDB`
    - Issue: ⚠️ Hardcoded tx hash `0xdf7c45c3610e4903c001c691e3916f1c52e4d4b34528cec74e3bf8b9ed02d095`
    - Issue: ❌ Duplicate of check-transaction-state.ts with less flexibility
    - Recommendation: **DELETE** - Redundant with check-transaction-state.ts
    - Action: 🗑️ Delete

13. **[increment-nonce.ts](contracts/scripts/increment-nonce.ts)** (124 lines)
    - Purpose: Increment wallet nonce via dummy transaction
    - Status: ✅ Keep - Useful for resolving stuck nonce issues
    - Features: Accepts command-line args, auto-executes for threshold=1

14. **[check-wallet-cancel.ts](contracts/scripts/check-wallet-cancel.ts)**
    - Status: ❌ File not found - possibly renamed or removed
    - Action: No action needed

### Frontend Utils (frontend/src/utils/) - KEEP ALL

All frontend utilities are actively used by the application:

- ✅ **blockExplorer.ts** (42 lines) - Block explorer URL generation
- ✅ **clipboard.ts** (38 lines) - Copy to clipboard with fallback
- ✅ **contractVerification.ts** (80 lines) - Contract verification helpers
- ✅ **blockTime.ts** - Block time utilities
- ✅ **diagnostics.ts** - Diagnostic helpers
- ✅ **errorMessages.ts** - Error message formatting
- ✅ **ipfsHelper.ts** - IPFS integration
- ✅ **transactionDecoder.ts** - Transaction decoding

## Consolidation Plan

### Phase 1: Delete Redundant Scripts

Remove 3 scripts with duplicate functionality:

```bash
# Delete duplicate transfer test (less comprehensive version)
rm contracts/test-transfer-new.ts

# Delete minimal check script (superseded by check-wallet.ts)
rm contracts/scripts/simple-test.ts

# Delete hardcoded quick check (superseded by check-transaction-state.ts)
rm contracts/scripts/quick-check-tx.ts
```

### Phase 2: Consolidate Check Wallet Script

Merge simple-test.ts functionality into check-wallet.ts and move to scripts/:

```bash
# Move and enhance check-wallet.ts
mv contracts/check-wallet.ts contracts/scripts/check-wallet.ts
# Then update to accept command-line args instead of hardcoded address
```

### Phase 3: Update Scripts with Hardcoded Values

Update 3 scripts to use environment variables or command-line arguments:

1. **test-factory.ts**
   - Replace hardcoded factory address with: `process.env.PROXY_FACTORY || process.argv[2]`

2. **debug-proxy.ts**
   - Replace hardcoded implementation with: `process.env.MULTISIG_IMPLEMENTATION || process.argv[2]`

3. **check-wallet.ts** (after consolidation)
   - Already accepts command-line args, just remove hardcoded default

### Phase 4: Update package.json Scripts (Optional)

Add convenient npm scripts for common debug tasks:

```json
{
  "scripts": {
    "check:wallet": "ts-node scripts/check-wallet.ts",
    "check:tx": "ts-node scripts/check-transaction-state.ts",
    "verify:bytecode": "ts-node scripts/verify-bytecode.ts",
    "test:factory": "ts-node scripts/test-factory.ts",
    "test:transfer": "ts-node scripts/test-transfer.ts"
  }
}
```

## Summary

### Before
- **Total Scripts**: 20 (12 contract scripts + 8 frontend utils)
- **Issues**: 3 duplicates, 4 with hardcoded values, 2 in wrong location

### After
- **Total Scripts**: 17 (9 contract scripts + 8 frontend utils)
- **Eliminated**: 3 duplicate scripts
- **Consolidated**: 2 check wallet scripts → 1
- **Updated**: 3 scripts to remove hardcoded values
- **Result**: Cleaner, more maintainable script organization

## Implementation Priority

1. **Immediate** (Safe deletions):
   - Delete test-transfer-new.ts
   - Delete simple-test.ts
   - Delete quick-check-tx.ts

2. **Short-term** (Consolidation):
   - Move check-wallet.ts to scripts/
   - Update hardcoded values in test-factory.ts, debug-proxy.ts

3. **Optional**:
   - Add npm script aliases for convenience

## Benefits

- ✅ Reduced codebase clutter (3 fewer files)
- ✅ Eliminated duplicate maintenance burden
- ✅ More flexible scripts (no hardcoded values)
- ✅ Better organization (all scripts in scripts/ directory)
- ✅ Easier onboarding for new developers

---

*Generated: 2026-01-29*
