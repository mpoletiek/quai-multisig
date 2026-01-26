import type { Provider, Signer } from '../types';
import type { WalletInfo, DeploymentConfig, Transaction, PendingTransaction } from '../types';

// Import specialized services
import { WalletService } from './core/WalletService';
import { TransactionService } from './core/TransactionService';
import { OwnerService } from './core/OwnerService';
import { WhitelistModuleService } from './modules/WhitelistModuleService';
import { DailyLimitModuleService } from './modules/DailyLimitModuleService';
import { SocialRecoveryModuleService } from './modules/SocialRecoveryModuleService';

// Re-export types from modules
export type { RecoveryConfig, Recovery, PendingRecovery } from './modules/SocialRecoveryModuleService';

/**
 * MultisigService - Facade that combines all specialized services
 *
 * This class maintains backward compatibility with existing code while
 * delegating to focused service classes internally.
 *
 * For new code, consider importing specific services directly:
 * - WalletService: wallet deployment, info
 * - TransactionService: propose, approve, execute transactions
 * - OwnerService: owner/module management
 * - WhitelistModuleService: whitelist operations
 * - DailyLimitModuleService: daily limit operations
 * - SocialRecoveryModuleService: social recovery operations
 */
export class MultisigService {
  // Specialized services
  private walletService: WalletService;
  private transactionService: TransactionService;
  private ownerService: OwnerService;
  private whitelistService: WhitelistModuleService;
  private dailyLimitService: DailyLimitModuleService;
  private socialRecoveryService: SocialRecoveryModuleService;

  constructor(provider?: Provider) {
    this.walletService = new WalletService(provider);
    this.transactionService = new TransactionService(provider);
    this.ownerService = new OwnerService(provider, this.transactionService);
    this.whitelistService = new WhitelistModuleService(provider);
    this.dailyLimitService = new DailyLimitModuleService(provider);
    this.socialRecoveryService = new SocialRecoveryModuleService(provider);
  }

  /**
   * Set signer for signing transactions
   */
  setSigner(signer: Signer | null): void {
    this.walletService.setSigner(signer);
    this.transactionService.setSigner(signer);
    this.ownerService.setSigner(signer);
    this.whitelistService.setSigner(signer);
    this.dailyLimitService.setSigner(signer);
    this.socialRecoveryService.setSigner(signer);
  }

  // ============ Wallet Service Methods ============

  async getImplementationAddress(): Promise<string> {
    return this.walletService.getImplementationAddress();
  }

