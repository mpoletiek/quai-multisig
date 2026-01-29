import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { multisigService } from '../services/MultisigService';
import { notificationManager } from './NotificationContainer';
import { EmptyState } from './EmptyState';
import { Modal } from './Modal';
import * as quais from 'quais';

interface WhitelistConfigurationProps {
  walletAddress: string;
  onUpdate: () => void;
}

export function WhitelistConfiguration({ walletAddress, onUpdate }: WhitelistConfigurationProps) {
  const queryClient = useQueryClient();
  const [newAddress, setNewAddress] = useState('');
  const [newLimit, setNewLimit] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [addressToRemove, setAddressToRemove] = useState<string | null>(null);

  // Query whitelisted addresses
  const { data: whitelistedAddresses, isLoading, refetch } = useQuery({
    queryKey: ['whitelistedAddresses', walletAddress],
    queryFn: async () => {
      return await multisigService.getWhitelistedAddresses(walletAddress);
    },
    enabled: !!walletAddress,
    refetchInterval: 30000, // Refetch every 30 seconds
  });

  // Propose add to whitelist mutation (now creates a multisig proposal)
  const proposeAddToWhitelist = useMutation({
    mutationFn: async ({ address, limit }: { address: string; limit: bigint }) => {
      return await multisigService.proposeAddToWhitelist(walletAddress, address, limit);
    },
    onSuccess: (txHash, variables) => {
      const limitText = variables.limit === 0n
        ? 'unlimited'
        : `${parseFloat(quais.formatQuai(variables.limit)).toFixed(4)} QUAI`;
      const shortAddress = `${variables.address.slice(0, 6)}...${variables.address.slice(-4)}`;
      const shortHash = `${txHash.slice(0, 10)}...${txHash.slice(-8)}`;

      notificationManager.add({
        message: `Proposal created to add ${shortAddress} to whitelist (limit: ${limitText}). Requires multisig approval.`,
        type: 'success',
      });

      // Browser notification
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('Whitelist Proposal Created', {
          body: `Proposal ${shortHash} to add ${shortAddress} requires approval`,
          icon: '/vite.svg',
        });
      }

      queryClient.invalidateQueries({ queryKey: ['pendingTransactions'] });
      setNewAddress('');
      setNewLimit('');
      setErrors([]);
      onUpdate();
    },
    onError: (error) => {
      setErrors([error instanceof Error ? error.message : 'Failed to create proposal']);
    },
  });

  // Propose remove from whitelist mutation (now creates a multisig proposal)
  const proposeRemoveFromWhitelist = useMutation({
    mutationFn: async (address: string) => {
      return await multisigService.proposeRemoveFromWhitelist(walletAddress, address);
    },
    onSuccess: (txHash, address) => {
      const shortAddress = `${address.slice(0, 6)}...${address.slice(-4)}`;
      const shortHash = `${txHash.slice(0, 10)}...${txHash.slice(-8)}`;

      notificationManager.add({
        message: `Proposal created to remove ${shortAddress} from whitelist. Requires multisig approval.`,
        type: 'success',
      });

      // Browser notification
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('Whitelist Removal Proposal Created', {
          body: `Proposal ${shortHash} to remove ${shortAddress} requires approval`,
          icon: '/vite.svg',
        });
      }

      queryClient.invalidateQueries({ queryKey: ['pendingTransactions'] });
      setAddressToRemove(null);
      onUpdate();
    },
    onError: (error) => {
      setErrors([error instanceof Error ? error.message : 'Failed to create proposal']);
    },
  });

  const validateForm = (): boolean => {
    const newErrors: string[] = [];

    if (!newAddress.trim()) {
      newErrors.push('Address is required');
    } else if (!quais.isAddress(newAddress.trim())) {
      newErrors.push('Invalid address format');
    }

    if (newLimit.trim() && newLimit.trim() !== '0') {
      const limitValue = parseFloat(newLimit.trim());
      if (isNaN(limitValue) || limitValue < 0) {
        newErrors.push('Limit must be a positive number or 0 for unlimited');
      }
    }

    // Check if address is already whitelisted
    if (newAddress.trim() && quais.isAddress(newAddress.trim())) {
      const normalized = quais.getAddress(newAddress.trim()).toLowerCase();
      const isAlreadyWhitelisted = whitelistedAddresses?.some(
        (entry) => entry.address.toLowerCase() === normalized
      );
      if (isAlreadyWhitelisted) {
        newErrors.push('Address is already whitelisted');
      }
    }

    setErrors(newErrors);
    return newErrors.length === 0;
  };

  const handleAdd = async () => {
    if (!validateForm()) {
      return;
    }

    const normalizedAddress = quais.getAddress(newAddress.trim());
    const limitValue = newLimit.trim() === '' || newLimit.trim() === '0'
      ? 0n
      : quais.parseQuai(newLimit.trim());

    proposeAddToWhitelist.mutate({ address: normalizedAddress, limit: limitValue });
  };

  const handleRemove = async (address: string) => {
    if (window.confirm(`Create a proposal to remove ${address} from whitelist? This will require multisig approval.`)) {
      setAddressToRemove(address);
      proposeRemoveFromWhitelist.mutate(address);
    }
  };

  const formatLimit = (limit: bigint): string => {
    if (limit === 0n) {
      return 'Unlimited';
    }
    return `${parseFloat(quais.formatQuai(limit)).toFixed(4)} QUAI`;
  };

  return (
    <Modal
      isOpen={true}
      onClose={onUpdate}
      title="Whitelist Configuration"
      size="lg"
    >
      <div className="space-y-6">
          {/* Multisig Approval Notice */}
        <div className="bg-gradient-to-r from-green-900/90 via-green-800/90 to-green-900/90 border-l-4 border-green-600 rounded-md p-4">
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <div>
            <h4 className="text-base font-semibold text-green-200 mb-1">Multisig Approval Required</h4>
            <p className="text-sm text-green-200/90">
              Changes to the whitelist now require multisig approval. When you add or remove addresses, a proposal will be created that other owners must approve before it takes effect.
            </p>
          </div>
          </div>
        </div>

        {/* Important Information */}
        <div className="bg-gradient-to-r from-blue-900/90 via-blue-800/90 to-blue-900/90 border-l-4 border-blue-600 rounded-md p-4">
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
          <div>
            <h4 className="text-base font-semibold text-blue-200 mb-1">How Whitelist Works</h4>
            <p className="text-sm text-blue-200/90 mb-2">
              Whitelisted addresses can receive funds <strong>without requiring multisig approvals</strong> when using this frontend. The whitelist is enforced at the <strong>smart contract level</strong>, so it cannot be bypassed by interacting with the contract directly.
            </p>
            <p className="text-sm text-blue-200/90">
              <strong>Important:</strong> Only use whitelist for trusted addresses. Once whitelisted, any owner can send funds to that address without approval from other owners.
            </p>
          </div>
          </div>
        </div>

        {/* Add Address Form */}
        <div className="p-4 bg-vault-dark-4 rounded-md border border-dark-600">
        <h3 className="text-base font-semibold text-dark-200 mb-3">Propose Add Address to Whitelist</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-mono text-dark-500 uppercase tracking-wider mb-2">
              Address
            </label>
            <input
              type="text"
              value={newAddress}
              onChange={(e) => {
                setNewAddress(e.target.value);
                setErrors([]);
              }}
              placeholder="0x..."
              className="input-field w-full"
            />
          </div>
          <div>
            <label className="block text-sm font-mono text-dark-500 uppercase tracking-wider mb-2">
              Limit (QUAI) - Leave empty or 0 for unlimited
            </label>
            <input
              type="text"
              value={newLimit}
              onChange={(e) => {
                setNewLimit(e.target.value);
                setErrors([]);
              }}
              placeholder="0 or leave empty for unlimited"
              className="input-field w-full"
            />
          </div>
          {errors.length > 0 && (
            <div className="bg-gradient-to-r from-primary-900/90 via-primary-800/90 to-primary-900/90 border-l-4 border-primary-600 rounded-md p-3 shadow-red-glow">
              <ul className="text-sm text-primary-200 space-y-1">
                {errors.map((error, index) => (
                  <li key={index} className="font-medium">{error}</li>
                ))}
              </ul>
            </div>
          )}
          <button
            onClick={handleAdd}
            disabled={proposeAddToWhitelist.isPending}
            className="btn-primary text-base px-4 py-2 inline-flex items-center gap-2"
          >
            {proposeAddToWhitelist.isPending ? (
              <>
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                Creating Proposal...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Propose Add to Whitelist
              </>
            )}
            </button>
          </div>
        </div>

        {/* Whitelisted Addresses List */}
          {isLoading ? (
          <div className="text-center py-8">
            <div className="relative inline-block">
              <div className="absolute inset-0 bg-primary-600/20 blur-xl animate-pulse"></div>
              <div className="relative inline-block h-8 w-8 animate-spin rounded-full border-2 border-solid border-primary-600 border-r-transparent"></div>
            </div>
            <p className="mt-4 text-base text-dark-400 font-semibold">Loading whitelist...</p>
          </div>
        ) : !whitelistedAddresses || whitelistedAddresses.length === 0 ? (
            <EmptyState
            icon={
              <svg className="w-6 h-6 text-dark-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            }
            title="No Whitelisted Addresses"
            description="Add addresses to the whitelist to enable quick execution of transactions without requiring approvals. Use the form above to create a proposal."
            className="py-8"
          />
        ) : (
            <div className="space-y-2">
            {whitelistedAddresses.map((entry) => (
              <div
                key={entry.address}
                className="flex items-center justify-between p-3 bg-vault-dark-4 rounded-md border border-dark-600 hover:border-primary-600/30 transition-all"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <div className="w-2 h-2 rounded-full bg-primary-600"></div>
                    <span className="text-base font-mono text-primary-300 truncate">{entry.address}</span>
                  </div>
                  <p className="text-sm text-dark-500">
                    Limit: <span className="font-semibold text-dark-300">{formatLimit(entry.limit)}</span>
                  </p>
                </div>
                <button
                  onClick={() => handleRemove(entry.address)}
                  disabled={proposeRemoveFromWhitelist.isPending}
                  className="btn-secondary text-sm px-3 py-1.5 inline-flex items-center gap-2 flex-shrink-0"
                >
                  {proposeRemoveFromWhitelist.isPending && addressToRemove === entry.address ? (
                    <>
                      <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                      Creating Proposal...
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                      Propose Remove
                    </>
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
