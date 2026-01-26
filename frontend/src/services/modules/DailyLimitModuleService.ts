import * as quais from 'quais';
import type { Contract, Signer, Provider } from '../../types';
import { CONTRACT_ADDRESSES } from '../../config/contracts';
import { BaseService } from '../core/BaseService';
import { transactionBuilderService } from '../TransactionBuilderService';
import {
  isUserRejection,
  validateAddress,
} from '../utils/TransactionErrorHandler';
import {
  estimateGasWithBuffer,
  estimateGasOrThrow,
  buildTxOptions,
  GasPresets,
} from '../utils/GasEstimator';
import DailyLimitModuleABI from '../../config/abi/DailyLimitModule.json';

/**
 * Service for daily limit module operations
 */
export class DailyLimitModuleService extends BaseService {

  constructor(provider?: Provider) {
    super(provider);
  }

  /**
   * Get daily limit module contract instance
   */
  private getModuleContract(signerOrProvider?: Signer | Provider): Contract {
    const abi = Array.isArray(DailyLimitModuleABI) ? DailyLimitModuleABI : (DailyLimitModuleABI as any).abi;
    return new quais.Contract(
      CONTRACT_ADDRESSES.DAILY_LIMIT_MODULE,
      abi,
      signerOrProvider || this.provider
    ) as Contract;
  }

  /**
   * Set daily spending limit
   */
  async setDailyLimit(walletAddress: string, limit: bigint): Promise<void> {
    const signer = this.requireSigner();
    const module = this.getModuleContract(signer);

    await estimateGasOrThrow(
      module.setDailyLimit,
      [walletAddress, limit],
      'set daily limit',
      module
    );

    const { gasLimit } = await estimateGasWithBuffer(
      module.setDailyLimit,
      [walletAddress, limit],
      GasPresets.standard
    );

    const tx = await module.setDailyLimit(walletAddress, limit, buildTxOptions(gasLimit));
    await tx.wait();
  }

  /**
   * Get daily limit configuration
   */
  async getDailyLimit(walletAddress: string): Promise<{ limit: bigint; spent: bigint; lastReset: bigint }> {
    const module = this.getModuleContract();
    return await module.getDailyLimit(walletAddress);
  }

  /**
   * Reset daily limit (manually reset spent amount)
   */
  async resetDailyLimit(walletAddress: string): Promise<void> {
    const signer = this.requireSigner();
    const module = this.getModuleContract(signer);

    await estimateGasOrThrow(
      module.resetDailyLimit,
      [walletAddress],
      'reset daily limit',
      module
    );

    const { gasLimit } = await estimateGasWithBuffer(
      module.resetDailyLimit,
      [walletAddress],
      GasPresets.standard
    );

    const tx = await module.resetDailyLimit(walletAddress, buildTxOptions(gasLimit));
    await tx.wait();
  }

  /**
   * Get remaining daily limit
   */
  async getRemainingLimit(walletAddress: string): Promise<bigint> {
    const module = this.getModuleContract();
    return await module.getRemainingLimit(walletAddress);
  }

  /**
   * Get time until limit resets (in seconds)
   */
  async getTimeUntilReset(walletAddress: string): Promise<bigint> {
    const module = this.getModuleContract();
    return await module.getTimeUntilReset(walletAddress);
  }

  /**
   * Execute transaction below daily limit (bypasses approval requirement)
   */
  async executeBelowLimit(
    walletAddress: string,
    to: string,
    value: bigint
  ): Promise<string> {
    const signer = this.requireSigner();
    const normalizedTo = validateAddress(to);
    const module = this.getModuleContract(signer);

    // Check wallet balance
    const walletBalance = await this.provider.getBalance(walletAddress);
    if (walletBalance < value) {
      throw new Error(`Insufficient balance: wallet has ${walletBalance.toString()}, trying to send ${value.toString()}`);
    }

    // Estimate gas - will throw with descriptive error if validation fails
    await estimateGasOrThrow(
      module.executeBelowLimit,
      [walletAddress, normalizedTo, value],
      'execute below limit',
      module
    );

    const { gasLimit } = await estimateGasWithBuffer(
      module.executeBelowLimit,
      [walletAddress, normalizedTo, value],
      GasPresets.standard
    );

    let tx;
    try {
      tx = await module.executeBelowLimit(walletAddress, normalizedTo, value, buildTxOptions(gasLimit));
    } catch (error: any) {
      if (isUserRejection(error)) {
        throw new Error('Transaction was rejected by user');
      }
      throw error;
    }

    const receipt = await tx.wait();

    if (receipt.status === 0) {
      throw new Error('Transaction reverted. Possible causes: exceeds daily limit, insufficient balance, or module not enabled.');
    }

    return receipt.hash;
  }

  /**
   * Check if a transaction can be executed via daily limit
   */
  async canExecuteViaDailyLimit(
    walletAddress: string,
    value: bigint
  ): Promise<{ canExecute: boolean; reason?: string }> {
    try {
      const wallet = this.getWalletContract(walletAddress);

      // Check if module is enabled
      const isModuleEnabled = await wallet.modules(CONTRACT_ADDRESSES.DAILY_LIMIT_MODULE);
      if (!isModuleEnabled) {
        return { canExecute: false, reason: 'Daily limit module not enabled' };
      }

      // Check if limit is configured
      const dailyLimit = await this.getDailyLimit(walletAddress);
      if (dailyLimit.limit === 0n) {
        return { canExecute: false, reason: 'Daily limit not configured' };
      }

      // Check remaining limit
      const remainingLimit = await this.getRemainingLimit(walletAddress);
      if (remainingLimit < value) {
        return {
          canExecute: false,
          reason: `Transaction value exceeds remaining daily limit of ${transactionBuilderService.formatValue(remainingLimit)} QUAI`,
        };
      }

      // Check wallet balance
      const walletBalance = await this.provider.getBalance(walletAddress);
      if (walletBalance < value) {
        return { canExecute: false, reason: 'Insufficient balance' };
      }

      return { canExecute: true };
    } catch (error) {
      return { canExecute: false, reason: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}
