import * as quais from 'quais';
import type { Contract, Signer, Provider } from '../types';
import type {
  WalletInfo,
  Transaction,
  PendingTransaction,
  DeploymentConfig
} from '../types';
import { CONTRACT_ADDRESSES, NETWORK_CONFIG } from '../config/contracts';
import { extractIpfsHashFromBytecode } from '../utils/ipfsHelper';
import { transactionBuilderService } from './TransactionBuilderService';

// Import ABIs
import MultisigWalletABI from '../config/abi/MultisigWallet.json';
import ProxyFactoryABI from '../config/abi/ProxyFactory.json';
import MultisigWalletProxyABI from '../config/abi/MultisigWalletProxy.json';
import WhitelistModuleABI from '../config/abi/WhitelistModule.json';
import DailyLimitModuleABI from '../config/abi/DailyLimitModule.json';
import SocialRecoveryModuleABI from '../config/abi/SocialRecoveryModule.json';

export class MultisigService {
  private provider: Provider;
  private signer: Signer | null = null;
  private factoryContract: Contract;

  constructor(provider?: Provider) {
    // Use provided provider or create default RPC provider
    this.provider = provider || new quais.JsonRpcProvider(
      NETWORK_CONFIG.RPC_URL,
      undefined,
      { usePathing: true }
    );

    // Initialize factory contract
    this.factoryContract = new quais.Contract(
      CONTRACT_ADDRESSES.PROXY_FACTORY,
      ProxyFactoryABI.abi,
      this.provider
    );
  }

  /**
   * Set signer for signing transactions
   */
  setSigner(signer: Signer | null): void {
    this.signer = signer;
    if (signer) {
      this.factoryContract = this.factoryContract.connect(signer) as Contract;
    } else {
      // Reset factory contract to provider-only when signer is cleared
      this.factoryContract = new quais.Contract(
        CONTRACT_ADDRESSES.PROXY_FACTORY,
        ProxyFactoryABI.abi,
        this.provider
      );
    }
  }

  /**
   * Get the implementation address from the factory
   */
  async getImplementationAddress(): Promise<string> {
    return await this.factoryContract.implementation();
  }

