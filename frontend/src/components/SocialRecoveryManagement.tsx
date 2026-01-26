import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { multisigService } from '../services/MultisigService';
import { notificationManager } from './NotificationContainer';
import { useWalletStore } from '../store/walletStore';
import { Modal } from './Modal';
import * as quais from 'quais';

interface SocialRecoveryManagementProps {
  walletAddress: string;
  isOpen: boolean;
  onClose: () => void;
  onUpdate?: () => void;
}

export function SocialRecoveryManagement({ walletAddress, isOpen, onClose, onUpdate }: SocialRecoveryManagementProps) {
  const queryClient = useQueryClient();
  const { address: connectedAddress } = useWalletStore();
  
  // Recovery initiation form state
  const [showInitiateRecovery, setShowInitiateRecovery] = useState(false);
  const [newOwners, setNewOwners] = useState<string[]>(['']);
  const [newThreshold, setNewThreshold] = useState<number>(1);
  const [errors, setErrors] = useState<string[]>([]);

  // Query recovery configuration
  const { data: recoveryConfig, isLoading: isLoadingConfig } = useQuery({
    queryKey: ['recoveryConfig', walletAddress],
    queryFn: async () => {
      return await multisigService.getRecoveryConfig(walletAddress);
    },
    enabled: !!walletAddress && isOpen,
    refetchInterval: 30000,
  });

  // Query pending recoveries
  const { data: pendingRecoveries, isLoading: isLoadingRecoveries, refetch: refetchRecoveries } = useQuery({
    queryKey: ['pendingRecoveries', walletAddress],
    queryFn: async () => {
      return await multisigService.getPendingRecoveries(walletAddress);
    },
    enabled: !!walletAddress && !!recoveryConfig && recoveryConfig.guardians.length > 0 && isOpen,
    refetchInterval: 30000,
  });

  // Query approval statuses for all recoveries
  const { data: approvalStatuses, isLoading: isLoadingApprovals } = useQuery({
    queryKey: ['recoveryApprovalStatuses', walletAddress, connectedAddress, pendingRecoveries?.map(r => r.recoveryHash).join(',')],
    queryFn: async () => {
      if (!connectedAddress || !pendingRecoveries || pendingRecoveries.length === 0) {
        return new Map<string, boolean>();
      }
      
      const statusMap = new Map<string, boolean>();
      await Promise.all(
        pendingRecoveries.map(async (recovery) => {
          try {
            const hasApproved = await multisigService.hasApprovedRecovery(
              walletAddress,
              recovery.recoveryHash,
              connectedAddress
            );
            statusMap.set(recovery.recoveryHash, hasApproved);
          } catch (error) {
            console.error(`Error checking approval status for ${recovery.recoveryHash}:`, error);
            statusMap.set(recovery.recoveryHash, false);
          }
        })
      );
      return statusMap;
    },
    enabled: !!connectedAddress && !!pendingRecoveries && pendingRecoveries.length > 0 && isOpen,
    refetchInterval: 30000,
    retry: 1,
  });

  // Check if connected address is a guardian
  const { data: isGuardian } = useQuery({
    queryKey: ['isGuardian', walletAddress, connectedAddress],
    queryFn: async () => {
      if (!connectedAddress || !walletAddress) return false;
      return await multisigService.isGuardian(walletAddress, connectedAddress);
    },
    enabled: !!walletAddress && !!connectedAddress && isOpen,
  });

  // Initiate recovery mutation
  const initiateRecovery = useMutation({
    mutationFn: async ({ newOwners, newThreshold }: { newOwners: string[]; newThreshold: number }) => {
      return await multisigService.initiateRecovery(walletAddress, newOwners, newThreshold);
    },
    onSuccess: () => {
      notificationManager.add({
        message: '✅ Recovery initiated successfully',
        type: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['pendingRecoveries', walletAddress] });
      queryClient.invalidateQueries({ queryKey: ['recoveryApprovalStatuses'] });
      setTimeout(() => {
        refetchRecoveries();
      }, 2000);
      setShowInitiateRecovery(false);
      setNewOwners(['']);
      setNewThreshold(1);
      setErrors([]);
    },
    onError: (error) => {
      setErrors([error instanceof Error ? error.message : 'Failed to initiate recovery']);
    },
  });

  // Approve recovery mutation
  const approveRecovery = useMutation({
    mutationFn: async (recoveryHash: string) => {
      return await multisigService.approveRecovery(walletAddress, recoveryHash);
    },
    onSuccess: () => {
      notificationManager.add({
        message: '✅ Recovery approved successfully',
        type: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['pendingRecoveries', walletAddress] });
      queryClient.invalidateQueries({ queryKey: ['recoveryApprovalStatuses'] });
      refetchRecoveries();
    },
    onError: (error) => {
      setErrors([error instanceof Error ? error.message : 'Failed to approve recovery']);
    },
  });

  // Execute recovery mutation
  const executeRecovery = useMutation({
    mutationFn: async (recoveryHash: string) => {
      return await multisigService.executeRecovery(walletAddress, recoveryHash);
    },
    onSuccess: () => {
      notificationManager.add({
        message: '✅ Recovery executed successfully',
        type: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['pendingRecoveries', walletAddress] });
      queryClient.invalidateQueries({ queryKey: ['walletInfo', walletAddress] });
      refetchRecoveries();
      onUpdate?.();
    },
    onError: (error) => {
      setErrors([error instanceof Error ? error.message : 'Failed to execute recovery']);
    },
  });

  // Cancel recovery mutation
  const cancelRecovery = useMutation({
    mutationFn: async (recoveryHash: string) => {
      return await multisigService.cancelRecovery(walletAddress, recoveryHash);
    },
    onSuccess: () => {
      notificationManager.add({
        message: '✅ Recovery cancelled successfully',
        type: 'success',
      });
      queryClient.invalidateQueries({ queryKey: ['pendingRecoveries', walletAddress] });
      refetchRecoveries();
    },
    onError: (error) => {
      setErrors([error instanceof Error ? error.message : 'Failed to cancel recovery']);
    },
  });

  const updateNewOwner = (index: number, value: string) => {
    const owners = [...newOwners];
    owners[index] = value;
    setNewOwners(owners);
    setErrors([]);
  };

  const addNewOwner = () => {
    setNewOwners([...newOwners, '']);
  };

  const removeNewOwner = (index: number) => {
    const owners = newOwners.filter((_, i) => i !== index);
    setNewOwners(owners);
    if (newThreshold > owners.length) {
      setNewThreshold(owners.length);
    }
    setErrors([]);
  };

  const validateRecoveryForm = (): boolean => {
    const newErrors: string[] = [];
    const validOwners = newOwners.filter(o => o.trim() !== '');

    if (validOwners.length === 0) {
      newErrors.push('At least one new owner is required');
    }

    for (const owner of validOwners) {
      if (!quais.isAddress(owner.trim())) {
        newErrors.push(`Invalid owner address: ${owner.substring(0, 10)}...`);
      }
    }

    const normalizedOwners = validOwners.map(o => quais.getAddress(o.trim()).toLowerCase());
    const uniqueOwners = new Set(normalizedOwners);
    if (uniqueOwners.size !== normalizedOwners.length) {
      newErrors.push('Duplicate owner addresses found');
    }

    if (newThreshold < 1 || newThreshold > validOwners.length) {
      newErrors.push(`Threshold must be between 1 and ${validOwners.length}`);
    }

    setErrors(newErrors);
    return newErrors.length === 0;
  };

  const handleInitiateRecovery = async () => {
    if (!validateRecoveryForm()) {
      return;
    }

    const validOwners = newOwners.filter(o => o.trim() !== '');
    initiateRecovery.mutate({ newOwners: validOwners, newThreshold });
  };

  const formatTimeUntilExecution = (executionTime: bigint): string => {
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (executionTime <= now) {
      return 'Ready to execute';
    }
    const secondsRemaining = Number(executionTime - now);
    const days = Math.floor(secondsRemaining / 86400);
    const hours = Math.floor((secondsRemaining % 86400) / 3600);
    const minutes = Math.floor((secondsRemaining % 3600) / 60);
    
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  if (!isOpen) return null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Social Recovery Management"
      size="lg"
    >
      <div className="space-y-6">
        {/* Important Information */}
        <div className="bg-gradient-to-r from-blue-900/90 via-blue-800/90 to-blue-900/90 border-l-4 border-blue-600 rounded-md p-4">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <div>
              <h4 className="text-base font-semibold text-blue-200 mb-1">Recovery Process</h4>
              <p className="text-sm text-blue-200/90 mb-2">
                Guardians can initiate a recovery process to change the wallet's owners and threshold. After the recovery period elapses and enough guardians approve, the recovery can be executed.
              </p>
              {isGuardian && (
                <p className="text-sm text-blue-200/90 font-semibold">
                  You are a guardian and can initiate or approve recoveries.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Current Configuration Summary */}
        {isLoadingConfig ? (
          <div className="text-center py-4">
            <div className="inline-block w-5 h-5 border-2 border-primary-600 border-t-transparent rounded-full animate-spin"></div>
            <p className="mt-2 text-sm text-dark-500">Loading configuration...</p>
          </div>
        ) : recoveryConfig && recoveryConfig.guardians.length > 0 ? (
          <div className="bg-vault-dark-4 rounded-md p-4 border border-dark-600">
            <h3 className="text-sm font-mono text-dark-500 uppercase tracking-wider mb-3">Current Configuration</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-dark-500">Guardians:</span>
                <span className="ml-2 text-dark-200 font-semibold">{recoveryConfig.guardians.length}</span>
              </div>
              <div>
                <span className="text-dark-500">Threshold:</span>
                <span className="ml-2 text-dark-200 font-semibold">{recoveryConfig.threshold.toString()} of {recoveryConfig.guardians.length}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-vault-dark-4 rounded-md p-4 border border-dark-600">
            <p className="text-sm text-dark-400 text-center">No recovery configuration set. Please configure recovery first.</p>
          </div>
        )}

        {/* Initiate Recovery Section */}
        {recoveryConfig && recoveryConfig.guardians.length > 0 && isGuardian && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-mono text-dark-500 uppercase tracking-wider">Initiate Recovery</h3>
              <button
                onClick={() => setShowInitiateRecovery(!showInitiateRecovery)}
                className="btn-primary text-sm px-3 py-1.5 inline-flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                {showInitiateRecovery ? 'Cancel' : 'Initiate Recovery'}
              </button>
            </div>

            {/* Initiate Recovery Form */}
            {showInitiateRecovery && (
              <div className="mb-6 p-4 bg-vault-dark-4 rounded-md border border-dark-600">
                <h4 className="text-sm font-mono text-dark-500 uppercase tracking-wider mb-3">New Recovery Configuration</h4>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-mono text-dark-500 uppercase tracking-wider mb-2">
                      New Owners
                    </label>
                    <div className="space-y-2">
                      {newOwners.map((owner, index) => (
                        <div key={index} className="flex gap-2">
                          <input
                            type="text"
                            value={owner}
                            onChange={(e) => updateNewOwner(index, e.target.value)}
                            placeholder="0x..."
                            className="input-field flex-1"
                          />
                          {newOwners.length > 1 && (
                            <button
                              onClick={() => removeNewOwner(index)}
                              className="btn-secondary px-3 py-2"
                              type="button"
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          )}
                        </div>
                      ))}
                      <button
                        onClick={addNewOwner}
                        className="btn-secondary text-sm px-3 py-1.5 inline-flex items-center gap-2"
                        type="button"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Add Owner
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-mono text-dark-500 uppercase tracking-wider mb-2">
                      New Threshold
                    </label>
                    <input
                      type="number"
                      value={newThreshold}
                      onChange={(e) => {
                        const value = parseInt(e.target.value) || 1;
                        setNewThreshold(Math.max(1, Math.min(value, newOwners.filter(o => o.trim() !== '').length || 1)));
                      }}
                      min={1}
                      max={newOwners.filter(o => o.trim() !== '').length || 1}
                      className="input-field w-full"
                    />
                  </div>
                  {errors.length > 0 && (
                    <div className="bg-gradient-to-r from-primary-900/90 via-primary-800/90 to-primary-900/90 border-l-4 border-primary-600 rounded-md p-3 shadow-red-glow">
                      <ul className="text-sm text-primary-200 space-y-1">
                        {errors.map((error, index) => (
                          <li key={index} className="font-medium">• {error}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <button
                    onClick={handleInitiateRecovery}
                    disabled={initiateRecovery.isPending}
                    className="btn-primary w-full text-sm px-4 py-2 inline-flex items-center justify-center gap-2"
                  >
                    {initiateRecovery.isPending ? (
                      <>
                        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                        Initiating...
                      </>
                    ) : (
                      'Initiate Recovery'
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Pending Recoveries */}
        {recoveryConfig && recoveryConfig.guardians.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-mono text-dark-500 uppercase tracking-wider">Pending Recoveries</h3>
              <button
                onClick={() => {
                  queryClient.invalidateQueries({ queryKey: ['pendingRecoveries', walletAddress] });
                  refetchRecoveries();
                }}
                className="btn-secondary text-xs px-2 py-1 inline-flex items-center gap-1"
                title="Refresh recoveries list"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </button>
            </div>
            {isLoadingRecoveries ? (
              <div className="text-center py-4">
                <div className="inline-block w-5 h-5 border-2 border-primary-600 border-t-transparent rounded-full animate-spin"></div>
                <p className="mt-2 text-sm text-dark-500">Loading recoveries...</p>
              </div>
            ) : pendingRecoveries && pendingRecoveries.length > 0 ? (
              <div className="space-y-3">
                {pendingRecoveries.map((recovery) => {
                  const now = BigInt(Math.floor(Date.now() / 1000));
                  const canExecute = recovery.executionTime <= now && Number(recovery.approvalCount) >= Number(recoveryConfig.threshold);
                  const requiredApprovals = Number(recoveryConfig.threshold);
                  const currentApprovals = Number(recovery.approvalCount);
                  const hasApproved = approvalStatuses?.get(recovery.recoveryHash) === true;
                  
                  return (
                    <div key={recovery.recoveryHash} className="bg-vault-dark-4 rounded-md p-4 border border-dark-600">
                      <div className="space-y-3">
                        <div>
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-sm font-mono text-dark-500 uppercase tracking-wider">Recovery Hash:</span>
                            <span className="text-xs font-mono text-primary-300">{recovery.recoveryHash.slice(0, 10)}...{recovery.recoveryHash.slice(-8)}</span>
                          </div>
                          <div className="text-sm text-dark-400 mb-2">
                            <div className="mb-1">
                              <strong>New Owners:</strong> {recovery.newOwners.length}
                            </div>
                            <div className="mb-1">
                              <strong>New Threshold:</strong> {recovery.newThreshold.toString()}
                            </div>
                            <div>
                              <strong>Approvals:</strong> {currentApprovals} / {requiredApprovals}
                            </div>
                            <div>
                              <strong>Execution Time:</strong> {formatTimeUntilExecution(recovery.executionTime)}
                            </div>
                          </div>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          {isGuardian && currentApprovals < requiredApprovals && (
                            <button
                              onClick={() => approveRecovery.mutate(recovery.recoveryHash)}
                              disabled={approveRecovery.isPending || hasApproved || isLoadingApprovals}
                              className={`text-sm px-3 py-1.5 inline-flex items-center gap-2 ${
                                hasApproved
                                  ? 'btn-secondary opacity-50 cursor-not-allowed' 
                                  : 'btn-primary'
                              }`}
                              title={hasApproved ? 'You have already approved this recovery' : isLoadingApprovals ? 'Checking approval status...' : ''}
                            >
                              {approveRecovery.isPending ? (
                                <>
                                  <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                                  Approving...
                                </>
                              ) : hasApproved ? (
                                <>
                                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                  Approved
                                </>
                              ) : (
                                'Approve'
                              )}
                            </button>
                          )}
                          {canExecute && (
                            <button
                              onClick={() => executeRecovery.mutate(recovery.recoveryHash)}
                              disabled={executeRecovery.isPending}
                              className="btn-primary text-sm px-3 py-1.5 inline-flex items-center gap-2"
                            >
                              {executeRecovery.isPending ? (
                                <>
                                  <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                                  Executing...
                                </>
                              ) : (
                                'Execute Recovery'
                              )}
                            </button>
                          )}
                          <button
                            onClick={() => {
                              if (window.confirm('Cancel this recovery?')) {
                                cancelRecovery.mutate(recovery.recoveryHash);
                              }
                            }}
                            disabled={cancelRecovery.isPending}
                            className="btn-secondary text-sm px-3 py-1.5 inline-flex items-center gap-2"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="bg-vault-dark-4 rounded-md p-4 border border-dark-600">
                <p className="text-sm text-dark-400 text-center">No pending recoveries</p>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