  async verifyFactoryConfig(): Promise<{ valid: boolean; errors: string[] }> {
    return this.walletService.verifyFactoryConfig();
  }

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
    return this.walletService.deployWallet(config, onProgress);
  }

  async getWalletInfo(walletAddress: string): Promise<WalletInfo> {
    return this.walletService.getWalletInfo(walletAddress);
  }

  async getWalletsForOwner(ownerAddress: string): Promise<string[]> {
    return this.walletService.getWalletsForOwner(ownerAddress);
  }

  async isOwner(walletAddress: string, address: string): Promise<boolean> {
    return this.walletService.isOwner(walletAddress, address);
  }

  async isModuleEnabled(walletAddress: string, moduleAddress: string): Promise<boolean> {
    return this.walletService.isModuleEnabled(walletAddress, moduleAddress);
  }

  // ============ Transaction Service Methods ============

  async proposeTransaction(
    walletAddress: string,
    to: string,
    value: bigint,
    data: string
  ): Promise<string> {
    return this.transactionService.proposeTransaction(walletAddress, to, value, data);
  }

  async approveTransaction(walletAddress: string, txHash: string): Promise<void> {
    return this.transactionService.approveTransaction(walletAddress, txHash);
  }

  async revokeApproval(walletAddress: string, txHash: string): Promise<void> {
    return this.transactionService.revokeApproval(walletAddress, txHash);
  }

  async cancelTransaction(walletAddress: string, txHash: string): Promise<void> {
    return this.transactionService.cancelTransaction(walletAddress, txHash);
  }

  async executeTransaction(walletAddress: string, txHash: string): Promise<void> {
    return this.transactionService.executeTransaction(walletAddress, txHash);
  }

  async getTransaction(walletAddress: string, txHash: string): Promise<Transaction> {
    return this.transactionService.getTransaction(walletAddress, txHash);
  }

  async getTransactionByHash(walletAddress: string, txHash: string): Promise<PendingTransaction | null> {
    return this.transactionService.getTransactionByHash(walletAddress, txHash);
  }

  async getPendingTransactions(walletAddress: string): Promise<PendingTransaction[]> {
    return this.transactionService.getPendingTransactions(walletAddress);
  }

  async getExecutedTransactions(walletAddress: string): Promise<PendingTransaction[]> {
    return this.transactionService.getExecutedTransactions(walletAddress);
  }

  async getCancelledTransactions(walletAddress: string): Promise<PendingTransaction[]> {
    return this.transactionService.getCancelledTransactions(walletAddress);
  }

  // ============ Owner Service Methods ============

  async addOwner(walletAddress: string, newOwner: string): Promise<string> {
    return this.ownerService.addOwner(walletAddress, newOwner);
  }

  async removeOwner(walletAddress: string, owner: string): Promise<string> {
    return this.ownerService.removeOwner(walletAddress, owner);
  }

  async changeThreshold(walletAddress: string, newThreshold: number): Promise<string> {
    return this.ownerService.changeThreshold(walletAddress, newThreshold);
  }

  async enableModule(walletAddress: string, moduleAddress: string): Promise<string> {
    return this.ownerService.enableModule(walletAddress, moduleAddress);
  }

  async disableModule(walletAddress: string, moduleAddress: string): Promise<string> {
    return this.ownerService.disableModule(walletAddress, moduleAddress);
  }

  // ============ Whitelist Module Methods ============

  async addToWhitelist(walletAddress: string, address: string, limit: bigint): Promise<void> {
    return this.whitelistService.addToWhitelist(walletAddress, address, limit);
  }

  async removeFromWhitelist(walletAddress: string, address: string): Promise<void> {
    return this.whitelistService.removeFromWhitelist(walletAddress, address);
  }

  async isWhitelisted(walletAddress: string, address: string): Promise<boolean> {
    return this.whitelistService.isWhitelisted(walletAddress, address);
  }

  async getWhitelistLimit(walletAddress: string, address: string): Promise<bigint> {
    return this.whitelistService.getWhitelistLimit(walletAddress, address);
  }

  async executeToWhitelist(
    walletAddress: string,
    to: string,
    value: bigint,
    data: string
  ): Promise<string> {
    return this.whitelistService.executeToWhitelist(walletAddress, to, value, data);
  }

  async canExecuteViaWhitelist(
    walletAddress: string,
    to: string,
    value: bigint
  ): Promise<{ canExecute: boolean; reason?: string }> {
    return this.whitelistService.canExecuteViaWhitelist(walletAddress, to, value);
  }

  async getWhitelistedAddresses(walletAddress: string): Promise<Array<{ address: string; limit: bigint }>> {
    return this.whitelistService.getWhitelistedAddresses(walletAddress);
  }

  // ============ Daily Limit Module Methods ============

  async setDailyLimit(walletAddress: string, limit: bigint): Promise<void> {
    return this.dailyLimitService.setDailyLimit(walletAddress, limit);
  }

  async getDailyLimit(walletAddress: string): Promise<{ limit: bigint; spent: bigint; lastReset: bigint }> {
    return this.dailyLimitService.getDailyLimit(walletAddress);
  }

  async resetDailyLimit(walletAddress: string): Promise<void> {
    return this.dailyLimitService.resetDailyLimit(walletAddress);
  }

  async getRemainingLimit(walletAddress: string): Promise<bigint> {
    return this.dailyLimitService.getRemainingLimit(walletAddress);
  }

  async getTimeUntilReset(walletAddress: string): Promise<bigint> {
    return this.dailyLimitService.getTimeUntilReset(walletAddress);
  }

  async executeBelowLimit(walletAddress: string, to: string, value: bigint): Promise<string> {
    return this.dailyLimitService.executeBelowLimit(walletAddress, to, value);
  }

  async canExecuteViaDailyLimit(
    walletAddress: string,
    value: bigint
  ): Promise<{ canExecute: boolean; reason?: string }> {
    return this.dailyLimitService.canExecuteViaDailyLimit(walletAddress, value);
  }

  // ============ Social Recovery Module Methods ============

  async getRecoveryConfig(walletAddress: string): Promise<{
    guardians: string[];
    threshold: bigint;
    recoveryPeriod: bigint;
  }> {
    return this.socialRecoveryService.getRecoveryConfig(walletAddress);
  }

  async setupRecovery(
    walletAddress: string,
    guardians: string[],
    threshold: number,
    recoveryPeriodDays: number
  ): Promise<void> {
    return this.socialRecoveryService.setupRecovery(walletAddress, guardians, threshold, recoveryPeriodDays);
  }

  async isGuardian(walletAddress: string, address: string): Promise<boolean> {
    return this.socialRecoveryService.isGuardian(walletAddress, address);
  }

  async hasApprovedRecovery(walletAddress: string, recoveryHash: string, address: string): Promise<boolean> {
    return this.socialRecoveryService.hasApprovedRecovery(walletAddress, recoveryHash, address);
  }

  async getRecoveryHash(
    walletAddress: string,
    newOwners: string[],
    newThreshold: number
  ): Promise<string> {
    return this.socialRecoveryService.getRecoveryHash(walletAddress, newOwners, newThreshold);
  }

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
    return this.socialRecoveryService.getRecovery(walletAddress, recoveryHash);
  }

  async initiateRecovery(
    walletAddress: string,
    newOwners: string[],
    newThreshold: number
  ): Promise<string> {
    return this.socialRecoveryService.initiateRecovery(walletAddress, newOwners, newThreshold);
  }

  async approveRecovery(walletAddress: string, recoveryHash: string): Promise<void> {
    return this.socialRecoveryService.approveRecovery(walletAddress, recoveryHash);
  }

  async executeRecovery(walletAddress: string, recoveryHash: string): Promise<void> {
    return this.socialRecoveryService.executeRecovery(walletAddress, recoveryHash);
  }

  async cancelRecovery(walletAddress: string, recoveryHash: string): Promise<void> {
    return this.socialRecoveryService.cancelRecovery(walletAddress, recoveryHash);
  }

  async getPendingRecoveries(walletAddress: string): Promise<Array<{
    recoveryHash: string;
    newOwners: string[];
    newThreshold: bigint;
    approvalCount: bigint;
    executionTime: bigint;
    executed: boolean;
  }>> {
    return this.socialRecoveryService.getPendingRecoveries(walletAddress);
  }
}

// Singleton instance for backward compatibility
export const multisigService = new MultisigService();
