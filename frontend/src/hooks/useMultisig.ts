import { useCallback, useEffect, useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useWalletStore } from '../store/walletStore';
import { multisigService } from '../services/MultisigService';
import { notificationManager } from '../components/NotificationContainer';
import { CONTRACT_ADDRESSES } from '../config/contracts';
import type { DeploymentConfig, TransactionData, PendingTransaction } from '../types';
import * as quais from 'quais';

// Polling intervals (in milliseconds)
const POLLING_INTERVALS = {
  WALLET_INFO: 15000,        // 15 seconds - balance and owner info
  PENDING_TXS: 10000,        // 10 seconds - pending transactions (most critical)
  TRANSACTION_HISTORY: 30000, // 30 seconds - executed/cancelled transactions
  USER_WALLETS: 20000,       // 20 seconds - wallet list
} as const;

// Global tracking of last notified balances (shared across all hook instances)
// This prevents duplicate notifications when multiple components use the same wallet
const lastNotifiedBalances = new Map<string, string>();

// Global tracking of notified transaction states (executed, cancelled, ready to execute)
const notifiedExecutedTxs = new Set<string>();
const notifiedCancelledTxs = new Set<string>();
const notifiedReadyTxs = new Set<string>();
const notifiedProposedTxs = new Set<string>(); // Track transactions we've already notified about being proposed

// Global tracking of notified approvals (to detect when someone else approves)
const notifiedApprovals = new Map<string, Set<string>>(); // walletAddress -> Set<txHash>

// Global tracking of notified wallet changes (owners, threshold)
const lastNotifiedOwners = new Map<string, string>(); // walletAddress -> owners array (as JSON string)
const lastNotifiedThresholds = new Map<string, number>(); // walletAddress -> threshold

// Global tracking of notified module status changes
const lastNotifiedModuleStatus = new Map<string, Record<string, boolean>>(); // walletAddress -> { moduleAddress: enabled }

// Module address to name mapping
const MODULE_NAMES: Record<string, string> = {
  [CONTRACT_ADDRESSES.SOCIAL_RECOVERY_MODULE]: 'Social Recovery',
  [CONTRACT_ADDRESSES.DAILY_LIMIT_MODULE]: 'Daily Limit',
  [CONTRACT_ADDRESSES.WHITELIST_MODULE]: 'Whitelist',
};

/**
 * Hook to detect if the page is visible (not hidden/minimized)
 */
function usePageVisibility() {
  const [isVisible, setIsVisible] = useState(() => {
    if (typeof document === 'undefined') return true;
    return !document.hidden;
  });

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      setIsVisible(!document.hidden);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return isVisible;
}

