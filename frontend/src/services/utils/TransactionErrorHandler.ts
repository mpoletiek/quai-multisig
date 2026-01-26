import * as quais from 'quais';
import type { Contract } from '../../types';

/**
 * Transaction error handler utility
 * Provides reusable error decoding and messaging for blockchain transactions
 */

/**
 * Check if an error indicates user rejection
 */
export function isUserRejection(error: any): boolean {
  if (error.code === 'ACTION_REJECTED' || error.code === 4001) {
    return true;
  }
  if (error.message) {
    const message = error.message.toLowerCase();
    return message.includes('rejected') ||
           message.includes('denied') ||
           message.includes('cancelled');
  }
  return false;
}

/**
 * Decode error data using contract interface
 */
export function decodeErrorData(contract: Contract, errorData: string): string | null {
  if (!errorData || errorData === '0x') {
    return null;
  }

  try {
    const decoded = contract.interface.parseError(errorData);
    if (decoded) {
      if (decoded.name === 'Error' && decoded.args && decoded.args.length > 0) {
        return decoded.args[0].toString();
      }
      let message = decoded.name;
      if (decoded.args && decoded.args.length > 0) {
        message += ` - ${decoded.args.map((arg: any) => arg.toString()).join(', ')}`;
      }
      return message;
    }
  } catch {
    // Try to decode as a plain string error message
    if (errorData.length > 138) {
      try {
        const errorString = quais.AbiCoder.defaultAbiCoder().decode(
          ['string'],
          '0x' + errorData.slice(138)
        )[0];
        if (errorString) {
          return errorString;
        }
      } catch {
        // Decoding failed
      }
    }
  }

  return null;
}

/**
 * Extract error message from various error formats
 */
export function extractErrorMessage(error: any, contract?: Contract): string {
  // Check for explicit reason
  if (error.reason) {
    return error.reason;
  }

  // Try to decode error data
  if (error.data && contract) {
    const decoded = decodeErrorData(contract, error.data);
    if (decoded) {
      return decoded;
    }
  }

  // Fall back to message
  if (error.message) {
    return error.message;
  }

  return 'Unknown error';
}

/**
 * Format error for user display with context
 */
export function formatTransactionError(
  error: any,
  operation: string,
  contract?: Contract
): Error {
  if (isUserRejection(error)) {
    return new Error('Transaction was rejected by user');
  }

  const message = extractErrorMessage(error, contract);
  return new Error(`${operation}: ${message}`);
}

/**
 * Check receipt status and throw if reverted
 */
export function checkReceiptStatus(
  receipt: any,
  operation: string,
  additionalContext?: string
): void {
  if (receipt && 'status' in receipt && receipt.status === 0) {
    const context = additionalContext ? ` ${additionalContext}` : '';
    throw new Error(`${operation} reverted.${context}`);
  }
}

/**
 * Common transaction state error messages
 */
export const TransactionErrors = {
  NOT_OWNER: 'Only wallet owners can perform this action',
  TX_NOT_FOUND: 'Transaction does not exist',
  TX_ALREADY_EXECUTED: 'Transaction has already been executed',
  TX_CANCELLED: 'Transaction has been cancelled',
  NOT_ENOUGH_APPROVALS: (current: number, required: number) =>
    `Not enough approvals: ${current} / ${required} required`,
  ALREADY_APPROVED: 'You have already approved this transaction',
  NOT_APPROVED: 'You have not approved this transaction',
  SIGNER_NOT_SET: 'Signer not set. Connect wallet first.',
  INVALID_ADDRESS: (addr: string) => `Invalid address format: ${addr}`,
  INVALID_HASH_LENGTH: (length: number) =>
    `Invalid transaction hash length: ${length} (expected 66)`,
} as const;

/**
 * Validate transaction hash format
 */
export function validateTxHash(txHash: string): string {
  let normalized = txHash;
  if (!normalized.startsWith('0x')) {
    normalized = '0x' + normalized;
  }
  if (normalized.length !== 66) {
    throw new Error(TransactionErrors.INVALID_HASH_LENGTH(normalized.length));
  }
  return normalized;
}

/**
 * Validate address format using quais
 */
export function validateAddress(address: string): string {
  const trimmed = address.trim();

  if (trimmed.length !== 42) {
    throw new Error(
      `Invalid address length: expected 42 characters, got ${trimmed.length}. ` +
      `Addresses must be 0x followed by exactly 40 hex characters.`
    );
  }

  if (!quais.isAddress(trimmed)) {
    throw new Error(
      `Invalid address format: "${trimmed}". ` +
      `Addresses must be 42 characters (0x + 40 hex characters) and pass checksum validation.`
    );
  }

  try {
    return quais.getAddress(trimmed);
  } catch (error) {
    throw new Error(
      `Invalid address format: "${trimmed}". ` +
      `${error instanceof Error ? error.message : 'Address validation failed'}`
    );
  }
}
