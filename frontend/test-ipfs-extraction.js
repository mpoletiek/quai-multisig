// Quick test to verify IPFS hash extraction
import { extractIpfsHashFromBytecode } from './src/utils/ipfsHelper.ts';
import MultisigWalletProxyABI from './src/config/abi/MultisigWalletProxy.json' assert { type: 'json' };

console.log('Testing IPFS hash extraction...\n');
console.log('Bytecode length:', MultisigWalletProxyABI.bytecode.length);

const ipfsHash = extractIpfsHashFromBytecode(MultisigWalletProxyABI.bytecode);

if (ipfsHash) {
  console.log('✅ Successfully extracted IPFS hash:', ipfsHash);
  console.log('   Hash length:', ipfsHash.length, '(should be 46 for CIDv0)');
  console.log('   Starts with "Qm":', ipfsHash.startsWith('Qm'));
} else {
  console.error('❌ Failed to extract IPFS hash');
  process.exit(1);
}
