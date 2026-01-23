import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { multisigService } from '../services/MultisigService';
import { transactionBuilderService } from '../services/TransactionBuilderService';
import { notificationManager } from './NotificationContainer';
import { Modal } from './Modal';

interface DailyLimitConfigurationProps {
  walletAddress: string;
  onUpdate: () => void;
}

export function DailyLimitConfiguration({ walletAddress, onUpdate }: DailyLimitConfigurationProps) {
  const queryClient = useQueryClient();
  const [newLimit, setNewLimit] = useState('');
  const [errors, setErrors] = useState<string[]>([]);

  // Query daily limit configuration
  const { data: dailyLimit, isLoading, refetch } = useQuery({
    queryKey: ['dailyLimit', walletAddress],
    queryFn: async () => {
      return await multisigService.getDailyLimit(walletAddress);
    },
    enabled: !!walletAddress,
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  // Query remaining limit
  const { data: remainingLimit } = useQuery({
    queryKey: ['remainingLimit', walletAddress],
    queryFn: async () => {
      return await multisigService.getRemainingLimit(walletAddress);
    },
    enabled: !!walletAddress,
    refetchInterval: 30000,
  });

  // Query time until reset
  const { data: timeUntilReset } = useQuery({
    queryKey: ['timeUntilReset', walletAddress],
    queryFn: async () => {
      return await multisigService.getTimeUntilReset(walletAddress);
    },
    enabled: !!walletAddress,
    refetchInterval: 60000, // Refetch every minute
  });

  // Set daily limit mutation
  const setDailyLimit = useMutation({
    mutationFn: async (limit: bigint) => {
      return await multisigService.setDailyLimit(walletAddress, limit);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dailyLimit'] });
      queryClient.invalidateQueries({ queryKey: ['remainingLimit'] });
      queryClient.invalidateQueries({ queryKey: ['timeUntilReset'] });
      refetch();
      setNewLimit('');
      setErrors([]);
      onUpdate();
    },
    onError: (error) => {
      setErrors([error instanceof Error ? error.message : 'Failed to set daily limit']);
    },
  });

  // Reset daily limit mutation
  const resetDailyLimit = useMutation({
    mutationFn: async () => {
      return await multisigService.resetDailyLimit(walletAddress);
    },
    onSuccess: () => {
      notificationManager.add({
        message: '✅ Daily limit reset successfully (spent amount reset to 0)',
        type: 'success',
      });

      // Browser notification
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('Daily Limit Reset', {
          body: 'Daily spent amount has been reset to 0',
          icon: '/vite.svg',
        });
      }

      queryClient.invalidateQueries({ queryKey: ['dailyLimit'] });
      queryClient.invalidateQueries({ queryKey: ['remainingLimit'] });
      queryClient.invalidateQueries({ queryKey: ['timeUntilReset'] });
      refetch();
      onUpdate();
    },
    onError: (error) => {
      setErrors([error instanceof Error ? error.message : 'Failed to reset daily limit']);
    },
  });

  const validateForm = (): boolean => {
    const newErrors: string[] = [];

    if (!newLimit.trim()) {
      newErrors.push('Daily limit is required (use 0 to disable)');
    } else {
      const limitValue = parseFloat(newLimit.trim());
      if (isNaN(limitValue) || limitValue < 0) {
        newErrors.push('Daily limit must be a positive number or 0 to disable');
      }
    }

    setErrors(newErrors);
    return newErrors.length === 0;
  };

  const handleSetLimit = async () => {
    if (!validateForm()) {
      return;
    }

    try {
      const parsedLimit = transactionBuilderService.parseValue(newLimit);
      await setDailyLimit.mutateAsync(parsedLimit);
    } catch (err: any) {
      setErrors([err.message || 'Failed to set daily limit']);
    }
  };

  const handleReset = async () => {
    if (!confirm('Are you sure you want to reset the daily limit? This will reset the spent amount to 0.')) {
      return;
    }

    try {
      await resetDailyLimit.mutateAsync();
    } catch (err: any) {
      setErrors([err.message || 'Failed to reset daily limit']);
    }
  };

  const formatTime = (seconds: bigint): string => {
    const secs = Number(seconds);
    if (secs === 0) return 'Reset';
    
    const hours = Math.floor(secs / 3600);
    const minutes = Math.floor((secs % 3600) / 60);
    const remainingSecs = secs % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${remainingSecs}s`;
    } else {
      return `${remainingSecs}s`;
    }
  };

  return (
    <Modal
      isOpen={true}
      onClose={onUpdate}
      title="Daily Limit Configuration"
      size="lg"
    >
      <div className="space-y-6">
        {/* Important Warning */}
        <div className="bg-gradient-to-r from-yellow-900/90 via-yellow-800/90 to-yellow-900/90 border-l-4 border-yellow-600 rounded-md p-4">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <div>
              <h4 className="text-base font-semibold text-yellow-200 mb-1">Frontend-Only Enforcement</h4>
              <p className="text-sm text-yellow-200/90 mb-2">
                The daily limit is <strong>ONLY enforced in this frontend</strong>. Transactions can bypass this limitation by interacting with the multisig wallet contract directly (e.g., via Etherscan, other interfaces, or direct contract calls).
              </p>
              <p className="text-sm text-yellow-200/90">
                This is a <strong>convenience feature, not a security mechanism</strong>. For true security, use multisig approvals for all transactions.
              </p>
            </div>
          </div>
        </div>

        {/* Current Configuration */}
        {isLoading ? (
          <div className="text-center py-8">
            <div className="inline-block w-6 h-6 border-2 border-primary-600 border-t-transparent rounded-full animate-spin"></div>
            <p className="mt-2 text-sm text-dark-500">Loading...</p>
          </div>
        ) : (
          <div className="bg-vault-dark-4 rounded-md p-5 border border-dark-600">
            <h3 className="text-base font-mono text-dark-500 uppercase tracking-wider mb-4">Current Configuration</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-base font-mono text-dark-500 uppercase tracking-wider">Daily Limit:</span>
                <span className="text-dark-200 font-semibold">
                  {dailyLimit && dailyLimit.limit > 0n
                    ? `${transactionBuilderService.formatValue(dailyLimit.limit)} QUAI`
                    : 'Not set'}
                </span>
              </div>
              {dailyLimit && dailyLimit.limit > 0n && (
                <>
                  <div className="flex justify-between items-center">
                    <span className="text-base font-mono text-dark-500 uppercase tracking-wider">Spent Today:</span>
                    <span className="text-dark-200 font-semibold">
                      {transactionBuilderService.formatValue(dailyLimit.spent)} QUAI
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-base font-mono text-dark-500 uppercase tracking-wider">Remaining:</span>
                    <span className="text-primary-400 font-semibold">
                      {remainingLimit !== undefined
                        ? `${transactionBuilderService.formatValue(remainingLimit)} QUAI`
                        : 'Loading...'}
                    </span>
                  </div>
                  {timeUntilReset !== undefined && (
                    <div className="flex justify-between items-center">
                      <span className="text-base font-mono text-dark-500 uppercase tracking-wider">Resets In:</span>
                      <span className="text-dark-200 font-semibold">
                        {formatTime(timeUntilReset)}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* Set New Limit */}
        <div>
          <h3 className="text-base font-mono text-dark-500 uppercase tracking-wider mb-4">
            {dailyLimit && dailyLimit.limit > 0n ? 'Update Daily Limit' : 'Set Daily Limit'}
          </h3>
          <div className="space-y-4">
            <div>
              <label htmlFor="dailyLimit" className="block text-sm font-mono text-dark-500 uppercase tracking-wider mb-2">
                Daily Limit (QUAI)
              </label>
              <input
                id="dailyLimit"
                type="text"
                value={newLimit}
                onChange={(e) => setNewLimit(e.target.value)}
                placeholder={dailyLimit && dailyLimit.limit > 0n ? transactionBuilderService.formatValue(dailyLimit.limit) : "0.0"}
                className="input-field w-full"
              />
              <p className="mt-2 text-sm font-mono text-dark-600">
                Enter the maximum amount that can be spent per day (e.g., 10 for 10 QUAI). Set to <strong>0</strong> to disable the daily limit.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleSetLimit}
                disabled={setDailyLimit.isPending}
                className="btn-primary flex-1 text-base px-4 py-2.5 inline-flex items-center justify-center gap-2"
              >
                {setDailyLimit.isPending ? (
                  <>
                    <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                    Setting Limit...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    {dailyLimit && dailyLimit.limit > 0n ? 'Update Limit' : 'Set Limit'}
                  </>
                )}
              </button>
              {dailyLimit && dailyLimit.limit > 0n && (
                <button
                  onClick={async () => {
                    if (!confirm('Are you sure you want to disable the daily limit? This will set the limit to 0.')) {
                      return;
                    }
                    try {
                      await setDailyLimit.mutateAsync(0n);
                    } catch (err: any) {
                      setErrors([err.message || 'Failed to disable daily limit']);
                    }
                  }}
                  disabled={setDailyLimit.isPending}
                  className="btn-secondary text-base px-4 py-2.5 inline-flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Disable
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Reset Limit */}
        {dailyLimit && dailyLimit.limit > 0n && dailyLimit.spent > 0n && (
          <div>
            <h3 className="text-base font-mono text-dark-500 uppercase tracking-wider mb-4">Reset Daily Limit</h3>
            <p className="text-sm text-dark-500 mb-4">
              Manually reset the spent amount to 0. The limit will automatically reset after 24 hours.
            </p>
            <button
              onClick={handleReset}
              disabled={resetDailyLimit.isPending}
              className="btn-secondary w-full text-base px-4 py-2.5 inline-flex items-center justify-center gap-2"
            >
              {resetDailyLimit.isPending ? (
                <>
                  <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                  Resetting...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Reset Spent Amount
                </>
              )}
            </button>
          </div>
        )}

        {/* Errors */}
        {errors.length > 0 && (
          <div className="bg-gradient-to-r from-primary-900/90 via-primary-800/90 to-primary-900/90 border-l-4 border-primary-600 rounded-md p-4 shadow-red-glow">
            <h4 className="text-base font-semibold text-primary-200 mb-2 flex items-center gap-2">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              Error
            </h4>
            <ul className="list-disc list-inside text-sm text-primary-200 space-y-1">
              {errors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Modal>
  );
}