export function useMultisig(walletAddress?: string) {
  const queryClient = useQueryClient();
  const isPageVisible = usePageVisibility();
  const {
    address: connectedAddress,
    setError,
    setLoading,
    setWalletInfo,
    setPendingTransactions,
  } = useWalletStore();

  // Track previous balances for each wallet (using ref to persist across renders)
  const prevBalancesRef = useRef<Map<string, string>>(new Map());
  
  // Track previous pending transactions state (for approval changes)
  const prevPendingTxsRef = useRef<Map<string, Map<string, PendingTransaction>>>(new Map()); // walletAddress -> Map<txHash, tx>
  
  // Track previous wallet info (for owner/threshold changes)
  const prevWalletInfoRef = useRef<Map<string, { owners: string[]; threshold: number }>>(new Map());

  // Get wallet info
  const {
    data: walletInfo,
    isLoading: isLoadingInfo,
    refetch: refetchWalletInfo,
    isRefetching: isRefetchingWalletInfo,
  } = useQuery({
    queryKey: ['walletInfo', walletAddress],
    queryFn: async () => {
      if (!walletAddress) return null;
      const info = await multisigService.getWalletInfo(walletAddress);
      setWalletInfo(walletAddress, info);
      return info;
    },
    enabled: !!walletAddress && isPageVisible,
    refetchInterval: isPageVisible ? POLLING_INTERVALS.WALLET_INFO : false,
  });

  // Track wallet info changes for notifications (balance, owners, threshold)
  useEffect(() => {
    if (walletInfo && walletAddress) {
      const prevInfo = prevWalletInfoRef.current.get(walletAddress);
      
      // Track balance changes
      const currentBalance = walletInfo.balance;
      const prevBalance = prevBalancesRef.current.get(walletAddress);
      const lastNotifiedBalance = lastNotifiedBalances.get(walletAddress);
      
      if (prevBalance && currentBalance) {
        const prevBigInt = BigInt(prevBalance);
        const currentBigInt = BigInt(currentBalance);
        const lastNotifiedBigInt = lastNotifiedBalance ? BigInt(lastNotifiedBalance) : null;
        
        const hasIncreased = currentBigInt > prevBigInt;
        const alreadyNotified = lastNotifiedBigInt !== null && currentBigInt === lastNotifiedBigInt;
        
        if (hasIncreased && !alreadyNotified) {
          const increase = currentBigInt - prevBigInt;
          const increaseFormatted = parseFloat(quais.formatQuai(increase)).toFixed(4);
          const totalFormatted = parseFloat(quais.formatQuai(currentBigInt)).toFixed(4);
          
          lastNotifiedBalances.set(walletAddress, currentBalance);
          
          notificationManager.add({
            message: `💰 Vault received ${increaseFormatted} QUAI! New balance: ${totalFormatted} QUAI`,
            type: 'success',
          });

          if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
            new Notification('Vault Received Funds', {
              body: `Received ${increaseFormatted} QUAI. New balance: ${totalFormatted} QUAI`,
              icon: '/vite.svg',
              tag: `${walletAddress}-${currentBalance}`,
            });
          }
        }
      }
      
      prevBalancesRef.current.set(walletAddress, currentBalance);
      
      // Track owner changes
      if (prevInfo) {
        const prevOwners = prevInfo.owners.sort();
        const currentOwners = [...walletInfo.owners].sort();
        const prevOwnersStr = JSON.stringify(prevOwners);
        const currentOwnersStr = JSON.stringify(currentOwners);
        const lastNotifiedOwnersStr = lastNotifiedOwners.get(walletAddress);
        
        if (prevOwnersStr !== currentOwnersStr && currentOwnersStr !== lastNotifiedOwnersStr) {
          const addedOwners = currentOwners.filter(addr => !prevOwners.includes(addr));
          const removedOwners = prevOwners.filter(addr => !currentOwners.includes(addr));
          
          if (addedOwners.length > 0) {
            addedOwners.forEach((owner) => {
              const ownerShort = `${owner.slice(0, 6)}...${owner.slice(-4)}`;
              notificationManager.add({
                message: `👤 Owner added: ${ownerShort}`,
                type: 'success',
              });
            });
          }
          
          if (removedOwners.length > 0) {
            removedOwners.forEach((owner) => {
              const ownerShort = `${owner.slice(0, 6)}...${owner.slice(-4)}`;
              notificationManager.add({
                message: `👤 Owner removed: ${ownerShort}`,
                type: 'warning',
              });
            });
          }
          
          lastNotifiedOwners.set(walletAddress, currentOwnersStr);
        }
        
        // Track threshold changes
        const prevThreshold = prevInfo.threshold;
        const currentThreshold = walletInfo.threshold;
        const lastNotifiedThreshold = lastNotifiedThresholds.get(walletAddress);
        
        if (prevThreshold !== currentThreshold && currentThreshold !== lastNotifiedThreshold) {
          notificationManager.add({
            message: `⚙️ Threshold changed: ${prevThreshold} → ${currentThreshold}`,
            type: 'info',
          });

          if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
            new Notification('Threshold Changed', {
              body: `Approval threshold changed from ${prevThreshold} to ${currentThreshold}`,
              icon: '/vite.svg',
              tag: `threshold-${walletAddress}-${currentThreshold}`,
            });
          }
          
          lastNotifiedThresholds.set(walletAddress, currentThreshold);
        }
      }
      
      // Update stored wallet info
      prevWalletInfoRef.current.set(walletAddress, {
        owners: walletInfo.owners,
        threshold: walletInfo.threshold,
      });
    }
  }, [walletInfo, walletAddress]);

  // Query module statuses to track changes
  const {
    data: moduleStatuses,
  } = useQuery({
    queryKey: ['moduleStatus', walletAddress],
    queryFn: async () => {
      if (!walletAddress) return null;
      const statuses: Record<string, boolean> = {};
      const moduleAddresses = [
        CONTRACT_ADDRESSES.SOCIAL_RECOVERY_MODULE,
        CONTRACT_ADDRESSES.DAILY_LIMIT_MODULE,
        CONTRACT_ADDRESSES.WHITELIST_MODULE,
      ];
      
      for (const moduleAddress of moduleAddresses) {
        if (moduleAddress) {
          try {
            statuses[moduleAddress] = await multisigService.isModuleEnabled(walletAddress, moduleAddress);
          } catch (error) {
            console.error(`Failed to check status for module ${moduleAddress}:`, error);
            statuses[moduleAddress] = false;
          }
        }
      }
      return statuses;
    },
    enabled: !!walletAddress && isPageVisible,
    refetchInterval: isPageVisible ? POLLING_INTERVALS.WALLET_INFO : false,
  });

  // Track module status changes for notifications
  useEffect(() => {
    if (!moduleStatuses || !walletAddress) return;

    const prevStatuses = lastNotifiedModuleStatus.get(walletAddress) || {};
    const currentStatuses = moduleStatuses;

    // Check each module for status changes
    for (const [moduleAddress, isEnabled] of Object.entries(currentStatuses)) {
      const prevEnabled = prevStatuses[moduleAddress];
      const moduleName = MODULE_NAMES[moduleAddress] || 'Unknown Module';

      // Only notify if status actually changed (not on first load)
      if (prevEnabled !== undefined && prevEnabled !== isEnabled) {
        if (isEnabled) {
          notificationManager.add({
            message: `✅ ${moduleName} module enabled`,
            type: 'success',
          });

          if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
            new Notification(`${moduleName} Module Enabled`, {
              body: `The ${moduleName} module has been enabled for this vault`,
              icon: '/vite.svg',
            });
          }
        } else {
          notificationManager.add({
            message: `✅ ${moduleName} module disabled`,
            type: 'success',
          });

          if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
            new Notification(`${moduleName} Module Disabled`, {
              body: `The ${moduleName} module has been disabled for this vault`,
              icon: '/vite.svg',
            });
          }
        }
      }
    }

    // Update last notified status
    lastNotifiedModuleStatus.set(walletAddress, { ...currentStatuses });
  }, [moduleStatuses, walletAddress]);

  // Get pending transactions
  const {
    data: pendingTransactions,
    isLoading: isLoadingTransactions,
    refetch: refetchTransactions,
    isRefetching: isRefetchingPending,
  } = useQuery({
    queryKey: ['pendingTransactions', walletAddress],
    queryFn: async () => {
      if (!walletAddress) return [];
      const txs = await multisigService.getPendingTransactions(walletAddress);
      setPendingTransactions(walletAddress, txs);
      return txs;
    },
    enabled: !!walletAddress && isPageVisible,
    refetchInterval: isPageVisible ? POLLING_INTERVALS.PENDING_TXS : false,
  });

  // Track pending transactions for notifications (new transactions, approvals, ready to execute)
  useEffect(() => {
    if (!pendingTransactions || !walletAddress) return;
    
    const prevTxsMap = prevPendingTxsRef.current.get(walletAddress) || new Map();
    const currentTxsMap = new Map<string, PendingTransaction>();
    
    // Process current transactions
    pendingTransactions.forEach((tx) => {
      const txHashLower = tx.hash.toLowerCase();
      currentTxsMap.set(txHashLower, tx);
      const prevTx = prevTxsMap.get(txHashLower);
      
      if (!prevTx) {
        // New transaction detected (only notify if we had previous transactions and haven't already notified)
        if (prevTxsMap.size > 0 && !notifiedProposedTxs.has(txHashLower)) {
          notifiedProposedTxs.add(txHashLower);
          notificationManager.add({
            message: `📝 New transaction proposed: ${tx.hash.slice(0, 10)}...${tx.hash.slice(-6)}`,
            type: 'info',
          });

          if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
            new Notification('New Transaction Proposed', {
              body: `Transaction ${tx.hash.slice(0, 10)}... requires approval`,
              icon: '/vite.svg',
              tag: tx.hash,
            });
          }
        }
      } else {
        // Existing transaction - check for changes
        
        // Check if transaction is now ready to execute
        const wasReady = prevTx.numApprovals >= prevTx.threshold;
        const isReady = tx.numApprovals >= tx.threshold;
        if (!wasReady && isReady && !notifiedReadyTxs.has(txHashLower)) {
          notifiedReadyTxs.add(txHashLower);
          notificationManager.add({
            message: `✅ Transaction ready to execute! ${tx.hash.slice(0, 10)}...${tx.hash.slice(-6)}`,
            type: 'success',
          });

          if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
            new Notification('Transaction Ready to Execute', {
              body: `Transaction ${tx.hash.slice(0, 10)}... has reached the threshold`,
              icon: '/vite.svg',
              tag: `ready-${tx.hash}`,
            });
          }
        }
        
        // Check for new approvals (someone else approved)
        if (connectedAddress) {
          const prevApprovals = Object.keys(prevTx.approvals).filter(addr => prevTx.approvals[addr.toLowerCase()]);
          const currentApprovals = Object.keys(tx.approvals).filter(addr => tx.approvals[addr.toLowerCase()]);
          
          // Find new approvers (not the connected user)
          const newApprovers = currentApprovals.filter(
            addr => !prevApprovals.includes(addr) && addr.toLowerCase() !== connectedAddress.toLowerCase()
          );
          
          if (newApprovers.length > 0) {
            const approvalKey = `${walletAddress}-${txHashLower}`;
            const notifiedSet = notifiedApprovals.get(approvalKey) || new Set();
            
            newApprovers.forEach((approver) => {
              if (!notifiedSet.has(approver.toLowerCase())) {
                notifiedSet.add(approver.toLowerCase());
                const approverShort = `${approver.slice(0, 6)}...${approver.slice(-4)}`;
                notificationManager.add({
                  message: `👍 ${approverShort} approved transaction ${tx.hash.slice(0, 10)}...${tx.hash.slice(-6)}`,
                  type: 'info',
                });

                if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
                  new Notification('Transaction Approved', {
                    body: `${approverShort} approved transaction ${tx.hash.slice(0, 10)}...`,
                    icon: '/vite.svg',
                    tag: `approval-${tx.hash}-${approver}`,
                  });
                }
              }
            });
            
            notifiedApprovals.set(approvalKey, notifiedSet);
          }
          
          // Check for revoked approvals
          const revokedApprovers = prevApprovals.filter(
            addr => !currentApprovals.includes(addr) && addr.toLowerCase() !== connectedAddress.toLowerCase()
          );
          
          if (revokedApprovers.length > 0) {
            revokedApprovers.forEach((revoker) => {
              const revokerShort = `${revoker.slice(0, 6)}...${revoker.slice(-4)}`;
              notificationManager.add({
                message: `👎 ${revokerShort} revoked approval for transaction ${tx.hash.slice(0, 10)}...${tx.hash.slice(-6)}`,
                type: 'warning',
              });
            });
          }
        }
      }
    });
    
    // Update stored state
    prevPendingTxsRef.current.set(walletAddress, currentTxsMap);
  }, [pendingTransactions, walletAddress, connectedAddress]);

  // Get executed transactions (history)
  const {
    data: executedTransactions,
    isLoading: isLoadingHistory,
    refetch: refetchHistory,
    isRefetching: isRefetchingHistory,
  } = useQuery({
    queryKey: ['executedTransactions', walletAddress],
    queryFn: async () => {
      if (!walletAddress) return [];
      const txs = await multisigService.getExecutedTransactions(walletAddress);
      return txs;
    },
    enabled: !!walletAddress && isPageVisible,
    refetchInterval: isPageVisible ? POLLING_INTERVALS.TRANSACTION_HISTORY : false,
  });

  // Track executed transactions for notifications
  useEffect(() => {
    if (!executedTransactions || !walletAddress) return;
    
    executedTransactions.forEach((tx) => {
      const txHashLower = tx.hash.toLowerCase();
      if (!notifiedExecutedTxs.has(txHashLower)) {
        notifiedExecutedTxs.add(txHashLower);
        
        // Only notify if this was a pending transaction we were tracking
        const wasPending = prevPendingTxsRef.current.get(walletAddress)?.has(txHashLower);
        if (wasPending) {
          notificationManager.add({
            message: `✅ Transaction executed: ${tx.hash.slice(0, 10)}...${tx.hash.slice(-6)}`,
            type: 'success',
          });

          if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
            new Notification('Transaction Executed', {
              body: `Transaction ${tx.hash.slice(0, 10)}... has been executed`,
              icon: '/vite.svg',
              tag: `executed-${tx.hash}`,
            });
          }
        }
      }
    });
  }, [executedTransactions, walletAddress]);

  // Get cancelled transactions
  const {
    data: cancelledTransactions,
    isLoading: isLoadingCancelled,
    refetch: refetchCancelled,
    isRefetching: isRefetchingCancelled,
  } = useQuery({
    queryKey: ['cancelledTransactions', walletAddress],
    queryFn: async () => {
      if (!walletAddress) return [];
      const txs = await multisigService.getCancelledTransactions(walletAddress);
      return txs;
    },
    enabled: !!walletAddress && isPageVisible,
    refetchInterval: isPageVisible ? POLLING_INTERVALS.TRANSACTION_HISTORY : false,
  });

  // Track cancelled transactions for notifications
  useEffect(() => {
    if (!cancelledTransactions || !walletAddress) return;
    
    cancelledTransactions.forEach((tx) => {
      const txHashLower = tx.hash.toLowerCase();
      if (!notifiedCancelledTxs.has(txHashLower)) {
        notifiedCancelledTxs.add(txHashLower);
        
        // Only notify if this was a pending transaction we were tracking
        const wasPending = prevPendingTxsRef.current.get(walletAddress)?.has(txHashLower);
        if (wasPending) {
          notificationManager.add({
            message: `❌ Transaction cancelled: ${tx.hash.slice(0, 10)}...${tx.hash.slice(-6)}`,
            type: 'warning',
          });

          if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
            new Notification('Transaction Cancelled', {
              body: `Transaction ${tx.hash.slice(0, 10)}... has been cancelled`,
              icon: '/vite.svg',
              tag: `cancelled-${tx.hash}`,
            });
          }
        }
      }
    });
  }, [cancelledTransactions, walletAddress]);

  // Get wallets for connected address
  const {
    data: userWallets,
    isLoading: isLoadingWallets,
    refetch: refetchUserWallets,
    isRefetching: isRefetchingWallets,
  } = useQuery({
    queryKey: ['userWallets', connectedAddress],
    queryFn: async () => {
      if (!connectedAddress) return [];
      return await multisigService.getWalletsForOwner(connectedAddress);
    },
    enabled: !!connectedAddress && isPageVisible,
    refetchInterval: isPageVisible ? POLLING_INTERVALS.USER_WALLETS : false,
  });

  // Deploy wallet mutation
  const deployWallet = useMutation({
    mutationFn: async (config: DeploymentConfig) => {
      setLoading(true);
      return await multisigService.deployWallet(config);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userWallets'] });
    },
    onError: (error) => {
      setError(error instanceof Error ? error.message : 'Failed to deploy wallet');
    },
    onSettled: () => {
      setLoading(false);
    },
  });

  // Propose transaction mutation
  const proposeTransaction = useMutation({
    mutationFn: async (tx: TransactionData & { walletAddress: string }) => {
      return await multisigService.proposeTransaction(
        tx.walletAddress,
        tx.to,
        tx.value,
        tx.data
      );
    },
    onSuccess: (txHash) => {
      queryClient.invalidateQueries({ queryKey: ['pendingTransactions'] });
      // Mark this transaction as already notified to prevent duplicate notifications from polling
      if (txHash) {
        notifiedProposedTxs.add(txHash.toLowerCase());
      }
      // Show success notification when you propose a transaction
      notificationManager.add({
        message: `Transaction proposed successfully! Hash: ${txHash?.slice(0, 10)}...${txHash?.slice(-6)}`,
        type: 'success',
      });
    },
    onError: (error) => {
      setError(error instanceof Error ? error.message : 'Failed to propose transaction');
      // Show error notification
      notificationManager.add({
        message: `Failed to propose transaction: ${error instanceof Error ? error.message : 'Unknown error'}`,
        type: 'error',
      });
    },
  });

  // Approve transaction mutation
  const approveTransaction = useMutation({
    mutationFn: async ({ walletAddress, txHash }: { walletAddress: string; txHash: string }) => {
      return await multisigService.approveTransaction(walletAddress, txHash);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pendingTransactions'] });
    },
    onError: (error) => {
      setError(error instanceof Error ? error.message : 'Failed to approve transaction');
    },
  });

  // Revoke approval mutation
  const revokeApproval = useMutation({
    mutationFn: async ({ walletAddress, txHash }: { walletAddress: string; txHash: string }) => {
      return await multisigService.revokeApproval(walletAddress, txHash);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pendingTransactions'] });
    },
    onError: (error) => {
      setError(error instanceof Error ? error.message : 'Failed to revoke approval');
    },
  });

  // Execute transaction mutation
  const executeTransaction = useMutation({
    mutationFn: async ({ walletAddress, txHash }: { walletAddress: string; txHash: string }) => {
      return await multisigService.executeTransaction(walletAddress, txHash);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pendingTransactions'] });
      queryClient.invalidateQueries({ queryKey: ['walletInfo'] });
    },
    onError: (error) => {
      setError(error instanceof Error ? error.message : 'Failed to execute transaction');
    },
  });

  // Cancel transaction mutation
  const cancelTransaction = useMutation({
    mutationFn: async ({ walletAddress, txHash }: { walletAddress: string; txHash: string }) => {
      return await multisigService.cancelTransaction(walletAddress, txHash);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pendingTransactions'] });
      queryClient.invalidateQueries({ queryKey: ['cancelledTransactions'] });
    },
    onError: (error) => {
      setError(error instanceof Error ? error.message : 'Failed to cancel transaction');
    },
  });

  // Add owner mutation (proposes transaction)
  const addOwner = useMutation({
    mutationFn: async ({ walletAddress, newOwner }: { walletAddress: string; newOwner: string }) => {
      return await multisigService.addOwner(walletAddress, newOwner);
    },
    onSuccess: (txHash, variables) => {
      console.log('✅ Add owner transaction proposed:', txHash);
      // Invalidate and refetch queries
      queryClient.invalidateQueries({ queryKey: ['walletInfo', variables.walletAddress] });
      queryClient.invalidateQueries({ queryKey: ['pendingTransactions', variables.walletAddress] });
      // Also manually refetch after a short delay to ensure the transaction appears
      setTimeout(() => {
        queryClient.refetchQueries({ queryKey: ['pendingTransactions', variables.walletAddress] });
      }, 2000);
    },
    onError: (error) => {
      setError(error instanceof Error ? error.message : 'Failed to add owner');
    },
  });

  // Remove owner mutation (proposes transaction)
  const removeOwner = useMutation({
    mutationFn: async ({ walletAddress, owner }: { walletAddress: string; owner: string }) => {
      return await multisigService.removeOwner(walletAddress, owner);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['walletInfo'] });
      queryClient.invalidateQueries({ queryKey: ['pendingTransactions'] });
    },
    onError: (error) => {
      setError(error instanceof Error ? error.message : 'Failed to remove owner');
    },
  });

  // Change threshold mutation (proposes transaction)
  const changeThreshold = useMutation({
    mutationFn: async ({ walletAddress, newThreshold }: { walletAddress: string; newThreshold: number }) => {
      return await multisigService.changeThreshold(walletAddress, newThreshold);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['walletInfo'] });
      queryClient.invalidateQueries({ queryKey: ['pendingTransactions'] });
    },
    onError: (error) => {
      setError(error instanceof Error ? error.message : 'Failed to change threshold');
    },
  });

  // Enable module mutation (proposes transaction)
  const enableModule = useMutation({
    mutationFn: async ({ walletAddress, moduleAddress }: { walletAddress: string; moduleAddress: string }) => {
      return await multisigService.enableModule(walletAddress, moduleAddress);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pendingTransactions'] });
      queryClient.invalidateQueries({ queryKey: ['moduleStatus'] });
    },
    onError: (error) => {
      setError(error instanceof Error ? error.message : 'Failed to enable module');
    },
  });

  // Disable module mutation (proposes transaction)
  const disableModule = useMutation({
    mutationFn: async ({ walletAddress, moduleAddress }: { walletAddress: string; moduleAddress: string }) => {
      return await multisigService.disableModule(walletAddress, moduleAddress);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pendingTransactions'] });
      queryClient.invalidateQueries({ queryKey: ['moduleStatus'] });
    },
    onError: (error) => {
      setError(error instanceof Error ? error.message : 'Failed to disable module');
    },
  });

  // Execute transaction via whitelist (bypasses approval requirement)
  const executeToWhitelist = useMutation({
    mutationFn: async (tx: TransactionData & { walletAddress: string }) => {
      return await multisigService.executeToWhitelist(
        tx.walletAddress,
        tx.to,
        tx.value,
        tx.data
      );
    },
    onSuccess: (txHash) => {
      queryClient.invalidateQueries({ queryKey: ['pendingTransactions'] });
      queryClient.invalidateQueries({ queryKey: ['walletInfo'] });
      notificationManager.add({
        message: `✅ Transaction executed via whitelist! Hash: ${txHash?.slice(0, 10)}...${txHash?.slice(-6)}`,
        type: 'success',
      });
    },
    onError: (error) => {
      setError(error instanceof Error ? error.message : 'Failed to execute transaction via whitelist');
      notificationManager.add({
        message: `Failed to execute via whitelist: ${error instanceof Error ? error.message : 'Unknown error'}`,
        type: 'error',
      });
    },
  });

  // Execute transaction via daily limit (bypasses approval requirement)
  // Note: This is ONLY enforced in the frontend. Users can bypass this by interacting with the multisig directly.
  const executeBelowLimit = useMutation({
    mutationFn: async (tx: TransactionData & { walletAddress: string }) => {
      return await multisigService.executeBelowLimit(
        tx.walletAddress,
        tx.to,
        tx.value
      );
    },
    onSuccess: (txHash) => {
      queryClient.invalidateQueries({ queryKey: ['pendingTransactions'] });
      queryClient.invalidateQueries({ queryKey: ['walletInfo'] });
      queryClient.invalidateQueries({ queryKey: ['dailyLimit'] });
      queryClient.invalidateQueries({ queryKey: ['remainingLimit'] });
      notificationManager.add({
        message: `✅ Transaction executed via daily limit! Hash: ${txHash?.slice(0, 10)}...${txHash?.slice(-6)}`,
        type: 'success',
      });
    },
    onError: (error) => {
      setError(error instanceof Error ? error.message : 'Failed to execute transaction via daily limit');
      notificationManager.add({
        message: `Failed to execute via daily limit: ${error instanceof Error ? error.message : 'Unknown error'}`,
        type: 'error',
      });
    },
  });

  const refresh = useCallback(() => {
    refetchWalletInfo();
    refetchTransactions();
    refetchUserWallets();
    refetchCancelled();
  }, [refetchWalletInfo, refetchTransactions, refetchUserWallets, refetchCancelled]);

  return {
    // Data
    walletInfo,
    pendingTransactions,
    executedTransactions,
    cancelledTransactions,
    userWallets,

    // Loading states
    isLoading: isLoadingInfo || isLoadingTransactions || isLoadingHistory || isLoadingCancelled || isLoadingWallets,
    isLoadingInfo,
    isLoadingTransactions,
    isLoadingHistory,
    isLoadingCancelled,
    isLoadingWallets,

    // Refreshing states (for visual indicators)
    isRefetchingWalletInfo,
    isRefetchingPending,
    isRefetchingHistory,
    isRefetchingCancelled,
    isRefetchingWallets,

    // Mutations
    deployWallet: deployWallet.mutate,
    deployWalletAsync: deployWallet.mutateAsync,
    proposeTransaction: proposeTransaction.mutate,
    proposeTransactionAsync: proposeTransaction.mutateAsync,
    approveTransaction: approveTransaction.mutate,
    approveTransactionAsync: approveTransaction.mutateAsync,
    revokeApproval: revokeApproval.mutate,
    revokeApprovalAsync: revokeApproval.mutateAsync,
    executeTransaction: executeTransaction.mutate,
    executeTransactionAsync: executeTransaction.mutateAsync,
    cancelTransaction: cancelTransaction.mutate,
    cancelTransactionAsync: cancelTransaction.mutateAsync,
    addOwner: addOwner.mutate,
    addOwnerAsync: addOwner.mutateAsync,
    removeOwner: removeOwner.mutate,
    removeOwnerAsync: removeOwner.mutateAsync,
    changeThreshold: changeThreshold.mutate,
    changeThresholdAsync: changeThreshold.mutateAsync,
    enableModule: enableModule.mutate,
    enableModuleAsync: enableModule.mutateAsync,
    disableModule: disableModule.mutate,
    disableModuleAsync: disableModule.mutateAsync,
    executeToWhitelist: executeToWhitelist.mutate,
    executeToWhitelistAsync: executeToWhitelist.mutateAsync,
    executeBelowLimit: executeBelowLimit.mutate,
    executeBelowLimitAsync: executeBelowLimit.mutateAsync,

    // Mutation states
    isDeploying: deployWallet.isPending,
    isProposing: proposeTransaction.isPending,
    isApproving: approveTransaction.isPending,
    isRevoking: revokeApproval.isPending,
    isExecuting: executeTransaction.isPending,
    isCancelling: cancelTransaction.isPending,
    isAddingOwner: addOwner.isPending,
    isRemovingOwner: removeOwner.isPending,
    isChangingThreshold: changeThreshold.isPending,
    isExecutingViaWhitelist: executeToWhitelist.isPending,
    isExecutingViaDailyLimit: executeBelowLimit.isPending,

    // Utilities
    refresh,
    refreshTransactions: refetchTransactions,
    refreshHistory: refetchHistory,
    refreshCancelled: refetchCancelled,
  };
}
