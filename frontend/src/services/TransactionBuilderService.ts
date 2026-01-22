import * as quais from 'quais';
import type { TransactionData, DecodedTransaction, ValidationResult } from '../types';

export class TransactionBuilderService {
  /**
   * Build a simple transfer transaction
   */
  buildTransfer(to: string, value: bigint): TransactionData {
    return {
      to,
      value,
      data: '0x',
    };
  }

  /**
   * Build a contract interaction transaction
   */
  buildContractCall(
    contractAddress: string,
    abi: any[],
    functionName: string,
    args: any[],
    value: bigint = 0n
  ): TransactionData {
    const iface = new quais.Interface(abi);
    const data = iface.encodeFunctionData(functionName, args);

    return {
      to: contractAddress,
      value,
      data,
    };
  }

  /**
   * Build transaction to add an owner
   */
  buildAddOwner(newOwner: string): TransactionData {
    const iface = new quais.Interface([
      'function addOwner(address owner)',
    ]);

    return {
      to: '', // Will be set to wallet address
      value: 0n,
      data: iface.encodeFunctionData('addOwner', [newOwner]),
    };
  }

  /**
   * Build transaction to remove an owner
   */
  buildRemoveOwner(owner: string): TransactionData {
    const iface = new quais.Interface([
      'function removeOwner(address owner)',
    ]);

    return {
      to: '', // Will be set to wallet address
      value: 0n,
      data: iface.encodeFunctionData('removeOwner', [owner]),
    };
  }

  /**
   * Build transaction to change threshold
   */
  buildChangeThreshold(newThreshold: number): TransactionData {
    const iface = new quais.Interface([
      'function changeThreshold(uint256 threshold)',
    ]);

    return {
      to: '', // Will be set to wallet address
      value: 0n,
      data: iface.encodeFunctionData('changeThreshold', [newThreshold]),
    };
  }

  /**
   * Build transaction to enable a module
   */
  buildEnableModule(moduleAddress: string): TransactionData {
    const iface = new quais.Interface([
      'function enableModule(address module)',
    ]);

    return {
      to: '', // Will be set to wallet address
      value: 0n,
      data: iface.encodeFunctionData('enableModule', [moduleAddress]),
    };
  }

  /**
   * Build transaction to disable a module
   */
  buildDisableModule(moduleAddress: string): TransactionData {
    const iface = new quais.Interface([
      'function disableModule(address module)',
    ]);

    return {
      to: '', // Will be set to wallet address
      value: 0n,
      data: iface.encodeFunctionData('disableModule', [moduleAddress]),
    };
  }

  /**
   * Decode transaction data
   */
  decodeTransaction(data: string, abi: any[]): DecodedTransaction | null {
    if (data === '0x' || data === '') {
      return {
        method: 'transfer',
        params: [],
      };
    }

    try {
      const iface = new quais.Interface(abi);
      const decoded = iface.parseTransaction({ data });

      if (!decoded) {
        return null;
      }

      return {
        method: decoded.name,
        params: decoded.args.map((arg, index) => ({
          name: decoded.fragment.inputs[index].name,
          type: decoded.fragment.inputs[index].type,
          value: arg,
        })),
      };
    } catch (error) {
      console.error('Failed to decode transaction:', error);
      return null;
    }
  }

  /**
   * Validate transaction data
   */
  validateTransaction(tx: TransactionData): ValidationResult {
    const errors: string[] = [];

    // Validate address
    if (!tx.to || !quais.isAddress(tx.to)) {
      errors.push('Invalid recipient address');
    }

    // Validate value
    if (tx.value < 0n) {
      errors.push('Value cannot be negative');
    }

    // Validate data format
    if (tx.data && !quais.isHexString(tx.data)) {
      errors.push('Invalid transaction data format');
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Estimate gas for transaction
   */
  async estimateGas(
    provider: quais.Provider,
    from: string,
    tx: TransactionData
  ): Promise<bigint> {
    try {
      return await provider.estimateGas({
        from,
        to: tx.to,
        value: tx.value,
        data: tx.data,
      });
    } catch (error) {
      console.error('Failed to estimate gas:', error);
      throw new Error('Gas estimation failed');
    }
  }

  /**
   * Format transaction for display
   */
  formatTransaction(tx: TransactionData, decoded?: DecodedTransaction | null): string {
    if (!decoded || decoded.method === 'transfer') {
      return `Transfer ${quais.formatQuai(tx.value)} QUAI to ${tx.to}`;
    }

    const params = decoded.params
      .map((p: any) => `${p.name}: ${p.value}`)
      .join(', ');

    return `${decoded.method}(${params})`;
  }

  /**
   * Parse transaction value from string
   */
  parseValue(value: string): bigint {
    try {
      return quais.parseQuai(value);
    } catch (error) {
      throw new Error('Invalid value format');
    }
  }

  /**
   * Format value for display
   */
  formatValue(value: bigint, decimals: number = 4): string {
    return parseFloat(quais.formatQuai(value)).toFixed(decimals);
  }

  /**
   * Build batch transaction data (for future enhancement)
   */
  buildBatchTransaction(transactions: TransactionData[]): TransactionData {
    // This would encode multiple transactions into a single multicall
    // For now, return the first transaction
    // TODO: Implement multicall pattern
    if (transactions.length === 0) {
      throw new Error('No transactions provided');
    }

    return transactions[0];
  }

  /**
   * Compute transaction hash for proposal
   */
  computeTransactionHash(
    to: string,
    value: bigint,
    data: string,
    nonce: bigint
  ): string {
    return quais.keccak256(
      quais.solidityPacked(
        ['address', 'uint256', 'bytes', 'uint256'],
        [to, value, data, nonce]
      )
    );
  }
}

// Singleton instance
export const transactionBuilderService = new TransactionBuilderService();
