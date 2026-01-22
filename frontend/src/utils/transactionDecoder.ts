import * as quais from 'quais';
import MultisigWalletABI from '../config/abi/MultisigWallet.json';

export interface DecodedTransaction {
  type: 'transfer' | 'addOwner' | 'removeOwner' | 'changeThreshold' | 'contractCall';
  description: string;
  details?: string;
  icon: string;
  bgColor: string;
  borderColor: string;
  textColor: string;
}

function formatAddress(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function decodeTransaction(
  tx: { to: string; value: string; data: string },
  walletAddress: string
): DecodedTransaction {
  // Plain transfer
  if (tx.data === '0x' || tx.data === '') {
    return {
      type: 'transfer',
      description: 'Transfer QUAI',
      details: `${parseFloat(quais.formatQuai(tx.value)).toFixed(4)} QUAI`,
      icon: '💸',
      bgColor: 'bg-primary-900',
      borderColor: 'border-primary-700',
      textColor: 'text-primary-200',
    };
  }

  // Self-call (wallet calling itself) - likely owner management
  if (tx.to.toLowerCase() === walletAddress.toLowerCase()) {
    try {
      const iface = new quais.Interface(MultisigWalletABI.abi);
      const decoded = iface.parseTransaction({ data: tx.data });

      if (!decoded) {
        return {
          type: 'contractCall',
          description: 'Contract Call',
          details: 'Unknown function',
          icon: '📄',
          bgColor: 'bg-dark-400',
          borderColor: 'border-dark-500',
          textColor: 'text-dark-900',
        };
      }

      switch (decoded.name) {
        case 'addOwner': {
          const ownerAddress = decoded.args[0] as string;
          return {
            type: 'addOwner',
            description: 'Add Owner',
            details: `Add ${formatAddress(ownerAddress)} as owner`,
            icon: '➕',
            bgColor: 'bg-green-900',
            borderColor: 'border-green-700',
            textColor: 'text-green-200',
          };
        }
        case 'removeOwner': {
          const ownerAddress = decoded.args[0] as string;
          return {
            type: 'removeOwner',
            description: 'Remove Owner',
            details: `Remove ${formatAddress(ownerAddress)} as owner`,
            icon: '➖',
            bgColor: 'bg-red-900',
            borderColor: 'border-red-700',
            textColor: 'text-red-200',
          };
        }
        case 'changeThreshold': {
          const newThreshold = decoded.args[0] as bigint;
          return {
            type: 'changeThreshold',
            description: 'Change Threshold',
            details: `Set threshold to ${newThreshold.toString()}`,
            icon: '🔢',
            bgColor: 'bg-blue-900',
            borderColor: 'border-blue-700',
            textColor: 'text-blue-200',
          };
        }
        default:
          return {
            type: 'contractCall',
            description: 'Wallet Operation',
            details: decoded.name,
            icon: '📄',
            bgColor: 'bg-dark-400',
            borderColor: 'border-dark-500',
            textColor: 'text-dark-900',
          };
      }
    } catch (error) {
      console.error('Failed to decode transaction:', error);
      return {
        type: 'contractCall',
        description: 'Contract Call',
        details: 'Unable to decode',
        icon: '📄',
        bgColor: 'bg-dark-400',
        borderColor: 'border-dark-500',
        textColor: 'text-dark-900',
      };
    }
  }

  // External contract call
  return {
    type: 'contractCall',
    description: 'Contract Call',
    details: `Call to ${formatAddress(tx.to)}`,
    icon: '📄',
    bgColor: 'bg-dark-400',
    borderColor: 'border-dark-500',
    textColor: 'text-dark-900',
  };
}