  /**
   * Verify factory configuration
   */
  async verifyFactoryConfig(): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    try {
      const implAddress = await this.getImplementationAddress();

      if (!implAddress || implAddress === quais.ZeroAddress) {
        errors.push('Implementation address is not set');
      } else {
        // Check if implementation has code
        const code = await this.provider.getCode(implAddress);
        if (code === '0x') {
          errors.push(`Implementation contract at ${implAddress} has no code`);
        }
      }
    } catch (error) {
      errors.push('Failed to verify factory configuration: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Deploy a new multisig wallet directly (without factory CREATE2)
   * This approach works with Quai Network's IPFS metadata requirements
   * @param config Deployment configuration
   * @param onProgress Optional callback to track deployment progress
   */
  async deployWallet(
    config: DeploymentConfig,
    onProgress?: (progress: {
      step: 'deploying' | 'deploying_waiting' | 'registering' | 'registering_waiting' | 'verifying' | 'success';
      deployTxHash?: string;
      registerTxHash?: string;
      walletAddress?: string;
      message?: string;
    }) => void
  ): Promise<string> {
    if (!this.signer) {
      throw new Error('Signer not set. Connect wallet first.');
    }

    // Validate config exists
    if (!config) {
      throw new Error('Deployment config is required');
    }

    const { owners, threshold } = config;

    // Validate inputs
    if (!owners || !Array.isArray(owners)) {
      throw new Error('Owners must be an array');
    }
    if (owners.length === 0) {
      throw new Error('At least one owner is required');
    }
    if (threshold === undefined || threshold === null || threshold === 0 || threshold > owners.length) {
      throw new Error(`Invalid threshold: ${threshold} (must be between 1 and ${owners.length})`);
    }

    try {
      console.log('Deploying wallet directly with:');
      console.log('  Owners:', owners);
      console.log('  Threshold:', threshold);
      console.log('  Implementation:', CONTRACT_ADDRESSES.MULTISIG_IMPLEMENTATION);

      // Encode initialization data
      const iface = new quais.Interface(MultisigWalletABI.abi);
      const initData = iface.encodeFunctionData('initialize', [owners, threshold]);

      console.log('  Init data:', initData);

      // Validate ABI and bytecode
      if (!MultisigWalletProxyABI || !MultisigWalletProxyABI.bytecode) {
        throw new Error('MultisigWalletProxy ABI or bytecode is missing. Please check the ABI file.');
      }
      if (!MultisigWalletProxyABI.deployedBytecode) {
        throw new Error('MultisigWalletProxy deployedBytecode is missing. Please check the ABI file.');
      }

      // Extract IPFS hash from bytecode
      // Quai Network requires IPFS hash to be provided explicitly
      const ipfsHash = extractIpfsHashFromBytecode(MultisigWalletProxyABI.bytecode);
      if (!ipfsHash) {
        throw new Error('Failed to extract IPFS hash from proxy bytecode');
      }

      console.log('  IPFS hash:', ipfsHash);
      console.log('  Bytecode length:', MultisigWalletProxyABI.bytecode?.length || 0);
      console.log('  Deployed bytecode length:', MultisigWalletProxyABI.deployedBytecode?.length || 0);

      // Verify bytecode includes receive function
      const deployedBytecode = MultisigWalletProxyABI.deployedBytecode.replace('0x', '');
      const hasReceivePattern = deployedBytecode.includes('3660008037') || deployedBytecode.includes('f4');
      if (!hasReceivePattern) {
        console.warn('⚠️  WARNING: Bytecode may not include receive() function!');
      }

      // Deploy proxy with IPFS hash
      const ProxyFactory = new quais.ContractFactory(
        MultisigWalletProxyABI.abi,
        MultisigWalletProxyABI.bytecode,
        this.signer,
        ipfsHash  // Required for Quai Network
      );

      onProgress?.({ step: 'deploying', message: 'Please approve the deployment transaction in your wallet' });
      
      console.log('Deploying proxy...');
      const proxy = await ProxyFactory.deploy(
        CONTRACT_ADDRESSES.MULTISIG_IMPLEMENTATION,
        initData
      );

      const deployTxHash = proxy.deploymentTransaction()?.hash;
      console.log('Transaction sent:', deployTxHash);

      onProgress?.({
        step: 'deploying_waiting',
        deployTxHash,
        message: 'Waiting for deployment transaction to be confirmed...',
      });

      await proxy.waitForDeployment();
      const walletAddress = await proxy.getAddress();

      console.log('✅ Wallet deployed to:', walletAddress);

      // Verify deployed bytecode matches expected
      onProgress?.({
        step: 'verifying',
        deployTxHash,
        walletAddress,
        message: 'Verifying deployed contract...',
      });

      try {
        const deployedCode = await this.provider.getCode(walletAddress);
        const expectedDeployed = MultisigWalletProxyABI.deployedBytecode.replace('0x', '').toLowerCase();
        const actualDeployed = deployedCode.replace('0x', '').toLowerCase();
        
        if (actualDeployed === expectedDeployed) {
          console.log('✅ Verified: Deployed bytecode matches expected bytecode');
        } else {
          console.warn('⚠️  WARNING: Deployed bytecode does not match expected!');
          console.warn('  Expected length:', expectedDeployed.length);
          console.warn('  Actual length:', actualDeployed.length);
          console.warn('  This wallet may not be able to receive QUAI.');
        }
      } catch (verifyError) {
        console.warn('⚠️  Could not verify deployed bytecode:', verifyError);
      }

      // Register wallet with factory for discovery
      try {
        onProgress?.({
          step: 'registering',
          deployTxHash,
          walletAddress,
          message: 'Please approve the registration transaction in your wallet',
        });

        console.log('Registering wallet with factory...');
        const registerTx = await this.factoryContract.registerWallet(walletAddress);
        const registerTxHash = registerTx.hash;

        onProgress?.({
          step: 'registering_waiting',
          deployTxHash,
          registerTxHash,
          walletAddress,
          message: 'Waiting for registration transaction to be confirmed...',
        });

        await registerTx.wait();
        console.log('✅ Wallet registered with factory');

        onProgress?.({
          step: 'success',
          deployTxHash,
          registerTxHash,
          walletAddress,
          message: 'Wallet created successfully!',
        });
      } catch (regError) {
        console.warn('Warning: Failed to register wallet with factory:', regError);
        // Non-fatal - wallet is deployed, just not registered
        // Still report success since wallet is usable
        onProgress?.({
          step: 'success',
          deployTxHash,
          walletAddress,
          message: 'Wallet deployed successfully (registration skipped)',
        });
      }

      return walletAddress;
    } catch (error: any) {
      console.error('Deployment error:', error);

      if (error.code === 'CALL_EXCEPTION') {
        throw new Error(
          'Deployment failed: ' +
          (error.reason || error.message || 'Unknown error')
        );
      }
      throw error;
    }
  }

  /**
   * Extract wallet address from deployment receipt
   */
  private extractWalletAddressFromReceipt(receipt: any): string {

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

    if (!event) {
      throw new Error('Wallet creation event not found');
    }

    const parsedEvent = this.factoryContract.interface.parseLog(event);
    const walletAddress = parsedEvent?.args.wallet;

    if (!walletAddress) {
      throw new Error('Failed to get wallet address from event');
    }

    return walletAddress;
  }

  /**
   * Get wallet information
   */
  async getWalletInfo(walletAddress: string): Promise<WalletInfo> {
    console.log('📊 Getting wallet info for:', walletAddress);

    try {
      const wallet = this.getWalletContract(walletAddress);

      const [owners, threshold, balance] = await Promise.all([
        wallet.getOwners(),
        wallet.threshold(),  // Public state variable, not getThreshold()
        this.provider.getBalance(walletAddress),
      ]);

      const result = {
        address: walletAddress,
        owners: Array.from(owners).map(address => String(address)), // Ensure plain array of strings
        threshold: Number(threshold),  // Convert BigInt to number
        balance: balance.toString(),   // Convert BigInt to string to preserve precision
      };

      console.log('✅ Wallet info:', result);
      return result;
    } catch (error) {
      console.error('❌ Error getting wallet info:', error);
      throw error;
    }
  }

  /**
   * Get all wallets for an owner address
   */
  async getWalletsForOwner(ownerAddress: string): Promise<string[]> {
    console.log('🔍 Getting wallets for owner:', ownerAddress);

    try {
      const wallets = await this.factoryContract.getWalletsByCreator(ownerAddress);
      console.log('📋 Raw result from contract:', wallets);

      // Convert to plain array to ensure JSON serializability for React Query
      const result = Array.from(wallets).map(address => String(address));
      console.log('✅ Converted wallets:', result);

      return result;
    } catch (error) {
      console.error('❌ Error getting wallets:', error);
      throw error;
    }
  }

  /**
   * Propose a new transaction
   */
  async proposeTransaction(
    walletAddress: string,
    to: string,
    value: bigint,
    data: string
  ): Promise<string> {
    if (!this.signer) {
      throw new Error('Signer not set. Connect wallet first.');
    }

    const wallet = this.getWalletContract(walletAddress, this.signer);
    
    // Check if caller is an owner before attempting to propose
    const callerAddress = await this.signer.getAddress();
    const isOwner = await wallet.isOwner(callerAddress);
    if (!isOwner) {
      throw new Error(`Address ${callerAddress} is not an owner of this wallet`);
    }

    // Check if transaction already exists by calculating the hash
    try {
      const nonce = await wallet.nonce();
      const txHash = await wallet.getTransactionHash(to, value, data, nonce);

      console.log('🔍 Checking if transaction already exists:');
      console.log('  Calculated txHash:', txHash);
      console.log('  Current nonce:', nonce.toString());

      const existingTx = await wallet.transactions(txHash);
      const zeroAddress = '0x0000000000000000000000000000000000000000';

      console.log('  Existing transaction state:', {
        to: existingTx.to,
        value: existingTx.value.toString(),
        executed: existingTx.executed,
        cancelled: existingTx.cancelled,
        numApprovals: Number(existingTx.numApprovals),
        isZeroAddress: existingTx.to.toLowerCase() === zeroAddress.toLowerCase()
      });

      // If transaction exists (to is not zero address)
      if (existingTx.to.toLowerCase() !== zeroAddress.toLowerCase()) {
        // Allow re-proposing cancelled transactions
        if (existingTx.cancelled) {
          // Transaction is cancelled, allow overwriting it
          console.log('⚠️  Transaction exists but is cancelled. Re-proposing will overwrite it.');
          console.log('  Previous state:', {
            to: existingTx.to,
            value: existingTx.value.toString(),
            executed: existingTx.executed,
            cancelled: existingTx.cancelled,
            numApprovals: Number(existingTx.numApprovals)
          });
          // Continue with proposal - the contract will clear old approvals
        } else if (existingTx.executed) {
          throw new Error('This transaction was already executed');
        } else {
          // Transaction exists and is not cancelled or executed - it's pending
          // Try to get the full transaction details to help user find it
          const txDetails = await this.getTransactionByHash(walletAddress, txHash);
          if (txDetails) {
            throw new Error(`A transaction with this exact parameters already exists (hash: ${txHash}). It has ${txDetails.numApprovals}/${txDetails.threshold} approvals. The transaction exists in the contract but may not appear in pending transactions due to event indexing issues. Please try refreshing the page or check the transaction directly.`);
          } else {
            throw new Error(`A transaction with this exact parameters already exists (hash: ${txHash}). Please approve and execute the existing transaction first.`);
          }
        }
      }
    } catch (error: any) {
      // If it's our custom error about existing transaction, re-throw it
      if (error.message && (error.message.includes('already exists') || error.message.includes('already executed'))) {
        throw error;
      }
      // Otherwise, continue - transaction doesn't exist yet
    }

    // Try to estimate gas first to get better error messages
    // Note: Gas estimation may fail on Quai Network for self-calls, so we'll try but not fail if it does
    // Skip gas estimation if:
    // 1. We're overwriting a cancelled transaction (can cause false negatives)
    // 2. This is a self-call (wallet calling itself) - gas estimation is unreliable for these
    const isSelfCall = to.toLowerCase() === walletAddress.toLowerCase();
    const skipGasEstimation = await (async () => {
      // Always skip for self-calls (owner management transactions)
      if (isSelfCall) {
        console.log('⏭️  Skipping gas estimation (self-call - unreliable on Quai Network)');
        return true;
      }
      
      // Skip if overwriting cancelled transaction
      try {
        const nonce = await wallet.nonce();
        const txHash = await wallet.getTransactionHash(to, value, data, nonce);
        const existingTx = await wallet.transactions(txHash);
        if (existingTx.cancelled === true) {
          console.log('⏭️  Skipping gas estimation (overwriting cancelled transaction)');
          return true;
        }
      } catch {
        // Continue with gas estimation
      }
      return false;
    })();

    if (!skipGasEstimation) {
      try {
        console.log('⚙️  Estimating gas for transaction proposal...');
        console.log('  Parameters:', { to, value: value.toString(), dataLength: data.length });
        await wallet.proposeTransaction.estimateGas(to, value, data);
        console.log('✅ Gas estimation succeeded');
      } catch (error: any) {
        // Log the error but don't fail - Quai Network sometimes has issues with gas estimation
        console.error('⚠️  Gas estimation failed:', error);
        console.error('Error details:', {
          code: error.code,
          message: error.message,
          reason: error.reason,
          data: error.data
        });
        // Only throw if we can extract a meaningful error reason
        if (error.reason && !error.reason.includes('missing revert data')) {
          throw new Error(`Transaction proposal would fail: ${error.reason}`);
        }
        // Otherwise, continue - we'll let the actual transaction attempt reveal the error
      }
    }
    
    // Attempt the actual transaction
    let tx;
    try {
      console.log('📤 Sending proposeTransaction to contract...');
      console.log('  To:', to);
      console.log('  Value:', value.toString());
      console.log('  Data:', data);
      console.log('  Is self-call:', isSelfCall);

      // For self-calls, provide explicit gas limit and nonce to prevent wallet rejection
      // Self-calls can have unreliable gas estimation, so we use a safe default
      const txOptions: any = {};
      if (isSelfCall) {
        // Use a generous gas limit for self-calls (owner management transactions)
        // This prevents the wallet from rejecting due to gas estimation failures
        txOptions.gasLimit = 200000n; // 200k gas should be more than enough for proposeTransaction
        console.log('  Using explicit gas limit for self-call:', txOptions.gasLimit.toString());
        
        // Explicitly get and set the nonce to ensure the wallet uses the correct one
        // This can help prevent nonce-related rejections
        try {
          const callerAddress = await this.signer!.getAddress();
          const currentNonce = await this.provider.getTransactionCount(callerAddress, 'pending');
          txOptions.nonce = currentNonce;
          console.log('  Using explicit nonce for self-call:', currentNonce.toString());
        } catch (nonceError) {
          console.warn('  Could not get explicit nonce, wallet will use default:', nonceError);
          // Continue without explicit nonce - wallet will handle it
        }
      }

      tx = await wallet.proposeTransaction(to, value, data, txOptions);
      console.log('✅ Transaction sent, hash:', tx.hash);
    } catch (error: any) {
      // If the actual transaction fails, provide better error messages
      console.error('❌ Transaction proposal failed:', error);
      console.error('Error details:', {
        code: error.code,
        message: error.message,
        reason: error.reason,
        data: error.data
      });

      // Check if user rejected the transaction
      if (error.code === 'ACTION_REJECTED' || error.code === 4001 ||
          (error.message && (error.message.includes('rejected') || error.message.includes('denied') || error.message.includes('cancelled')))) {
        throw new Error('Transaction was rejected by user');
      }

      if (error.reason) {
        throw new Error(`Transaction proposal failed: ${error.reason}`);
      } else if (error.data) {
        // Try to decode revert reason from error data
        try {
          const iface = wallet.interface;
          const decoded = iface.parseError(error.data);
          if (decoded) {
            throw new Error(`Transaction proposal failed: ${decoded.name} - ${decoded.args.join(', ')}`);
          } else {
            throw new Error(`Transaction proposal failed: ${error.data}`);
          }
        } catch (decodeError) {
          // If decoding fails, use the original error data
          throw new Error(`Transaction proposal failed: ${error.data}`);
        }
      } else {
        throw new Error(`Transaction proposal failed. This might mean: 1) Transaction already exists, 2) Invalid parameters, or 3) Network issue. Original error: ${error.message || 'Unknown error'}`);
      }
    }
    
    const receipt = await tx.wait();

    // Extract transaction hash from event
    // Try multiple ways to find the event
    let event: any = null;
    let txHash: string | null = null;
    
    // Method 1: Check fragment name
    event = receipt.logs.find(
      (log: any) => log.fragment?.name === 'TransactionProposed'
    );
    if (event && event.args && event.args.txHash) {
      txHash = event.args.txHash;
    }

    // Method 2: Parse logs using interface
    if (!txHash) {
      for (const log of receipt.logs) {
        try {
          const parsed = wallet.interface.parseLog(log);
          if (parsed && parsed.name === 'TransactionProposed' && parsed.args && parsed.args.txHash) {
            txHash = parsed.args.txHash;
            break;
          }
        } catch {
          // Continue searching
        }
      }
    }

    // Method 3: Check topics (TransactionProposed event signature)
    if (!txHash) {
      try {
        const eventDef = wallet.interface.getEvent('TransactionProposed');
        if (eventDef) {
          const eventSignature = eventDef.topicHash;
          const foundLog = receipt.logs.find(
            (log: any) => log.topics && log.topics[0] === eventSignature
          );
          if (foundLog) {
            const parsed = wallet.interface.parseLog(foundLog);
            if (parsed && parsed.args && parsed.args.txHash) {
              txHash = parsed.args.txHash;
            }
          }
        }
      } catch (e) {
        console.warn('Error parsing event by topic:', e);
      }
    }

    if (!txHash) {
      console.error('TransactionProposed event not found in receipt:', receipt);
      console.error('Available logs:', receipt.logs.map((log: any) => ({
        topics: log.topics,
        data: log.data,
        address: log.address
      })));
      throw new Error('Transaction proposal event not found. Transaction may have failed.');
    }

    console.log('✅ Transaction proposed successfully:', txHash);
    return txHash;
  }

  /**
   * Approve a transaction
   */
  async approveTransaction(walletAddress: string, txHash: string): Promise<void> {
    if (!this.signer) {
      throw new Error('Signer not set. Connect wallet first.');
    }

    const wallet = this.getWalletContract(walletAddress, this.signer);
    const tx = await wallet.approveTransaction(txHash);
    await tx.wait();
  }

  /**
   * Revoke approval for a transaction
   */
  async revokeApproval(walletAddress: string, txHash: string): Promise<void> {
    if (!this.signer) {
      throw new Error('Signer not set. Connect wallet first.');
    }

    // Normalize txHash
    if (!txHash.startsWith('0x')) {
      txHash = '0x' + txHash;
    }
    if (txHash.length !== 66) {
      throw new Error(`Invalid transaction hash length: ${txHash.length} (expected 66)`);
    }

    const wallet = this.getWalletContract(walletAddress, this.signer);
    const signerAddress = await this.signer.getAddress();

    // Pre-validation: Check transaction state
    try {
      const txDetails = await wallet.transactions(txHash);
      
      // Check if transaction exists
      if (txDetails.to === '0x0000000000000000000000000000000000000000') {
        throw new Error('Transaction does not exist');
      }

      // Check if already executed
      if (txDetails.executed) {
        throw new Error('Cannot revoke approval for an executed transaction');
      }

      // Check if cancelled
      if (txDetails.cancelled) {
        throw new Error('Cannot revoke approval for a cancelled transaction');
      }

      // Check if user has actually approved
      const hasApproved = await wallet.approvals(txHash, signerAddress);
      if (!hasApproved) {
        throw new Error('You have not approved this transaction');
      }
    } catch (error: any) {
      if (error.message && !error.message.includes('Transaction does not exist')) {
        throw error; // Re-throw validation errors
      }
      // If it's a contract call error, try to decode it
      console.error('Pre-validation error:', error);
    }

    // Estimate gas and add buffer
    let gasLimit: bigint;
    try {
      const estimatedGas = await wallet.revokeApproval.estimateGas(txHash);
      gasLimit = (estimatedGas * 150n) / 100n; // 50% buffer
      if (gasLimit < 100000n) {
        gasLimit = 100000n; // Minimum gas
      }
    } catch (error: any) {
      console.warn('Gas estimation failed, using default:', error);
      gasLimit = 100000n; // Default gas limit
    }

    // Get current nonce
    const nonce = await this.provider.getTransactionCount(signerAddress, 'pending');

    try {
      const tx = await wallet.revokeApproval(txHash, {
        gasLimit,
        nonce,
      });
      
      const receipt = await tx.wait();
      
      if (receipt && receipt.status === 0) {
        // Transaction reverted, try to get the revert reason
        let errorMessage = 'Transaction reverted';
        try {
          await wallet.revokeApproval.estimateGas(txHash);
        } catch (revertError: any) {
          if (revertError.reason) {
            errorMessage = `Transaction reverted: ${revertError.reason}`;
          } else if (revertError.data && revertError.data !== '0x') {
            // Try to decode the error data
            try {
              if (revertError.data.length > 138) {
                const errorString = quais.AbiCoder.defaultAbiCoder().decode(['string'], '0x' + revertError.data.slice(138))[0];
                if (errorString) {
                  errorMessage = `Transaction reverted: ${errorString}`;
                }
              }
            } catch {
              errorMessage = `Transaction reverted (unable to decode: ${revertError.data.substring(0, 20)}...)`;
            }
          }
        }
        throw new Error(errorMessage);
      }

      // Verify on-chain that approval was revoked
      const stillApproved = await wallet.approvals(txHash, signerAddress);
      if (stillApproved) {
        throw new Error('Approval revocation may have failed - approval still exists on-chain');
      }
    } catch (error: any) {
      console.error('Error revoking approval:', error);
      
      // Try to decode revert reason if available
      if (error.reason) {
        throw new Error(`Failed to revoke approval: ${error.reason}`);
      }
      
      if (error.message) {
        throw error;
      }
      
      throw new Error('Failed to revoke approval: Transaction reverted');
    }
  }

  /**
   * Cancel a pending transaction
   * @param walletAddress Wallet address
   * @param txHash Transaction hash to cancel
   */
  async cancelTransaction(walletAddress: string, txHash: string): Promise<void> {
    if (!this.signer) {
      throw new Error('Signer not set. Connect wallet first.');
    }

    console.log('cancelTransaction called with:', { walletAddress, txHash });
    
    // Ensure txHash is properly formatted (bytes32, 66 chars with 0x prefix)
    if (!txHash.startsWith('0x')) {
      txHash = '0x' + txHash;
    }
    if (txHash.length !== 66) {
      throw new Error(`Invalid transaction hash length: ${txHash.length} (expected 66)`);
    }
    
    console.log('Normalized txHash:', txHash);
    const wallet = this.getWalletContract(walletAddress, this.signer);
    
    // Get transaction details first to validate
    const [txDetails, threshold] = await Promise.all([
      wallet.transactions(txHash),
      wallet.threshold(),
    ]);
    
    console.log('Initial transaction state:', {
      to: txDetails.to,
      executed: txDetails.executed,
      cancelled: txDetails.cancelled,
      numApprovals: txDetails.numApprovals.toString(),
      proposer: txDetails.proposer,
      threshold: threshold.toString(),
    });
    
    // Check if transaction exists
    const zeroAddress = '0x0000000000000000000000000000000000000000';
    if (txDetails.to.toLowerCase() === zeroAddress.toLowerCase()) {
      throw new Error('Transaction does not exist');
    }
    
    // Check if already executed
    if (txDetails.executed) {
      throw new Error('Cannot cancel an executed transaction');
    }
    
    // Check if already cancelled (if the wallet supports it)
    try {
      if (txDetails.cancelled) {
        throw new Error('Transaction has already been cancelled');
      }
    } catch (error: any) {
      // If cancelled property doesn't exist, the wallet doesn't support cancellation
      if (error.message && !error.message.includes('already been cancelled')) {
        throw new Error('This wallet does not support transaction cancellation. The wallet was deployed before this feature was added. Please deploy a new wallet with the updated contract.');
      }
      throw error;
    }

    // Get caller address
    const callerAddress = await this.signer.getAddress();
    
    // Verify caller is an owner
    const isOwner = await wallet.isOwner(callerAddress);
    if (!isOwner) {
      throw new Error('Only wallet owners can cancel transactions');
    }
    
    // Check if caller is the proposer
    // If staticCall passed above, the function exists, so the wallet supports cancellation
    let isProposer = false;
    try {
      // Try to access proposer field
      const proposer = txDetails.proposer;
      if (proposer && proposer !== zeroAddress) {
        isProposer = proposer.toLowerCase() === callerAddress.toLowerCase();
      }
    } catch (error: any) {
      // If we can't access proposer, assume caller is not the proposer
      // This shouldn't happen if the ABI is correct, but handle gracefully
      console.warn('Could not access proposer field, assuming caller is not proposer:', error.message);
    }
    
    // If not proposer, check if we have threshold approvals
    if (!isProposer) {
      const currentApprovals = Number(txDetails.numApprovals);
      const requiredThreshold = Number(threshold);
      if (currentApprovals < requiredThreshold) {
        throw new Error(`Only the proposer can cancel this transaction immediately. To cancel as a non-proposer, the transaction needs ${requiredThreshold} approvals (currently has ${currentApprovals})`);
      }
    }

    // First, try to estimate gas to catch validation errors before sending the transaction
    // estimateGas will fail if the transaction would revert, and give us the revert reason
    try {
      await wallet.cancelTransaction.estimateGas(txHash);
    } catch (simulationError: any) {
      console.log('Pre-transaction gas estimation error:', simulationError);
      console.log('Simulation error data:', simulationError.data);
      console.log('Simulation error reason:', simulationError.reason);
      console.log('Simulation error message:', simulationError.message);
      // If simulation fails, decode the revert reason and throw a clear error
      let errorMessage = 'Cannot cancel transaction';
      
      if (simulationError.reason) {
        errorMessage = `Cannot cancel transaction: ${simulationError.reason}`;
      } else if (simulationError.data) {
        try {
          const iface = wallet.interface;
          const decoded = iface.parseError(simulationError.data);
          if (decoded) {
            if (decoded.name === 'Error' && decoded.args && decoded.args.length > 0) {
              // This is a require() statement with a string message
              errorMessage = `Cannot cancel transaction: ${decoded.args[0].toString()}`;
            } else {
              // This is a custom error
              errorMessage = `Cannot cancel transaction: ${decoded.name}`;
              if (decoded.args && decoded.args.length > 0) {
                errorMessage += ` - ${decoded.args.map((arg: any) => arg.toString()).join(', ')}`;
              }
            }
          }
        } catch {
          // Try to decode as a plain string error message
          if (simulationError.data && simulationError.data.length > 138) {
            try {
              const errorString = quais.AbiCoder.defaultAbiCoder().decode(['string'], '0x' + simulationError.data.slice(138))[0];
              if (errorString) {
                errorMessage = `Cannot cancel transaction: ${errorString}`;
              }
            } catch {
              // If decoding fails, use a generic message
              errorMessage = 'Cannot cancel transaction: Validation failed (unable to decode reason)';
            }
          }
        }
      } else if (simulationError.message) {
        errorMessage = `Cannot cancel transaction: ${simulationError.message}`;
      }
      
      // Always throw the error - don't continue to send the transaction if simulation fails
      throw new Error(errorMessage);
    }

    console.log('Starting cancelTransaction - about to send transaction');
    console.log('Calling cancelTransaction with txHash:', txHash);
    console.log('Wallet address:', walletAddress);
    try {
      // Encode the function call to verify it's correct
      const callData = wallet.interface.encodeFunctionData('cancelTransaction', [txHash]);
      console.log('Encoded call data:', callData);
      console.log('Call data length:', callData.length);
      
      // Double-check with a direct call simulation right before sending
      const callerAddress = await this.signer!.getAddress();
      try {
        const result = await this.provider.call({
          to: walletAddress,
          from: callerAddress,
          data: callData,
        });
        console.log('Pre-send call simulation result:', result);
        // If call succeeds, proceed
      } catch (preCallError: any) {
        console.log('Pre-send call simulation failed:', preCallError);
        console.log('Pre-call error reason:', preCallError.reason);
        console.log('Pre-call error data:', preCallError.data);
        // Decode and throw the error
        if (preCallError.reason) {
          throw new Error(`Cannot cancel transaction: ${preCallError.reason}`);
        } else if (preCallError.data) {
          try {
            const iface = wallet.interface;
            const decoded = iface.parseError(preCallError.data);
            if (decoded && decoded.name === 'Error' && decoded.args && decoded.args.length > 0) {
              throw new Error(`Cannot cancel transaction: ${decoded.args[0].toString()}`);
            }
          } catch {
            throw new Error('Cannot cancel transaction: Validation failed');
          }
        }
        throw preCallError;
      }
      
      // Estimate gas and add a buffer to prevent out-of-gas errors
      // The trace showed the transaction ran out of gas, so we'll add a 50% buffer
      let estimatedGas: bigint;
      try {
        estimatedGas = await wallet.cancelTransaction.estimateGas(txHash);
        console.log('Estimated gas:', estimatedGas.toString());
      } catch (gasEstError: any) {
        // If gas estimation fails, it means the transaction would revert
        // Decode the error and throw it
        console.log('Gas estimation failed:', gasEstError);
        if (gasEstError.reason) {
          throw new Error(`Cannot cancel transaction: ${gasEstError.reason}`);
        } else if (gasEstError.data) {
          try {
            const iface = wallet.interface;
            const decoded = iface.parseError(gasEstError.data);
            if (decoded && decoded.name === 'Error' && decoded.args && decoded.args.length > 0) {
              throw new Error(`Cannot cancel transaction: ${decoded.args[0].toString()}`);
            }
          } catch {
            throw new Error('Cannot cancel transaction: Validation failed');
          }
        }
        throw new Error(`Cannot cancel transaction: ${gasEstError.message || 'Gas estimation failed'}`);
      }
      
      // Add 50% buffer to estimated gas, with a minimum of 100,000 gas
      const gasWithBuffer = estimatedGas + (estimatedGas / 2n);
      const gasLimit = gasWithBuffer > 100000n ? gasWithBuffer : 100000n;
      console.log('Using gas limit:', gasLimit.toString());
      
      // Get current nonce before sending to check for nonce issues
      const currentNonce = await this.provider.getTransactionCount(callerAddress);
      console.log('Current account nonce:', currentNonce);
      
      // Send transaction with explicit gas limit
      const tx = await wallet.cancelTransaction(txHash, { gasLimit });
      console.log('Transaction sent, hash:', tx.hash);
      console.log('Transaction data:', tx.data);
      console.log('Transaction nonce:', tx.nonce);
      console.log('Waiting for receipt...');
      
      let receipt;
      try {
        receipt = await tx.wait();
        console.log('Receipt received:', receipt);
        console.log('Receipt status:', receipt?.status);
      } catch (waitError: any) {
        console.log('tx.wait() threw an error:', waitError);
        console.log('Wait error receipt:', waitError.receipt);
        // If tx.wait() throws, it might have the receipt attached
        if (waitError.receipt) {
          receipt = waitError.receipt;
        } else {
          throw waitError;
        }
      }
      
      // IMPORTANT: Verify the transaction was actually cancelled on-chain
      // Even if receipt.status is 0, the transaction might have succeeded
      // (this can happen if the receipt is from a reverted call but the actual transaction succeeded)
      const verifyTxDetails = await wallet.transactions(txHash);
      const isActuallyCancelled = verifyTxDetails.cancelled;
      
      console.log('On-chain verification:', {
        receiptStatus: receipt?.status,
        isActuallyCancelled,
        executed: verifyTxDetails.executed,
      });
      
      // If the transaction was actually cancelled on-chain, consider it a success
      if (isActuallyCancelled) {
        console.log('Transaction successfully cancelled (verified on-chain)');
        return; // Success!
      }
      
      // If receipt status is 0 AND transaction wasn't cancelled, it actually failed
      if (receipt && 'status' in receipt && receipt.status === 0) {
        console.log('Transaction reverted (status 0) and not cancelled on-chain');
        // Transaction reverted - check current state to understand why
        console.log('Transaction reverted, checking current state...');
        
        // Re-check transaction state to see what might have changed
        const [currentTxDetails, currentThreshold, callerAddress] = await Promise.all([
          wallet.transactions(txHash),
          wallet.threshold(),
          this.signer!.getAddress(),
        ]);
        
        console.log('Current transaction state:', {
          exists: currentTxDetails.to !== '0x0000000000000000000000000000000000000000',
          executed: currentTxDetails.executed,
          cancelled: currentTxDetails.cancelled,
          numApprovals: currentTxDetails.numApprovals.toString(),
          proposer: currentTxDetails.proposer,
          threshold: currentThreshold.toString(),
          caller: callerAddress,
          isOwner: await wallet.isOwner(callerAddress),
        });
        
        let errorMessage = 'Transaction cancellation failed (reverted)';
        
        try {
          // Use estimateGas to get the revert reason
          // This should fail if the transaction would revert
          try {
            await wallet.cancelTransaction.estimateGas(txHash);
            // If estimateGas succeeds now, something unexpected happened
            errorMessage = 'Transaction cancellation failed (reverted unexpectedly - state may have changed)';
          } catch (gasError: any) {
            // Extract revert reason from the gas estimation error
            console.log('Gas estimation error:', gasError);
            console.log('Gas error data:', gasError.data);
            console.log('Gas error reason:', gasError.reason);
            console.log('Gas error message:', gasError.message);
            
            if (gasError.reason) {
              errorMessage = `Cancellation failed: ${gasError.reason}`;
            } else if (gasError.data) {
              try {
                const iface = wallet.interface;
                const decoded = iface.parseError(gasError.data);
                if (decoded) {
                  if (decoded.name === 'Error' && decoded.args && decoded.args.length > 0) {
                    errorMessage = `Cancellation failed: ${decoded.args[0].toString()}`;
                  } else {
                    errorMessage = `Cancellation failed: ${decoded.name}`;
                    if (decoded.args && decoded.args.length > 0) {
                      errorMessage += ` - ${decoded.args.map((arg: any) => arg.toString()).join(', ')}`;
                    }
                  }
                }
              } catch (decodeError) {
                console.log('Error decoding gasError.data:', decodeError);
                // Try to decode as string
                if (gasError.data && gasError.data.length > 138) {
                  try {
                    const errorString = quais.AbiCoder.defaultAbiCoder().decode(['string'], '0x' + gasError.data.slice(138))[0];
                    if (errorString) {
                      errorMessage = `Cancellation failed: ${errorString}`;
                    }
                  } catch {
                    // If decoding fails, use generic message
                    errorMessage = `Cancellation failed: Transaction reverted (unable to decode reason)`;
                  }
                } else {
                  // If data is too short, it might be a different error format
                  errorMessage = `Cancellation failed: Transaction reverted (unable to decode: ${gasError.data || 'no data'})`;
                }
              }
            } else if (gasError.message) {
              errorMessage = `Cancellation failed: ${gasError.message}`;
            }
          }
        } catch (error: any) {
          // Fallback: try staticCall
          try {
            await wallet.cancelTransaction.staticCall(txHash);
          } catch (staticError: any) {
            if (staticError.reason) {
              errorMessage = `Cancellation failed: ${staticError.reason}`;
            } else if (staticError.data) {
              try {
                const iface = wallet.interface;
                const decoded = iface.parseError(staticError.data);
                if (decoded && decoded.name === 'Error' && decoded.args && decoded.args.length > 0) {
                  errorMessage = `Cancellation failed: ${decoded.args[0].toString()}`;
                }
              } catch {
                // Ignore
              }
            }
          }
        }
        
        throw new Error(errorMessage);
      }
    } catch (error: any) {
      console.log('Error caught in cancelTransaction:', error);
      console.log('Error type:', error?.constructor?.name);
      console.log('Error message:', error?.message);
      console.log('Error receipt:', error?.receipt);
      console.log('Error code:', error?.code);
      console.log('Error reason:', error?.reason);
      console.log('Error data:', error?.data);
      
      // If the error already has a message from the status check above, re-throw it
      if (error.message && (error.message.includes('Cancellation failed') || error.message.includes('Transaction cancellation failed'))) {
        throw error;
      }
      
      // Check if this is a receipt with status 0 (tx.wait() throws with receipt attached when reverted)
      if (error.receipt && 'status' in error.receipt && error.receipt.status === 0) {
        console.log('Error has receipt with status 0, checking current state...');
        
        // Check current transaction state to understand why it reverted
        const [currentTxDetails, currentThreshold, callerAddress] = await Promise.all([
          wallet.transactions(txHash),
          wallet.threshold(),
          this.signer!.getAddress(),
        ]);
        
        const isOwner = await wallet.isOwner(callerAddress);
        const isProposer = currentTxDetails.proposer?.toLowerCase() === callerAddress.toLowerCase();
        const currentApprovals = Number(currentTxDetails.numApprovals);
        const requiredThreshold = Number(currentThreshold);
        
        console.log('Current state after revert:', {
          exists: currentTxDetails.to !== '0x0000000000000000000000000000000000000000',
          executed: currentTxDetails.executed,
          cancelled: currentTxDetails.cancelled,
          numApprovals: currentApprovals,
          threshold: requiredThreshold,
          proposer: currentTxDetails.proposer,
          caller: callerAddress,
          isOwner,
          isProposer,
        });
        
        // Try to get revert reason using estimateGas
        let errorMessage = 'Transaction cancellation failed (reverted)';
        
        try {
          await wallet.cancelTransaction.estimateGas(txHash);
          // If estimateGas succeeds, something unexpected happened
          errorMessage = 'Transaction cancellation failed (reverted unexpectedly - state may have changed)';
        } catch (gasError: any) {
          console.log('Gas estimation error after revert:', gasError);
          console.log('Gas error reason:', gasError.reason);
          console.log('Gas error data:', gasError.data);
          
          if (gasError.reason) {
            errorMessage = `Cancellation failed: ${gasError.reason}`;
          } else if (gasError.data) {
            try {
              const iface = wallet.interface;
              const decoded = iface.parseError(gasError.data);
              if (decoded) {
                if (decoded.name === 'Error' && decoded.args && decoded.args.length > 0) {
                  errorMessage = `Cancellation failed: ${decoded.args[0].toString()}`;
                } else {
                  errorMessage = `Cancellation failed: ${decoded.name}`;
                  if (decoded.args && decoded.args.length > 0) {
                    errorMessage += ` - ${decoded.args.map((arg: any) => arg.toString()).join(', ')}`;
                  }
                }
              }
            } catch {
              // Try to decode as string
              if (gasError.data && gasError.data.length > 138) {
                try {
                  const errorString = quais.AbiCoder.defaultAbiCoder().decode(['string'], '0x' + gasError.data.slice(138))[0];
                  if (errorString) {
                    errorMessage = `Cancellation failed: ${errorString}`;
                  }
                } catch {
                  // If decoding fails, provide a helpful message based on state
                  if (!isOwner) {
                    errorMessage = 'Cancellation failed: Only wallet owners can cancel transactions';
                  } else if (currentTxDetails.executed) {
                    errorMessage = 'Cancellation failed: Transaction has already been executed';
                  } else if (currentTxDetails.cancelled) {
                    errorMessage = 'Cancellation failed: Transaction has already been cancelled';
                  } else if (!isProposer && currentApprovals < requiredThreshold) {
                    errorMessage = `Cancellation failed: Only the proposer can cancel immediately, or it needs ${requiredThreshold} approvals (currently has ${currentApprovals})`;
                  } else {
                    errorMessage = 'Cancellation failed: Transaction reverted (unable to decode reason)';
                  }
                }
              } else {
                // Provide helpful message based on state
                if (!isOwner) {
                  errorMessage = 'Cancellation failed: Only wallet owners can cancel transactions';
                } else if (currentTxDetails.executed) {
                  errorMessage = 'Cancellation failed: Transaction has already been executed';
                } else if (currentTxDetails.cancelled) {
                  errorMessage = 'Cancellation failed: Transaction has already been cancelled';
                } else if (!isProposer && currentApprovals < requiredThreshold) {
                  errorMessage = `Cancellation failed: Only the proposer can cancel immediately, or it needs ${requiredThreshold} approvals (currently has ${currentApprovals})`;
                }
              }
            }
          } else {
            // No error data - provide helpful message based on state
            if (!isOwner) {
              errorMessage = 'Cancellation failed: Only wallet owners can cancel transactions';
            } else if (currentTxDetails.executed) {
              errorMessage = 'Cancellation failed: Transaction has already been executed';
            } else if (currentTxDetails.cancelled) {
              errorMessage = 'Cancellation failed: Transaction has already been cancelled';
            } else if (!isProposer && currentApprovals < requiredThreshold) {
              errorMessage = `Cancellation failed: Only the proposer can cancel immediately, or it needs ${requiredThreshold} approvals (currently has ${currentApprovals})`;
            }
          }
        }
        
        throw new Error(errorMessage);
      }
      
      // Try to decode revert reason from the error
      if (error.reason) {
        throw new Error(`Failed to cancel transaction: ${error.reason}`);
      } else if (error.data) {
        // Try to decode revert reason from error data
        try {
          const iface = wallet.interface;
          const decoded = iface.parseError(error.data);
          if (decoded) {
            const errorMsg = decoded.name === 'Error' && decoded.args && decoded.args.length > 0 
              ? decoded.args[0].toString()
              : decoded.name;
            throw new Error(`Cancellation failed: ${errorMsg}`);
          }
        } catch {
          // If decoding fails, try to extract string error message
          if (error.data && error.data !== '0x' && error.data.length > 138) {
            try {
              const errorString = quais.AbiCoder.defaultAbiCoder().decode(['string'], '0x' + error.data.slice(138))[0];
              if (errorString) {
                throw new Error(`Cancellation failed: ${errorString}`);
              }
            } catch {
              // Ignore decode errors
            }
          }
        }
      }
      
      // Only check for "function not found" if we haven't gotten past staticCall
      // If we got here and staticCall passed, the function exists, so any error is a validation error
      // Don't throw "function doesn't exist" error here since we already validated the function exists
      
      // Re-throw with improved message
      if (error.message && !error.message.includes('Failed to cancel') && !error.message.includes('Cancellation failed')) {
        throw new Error(`Failed to cancel transaction: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Execute a transaction
   */
  async executeTransaction(walletAddress: string, txHash: string): Promise<void> {
    if (!this.signer) {
      throw new Error('Signer not set. Connect wallet first.');
    }

    const wallet = this.getWalletContract(walletAddress, this.signer);
    
    // Get transaction details first to validate
    const txDetails = await wallet.transactions(txHash);
    
    // Check if transaction exists
    const zeroAddress = '0x0000000000000000000000000000000000000000';
    if (txDetails.to.toLowerCase() === zeroAddress.toLowerCase()) {
      throw new Error('Transaction does not exist');
    }
    
    // Check if already executed
    if (txDetails.executed) {
      throw new Error('Transaction has already been executed');
    }
    
    // Check if cancelled
    if (txDetails.cancelled) {
      throw new Error('Transaction has been cancelled and cannot be executed');
    }
    
    // Check if enough approvals
    const threshold = await wallet.threshold();
    if (txDetails.numApprovals < threshold) {
      throw new Error(`Not enough approvals: ${txDetails.numApprovals.toString()} / ${threshold.toString()} required`);
    }
    
    // If this is a self-call (wallet management), check additional constraints
    if (txDetails.to.toLowerCase() === walletAddress.toLowerCase() && txDetails.data !== '0x') {
      try {
        const iface = wallet.interface;
        const decoded = iface.parseTransaction({ data: txDetails.data });
        
        // Check removeOwner constraints
        if (decoded && decoded.name === 'removeOwner') {
          const owners = await wallet.getOwners();
          const currentThreshold = await wallet.threshold();
          
          // Check if removing this owner would violate threshold
          if (owners.length - 1 < Number(currentThreshold)) {
            throw new Error(`Cannot remove owner: would reduce owners to ${owners.length - 1}, but threshold is ${currentThreshold}. Lower the threshold first or add more owners.`);
          }
        }
      } catch (error: any) {
        // If it's our custom error, re-throw it
        if (error.message && error.message.includes('Cannot remove owner')) {
          throw error;
        }
        // Otherwise, continue - decoding might fail for other reasons
      }
    }
    
    // Attempt execution
    try {
      console.log('📤 Executing transaction:', txHash);
      console.log('  Transaction details:', {
        to: txDetails.to,
        value: txDetails.value.toString(),
        dataLength: txDetails.data.length,
        numApprovals: txDetails.numApprovals.toString(),
        threshold: threshold.toString(),
        executed: txDetails.executed,
        cancelled: txDetails.cancelled,
      });

      // Estimate gas and add a buffer to prevent out-of-gas errors
      let estimatedGas: bigint;
      try {
        estimatedGas = await wallet.executeTransaction.estimateGas(txHash);
        console.log('  Estimated gas:', estimatedGas.toString());
      } catch (gasEstError: any) {
        // If gas estimation fails, it might mean the transaction would revert
        // But on Quai Network, gas estimation can be unreliable, so we'll use a default
        console.warn('  Gas estimation failed, using default:', gasEstError);
        // Use a generous default gas limit for execution
        estimatedGas = 500000n; // 500k gas should be enough for most transactions
        console.log('  Using default gas limit:', estimatedGas.toString());
      }
      
      // Add 50% buffer to estimated gas, with a minimum of 200,000 gas
      // Execution transactions can be more complex than cancellation
      const gasWithBuffer = estimatedGas + (estimatedGas / 2n);
      const gasLimit = gasWithBuffer > 200000n ? gasWithBuffer : 200000n;
      console.log('  Using gas limit with buffer:', gasLimit.toString());

      const tx = await wallet.executeTransaction(txHash, { gasLimit });
      console.log('✅ Transaction sent, hash:', tx.hash);
      console.log('  Waiting for receipt...');
      
      let receipt;
      try {
        receipt = await tx.wait();
        console.log('✅ Receipt received, status:', receipt?.status);
      } catch (waitError: any) {
        console.log('tx.wait() threw an error:', waitError);
        if (waitError.receipt) {
          receipt = waitError.receipt;
        } else {
          throw waitError;
        }
      }
      
      // Check if transaction actually succeeded
      if (receipt && 'status' in receipt && receipt.status === 0) {
        console.log('❌ Transaction reverted (status 0)');
        console.log('  Checking current transaction state...');
        
        // Re-check transaction state to see what might have changed
        const [currentTxDetails, currentThreshold, callerAddress] = await Promise.all([
          wallet.transactions(txHash),
          wallet.threshold(),
          this.signer!.getAddress(),
        ]);

        const currentIsOwner = await wallet.isOwner(callerAddress);
        const currentApprovals = Number(currentTxDetails.numApprovals);
        const currentRequiredThreshold = Number(currentThreshold);

        console.log('  Current state after revert:', {
          exists: currentTxDetails.to !== '0x0000000000000000000000000000000000000000',
          executed: currentTxDetails.executed,
          cancelled: currentTxDetails.cancelled,
          numApprovals: currentApprovals,
          threshold: currentRequiredThreshold,
          caller: callerAddress,
          isOwner: currentIsOwner,
        });

        // Check if transaction state changed
        const zeroAddress = '0x0000000000000000000000000000000000000000';
        if (currentTxDetails.to.toLowerCase() === zeroAddress.toLowerCase()) {
          throw new Error('Transaction no longer exists (may have been cleared or replaced)');
        }

        if (currentTxDetails.executed) {
          throw new Error('Transaction was already executed (may have been executed by another owner)');
        }

        if (currentTxDetails.cancelled) {
          throw new Error('Transaction was cancelled (cannot execute a cancelled transaction)');
        }

        // Check if approvals changed
        if (currentApprovals < currentRequiredThreshold) {
          throw new Error(`Not enough approvals: ${currentApprovals} / ${currentRequiredThreshold} required (approvals may have been revoked)`);
        }

        // Try to get revert reason using estimateGas
        let errorMessage = 'Transaction execution failed (reverted)';

        try {
          // Use estimateGas to get the revert reason
          try {
            await wallet.executeTransaction.estimateGas(txHash);
            // If estimateGas succeeds now, the issue is likely with the actual call execution
            // (e.g., the target contract call failed, not the multisig validation)
            // Try to simulate the actual target call to get more information
            console.log('  estimateGas succeeded, simulating target call to get revert reason...');
            
            try {
              // Simulate the actual call that would be made
              const callResult = await this.provider.call({
                to: currentTxDetails.to,
                data: currentTxDetails.data,
                value: currentTxDetails.value,
              });
              console.log('  Target call simulation result:', callResult);
              // If simulation succeeds but execution fails, check if it's a self-call
              const isSelfCall = currentTxDetails.to.toLowerCase() === walletAddress.toLowerCase();
              if (isSelfCall && currentTxDetails.data !== '0x') {
                // This is a self-call (owner management transaction)
                // The simulation succeeds because it's called from outside the contract context
                // But execution fails because executeTransaction has nonReentrant modifier
                // which prevents calling back into the contract
                errorMessage = 'Transaction execution failed: Cannot execute self-call transactions (owner management) due to reentrancy protection. This is a known limitation - self-call transactions cannot be executed through executeTransaction.';
                
                // Try to decode what function is being called
                try {
                  const iface = wallet.interface;
                  const decoded = iface.parseTransaction({ data: currentTxDetails.data });
                  if (decoded) {
                    errorMessage = `Transaction execution failed: Cannot execute ${decoded.name} transaction due to reentrancy protection. The executeTransaction function has a nonReentrant modifier that prevents calling back into the contract.`;
                  }
                } catch {
                  // If decoding fails, use the generic message
                }
              } else {
                // If simulation succeeds, the issue might be with gas or reentrancy
                errorMessage = 'Transaction execution failed: The target contract call reverted. This could be due to insufficient gas, reentrancy protection, or the target contract rejecting the call.';
              }
            } catch (callError: any) {
              console.log('  Target call simulation failed:', callError);
              console.log('  Call error reason:', callError.reason);
              console.log('  Call error data:', callError.data);
              
              if (callError.reason) {
                errorMessage = `Transaction execution failed: Target call reverted - ${callError.reason}`;
              } else if (callError.data && callError.data !== '0x') {
                // Try to decode the error data
                try {
                  // Check if it's a standard error string
                  if (callError.data.length > 138) {
                    const errorString = quais.AbiCoder.defaultAbiCoder().decode(['string'], '0x' + callError.data.slice(138))[0];
                    if (errorString) {
                      errorMessage = `Transaction execution failed: ${errorString}`;
                    }
                  }
                } catch {
                  // If decoding fails, use generic message
                  errorMessage = `Transaction execution failed: Target contract call reverted (unable to decode: ${callError.data.substring(0, 20)}...)`;
                }
              } else {
                errorMessage = 'Transaction execution failed: The target contract call reverted (no error data available)';
              }
            }
            
            // If this is a self-call, check for specific issues
            if (currentTxDetails.to.toLowerCase() === walletAddress.toLowerCase() && currentTxDetails.data !== '0x') {
              try {
                const iface = wallet.interface;
                const decoded = iface.parseTransaction({ data: currentTxDetails.data });
                if (decoded && decoded.name === 'removeOwner') {
                  const owners = await wallet.getOwners();
                  const currentThreshold = await wallet.threshold();
                  if (owners.length - 1 < Number(currentThreshold)) {
                    errorMessage = `Cannot remove owner: would reduce owners to ${owners.length - 1}, but threshold is ${currentThreshold}. Lower the threshold first or add more owners.`;
                  } else {
                    errorMessage = 'Transaction execution failed: The removeOwner call reverted. This may be due to invalid parameters or the owner not existing.';
                  }
                } else if (decoded && decoded.name === 'addOwner') {
                  errorMessage = 'Transaction execution failed: The addOwner call reverted. This may be due to the owner already existing or invalid parameters.';
                } else if (decoded && decoded.name === 'changeThreshold') {
                  const owners = await wallet.getOwners();
                  const newThreshold = decoded.args && decoded.args.length > 0 ? Number(decoded.args[0]) : null;
                  if (newThreshold !== null && newThreshold > owners.length) {
                    errorMessage = `Cannot change threshold: new threshold (${newThreshold}) exceeds number of owners (${owners.length})`;
                  } else {
                    errorMessage = 'Transaction execution failed: The changeThreshold call reverted. This may be due to invalid parameters.';
                  }
                }
              } catch {
                // If decoding fails, use the generic error message
              }
            }
          } catch (gasError: any) {
            console.log('  Gas estimation error:', gasError);
            console.log('  Gas error reason:', gasError.reason);
            console.log('  Gas error data:', gasError.data);

            if (gasError.reason) {
              errorMessage = `Execution failed: ${gasError.reason}`;
            } else if (gasError.data) {
              try {
                const iface = wallet.interface;
                const decoded = iface.parseError(gasError.data);
                if (decoded) {
                  if (decoded.name === 'Error' && decoded.args && decoded.args.length > 0) {
                    errorMessage = `Execution failed: ${decoded.args[0].toString()}`;
                  } else {
                    errorMessage = `Execution failed: ${decoded.name}`;
                    if (decoded.args && decoded.args.length > 0) {
                      errorMessage += ` - ${decoded.args.map((arg: any) => arg.toString()).join(', ')}`;
                    }
                  }
                }
              } catch (decodeError) {
                console.log('  Error decoding gasError.data:', decodeError);
                // Try to decode as a plain string error message
                if (gasError.data && gasError.data.length > 138) {
                  try {
                    const errorString = quais.AbiCoder.defaultAbiCoder().decode(['string'], '0x' + gasError.data.slice(138))[0];
                    if (errorString) {
                      errorMessage = `Execution failed: ${errorString}`;
                    }
                  } catch {
                    // If decoding fails, provide a helpful message based on state
                    if (!currentIsOwner) {
                      errorMessage = 'Execution failed: Only wallet owners can execute transactions';
                    } else if (currentTxDetails.executed) {
                      errorMessage = 'Execution failed: Transaction has already been executed';
                    } else if (currentTxDetails.cancelled) {
                      errorMessage = 'Execution failed: Transaction has been cancelled';
                    } else if (currentApprovals < currentRequiredThreshold) {
                      errorMessage = `Execution failed: Not enough approvals (${currentApprovals} / ${currentRequiredThreshold} required)`;
                    } else {
                      errorMessage = 'Execution failed: Transaction reverted (unable to decode reason)';
                    }
                  }
                } else {
                  // Provide helpful message based on state
                  if (!currentIsOwner) {
                    errorMessage = 'Execution failed: Only wallet owners can execute transactions';
                  } else if (currentTxDetails.executed) {
                    errorMessage = 'Execution failed: Transaction has already been executed';
                  } else if (currentTxDetails.cancelled) {
                    errorMessage = 'Execution failed: Transaction has been cancelled';
                  } else if (currentApprovals < currentRequiredThreshold) {
                    errorMessage = `Execution failed: Not enough approvals (${currentApprovals} / ${currentRequiredThreshold} required)`;
                  } else {
                    errorMessage = `Execution failed: Transaction reverted (unable to decode: ${gasError.data || 'no data'})`;
                  }
                }
              }
            } else if (gasError.message) {
              errorMessage = `Execution failed: ${gasError.message}`;
            }
          }
        } catch (error: any) {
          console.log('  Error during gas estimation:', error);
          // Fallback: provide helpful message based on state
          if (!currentIsOwner) {
            errorMessage = 'Execution failed: Only wallet owners can execute transactions';
          } else if (currentTxDetails.executed) {
            errorMessage = 'Execution failed: Transaction has already been executed';
          } else if (currentTxDetails.cancelled) {
            errorMessage = 'Execution failed: Transaction has been cancelled';
          } else if (currentApprovals < currentRequiredThreshold) {
            errorMessage = `Execution failed: Not enough approvals (${currentApprovals} / ${currentRequiredThreshold} required)`;
          }
        }

        // Check if this is a removeOwner transaction that would violate threshold
        if (txDetails.to.toLowerCase() === walletAddress.toLowerCase() && txDetails.data !== '0x') {
          try {
            const iface = wallet.interface;
            const decoded = iface.parseTransaction({ data: txDetails.data });
            if (decoded && decoded.name === 'removeOwner') {
              const owners = await wallet.getOwners();
              const currentThreshold = await wallet.threshold();
              if (owners.length - 1 < Number(currentThreshold)) {
                errorMessage = `Cannot remove owner: would reduce owners to ${owners.length - 1}, but threshold is ${currentThreshold}. Lower the threshold first or add more owners.`;
              }
            }
          } catch {
            // If decoding fails, use the error message we already have
          }
        }

        throw new Error(errorMessage);
      }
    } catch (error: any) {
      console.log('❌ Error caught in executeTransaction:', error);
      console.log('  Error type:', error?.constructor?.name);
      console.log('  Error message:', error?.message);
      console.log('  Error receipt:', error?.receipt);
      console.log('  Error code:', error?.code);
      console.log('  Error reason:', error?.reason);
      console.log('  Error data:', error?.data);

      // If the error already has a message from the status check above, re-throw it
      if (error.message && (error.message.includes('Execution failed') || error.message.includes('Transaction execution failed'))) {
        throw error;
      }

      // Check if this is a receipt with status 0 (tx.wait() throws with receipt attached when reverted)
      if (error.receipt && 'status' in error.receipt && error.receipt.status === 0) {
        console.log('  Error has receipt with status 0, checking current state...');

        // Check current transaction state to understand why it reverted
        const [currentTxDetails, currentThreshold, callerAddress] = await Promise.all([
          wallet.transactions(txHash),
          wallet.threshold(),
          this.signer!.getAddress(),
        ]);

        const currentIsOwner = await wallet.isOwner(callerAddress);
        const currentApprovals = Number(currentTxDetails.numApprovals);
        const currentRequiredThreshold = Number(currentThreshold);

        console.log('  Current state after revert:', {
          exists: currentTxDetails.to !== '0x0000000000000000000000000000000000000000',
          executed: currentTxDetails.executed,
          cancelled: currentTxDetails.cancelled,
          numApprovals: currentApprovals,
          threshold: currentRequiredThreshold,
          caller: callerAddress,
          isOwner: currentIsOwner,
        });

        // Check if transaction state changed
        const zeroAddress = '0x0000000000000000000000000000000000000000';
        if (currentTxDetails.to.toLowerCase() === zeroAddress.toLowerCase()) {
          throw new Error('Transaction no longer exists (may have been cleared or replaced)');
        }

        if (currentTxDetails.executed) {
          throw new Error('Transaction was already executed (may have been executed by another owner)');
        }

        if (currentTxDetails.cancelled) {
          throw new Error('Transaction was cancelled (cannot execute a cancelled transaction)');
        }

        // Check if approvals changed
        if (currentApprovals < currentRequiredThreshold) {
          throw new Error(`Not enough approvals: ${currentApprovals} / ${currentRequiredThreshold} required (approvals may have been revoked)`);
        }

        // Try to get revert reason using estimateGas
        let errorMessage = 'Transaction execution failed (reverted)';

        try {
          await wallet.executeTransaction.estimateGas(txHash);
          // If estimateGas succeeds now, the issue is likely with the actual call execution
          // (e.g., the target contract call failed, not the multisig validation)
          // Try to simulate the actual target call to get more information
          console.log('  estimateGas succeeded, simulating target call to get revert reason...');
          
          try {
            // Simulate the actual call that would be made
            const callResult = await this.provider.call({
              to: currentTxDetails.to,
              data: currentTxDetails.data,
              value: currentTxDetails.value,
            });
            console.log('  Target call simulation result:', callResult);
            // If simulation succeeds, the issue might be with gas or reentrancy
            errorMessage = 'Transaction execution failed: The target contract call reverted. This could be due to insufficient gas, reentrancy protection, or the target contract rejecting the call.';
          } catch (callError: any) {
            console.log('  Target call simulation failed:', callError);
            console.log('  Call error reason:', callError.reason);
            console.log('  Call error data:', callError.data);
            
            if (callError.reason) {
              errorMessage = `Transaction execution failed: Target call reverted - ${callError.reason}`;
            } else if (callError.data && callError.data !== '0x') {
              // Try to decode the error data
              try {
                // Check if it's a standard error string
                if (callError.data.length > 138) {
                  const errorString = quais.AbiCoder.defaultAbiCoder().decode(['string'], '0x' + callError.data.slice(138))[0];
                  if (errorString) {
                    errorMessage = `Transaction execution failed: ${errorString}`;
                  }
                }
              } catch {
                // If decoding fails, use generic message
                errorMessage = `Transaction execution failed: Target contract call reverted (unable to decode: ${callError.data.substring(0, 20)}...)`;
              }
            } else {
              errorMessage = 'Transaction execution failed: The target contract call reverted (no error data available)';
            }
          }
          
          // If this is a self-call, check for specific issues
          if (currentTxDetails.to.toLowerCase() === walletAddress.toLowerCase() && currentTxDetails.data !== '0x') {
            try {
              const iface = wallet.interface;
              const decoded = iface.parseTransaction({ data: currentTxDetails.data });
              if (decoded && decoded.name === 'removeOwner') {
                const owners = await wallet.getOwners();
                const currentThreshold = await wallet.threshold();
                if (owners.length - 1 < Number(currentThreshold)) {
                  errorMessage = `Cannot remove owner: would reduce owners to ${owners.length - 1}, but threshold is ${currentThreshold}. Lower the threshold first or add more owners.`;
                } else {
                  errorMessage = 'Transaction execution failed: The removeOwner call reverted. This may be due to invalid parameters or the owner not existing.';
                }
              } else if (decoded && decoded.name === 'addOwner') {
                errorMessage = 'Transaction execution failed: The addOwner call reverted. This may be due to the owner already existing or invalid parameters.';
              } else if (decoded && decoded.name === 'changeThreshold') {
                const owners = await wallet.getOwners();
                const newThreshold = decoded.args && decoded.args.length > 0 ? Number(decoded.args[0]) : null;
                if (newThreshold !== null && newThreshold > owners.length) {
                  errorMessage = `Cannot change threshold: new threshold (${newThreshold}) exceeds number of owners (${owners.length})`;
                } else {
                  errorMessage = 'Transaction execution failed: The changeThreshold call reverted. This may be due to invalid parameters.';
                }
              }
            } catch {
              // If decoding fails, use the generic error message
            }
          }
        } catch (gasError: any) {
          console.log('  Gas estimation error after revert:', gasError);
          console.log('  Gas error reason:', gasError.reason);
          console.log('  Gas error data:', gasError.data);

          if (gasError.reason) {
            errorMessage = `Execution failed: ${gasError.reason}`;
          } else if (gasError.data) {
            try {
              const iface = wallet.interface;
              const decoded = iface.parseError(gasError.data);
              if (decoded) {
                if (decoded.name === 'Error' && decoded.args && decoded.args.length > 0) {
                  errorMessage = `Execution failed: ${decoded.args[0].toString()}`;
                } else {
                  errorMessage = `Execution failed: ${decoded.name}`;
                  if (decoded.args && decoded.args.length > 0) {
                    errorMessage += ` - ${decoded.args.map((arg: any) => arg.toString()).join(', ')}`;
                  }
                }
              }
            } catch {
              // Try to decode as string
              if (gasError.data && gasError.data.length > 138) {
                try {
                  const errorString = quais.AbiCoder.defaultAbiCoder().decode(['string'], '0x' + gasError.data.slice(138))[0];
                  if (errorString) {
                    errorMessage = `Execution failed: ${errorString}`;
                  }
                } catch {
                  // If decoding fails, provide helpful message based on state
                  if (!currentIsOwner) {
                    errorMessage = 'Execution failed: Only wallet owners can execute transactions';
                  } else if (currentTxDetails.executed) {
                    errorMessage = 'Execution failed: Transaction has already been executed';
                  } else if (currentTxDetails.cancelled) {
                    errorMessage = 'Execution failed: Transaction has been cancelled';
                  } else if (currentApprovals < currentRequiredThreshold) {
                    errorMessage = `Execution failed: Not enough approvals (${currentApprovals} / ${currentRequiredThreshold} required)`;
                  } else {
                    errorMessage = 'Execution failed: Transaction reverted (unable to decode reason)';
                  }
                }
              } else {
                // Provide helpful message based on state
                if (!currentIsOwner) {
                  errorMessage = 'Execution failed: Only wallet owners can execute transactions';
                } else if (currentTxDetails.executed) {
                  errorMessage = 'Execution failed: Transaction has already been executed';
                } else if (currentTxDetails.cancelled) {
                  errorMessage = 'Execution failed: Transaction has been cancelled';
                } else if (currentApprovals < currentRequiredThreshold) {
                  errorMessage = `Execution failed: Not enough approvals (${currentApprovals} / ${currentRequiredThreshold} required)`;
                } else {
                  errorMessage = `Execution failed: Transaction reverted (unable to decode: ${gasError.data || 'no data'})`;
                }
              }
            }
          } else if (gasError.message) {
            errorMessage = `Execution failed: ${gasError.message}`;
          }
        }

        throw new Error(errorMessage);
      }

      // Try to decode revert reason if available
      if (error.reason) {
        throw new Error(`Transaction execution failed: ${error.reason}`);
      } else if (error.data) {
        try {
          const iface = wallet.interface;
          const decoded = iface.parseError(error.data);
          if (decoded) {
            const errorMsg = decoded.name === 'Error' && decoded.args && decoded.args.length > 0 
              ? decoded.args[0].toString()
              : decoded.name;
            throw new Error(`Transaction execution failed: ${errorMsg}`);
          }
        } catch {
          // If decoding fails, check if we have a custom message
          if (error.message && error.message.includes('Cannot remove owner')) {
            throw error;
          }
        }
      }
      
      // Re-throw with improved message
      if (error.message && !error.message.includes('Transaction execution failed') && !error.message.includes('Cannot remove owner') && !error.message.includes('Execution failed')) {
        throw new Error(`Transaction execution failed: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Get transaction details
   */
  async getTransaction(walletAddress: string, txHash: string): Promise<Transaction> {
    const wallet = this.getWalletContract(walletAddress);
    const tx = await wallet.transactions(txHash);

    return {
      to: tx.to,
      value: tx.value,
      data: tx.data,
      executed: tx.executed,
      numApprovals: tx.numApprovals,
      timestamp: tx.timestamp,
    };
  }

  /**
   * Get executed transactions for a wallet (transaction history)
   */
  async getExecutedTransactions(walletAddress: string): Promise<PendingTransaction[]> {
    const wallet = this.getWalletContract(walletAddress);
    const [owners, threshold] = await Promise.all([
      wallet.getOwners(),
      wallet.threshold(),
    ]);

    // Get executed transaction hashes from TransactionExecuted events
    // Limit to recent blocks to avoid exceeding Quai Network's 10,000 block limit
    const filter = wallet.filters.TransactionExecuted();
    let events: any[];
    
    try {
      // Query recent blocks - use 'latest' as toBlock and calculate fromBlock
      // Start with last 5000 blocks (well under the 10,000 limit)
      events = await wallet.queryFilter(filter, -5000, 'latest');
    } catch (error: any) {
      console.error('Error querying TransactionExecuted events:', error);
      // If the range is still too large, try an even smaller range
      if (error.message && error.message.includes('exceeds maximum limit')) {
        try {
          // Try just last 2000 blocks
          events = await wallet.queryFilter(filter, -2000, 'latest');
        } catch (retryError) {
          console.error('Retry also failed:', retryError);
          events = [];
        }
      } else {
        events = [];
      }
    }

    const executedTxs: PendingTransaction[] = [];

    for (const event of events) {
      if (!('args' in event)) continue;
      const txHash = event.args.txHash;
      const tx = await wallet.transactions(txHash);

      // Only include executed transactions
      if (!tx.executed) continue;

      // Get approvals for each owner (historical) - normalize keys to lowercase
      const approvals: { [owner: string]: boolean } = {};
      for (const owner of owners) {
        const approved = await wallet.approvals(txHash, owner);
        approvals[owner.toLowerCase()] = approved;
      }

      executedTxs.push({
        hash: txHash,
        to: tx.to,
        value: tx.value.toString(),
        data: tx.data,
        numApprovals: Number(tx.numApprovals),
        threshold: Number(threshold),
        executed: tx.executed,
        cancelled: tx.cancelled || false,
        timestamp: Number(tx.timestamp),
        proposer: tx.proposer || event.args.proposer || '',
        approvals,
      });
    }

    // Sort by timestamp descending (newest first)
    executedTxs.sort((a, b) => b.timestamp - a.timestamp);

    return executedTxs;
  }

  /**
   * Get cancelled transactions for a wallet
   */
  async getCancelledTransactions(walletAddress: string): Promise<PendingTransaction[]> {
    const wallet = this.getWalletContract(walletAddress);
    const [owners, threshold] = await Promise.all([
      wallet.getOwners(),
      wallet.threshold(),
    ]);

    // Get cancelled transaction hashes from TransactionCancelled events
    const filter = wallet.filters.TransactionCancelled();
    let events: any[];

    try {
      // Query recent blocks
      events = await wallet.queryFilter(filter, -5000, 'latest');
    } catch (error: any) {
      console.error('Error querying TransactionCancelled events:', error);
      if (error.message && error.message.includes('exceeds maximum limit')) {
        try {
          events = await wallet.queryFilter(filter, -2000, 'latest');
        } catch (retryError) {
          console.error('Retry also failed:', retryError);
          events = [];
        }
      } else {
        events = [];
      }
    }

    const cancelledTxs: PendingTransaction[] = [];

    for (const event of events) {
      if (!('args' in event)) continue;
      const txHash = event.args.txHash;
      const tx = await wallet.transactions(txHash);

      // Only include cancelled transactions
      if (!tx.cancelled) continue;

      // Get approvals for each owner (historical) - normalize keys to lowercase
      const approvals: { [owner: string]: boolean } = {};
      for (const owner of owners) {
        const approved = await wallet.approvals(txHash, owner);
        approvals[owner.toLowerCase()] = approved;
      }

      cancelledTxs.push({
        hash: txHash,
        to: tx.to,
        value: tx.value.toString(),
        data: tx.data,
        numApprovals: Number(tx.numApprovals),
        threshold: Number(threshold),
        executed: tx.executed,
        cancelled: tx.cancelled || false,
        timestamp: Number(tx.timestamp),
        proposer: tx.proposer || '',
        approvals,
      });
    }

    // Sort by timestamp descending (newest first)
    cancelledTxs.sort((a, b) => b.timestamp - a.timestamp);

    return cancelledTxs;
  }

  /**
   * Get pending transactions for a wallet
   */
  async getPendingTransactions(walletAddress: string): Promise<PendingTransaction[]> {
    const wallet = this.getWalletContract(walletAddress);
    const [owners, threshold] = await Promise.all([
      wallet.getOwners(),
      wallet.threshold(),
    ]);

    // Get transaction hashes from events
    // Limit to recent blocks to avoid exceeding Quai Network's 10,000 block limit
    const filter = wallet.filters.TransactionProposed();
    let events: any[];
    
    try {
      // Query recent blocks - use 'latest' as toBlock and negative number for relative blocks
      // Start with last 5000 blocks (well under the 10,000 limit)
      console.log(`Querying TransactionProposed events from last 5000 blocks`);
      events = await wallet.queryFilter(filter, -5000, 'latest');
      console.log(`Found ${events.length} TransactionProposed events for wallet ${walletAddress}`);
    } catch (error: any) {
      console.error('Error querying TransactionProposed events:', error);
      // If the range is still too large, try an even smaller range
      if (error.message && error.message.includes('exceeds maximum limit')) {
        try {
          // Try just last 2000 blocks
          console.log(`Retrying with smaller range: last 2000 blocks`);
          events = await wallet.queryFilter(filter, -2000, 'latest');
          console.log(`Found ${events.length} TransactionProposed events (retry)`);
        } catch (retryError) {
          console.error('Retry also failed:', retryError);
          events = [];
        }
      } else {
        events = [];
      }
    }

    const pendingTxs: PendingTransaction[] = [];
    const seenHashes = new Set<string>();

    // First, process events
    for (const event of events) {
      // TypeScript: event could be Log or EventLog, need to check for args
      if (!('args' in event)) {
        console.warn('Event missing args:', event);
        continue;
      }
      
      const txHash = event.args.txHash;
      
      // Skip if txHash is missing
      if (!txHash) {
        console.warn('Event missing txHash:', event);
        continue;
      }

      // Skip duplicates
      const txHashLower = txHash.toLowerCase();
      if (seenHashes.has(txHashLower)) {
        console.log(`Skipping duplicate transaction hash: ${txHash}`);
        continue;
      }
      seenHashes.add(txHashLower);

      try {
        const tx = await wallet.transactions(txHash);

        // Skip executed transactions
        if (tx.executed) {
          console.log(`Skipping executed transaction: ${txHash}`);
          continue;
        }

        // Skip cancelled transactions
        if (tx.cancelled) {
          console.log(`Skipping cancelled transaction: ${txHash}`);
          continue;
        }

        // Get approvals for each owner (normalize keys to lowercase for consistent matching)
        const approvals: { [owner: string]: boolean } = {};
        for (const owner of owners) {
          const approved = await wallet.approvals(txHash, owner);
          approvals[owner.toLowerCase()] = approved;
        }

        pendingTxs.push({
          hash: txHash,
          to: tx.to,
          value: tx.value.toString(),        // Convert BigInt to string
          data: tx.data,
          numApprovals: Number(tx.numApprovals),  // Convert BigInt to number
          threshold: Number(threshold),           // Convert BigInt to number
          executed: tx.executed,
          cancelled: tx.cancelled || false,
          timestamp: Number(tx.timestamp),        // Convert BigInt to number
          proposer: tx.proposer || event.args.proposer || '', // Get proposer from event or transaction
          approvals,
        });
      } catch (error) {
        console.error(`Error fetching transaction ${txHash}:`, error);
        // Continue with other transactions even if one fails
      }
    }

    // Fallback: If we have very few transactions from events, try to find transactions
    // by checking recent blocks or by scanning the nonce range
    // This is a safety net in case events weren't indexed properly
    if (pendingTxs.length === 0 && events.length === 0) {
      console.warn('No transactions found from events. This might indicate an indexing issue.');
      // We could add a fallback here to scan transactions, but it's expensive
      // For now, just log the warning
    }

    console.log(`Found ${pendingTxs.length} pending transactions for wallet ${walletAddress}`);
    return pendingTxs;
  }

  /**
   * Get a specific transaction by hash (helper method)
   */
  async getTransactionByHash(walletAddress: string, txHash: string): Promise<PendingTransaction | null> {
    try {
      const wallet = this.getWalletContract(walletAddress);
      const [owners, threshold, tx] = await Promise.all([
        wallet.getOwners(),
        wallet.threshold(),
        wallet.transactions(txHash),
      ]);

      // Check if transaction exists (to is not zero address)
      const zeroAddress = '0x0000000000000000000000000000000000000000';
      if (tx.to.toLowerCase() === zeroAddress.toLowerCase()) {
        return null; // Transaction doesn't exist
      }

      // Get approvals for each owner - normalize keys to lowercase
      const approvals: { [owner: string]: boolean } = {};
      for (const owner of owners) {
        const approved = await wallet.approvals(txHash, owner);
        approvals[owner.toLowerCase()] = approved;
      }

      return {
        hash: txHash,
        to: tx.to,
        value: tx.value.toString(),
        data: tx.data,
        numApprovals: Number(tx.numApprovals),
        threshold: Number(threshold),
        executed: tx.executed,
        cancelled: tx.cancelled || false,
        timestamp: Number(tx.timestamp),
        proposer: tx.proposer || '',
        approvals,
      };
    } catch (error) {
      console.error(`Error fetching transaction ${txHash}:`, error);
      return null;
    }
  }

  /**
   * Check if an address is an owner of the wallet
   */
  async isOwner(walletAddress: string, address: string): Promise<boolean> {
    const wallet = this.getWalletContract(walletAddress);
    return await wallet.isOwner(address);
  }

  /**
   * Add a new owner to the wallet
   * Note: addOwner has onlySelf modifier, so we need to propose a transaction
   * that calls addOwner on the wallet itself
   * @returns Transaction hash of the proposed transaction
   */
  async addOwner(walletAddress: string, newOwner: string): Promise<string> {
    if (!this.signer) {
      throw new Error('Signer not set. Connect wallet first.');
    }

    // Trim and validate address format first
    const trimmed = newOwner.trim();
    
    // Strict length check
    if (trimmed.length !== 42) {
      throw new Error(`Invalid address length: expected 42 characters, got ${trimmed.length}. Addresses must be 0x followed by exactly 40 hex characters.`);
    }

    // Validate address format using quais
    if (!quais.isAddress(trimmed)) {
      throw new Error(`Invalid address format: "${trimmed}". Addresses must be 42 characters (0x + 40 hex characters) and pass checksum validation.`);
    }

    // Normalize address (get checksummed version) - this will throw if invalid
    let normalizedOwner: string;
    try {
      normalizedOwner = quais.getAddress(trimmed);
    } catch (error) {
      throw new Error(`Invalid address format: "${trimmed}". ${error instanceof Error ? error.message : 'Address validation failed'}`);
    }

    // Check if already an owner
    const wallet = this.getWalletContract(walletAddress);
    const isAlreadyOwner = await wallet.isOwner(normalizedOwner);
    if (isAlreadyOwner) {
      throw new Error('Address is already an owner');
    }

    // addOwner has onlySelf modifier, so we need to propose a transaction
    // that calls the wallet's addOwner function
    const walletWithSigner = this.getWalletContract(walletAddress, this.signer);
    const iface = walletWithSigner.interface;
    
    // Encode the addOwner function call - this will throw if address is invalid
    let data: string;
    try {
      data = iface.encodeFunctionData('addOwner', [normalizedOwner]);
    } catch (error) {
      throw new Error(`Failed to encode addOwner call: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    
    // Check if this exact transaction already exists
    // Note: We check by looking at pending transactions instead of calculating hash
    // because the nonce might have changed if other transactions were executed
    try {
      const pendingTxs = await this.getPendingTransactions(walletAddress);
      const addOwnerSelector = '0x7065cb48'; // addOwner function selector
      
      // Check if there's already a pending transaction to add this owner
      for (const tx of pendingTxs) {
        // Check if this is a self-call (to == walletAddress) with addOwner data
        if (tx.to.toLowerCase() === walletAddress.toLowerCase() && 
            tx.data.startsWith(addOwnerSelector)) {
          // Decode the address from the data to see if it matches
          try {
            const decoded = iface.decodeFunctionData('addOwner', tx.data);
            const pendingOwner = decoded[0];
            if (pendingOwner.toLowerCase() === normalizedOwner.toLowerCase()) {
              throw new Error(`A transaction to add ${normalizedOwner} is already pending. Transaction hash: ${tx.hash.slice(0, 10)}...`);
            }
          } catch {
            // If decoding fails, continue checking other transactions
          }
        }
      }
    } catch (error: any) {
      // If it's our custom error, re-throw it
      if (error.message && error.message.includes('already pending')) {
        throw error;
      }
      // Otherwise, continue - the transaction doesn't exist yet
    }

    // Propose transaction to the wallet itself (self-call)
    const txHash = await this.proposeTransaction(walletAddress, walletAddress, 0n, data);
    return txHash;
  }

  /**
   * Remove an owner from the wallet
   * Note: removeOwner has onlySelf modifier, so we need to propose a transaction
   * that calls removeOwner on the wallet itself
   * @returns Transaction hash of the proposed transaction
   */
  async removeOwner(walletAddress: string, owner: string): Promise<string> {
    if (!this.signer) {
      throw new Error('Signer not set. Connect wallet first.');
    }

    // Validate address format
    if (!quais.isAddress(owner)) {
      throw new Error(`Invalid address format: ${owner}. Addresses must be 42 characters (0x + 40 hex characters).`);
    }

    // Normalize address (get checksummed version)
    const normalizedOwner = quais.getAddress(owner);

    // Check if owner exists and validate threshold constraint BEFORE proposing
    const wallet = this.getWalletContract(walletAddress);
    const [isOwner, owners, threshold] = await Promise.all([
      wallet.isOwner(normalizedOwner),
      wallet.getOwners(),
      wallet.threshold(),
    ]);

    if (!isOwner) {
      throw new Error('Address is not an owner');
    }

    // Pre-validate that removing this owner won't violate the threshold
    // This prevents the wallet from rejecting the transaction proposal
    const currentOwnerCount = owners.length;
    const newOwnerCount = currentOwnerCount - 1;
    const currentThreshold = Number(threshold);

    if (newOwnerCount < currentThreshold) {
      throw new Error(
        `Cannot remove owner: would reduce owners to ${newOwnerCount}, but threshold is ${currentThreshold}. ` +
        `Lower the threshold first (to ${newOwnerCount} or less) or add more owners before removing this one.`
      );
    }

    // removeOwner has onlySelf modifier, so we need to propose a transaction
    const walletWithSigner = this.getWalletContract(walletAddress, this.signer);
    const iface = walletWithSigner.interface;
    
    // Encode the removeOwner function call
    const data = iface.encodeFunctionData('removeOwner', [normalizedOwner]);

    console.log('🔍 removeOwner transaction details:');
    console.log('  Wallet address:', walletAddress);
    console.log('  Owner to remove:', normalizedOwner);
    console.log('  Current owners:', currentOwnerCount);
    console.log('  Current threshold:', currentThreshold);
    console.log('  Would result in owners:', newOwnerCount);
    console.log('  Encoded data:', data);
    console.log('  Data length:', data.length);
    
    // Propose transaction to the wallet itself (self-call)
    const txHash = await this.proposeTransaction(walletAddress, walletAddress, 0n, data);
    return txHash;
  }

  /**
   * Change the approval threshold
   * Note: changeThreshold has onlySelf modifier, so we need to propose a transaction
   * that calls changeThreshold on the wallet itself
   * @returns Transaction hash of the proposed transaction
   */
  async changeThreshold(walletAddress: string, newThreshold: number): Promise<string> {
    if (!this.signer) {
      throw new Error('Signer not set. Connect wallet first.');
    }

    // Validate threshold
    if (newThreshold < 1) {
      throw new Error('Threshold must be at least 1');
    }

    // Get current owners count to validate threshold
    const wallet = this.getWalletContract(walletAddress);
    const owners = await wallet.getOwners();
    if (newThreshold > owners.length) {
      throw new Error(`Threshold cannot exceed number of owners (${owners.length})`);
    }

    // changeThreshold has onlySelf modifier, so we need to propose a transaction
    const walletWithSigner = this.getWalletContract(walletAddress, this.signer);
    const iface = walletWithSigner.interface;

    // Encode the changeThreshold function call
    const data = iface.encodeFunctionData('changeThreshold', [newThreshold]);

    // Propose transaction to the wallet itself (self-call)
    const txHash = await this.proposeTransaction(walletAddress, walletAddress, 0n, data);
    return txHash;
  }

  /**
   * Enable a module
   * Note: enableModule has onlySelf modifier, so we need to propose a transaction
   * that calls enableModule on the wallet itself
   * @returns Transaction hash of the proposed transaction
   */
  async enableModule(walletAddress: string, moduleAddress: string): Promise<string> {
    if (!this.signer) {
      throw new Error('Signer not set. Connect wallet first.');
    }

    // Validate address format
    if (!quais.isAddress(moduleAddress)) {
      throw new Error(`Invalid module address format: ${moduleAddress}`);
    }

    const normalizedModule = quais.getAddress(moduleAddress);

    // Check if module is already enabled
    const wallet = this.getWalletContract(walletAddress);
    const isEnabled = await wallet.modules(normalizedModule);
    if (isEnabled) {
      throw new Error('Module is already enabled');
    }

    // enableModule has onlySelf modifier, so we need to propose a transaction
    // that calls the wallet's enableModule function
    const walletWithSigner = this.getWalletContract(walletAddress, this.signer);
    const iface = walletWithSigner.interface;
    
    // Encode the enableModule function call
    const data = iface.encodeFunctionData('enableModule', [normalizedModule]);
    
    // Propose transaction to the wallet itself (self-call)
    const txHash = await this.proposeTransaction(walletAddress, walletAddress, 0n, data);
    return txHash;
  }

  /**
   * Disable a module
   * Note: disableModule has onlySelf modifier, so we need to propose a transaction
   * that calls disableModule on the wallet itself
   * @returns Transaction hash of the proposed transaction
   */
  async disableModule(walletAddress: string, moduleAddress: string): Promise<string> {
    if (!this.signer) {
      throw new Error('Signer not set. Connect wallet first.');
    }

    // Validate address format
    if (!quais.isAddress(moduleAddress)) {
      throw new Error(`Invalid module address format: ${moduleAddress}`);
    }

    const normalizedModule = quais.getAddress(moduleAddress);

    // Check if module is enabled
    const wallet = this.getWalletContract(walletAddress);
    const isEnabled = await wallet.modules(normalizedModule);
    if (!isEnabled) {
      throw new Error('Module is not enabled');
    }

    // disableModule has onlySelf modifier, so we need to propose a transaction
    // that calls the wallet's disableModule function
    const walletWithSigner = this.getWalletContract(walletAddress, this.signer);
    const iface = walletWithSigner.interface;
    
    // Encode the disableModule function call
    const data = iface.encodeFunctionData('disableModule', [normalizedModule]);
    
    // Propose transaction to the wallet itself (self-call)
    const txHash = await this.proposeTransaction(walletAddress, walletAddress, 0n, data);
    return txHash;
  }

  /**
   * Check if a module is enabled
   */
  async isModuleEnabled(walletAddress: string, moduleAddress: string): Promise<boolean> {
    const wallet = this.getWalletContract(walletAddress);
    return await wallet.modules(moduleAddress);
  }

  /**
   * Get whitelist module contract instance
   */
  private getWhitelistModuleContract(signerOrProvider?: Signer | Provider): Contract {
    // WhitelistModuleABI is already an array, not an object with .abi property
    const abi = Array.isArray(WhitelistModuleABI) ? WhitelistModuleABI : (WhitelistModuleABI as any).abi;
    return new quais.Contract(
      CONTRACT_ADDRESSES.WHITELIST_MODULE,
      abi,
      signerOrProvider || this.provider
    ) as Contract;
  }

  /**
   * Add address to whitelist
   * Note: This is a direct call (not a multisig transaction) since the module handles owner checks
   */
  async addToWhitelist(
    walletAddress: string,
    address: string,
    limit: bigint
  ): Promise<void> {
    if (!this.signer) {
      throw new Error('Signer not set. Connect wallet first.');
    }

    // Validate address format
    if (!quais.isAddress(address)) {
      throw new Error(`Invalid address format: ${address}`);
    }

    const normalizedAddress = quais.getAddress(address);
    const whitelistModule = this.getWhitelistModuleContract(this.signer);
    
    // Estimate gas and add buffer to prevent "out of gas" errors
    let estimatedGas: bigint | null = null;
    try {
      estimatedGas = await whitelistModule.addToWhitelist.estimateGas(walletAddress, normalizedAddress, limit);
      console.log('  Gas estimation for addToWhitelist succeeded:', estimatedGas.toString());
    } catch (error: any) {
      // If gas estimation fails, decode error for better message
      let errorMessage = 'Transaction would fail';
      if (error.reason) {
        errorMessage = error.reason;
      } else if (error.message) {
        errorMessage = error.message;
      }
      throw new Error(`Cannot add to whitelist: ${errorMessage}`);
    }

    // Prepare transaction options with gas limit
    const txOptions: any = {};
    if (estimatedGas) {
      // Add 100% buffer to estimated gas (doubled) to handle external calls to multisig wallet
      // The addToWhitelist function makes external calls (isOwner, modules) which can vary in gas cost
      txOptions.gasLimit = estimatedGas * 2n;
      // Ensure minimum of 400k gas even if estimation is low
      if (txOptions.gasLimit < 400000n) {
        txOptions.gasLimit = 400000n;
      }
      // Cap at 1M gas to prevent excessive limits
      if (txOptions.gasLimit > 1000000n) {
        txOptions.gasLimit = 1000000n;
      }
      console.log('  Using estimated gas with 100% buffer for addToWhitelist:', {
        estimated: estimatedGas.toString(),
        limit: txOptions.gasLimit.toString(),
      });
    } else {
      // Fallback to generous default (increased to 500k)
      txOptions.gasLimit = 500000n;
      console.warn('  Gas estimation failed for addToWhitelist, using default:', txOptions.gasLimit.toString());
    }
    
    let tx;
    try {
      tx = await whitelistModule.addToWhitelist(walletAddress, normalizedAddress, limit, txOptions);
    } catch (error: any) {
      if (error.code === 'ACTION_REJECTED' || error.code === 4001 ||
          (error.message && (error.message.includes('rejected') || error.message.includes('denied') || error.message.includes('cancelled')))) {
        throw new Error('Transaction was rejected by user');
      }
      throw error;
    }

    const receipt = await tx.wait();

    // Log actual gas used for debugging
    if (receipt.gasUsed) {
      console.log('  Actual gas used for addToWhitelist:', receipt.gasUsed.toString());
      if (txOptions.gasLimit && receipt.gasUsed > txOptions.gasLimit * 95n / 100n) {
        console.warn('  Warning: Gas usage was very close to limit!', {
          used: receipt.gasUsed.toString(),
          limit: txOptions.gasLimit.toString(),
        });
      }
    }

    // Check if transaction reverted
    if (receipt.status === 0) {
      const gasInfo = receipt.gasUsed ? ` Gas used: ${receipt.gasUsed.toString()}, Gas limit: ${txOptions.gasLimit?.toString() || 'unknown'}` : '';
      throw new Error(`Transaction execution reverted. Possible causes: address already whitelisted, module not enabled, or insufficient gas.${gasInfo}`);
    }
  }

  /**
   * Remove address from whitelist
   * Note: This is a direct call (not a multisig transaction) since the module handles owner checks
   */
  async removeFromWhitelist(walletAddress: string, address: string): Promise<void> {
    if (!this.signer) {
      throw new Error('Signer not set. Connect wallet first.');
    }

    // Validate address format
    if (!quais.isAddress(address)) {
      throw new Error(`Invalid address format: ${address}`);
    }

    const normalizedAddress = quais.getAddress(address);
    const whitelistModule = this.getWhitelistModuleContract(this.signer);
    
    // Estimate gas and add buffer to prevent "out of gas" errors
    let estimatedGas: bigint | null = null;
    try {
      estimatedGas = await whitelistModule.removeFromWhitelist.estimateGas(walletAddress, normalizedAddress);
      console.log('  Gas estimation for removeFromWhitelist succeeded:', estimatedGas.toString());
    } catch (error: any) {
      // If gas estimation fails, decode error for better message
      let errorMessage = 'Transaction would fail';
      if (error.reason) {
        errorMessage = error.reason;
      } else if (error.message) {
        errorMessage = error.message;
      }
      throw new Error(`Cannot remove from whitelist: ${errorMessage}`);
    }

    // Prepare transaction options with gas limit
    const txOptions: any = {};
    if (estimatedGas) {
      // Add 100% buffer to estimated gas (doubled) to handle external calls to multisig wallet
      // The removeFromWhitelist function makes external calls (isOwner) which can vary in gas cost
      txOptions.gasLimit = estimatedGas * 2n;
      // Ensure minimum of 400k gas even if estimation is low
      if (txOptions.gasLimit < 400000n) {
        txOptions.gasLimit = 400000n;
      }
      // Cap at 1M gas to prevent excessive limits
      if (txOptions.gasLimit > 1000000n) {
        txOptions.gasLimit = 1000000n;
      }
      console.log('  Using estimated gas with 100% buffer for removeFromWhitelist:', {
        estimated: estimatedGas.toString(),
        limit: txOptions.gasLimit.toString(),
      });
    } else {
      // Fallback to generous default (increased to 500k)
      txOptions.gasLimit = 500000n;
      console.warn('  Gas estimation failed for removeFromWhitelist, using default:', txOptions.gasLimit.toString());
    }
    
    let tx;
    try {
      tx = await whitelistModule.removeFromWhitelist(walletAddress, normalizedAddress, txOptions);
    } catch (error: any) {
      if (error.code === 'ACTION_REJECTED' || error.code === 4001 ||
          (error.message && (error.message.includes('rejected') || error.message.includes('denied') || error.message.includes('cancelled')))) {
        throw new Error('Transaction was rejected by user');
      }
      throw error;
    }

    const receipt = await tx.wait();

    // Log actual gas used for debugging
    if (receipt.gasUsed) {
      console.log('  Actual gas used for removeFromWhitelist:', receipt.gasUsed.toString());
      if (txOptions.gasLimit && receipt.gasUsed > txOptions.gasLimit * 95n / 100n) {
        console.warn('  Warning: Gas usage was very close to limit!', {
          used: receipt.gasUsed.toString(),
          limit: txOptions.gasLimit.toString(),
        });
      }
    }

    // Check if transaction reverted
    if (receipt.status === 0) {
      const gasInfo = receipt.gasUsed ? ` Gas used: ${receipt.gasUsed.toString()}, Gas limit: ${txOptions.gasLimit?.toString() || 'unknown'}` : '';
      throw new Error(`Transaction execution reverted. Possible causes: address not whitelisted, module not enabled, or insufficient gas.${gasInfo}`);
    }
  }

  /**
   * Check if address is whitelisted
   */
  async isWhitelisted(walletAddress: string, address: string): Promise<boolean> {
    const whitelistModule = this.getWhitelistModuleContract();
    return await whitelistModule.isWhitelisted(walletAddress, address);
  }

  /**
   * Get whitelist limit for an address
   */
  async getWhitelistLimit(walletAddress: string, address: string): Promise<bigint> {
    const whitelistModule = this.getWhitelistModuleContract();
    return await whitelistModule.getWhitelistLimit(walletAddress, address);
  }

  /**
   * Execute a transaction to a whitelisted address without requiring approvals
   * This bypasses the normal multisig approval process for whitelisted addresses
   */
  async executeToWhitelist(
    walletAddress: string,
    to: string,
    value: bigint,
    data: string
  ): Promise<string> {
    if (!this.signer) {
      throw new Error('Signer not set. Connect wallet first.');
    }

    // Validate address format
    if (!quais.isAddress(to)) {
      throw new Error(`Invalid recipient address format: ${to}`);
    }

    const normalizedTo = quais.getAddress(to);
    const whitelistModule = this.getWhitelistModuleContract(this.signer);

    // Check if address is whitelisted
    const isWhitelisted = await this.isWhitelisted(walletAddress, normalizedTo);
    if (!isWhitelisted) {
      throw new Error(`Address ${normalizedTo} is not whitelisted`);
    }

    // Check limit if set
    const limit = await this.getWhitelistLimit(walletAddress, normalizedTo);
    if (limit > 0n && value > limit) {
      throw new Error(`Transaction value ${value.toString()} exceeds whitelist limit ${limit.toString()}`);
    }

    // Check wallet balance before attempting execution
    const walletBalance = await this.provider.getBalance(walletAddress);
    if (walletBalance < value) {
      throw new Error(`Insufficient balance: wallet has ${walletBalance.toString()}, trying to send ${value.toString()}`);
    }

    // Execute transaction through whitelist module
    // Use explicit gas limit to prevent "not enough gas" errors
    let tx;
    let estimatedGas: bigint | null = null;
    
    // Try to estimate gas first to catch potential errors and determine gas limit
    try {
      estimatedGas = await whitelistModule.executeToWhitelist.estimateGas(walletAddress, normalizedTo, value, data);
      console.log('  Gas estimation succeeded:', estimatedGas.toString());
    } catch (error: any) {
      // Try to decode the error reason
      let errorMessage = 'Transaction would fail';
      if (error.reason) {
        errorMessage = error.reason;
      } else if (error.data) {
        try {
          const iface = whitelistModule.interface;
          const decoded = iface.parseError(error.data);
          if (decoded) {
            errorMessage = `${decoded.name}: ${decoded.args.join(', ')}`;
          }
        } catch {
          // If decoding fails, check for common error patterns
          if (error.message) {
            if (error.message.includes('insufficient funds') || error.message.includes('balance')) {
              errorMessage = `Insufficient balance in wallet`;
            } else if (error.message.includes('module not enabled')) {
              errorMessage = `Whitelist module is not enabled for this wallet`;
            } else if (error.message.includes('not whitelisted')) {
              errorMessage = `Address ${normalizedTo} is not whitelisted`;
            } else if (error.message.includes('exceeds limit')) {
              errorMessage = `Transaction value exceeds whitelist limit`;
            } else {
              errorMessage = error.message;
            }
          }
        }
      } else if (error.message) {
        errorMessage = error.message;
      }
      throw new Error(`Cannot execute transaction: ${errorMessage}`);
    }

    // Prepare transaction options with gas limit
    const txOptions: any = {};
    if (estimatedGas) {
      // Add 20% buffer to estimated gas to prevent "not enough gas" errors
      txOptions.gasLimit = (estimatedGas * 120n) / 100n;
      console.log('  Using estimated gas with 20% buffer:', txOptions.gasLimit.toString());
    } else {
      // Fallback to generous default if estimation somehow failed (shouldn't happen due to throw above)
      txOptions.gasLimit = 300000n;
      console.log('  Using default gas limit:', txOptions.gasLimit.toString());
    }
    
    try {
      tx = await whitelistModule.executeToWhitelist(walletAddress, normalizedTo, value, data, txOptions);
    } catch (error: any) {
      // Handle user rejection
      if (error.code === 'ACTION_REJECTED' || error.code === 4001 ||
          (error.message && (error.message.includes('rejected') || error.message.includes('denied') || error.message.includes('cancelled')))) {
        throw new Error('Transaction was rejected by user');
      }
      throw error;
    }

    const receipt = await tx.wait();

    // Check if transaction reverted
    if (receipt.status === 0) {
      throw new Error('Transaction execution reverted. Possible causes: insufficient balance, invalid recipient, or module not enabled.');
    }

    // Return transaction hash
    return receipt.hash;
  }

  /**
   * Check if a transaction can be executed via whitelist (address is whitelisted and within limit)
   */
  async canExecuteViaWhitelist(
    walletAddress: string,
    to: string,
    value: bigint
  ): Promise<{ canExecute: boolean; reason?: string }> {
    try {
      // Validate address format
      if (!quais.isAddress(to)) {
        return { canExecute: false, reason: 'Invalid address format' };
      }

      const normalizedTo = quais.getAddress(to);

      // Check if whitelist module is enabled
      const wallet = this.getWalletContract(walletAddress);
      const isModuleEnabled = await wallet.modules(CONTRACT_ADDRESSES.WHITELIST_MODULE);
      if (!isModuleEnabled) {
        return { canExecute: false, reason: 'Whitelist module not enabled' };
      }

      // Check if address is whitelisted
      const isWhitelisted = await this.isWhitelisted(walletAddress, normalizedTo);
      if (!isWhitelisted) {
        return { canExecute: false, reason: 'Address not whitelisted' };
      }

      // Check limit if set
      const limit = await this.getWhitelistLimit(walletAddress, normalizedTo);
      if (limit > 0n && value > limit) {
        return { canExecute: false, reason: `Value exceeds whitelist limit of ${limit.toString()}` };
      }

      // Check wallet balance
      const walletBalance = await this.provider.getBalance(walletAddress);
      if (walletBalance < value) {
        return { canExecute: false, reason: `Insufficient balance: wallet has ${walletBalance.toString()}, need ${value.toString()}` };
      }

      return { canExecute: true };
    } catch (error) {
      console.error('Error checking whitelist status:', error);
      return { canExecute: false, reason: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Get all whitelisted addresses by querying events
   */
  async getWhitelistedAddresses(walletAddress: string): Promise<Array<{ address: string; limit: bigint }>> {
    const whitelistModule = this.getWhitelistModuleContract();
    
    // Query AddressWhitelisted events
    const filter = whitelistModule.filters.AddressWhitelisted(walletAddress);
    let events: any[];
    
    try {
      // Query recent blocks - use conservative limit
      console.log(`Querying AddressWhitelisted events from last 5000 blocks`);
      events = await whitelistModule.queryFilter(filter, -5000, 'latest');
      console.log(`Found ${events.length} AddressWhitelisted events`);
    } catch (error: any) {
      console.error('Error querying AddressWhitelisted events:', error);
      if (error.message && error.message.includes('exceeds maximum limit')) {
        try {
          events = await whitelistModule.queryFilter(filter, -2000, 'latest');
        } catch (retryError) {
          console.error('Retry also failed:', retryError);
          events = [];
        }
      } else {
        events = [];
      }
    }

    // Also query removal events to filter out removed addresses
    const removalFilter = whitelistModule.filters.AddressRemovedFromWhitelist(walletAddress);
    let removalEvents: any[];
    
    try {
      removalEvents = await whitelistModule.queryFilter(removalFilter, -5000, 'latest');
    } catch (error: any) {
      if (error.message && error.message.includes('exceeds maximum limit')) {
        try {
          removalEvents = await whitelistModule.queryFilter(removalFilter, -2000, 'latest');
        } catch {
          removalEvents = [];
        }
      } else {
        removalEvents = [];
      }
    }

    // Build a map of addresses to their latest limit (by block number)
    const addressMap = new Map<string, { limit: bigint; blockNumber: number }>();
    const removedAddresses = new Map<string, number>(); // address -> block number

    // Process removal events first (track block numbers)
    for (const event of removalEvents) {
      if (event.args && event.args.addr) {
        const addr = event.args.addr.toLowerCase();
        const blockNumber = event.blockNumber;
        // Keep the latest removal event
        const existingRemoval = removedAddresses.get(addr);
        if (!existingRemoval || blockNumber > existingRemoval) {
          removedAddresses.set(addr, blockNumber);
        }
      }
    }

    // Process whitelist events (later events override earlier ones)
    for (const event of events) {
      if (event.args && event.args.addr) {
        const addr = event.args.addr.toLowerCase();
        const blockNumber = event.blockNumber;
        const removalBlock = removedAddresses.get(addr);
        
        // Only add if not removed, or if this whitelist event happened after the removal
        if (!removalBlock || blockNumber > removalBlock) {
          const existing = addressMap.get(addr);
          // Keep the latest whitelist event
          if (!existing || blockNumber > existing.blockNumber) {
            addressMap.set(addr, { limit: event.args.limit || 0n, blockNumber });
          }
        }
      }
    }

    // Convert map to array and verify on-chain status
    const result: Array<{ address: string; limit: bigint }> = [];
    const verificationPromises: Promise<void>[] = [];
    
    for (const [address, data] of addressMap.entries()) {
      // Verify the address is still whitelisted (in case events are out of order or recent)
      const verifyPromise = (async () => {
        try {
          const isStillWhitelisted = await this.isWhitelisted(walletAddress, address);
          if (isStillWhitelisted) {
            const currentLimit = await this.getWhitelistLimit(walletAddress, address);
            result.push({ address, limit: currentLimit });
          } else {
            console.log(`Address ${address} found in events but not whitelisted on-chain (may have been removed)`);
          }
        } catch (error) {
          console.error(`Error verifying whitelist status for ${address}:`, error);
          // If verification fails but we have event data, include it anyway
          // This handles cases where the event exists but RPC is slow
          result.push({ address, limit: data.limit });
        }
      })();
      verificationPromises.push(verifyPromise);
    }
    
    // Wait for all verifications to complete
    await Promise.all(verificationPromises);
    
    console.log(`Returning ${result.length} whitelisted addresses`);
    return result;
  }

  /**
   * Get daily limit module contract instance
   */
  private getDailyLimitModuleContract(signerOrProvider?: Signer | Provider): Contract {
    const abi = Array.isArray(DailyLimitModuleABI) ? DailyLimitModuleABI : (DailyLimitModuleABI as any).abi;
    return new quais.Contract(
      CONTRACT_ADDRESSES.DAILY_LIMIT_MODULE,
      abi,
      signerOrProvider || this.provider
    ) as Contract;
  }

  /**
   * Set daily spending limit
   * Note: This is a direct call (not a multisig transaction) since the module handles owner checks
   */
  async setDailyLimit(walletAddress: string, limit: bigint): Promise<void> {
    if (!this.signer) {
      throw new Error('Signer not set. Connect wallet first.');
    }

    const dailyLimitModule = this.getDailyLimitModuleContract(this.signer);

    // Estimate gas and add buffer to prevent "out of gas" errors
    let estimatedGas: bigint | null = null;
    try {
      estimatedGas = await dailyLimitModule.setDailyLimit.estimateGas(walletAddress, limit);
      console.log('  Gas estimation for setDailyLimit succeeded:', estimatedGas.toString());
    } catch (error: any) {
      let errorMessage = 'Transaction would fail';
      if (error.reason) {
        errorMessage = error.reason;
      } else if (error.message) {
        errorMessage = error.message;
      }
      throw new Error(`Cannot set daily limit: ${errorMessage}`);
    }

    // Prepare transaction options with gas limit
    const txOptions: any = {};
    if (estimatedGas) {
      txOptions.gasLimit = (estimatedGas * 120n) / 100n;
      console.log('  Using estimated gas with 20% buffer:', txOptions.gasLimit.toString());
    } else {
      txOptions.gasLimit = 200000n;
      console.log('  Using default gas limit:', txOptions.gasLimit.toString());
    }

    const tx = await dailyLimitModule.setDailyLimit(walletAddress, limit, txOptions);
    await tx.wait();
  }

  /**
   * Get daily limit configuration
   */
  async getDailyLimit(walletAddress: string): Promise<{ limit: bigint; spent: bigint; lastReset: bigint }> {
    const dailyLimitModule = this.getDailyLimitModuleContract();
    return await dailyLimitModule.getDailyLimit(walletAddress);
  }

  /**
   * Reset daily limit (manually reset spent amount)
   */
  async resetDailyLimit(walletAddress: string): Promise<void> {
    if (!this.signer) {
      throw new Error('Signer not set. Connect wallet first.');
    }

    const dailyLimitModule = this.getDailyLimitModuleContract(this.signer);

    // Estimate gas and add buffer
    let estimatedGas: bigint | null = null;
    try {
      estimatedGas = await dailyLimitModule.resetDailyLimit.estimateGas(walletAddress);
      console.log('  Gas estimation for resetDailyLimit succeeded:', estimatedGas.toString());
    } catch (error: any) {
      let errorMessage = 'Transaction would fail';
      if (error.reason) {
        errorMessage = error.reason;
      } else if (error.message) {
        errorMessage = error.message;
      }
      throw new Error(`Cannot reset daily limit: ${errorMessage}`);
    }

    // Prepare transaction options with gas limit
    const txOptions: any = {};
    if (estimatedGas) {
      txOptions.gasLimit = (estimatedGas * 120n) / 100n;
      console.log('  Using estimated gas with 20% buffer:', txOptions.gasLimit.toString());
    } else {
      txOptions.gasLimit = 200000n;
      console.log('  Using default gas limit:', txOptions.gasLimit.toString());
    }

    const tx = await dailyLimitModule.resetDailyLimit(walletAddress, txOptions);
    await tx.wait();
  }

  /**
   * Get remaining daily limit
   */
  async getRemainingLimit(walletAddress: string): Promise<bigint> {
    const dailyLimitModule = this.getDailyLimitModuleContract();
    return await dailyLimitModule.getRemainingLimit(walletAddress);
  }

  /**
   * Get time until limit resets (in seconds)
   */
  async getTimeUntilReset(walletAddress: string): Promise<bigint> {
    const dailyLimitModule = this.getDailyLimitModuleContract();
    return await dailyLimitModule.getTimeUntilReset(walletAddress);
  }

  /**
   * Execute transaction below daily limit (bypasses approval requirement)
   * Note: This is ONLY enforced in the frontend. Users can bypass this by interacting with the multisig directly.
   */
  async executeBelowLimit(
    walletAddress: string,
    to: string,
    value: bigint
  ): Promise<string> {
    if (!this.signer) {
      throw new Error('Signer not set. Connect wallet first.');
    }

    // Validate address format
    if (!quais.isAddress(to)) {
      throw new Error(`Invalid recipient address format: ${to}`);
    }

    const normalizedTo = quais.getAddress(to);
    const dailyLimitModule = this.getDailyLimitModuleContract(this.signer);

    // Check wallet balance before attempting execution
    const walletBalance = await this.provider.getBalance(walletAddress);
    if (walletBalance < value) {
      throw new Error(`Insufficient balance: wallet has ${walletBalance.toString()}, trying to send ${value.toString()}`);
    }

    // Estimate gas and add buffer
    let estimatedGas: bigint | null = null;
    try {
      estimatedGas = await dailyLimitModule.executeBelowLimit.estimateGas(walletAddress, normalizedTo, value);
      console.log('  Gas estimation for executeBelowLimit succeeded:', estimatedGas.toString());
    } catch (error: any) {
      let errorMessage = 'Transaction would fail';
      if (error.reason) {
        errorMessage = error.reason;
      } else if (error.message) {
        if (error.message.includes('exceeds daily limit')) {
          errorMessage = 'Transaction exceeds daily limit';
        } else if (error.message.includes('Daily limit not set')) {
          errorMessage = 'Daily limit is not configured';
        } else {
          errorMessage = error.message;
        }
      }
      throw new Error(`Cannot execute transaction: ${errorMessage}`);
    }

    // Prepare transaction options with gas limit
    const txOptions: any = {};
    if (estimatedGas) {
      txOptions.gasLimit = (estimatedGas * 120n) / 100n;
      console.log('  Using estimated gas with 20% buffer:', txOptions.gasLimit.toString());
    } else {
      txOptions.gasLimit = 300000n;
      console.log('  Using default gas limit:', txOptions.gasLimit.toString());
    }

    let tx;
    try {
      tx = await dailyLimitModule.executeBelowLimit(walletAddress, normalizedTo, value, txOptions);
    } catch (error: any) {
      if (error.code === 'ACTION_REJECTED' || error.code === 4001 ||
          (error.message && (error.message.includes('rejected') || error.message.includes('denied') || error.message.includes('cancelled')))) {
        throw new Error('Transaction was rejected by user');
      }
      throw error;
    }

    const receipt = await tx.wait();

    // Check if transaction reverted
    if (receipt.status === 0) {
      throw new Error('Transaction execution reverted. Possible causes: exceeds daily limit, insufficient balance, or module not enabled.');
    }

    return receipt.hash;
  }

  /**
   * Check if a transaction can be executed via daily limit
   * Note: This is ONLY enforced in the frontend. Users can bypass this by interacting with the multisig directly.
   */
  async canExecuteViaDailyLimit(
    walletAddress: string,
    value: bigint
  ): Promise<{ canExecute: boolean; reason?: string }> {
    try {
      // Check if daily limit module is enabled
      const wallet = this.getWalletContract(walletAddress);
      const isModuleEnabled = await wallet.modules(CONTRACT_ADDRESSES.DAILY_LIMIT_MODULE);
      if (!isModuleEnabled) {
        return { canExecute: false, reason: 'Daily limit module not enabled' };
      }

      // Check if daily limit is set
      const dailyLimit = await this.getDailyLimit(walletAddress);
      if (dailyLimit.limit === 0n) {
        return { canExecute: false, reason: 'Daily limit not configured' };
      }

      // Check remaining limit
      const remainingLimit = await this.getRemainingLimit(walletAddress);
      if (remainingLimit < value) {
        return { canExecute: false, reason: `Transaction value exceeds remaining daily limit of ${transactionBuilderService.formatValue(remainingLimit)} QUAI` };
      }

      // Check wallet balance
      const walletBalance = await this.provider.getBalance(walletAddress);
      if (walletBalance < value) {
        return { canExecute: false, reason: `Insufficient balance: wallet has ${walletBalance.toString()}, need ${value.toString()}` };
      }

      return { canExecute: true };
    } catch (error) {
      console.error('Error checking daily limit status:', error);
      return { canExecute: false, reason: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Get wallet contract instance
   */
  private getWalletContract(walletAddress: string, signerOrProvider?: Signer | Provider): Contract {
    return new quais.Contract(
      walletAddress,
      MultisigWalletABI.abi,
      signerOrProvider || this.provider
    ) as Contract;
  }

  /**
   * Get social recovery module contract instance
   */
  private getSocialRecoveryModuleContract(signerOrProvider?: Signer | Provider): Contract {
    const abi = Array.isArray(SocialRecoveryModuleABI) ? SocialRecoveryModuleABI : (SocialRecoveryModuleABI as any).abi;
    return new quais.Contract(
      CONTRACT_ADDRESSES.SOCIAL_RECOVERY_MODULE,
      abi,
      signerOrProvider || this.provider
    ) as Contract;
  }

  /**
   * Get recovery configuration for a wallet
   */
  async getRecoveryConfig(walletAddress: string): Promise<{
    guardians: string[];
    threshold: bigint;
    recoveryPeriod: bigint;
  }> {
    const socialRecoveryModule = this.getSocialRecoveryModuleContract();
    const config = await socialRecoveryModule.getRecoveryConfig(walletAddress);
    return {
      guardians: config.guardians || [],
      threshold: config.threshold || 0n,
      recoveryPeriod: config.recoveryPeriod || 0n,
    };
  }

  /**
   * Setup recovery configuration
   * Note: This is a direct call (not a multisig transaction) since the module handles owner checks
   */
  async setupRecovery(
    walletAddress: string,
    guardians: string[],
    threshold: number,
    recoveryPeriodDays: number
  ): Promise<void> {
    if (!this.signer) {
      throw new Error('Signer not set. Connect wallet first.');
    }

    // Validate guardians
    const normalizedGuardians = guardians.map(addr => {
      if (!quais.isAddress(addr)) {
        throw new Error(`Invalid guardian address format: ${addr}`);
      }
      return quais.getAddress(addr);
    });

    // Validate threshold
    if (threshold < 1 || threshold > normalizedGuardians.length) {
      throw new Error(`Invalid threshold: must be between 1 and ${normalizedGuardians.length}`);
    }

    // Convert days to seconds (minimum 1 day = 86400 seconds)
    const recoveryPeriodSeconds = BigInt(recoveryPeriodDays) * 86400n;
    if (recoveryPeriodSeconds < 86400n) {
      throw new Error('Recovery period must be at least 1 day');
    }

    const socialRecoveryModule = this.getSocialRecoveryModuleContract(this.signer);

    // Estimate gas and add buffer
    let estimatedGas: bigint | null = null;
    try {
      estimatedGas = await socialRecoveryModule.setupRecovery.estimateGas(
        walletAddress,
        normalizedGuardians,
        threshold,
        recoveryPeriodSeconds
      );
      console.log('  Gas estimation for setupRecovery succeeded:', estimatedGas.toString());
    } catch (error: any) {
      let errorMessage = 'Transaction would fail';
      if (error.reason) {
        errorMessage = error.reason;
      } else if (error.message) {
        errorMessage = error.message;
      }
      throw new Error(`Cannot setup recovery: ${errorMessage}`);
    }

    // Prepare transaction options with gas limit
    const txOptions: any = {};
    if (estimatedGas) {
      // Add 100% buffer to estimated gas
      txOptions.gasLimit = estimatedGas * 2n;
      if (txOptions.gasLimit < 400000n) {
        txOptions.gasLimit = 400000n;
      }
      if (txOptions.gasLimit > 1000000n) {
        txOptions.gasLimit = 1000000n;
      }
      console.log('  Using estimated gas with 100% buffer for setupRecovery:', txOptions.gasLimit.toString());
    } else {
      txOptions.gasLimit = 500000n;
      console.warn('  Gas estimation failed for setupRecovery, using default:', txOptions.gasLimit.toString());
    }

    let tx;
    try {
      tx = await socialRecoveryModule.setupRecovery(
        walletAddress,
        normalizedGuardians,
        threshold,
        recoveryPeriodSeconds,
        txOptions
      );
    } catch (error: any) {
      if (error.code === 'ACTION_REJECTED' || error.code === 4001 ||
          (error.message && (error.message.includes('rejected') || error.message.includes('denied') || error.message.includes('cancelled')))) {
        throw new Error('Transaction was rejected by user');
      }
      throw error;
    }

    const receipt = await tx.wait();

    if (receipt.status === 0) {
      throw new Error('Transaction execution reverted. Possible causes: invalid guardians, threshold, or recovery period.');
    }
  }

  /**
   * Check if an address is a guardian for a wallet
   */
  async isGuardian(walletAddress: string, address: string): Promise<boolean> {
    const socialRecoveryModule = this.getSocialRecoveryModuleContract();
    return await socialRecoveryModule.isGuardian(walletAddress, address);
  }

  /**
   * Check if an address has approved a recovery
   * Note: With the nonce-based recovery hash, each recovery has a unique hash,
   * so stale approvals from cancelled recoveries won't interfere.
   */
  async hasApprovedRecovery(walletAddress: string, recoveryHash: string, address: string): Promise<boolean> {
    const socialRecoveryModule = this.getSocialRecoveryModuleContract();
    
    console.log(`hasApprovedRecovery: Checking approval for wallet ${walletAddress}, recovery ${recoveryHash.slice(0, 10)}..., address ${address}`);
    
    // First verify the recovery is actually active
    try {
      const recovery = await this.getRecovery(walletAddress, recoveryHash);
      console.log(`hasApprovedRecovery: Recovery state - executionTime: ${recovery.executionTime}, executed: ${recovery.executed}, approvalCount: ${recovery.approvalCount}`);
      
      // If recovery doesn't exist (executionTime == 0), it was cancelled - no approvals count
      if (recovery.executionTime === 0n) {
        console.log(`hasApprovedRecovery: Recovery has executionTime 0, returning false`);
        return false;
      }
      
      if (recovery.executed) {
        console.log(`hasApprovedRecovery: Recovery already executed, returning false`);
        return false;
      }
    } catch (error) {
      // If we can't fetch recovery, assume approval is invalid
      console.warn(`hasApprovedRecovery: Could not verify recovery state for ${recoveryHash}, assuming not approved:`, error);
      return false;
    }
    
    // Check the approval status - with nonce-based hashes, this should be accurate
    try {
      const hasApproved = await socialRecoveryModule.recoveryApprovals(walletAddress, recoveryHash, address);
      console.log(`hasApprovedRecovery: Approval status from contract: ${hasApproved}`);
      
      // Double-check: If approvalCount is 0 but hasApproved is true, it's a stale approval
      // This can happen if the contract wasn't redeployed with nonce changes
      const recovery = await this.getRecovery(walletAddress, recoveryHash);
      if (hasApproved && recovery.approvalCount === 0n) {
        console.warn(`hasApprovedRecovery: Stale approval detected - hasApproved=true but approvalCount=0. This suggests the contract may not have nonce-based hashes yet.`);
        // Return false to allow approval, but the contract call will likely fail
        // The user will see the actual error from the contract
        return false;
      }
      
      return hasApproved;
    } catch (error) {
      console.error(`hasApprovedRecovery: Error checking approval status:`, error);
      return false;
    }
  }

  /**
   * Get recovery hash for given parameters with current nonce
   * Note: The contract will increment the nonce when initiating, so this gives the hash for the next recovery
   */
  async getRecoveryHash(
    walletAddress: string,
    newOwners: string[],
    newThreshold: number
  ): Promise<string> {
    const socialRecoveryModule = this.getSocialRecoveryModuleContract();
    const normalizedOwners = newOwners.map(addr => quais.getAddress(addr));
    return await socialRecoveryModule.getRecoveryHashForCurrentNonce(walletAddress, normalizedOwners, newThreshold);
  }

  /**
   * Get recovery details
   */
  async getRecovery(
    walletAddress: string,
    recoveryHash: string
  ): Promise<{
    newOwners: string[];
    newThreshold: bigint;
    approvalCount: bigint;
    executionTime: bigint;
    executed: boolean;
  }> {
    const socialRecoveryModule = this.getSocialRecoveryModuleContract();
    const recovery = await socialRecoveryModule.getRecovery(walletAddress, recoveryHash);
    return {
      newOwners: recovery.newOwners || [],
      newThreshold: recovery.newThreshold || 0n,
      approvalCount: recovery.approvalCount || 0n,
      executionTime: recovery.executionTime || 0n,
      executed: recovery.executed || false,
    };
  }

  /**
   * Initiate recovery (guardians only)
   */
  async initiateRecovery(
    walletAddress: string,
    newOwners: string[],
    newThreshold: number
  ): Promise<string> {
    if (!this.signer) {
      throw new Error('Signer not set. Connect wallet first.');
    }

    const normalizedOwners = newOwners.map(addr => {
      if (!quais.isAddress(addr)) {
        throw new Error(`Invalid owner address format: ${addr}`);
      }
      return quais.getAddress(addr);
    });

    if (normalizedOwners.length === 0) {
      throw new Error('At least one new owner is required');
    }

    if (newThreshold < 1 || newThreshold > normalizedOwners.length) {
      throw new Error(`Invalid threshold: must be between 1 and ${normalizedOwners.length}`);
    }

    const socialRecoveryModule = this.getSocialRecoveryModuleContract(this.signer);

    // Estimate gas
    let estimatedGas: bigint | null = null;
    try {
      estimatedGas = await socialRecoveryModule.initiateRecovery.estimateGas(
        walletAddress,
        normalizedOwners,
        newThreshold
      );
    } catch (error: any) {
      let errorMessage = 'Transaction would fail';
      if (error.reason) {
        errorMessage = error.reason;
      } else if (error.message) {
        errorMessage = error.message;
      }
      throw new Error(`Cannot initiate recovery: ${errorMessage}`);
    }

    const txOptions: any = {};
    if (estimatedGas) {
      txOptions.gasLimit = estimatedGas * 2n;
      if (txOptions.gasLimit < 400000n) {
        txOptions.gasLimit = 400000n;
      }
      if (txOptions.gasLimit > 1000000n) {
        txOptions.gasLimit = 1000000n;
      }
    } else {
      txOptions.gasLimit = 500000n;
    }

    let tx;
    try {
      tx = await socialRecoveryModule.initiateRecovery(
        walletAddress,
        normalizedOwners,
        newThreshold,
        txOptions
      );
    } catch (error: any) {
      if (error.code === 'ACTION_REJECTED' || error.code === 4001 ||
          (error.message && (error.message.includes('rejected') || error.message.includes('denied') || error.message.includes('cancelled')))) {
        throw new Error('Transaction was rejected by user');
      }
      throw error;
    }

    const receipt = await tx.wait();
    if (receipt.status === 0) {
      throw new Error('Transaction execution reverted');
    }

    // Get recovery hash from event logs (contract now includes nonce in hash)
    let recoveryHash: string | null = null;
    if (receipt.logs) {
      const socialRecoveryModule = this.getSocialRecoveryModuleContract();
      for (const log of receipt.logs) {
        try {
          const parsedLog = socialRecoveryModule.interface.parseLog(log);
          if (parsedLog && parsedLog.name === 'RecoveryInitiated') {
            recoveryHash = parsedLog.args.recoveryHash;
            console.log('Found recovery hash from event:', recoveryHash);
            break;
          }
        } catch (error) {
          // Not a RecoveryInitiated event, continue
        }
      }
    }

    // The contract also returns the recovery hash, but we prefer getting it from events
    // If not found in events, try to get it from the transaction return value
    if (!recoveryHash) {
      try {
        // The contract's initiateRecovery returns the recovery hash
        // But since we already waited for the receipt, we need to get it from events
        // If events parsing failed, we can't reliably get the hash
        throw new Error('Could not extract recovery hash from transaction events');
      } catch (error) {
        console.error('Failed to get recovery hash:', error);
        throw new Error('Failed to get recovery hash from transaction. Please check the transaction receipt.');
      }
    }

    return recoveryHash;
  }

  /**
   * Approve recovery (guardians only)
   */
  async approveRecovery(walletAddress: string, recoveryHash: string): Promise<void> {
    if (!this.signer) {
      throw new Error('Signer not set. Connect wallet first.');
    }

    const socialRecoveryModule = this.getSocialRecoveryModuleContract(this.signer);
    const signerAddress = await this.signer.getAddress();

    // Check if recovery is active and if user has already approved
    try {
      const recovery = await this.getRecovery(walletAddress, recoveryHash);
      if (recovery.executionTime === 0n) {
        throw new Error('Recovery has been cancelled or does not exist');
      }
      if (recovery.executed) {
        throw new Error('Recovery has already been executed');
      }
      
      // Check approval status - with nonce-based hashes, each recovery has a unique hash
      // so stale approvals from cancelled recoveries won't interfere
      const hasApproved = await socialRecoveryModule.recoveryApprovals(walletAddress, recoveryHash, signerAddress);
      if (hasApproved) {
        throw new Error('You have already approved this recovery');
      }
    } catch (error: any) {
      // If it's already our custom error, re-throw it
      if (error.message && (error.message.includes('cancelled') || error.message.includes('already approved'))) {
        throw error;
      }
      // Otherwise, continue to gas estimation which might give more details
    }

    let estimatedGas: bigint | null = null;
    try {
      estimatedGas = await socialRecoveryModule.approveRecovery.estimateGas(walletAddress, recoveryHash);
    } catch (error: any) {
      let errorMessage = 'Transaction would fail';
      
      // Try to decode the revert reason
      if (error.data) {
        try {
          const decoded = socialRecoveryModule.interface.parseError(error.data);
          if (decoded) {
            errorMessage = decoded.name;
            if (decoded.args && decoded.args.length > 0) {
              errorMessage += `: ${decoded.args[0]}`;
            }
          }
        } catch (decodeError) {
          // If decoding fails, try to get reason from error
          if (error.reason) {
            errorMessage = error.reason;
          } else if (error.message) {
            errorMessage = error.message;
          }
        }
      } else if (error.reason) {
        errorMessage = error.reason;
      } else if (error.message) {
        errorMessage = error.message;
        // Check for common revert reasons in the message
        if (error.message.includes('Already approved') || error.message.includes('already approved')) {
          errorMessage = 'You have already approved this recovery. If you previously approved a recovery with the same parameters that was cancelled, you cannot approve a new recovery with identical parameters due to a contract limitation.';
        } else if (error.message.includes('Not a guardian')) {
          errorMessage = 'You are not a guardian for this wallet';
        } else if (error.message.includes('Recovery not initiated')) {
          errorMessage = 'This recovery has been cancelled or does not exist';
        } else if (error.message.includes('Recovery already executed')) {
          errorMessage = 'This recovery has already been executed';
        }
      }
      
      throw new Error(`Cannot approve recovery: ${errorMessage}`);
    }

    const txOptions: any = {};
    if (estimatedGas) {
      txOptions.gasLimit = estimatedGas * 2n;
      if (txOptions.gasLimit < 200000n) {
        txOptions.gasLimit = 200000n;
      }
    } else {
      txOptions.gasLimit = 300000n;
    }

    let tx;
    try {
      tx = await socialRecoveryModule.approveRecovery(walletAddress, recoveryHash, txOptions);
    } catch (error: any) {
      if (error.code === 'ACTION_REJECTED' || error.code === 4001 ||
          (error.message && (error.message.includes('rejected') || error.message.includes('denied') || error.message.includes('cancelled')))) {
        throw new Error('Transaction was rejected by user');
      }
      throw error;
    }

    const receipt = await tx.wait();
    if (receipt.status === 0) {
      throw new Error('Transaction execution reverted');
    }
  }

  /**
   * Execute recovery (anyone, once conditions met)
   */
  async executeRecovery(walletAddress: string, recoveryHash: string): Promise<void> {
    if (!this.signer) {
      throw new Error('Signer not set. Connect wallet first.');
    }

    const socialRecoveryModule = this.getSocialRecoveryModuleContract(this.signer);

    let estimatedGas: bigint | null = null;
    try {
      estimatedGas = await socialRecoveryModule.executeRecovery.estimateGas(walletAddress, recoveryHash);
    } catch (error: any) {
      let errorMessage = 'Transaction would fail';
      if (error.reason) {
        errorMessage = error.reason;
      } else if (error.message) {
        errorMessage = error.message;
      }
      throw new Error(`Cannot execute recovery: ${errorMessage}`);
    }

    const txOptions: any = {};
    if (estimatedGas) {
      txOptions.gasLimit = estimatedGas * 2n;
      if (txOptions.gasLimit < 500000n) {
        txOptions.gasLimit = 500000n;
      }
      if (txOptions.gasLimit > 2000000n) {
        txOptions.gasLimit = 2000000n;
      }
    } else {
      txOptions.gasLimit = 1000000n;
    }

    let tx;
    try {
      tx = await socialRecoveryModule.executeRecovery(walletAddress, recoveryHash, txOptions);
    } catch (error: any) {
      if (error.code === 'ACTION_REJECTED' || error.code === 4001 ||
          (error.message && (error.message.includes('rejected') || error.message.includes('denied') || error.message.includes('cancelled')))) {
        throw new Error('Transaction was rejected by user');
      }
      throw error;
    }

    const receipt = await tx.wait();
    if (receipt.status === 0) {
      throw new Error('Transaction execution reverted');
    }
  }

  /**
   * Cancel recovery (owners only)
   */
  async cancelRecovery(walletAddress: string, recoveryHash: string): Promise<void> {
    if (!this.signer) {
      throw new Error('Signer not set. Connect wallet first.');
    }

    const socialRecoveryModule = this.getSocialRecoveryModuleContract(this.signer);

    let estimatedGas: bigint | null = null;
    try {
      estimatedGas = await socialRecoveryModule.cancelRecovery.estimateGas(walletAddress, recoveryHash);
    } catch (error: any) {
      let errorMessage = 'Transaction would fail';
      if (error.reason) {
        errorMessage = error.reason;
      } else if (error.message) {
        errorMessage = error.message;
      }
      throw new Error(`Cannot cancel recovery: ${errorMessage}`);
    }

    const txOptions: any = {};
    if (estimatedGas) {
      txOptions.gasLimit = estimatedGas * 2n;
      if (txOptions.gasLimit < 200000n) {
        txOptions.gasLimit = 200000n;
      }
    } else {
      txOptions.gasLimit = 300000n;
    }

    let tx;
    try {
      tx = await socialRecoveryModule.cancelRecovery(walletAddress, recoveryHash, txOptions);
    } catch (error: any) {
      if (error.code === 'ACTION_REJECTED' || error.code === 4001 ||
          (error.message && (error.message.includes('rejected') || error.message.includes('denied') || error.message.includes('cancelled')))) {
        throw new Error('Transaction was rejected by user');
      }
      throw error;
    }

    const receipt = await tx.wait();
    if (receipt.status === 0) {
      throw new Error('Transaction execution reverted');
    }
  }

  /**
   * Get all pending recoveries by querying events
   */
  async getPendingRecoveries(walletAddress: string): Promise<Array<{
    recoveryHash: string;
    newOwners: string[];
    newThreshold: bigint;
    approvalCount: bigint;
    executionTime: bigint;
    executed: boolean;
  }>> {
    const socialRecoveryModule = this.getSocialRecoveryModuleContract();
    
    // Query RecoveryInitiated events - use relative block numbers for better compatibility
    const filter = socialRecoveryModule.filters.RecoveryInitiated(walletAddress);
    let events: any[];
    
    try {
      // Query from 5000 blocks ago to latest
      events = await socialRecoveryModule.queryFilter(filter, -5000, 'latest');
      console.log(`Found ${events.length} RecoveryInitiated events for wallet ${walletAddress}`);
    } catch (error: any) {
      console.error('Error querying RecoveryInitiated events:', error);
      if (error.message && error.message.includes('exceeds maximum limit')) {
        try {
          // Try with a smaller range
          events = await socialRecoveryModule.queryFilter(filter, -2000, 'latest');
          console.log(`Found ${events.length} RecoveryInitiated events (smaller range) for wallet ${walletAddress}`);
        } catch (innerError) {
          console.error('Error querying RecoveryInitiated events with smaller range:', innerError);
          events = [];
        }
      } else {
        events = [];
      }
    }

    // Note: We don't query cancelled/executed events anymore because:
    // 1. Same recovery hash can be re-initiated after cancellation
    // 2. On-chain state (executionTime === 0) is the source of truth for cancelled recoveries
    // 3. On-chain state (executed flag) is the source of truth for executed recoveries

    // Get recovery details for each initiated recovery
    const recoveries: Array<{
      recoveryHash: string;
      newOwners: string[];
      newThreshold: bigint;
      approvalCount: bigint;
      executionTime: bigint;
      executed: boolean;
    }> = [];

    console.log(`Processing ${events.length} RecoveryInitiated events`);
    
    // Process all events, but check on-chain state to determine if recovery is active
    // Same recovery hash can appear multiple times if recovery was cancelled and re-initiated
    for (const event of events) {
      const recoveryHash = event.args?.recoveryHash;
      if (!recoveryHash) {
        console.warn('RecoveryInitiated event missing recoveryHash:', event);
        console.warn('Event args:', event.args);
        continue;
      }
      
      const hashLower = recoveryHash.toLowerCase();
      console.log(`Processing recovery hash: ${recoveryHash}`);
      
      // Check on-chain state - this is the source of truth
      // Don't rely on cancelled/executed events since recovery can be re-initiated
      try {
        console.log(`Fetching recovery details for ${recoveryHash}`);
        const recovery = await this.getRecovery(walletAddress, recoveryHash);
        console.log(`Recovery details:`, recovery);
        
        // Check if recovery exists (executionTime != 0 means it was initiated and not cancelled)
        // If executionTime is 0, the recovery was cancelled (delete sets it to 0)
        if (recovery.executionTime === 0n) {
          console.log(`Recovery ${recoveryHash} has executionTime 0, cancelled or invalid - skipping`);
          continue;
        }
        
        // If executed flag is true, skip it
        if (recovery.executed) {
          console.log(`Recovery ${recoveryHash} is already executed, skipping`);
          continue;
        }
        
        // Recovery exists and is active - include it
        // Check if we already added this recovery hash (avoid duplicates)
        const alreadyAdded = recoveries.some(r => r.recoveryHash.toLowerCase() === hashLower);
        if (!alreadyAdded) {
          recoveries.push({
            recoveryHash,
            ...recovery,
          });
          console.log(`Added recovery ${recoveryHash} to list`);
        } else {
          console.log(`Recovery ${recoveryHash} already in list, skipping duplicate`);
        }
      } catch (error) {
        console.error(`Error fetching recovery ${recoveryHash}:`, error);
        // If we can't fetch recovery details, we can't determine if it's active
        // Skip it to avoid showing invalid recoveries
        continue;
      }
    }

    console.log(`Returning ${recoveries.length} pending recoveries`);
    return recoveries;
  }
}

// Singleton instance
export const multisigService = new MultisigService();
