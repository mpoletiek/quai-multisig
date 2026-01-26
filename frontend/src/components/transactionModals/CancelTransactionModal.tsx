import { useState, useEffect } from 'react';
import { TransactionFlow } from '../TransactionFlow';
import { ConfirmDialog } from '../ConfirmDialog';
import { useMultisig } from '../../hooks/useMultisig';
import type { PendingTransaction } from '../../types';

interface CancelTransactionModalProps {
  isOpen: boolean;
  onClose: () => void;
  walletAddress: string;
  transaction: PendingTransaction;
}

export function CancelTransactionModal({
  isOpen,
  onClose,
  walletAddress,
  transaction,
}: CancelTransactionModalProps) {
  const { cancelTransactionAsync } = useMultisig(walletAddress);
  const [showFlow, setShowFlow] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  // Reset the flow when showFlow becomes true
  useEffect(() => {
    if (showFlow) {
      setResetKey(prev => prev + 1);
    }
  }, [showFlow]);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setShowFlow(false);
    }
  }, [isOpen]);

  const handleCancel = async (onProgress: (progress: any) => void) => {
    onProgress({ step: 'signing', message: 'Please approve the cancellation transaction in your wallet' });
    
    const txHash = await cancelTransactionAsync({ walletAddress, txHash: transaction.hash });
    
    onProgress({ step: 'waiting', txHash: txHash || transaction.hash, message: 'Waiting for cancellation confirmation...' });
    
    // Wait for transaction to be mined
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    return txHash || transaction.hash;
  };

  const handleConfirm = () => {
    setShowFlow(true);
  };

  const handleComplete = () => {
    setShowFlow(false);
    onClose();
  };

  const handleCancelFlow = () => {
    setShowFlow(false);
    onClose();
  };

  if (showFlow) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="vault-panel max-w-lg w-full mx-4 p-6">
          <TransactionFlow
            title="Cancel Transaction"
            description={`You are cancelling transaction ${transaction.hash.substring(0, 10)}...`}
            onExecute={handleCancel}
            onComplete={handleComplete}
            onCancel={handleCancelFlow}
            successMessage="Transaction cancelled successfully!"
            resetKey={resetKey}
          />
        </div>
      </div>
    );
  }

  return (
    <ConfirmDialog
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={handleConfirm}
      title="Cancel Transaction"
      message={`Are you sure you want to cancel transaction ${transaction.hash.substring(0, 10)}...${transaction.hash.slice(-6)}? This action cannot be undone.`}
      confirmText="Cancel Transaction"
      cancelText="Keep Transaction"
      variant="danger"
    />
  );
}
