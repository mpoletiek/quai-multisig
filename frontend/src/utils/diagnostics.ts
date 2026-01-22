import { multisigService } from '../services/MultisigService';
import { CONTRACT_ADDRESSES, NETWORK_CONFIG } from '../config/contracts';

export async function runDiagnostics() {
  console.log('=== Quai Multisig Diagnostics ===\n');

  console.log('Network Config:');
  console.log('  RPC URL:', NETWORK_CONFIG.RPC_URL);
  console.log('  Chain ID:', NETWORK_CONFIG.CHAIN_ID);
  console.log('');

  console.log('Contract Addresses:');
  console.log('  Factory:', CONTRACT_ADDRESSES.PROXY_FACTORY);
  console.log('  Implementation:', CONTRACT_ADDRESSES.MULTISIG_IMPLEMENTATION);
  console.log('');

  console.log('Verifying factory configuration...');
  try {
    const verification = await multisigService.verifyFactoryConfig();

    if (verification.valid) {
      console.log('✅ Factory configuration is valid');

      const implAddress = await multisigService.getImplementationAddress();
      console.log('  Implementation address from factory:', implAddress);
    } else {
      console.log('❌ Factory configuration has errors:');
      verification.errors.forEach(error => console.log('  -', error));
    }
  } catch (error) {
    console.error('❌ Failed to verify factory:', error);
  }

  console.log('\n=== End Diagnostics ===');
}
