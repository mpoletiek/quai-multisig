import * as quais from 'quais';
import { CONTRACT_ADDRESSES, NETWORK_CONFIG } from '../config/contracts';

export async function verifyImplementationContract() {
  console.log('=== Verifying Implementation Contract ===\n');

  const provider = new quais.JsonRpcProvider(
    NETWORK_CONFIG.RPC_URL,
    undefined,
    { usePathing: true }
  );

  const implAddress = CONTRACT_ADDRESSES.MULTISIG_IMPLEMENTATION;
  console.log('Implementation address:', implAddress);

  try {
    // Check if contract has code
    const code = await provider.getCode(implAddress);
    console.log('Has code:', code !== '0x');
    console.log('Code length:', code.length);

    if (code === '0x') {
      console.error('❌ Implementation contract has no code!');
      return false;
    }

    // Try calling a view function to test if it's working
    // The implementation should NOT be initialized (only proxies should be)
    const MultisigWalletABI = [
      'function owners(uint256) view returns (address)',
      'function getOwners() view returns (address[])',
      'function threshold() view returns (uint256)'
    ];

    const implementation = new quais.Contract(implAddress, MultisigWalletABI, provider);

    try {
      // This should fail if the implementation is not initialized
      // (which is correct - implementations should not be initialized)
      const owners = await implementation.getOwners();
      console.log('Implementation owners:', owners);
      console.log('⚠️  Warning: Implementation appears to be initialized. It should not be.');
    } catch (error: any) {
      console.log('✅ Implementation is not initialized (correct behavior)');
      console.log('Error message:', error.message);
    }

    console.log('\n=== Verification Complete ===');
    return true;
  } catch (error) {
    console.error('❌ Verification failed:', error);
    return false;
  }
}

export async function testProxyDeployment() {
  console.log('\n=== Testing Proxy Deployment Pattern ===\n');

  const provider = new quais.JsonRpcProvider(
    NETWORK_CONFIG.RPC_URL,
    undefined,
    { usePathing: true }
  );

  // Check if we can simulate what the factory does
  console.log('Factory address:', CONTRACT_ADDRESSES.PROXY_FACTORY);
  console.log('Implementation address:', CONTRACT_ADDRESSES.MULTISIG_IMPLEMENTATION);

  const factoryCode = await provider.getCode(CONTRACT_ADDRESSES.PROXY_FACTORY);
  console.log('Factory has code:', factoryCode !== '0x');

  if (factoryCode === '0x') {
    console.error('❌ Factory contract has no code!');
    return false;
  }

  console.log('✅ Factory contract exists');
  return true;
}
