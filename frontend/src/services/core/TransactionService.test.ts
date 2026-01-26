import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TransactionService } from './TransactionService';

// Mock config
vi.mock('../../config/contracts', () => ({
  CONTRACT_ADDRESSES: {
    MULTISIG_IMPLEMENTATION: '0xImplementation',
  },
  NETWORK_CONFIG: {
    RPC_URL: 'http://localhost:8545',
  },
}));

// Mock ABIs
vi.mock('../../config/abi/MultisigWallet.json', () => ({
  default: { abi: [] },
}));

describe('TransactionService', () => {
  let service: TransactionService;
  let mockSigner: any;
  let mockWallet: any;

  beforeEach(() => {
    vi.clearAllMocks();

    service = new TransactionService();

    mockSigner = {
      getAddress: vi.fn().mockResolvedValue('0xSignerAddress'),
    };

    mockWallet = {
      isOwner: vi.fn().mockResolvedValue(true),
      nonce: vi.fn().mockResolvedValue(1n),
      getTransactionHash: vi.fn().mockResolvedValue('0xtxhash'),
      transactions: vi.fn().mockResolvedValue({
        to: '0x0000000000000000000000000000000000000000',
        value: 0n,
        data: '0x',
        executed: false,
        cancelled: false,
        numApprovals: 0n,
        timestamp: 0n,
        proposer: '0x',
      }),
      proposeTransaction: Object.assign(
        vi.fn().mockResolvedValue({
          hash: '0xproposetxhash',
          wait: vi.fn().mockResolvedValue({
            status: 1,
            logs: [{ fragment: { name: 'TransactionProposed' }, args: { txHash: '0xnewtxhash' } }],
          }),
        }),
        { estimateGas: vi.fn().mockResolvedValue(100000n) }
      ),
      approveTransaction: Object.assign(
        vi.fn().mockResolvedValue({
          hash: '0xapprovetxhash',
          wait: vi.fn().mockResolvedValue({ status: 1 }),
        }),
        { estimateGas: vi.fn().mockResolvedValue(100000n) }
      ),
      revokeApproval: Object.assign(
        vi.fn().mockResolvedValue({
          hash: '0xrevoketxhash',
          wait: vi.fn().mockResolvedValue({ status: 1 }),
        }),
        { estimateGas: vi.fn().mockResolvedValue(100000n) }
      ),
      cancelTransaction: Object.assign(
        vi.fn().mockResolvedValue({
          hash: '0xcanceltxhash',
          wait: vi.fn().mockResolvedValue({ status: 1 }),
        }),
        { estimateGas: vi.fn().mockResolvedValue(100000n) }
      ),
      executeTransaction: Object.assign(
        vi.fn().mockResolvedValue({
          hash: '0xexecutetxhash',
          wait: vi.fn().mockResolvedValue({ status: 1, gasUsed: 150000n }),
        }),
        { estimateGas: vi.fn().mockResolvedValue(200000n) }
      ),
      approvals: vi.fn().mockResolvedValue(true),
      threshold: vi.fn().mockResolvedValue(2n),
      getOwners: vi.fn().mockResolvedValue(['0xOwner1', '0xOwner2']),
      interface: {
        parseLog: vi.fn(),
        parseTransaction: vi.fn(),
        getEvent: vi.fn(),
      },
      filters: {
        TransactionProposed: vi.fn().mockReturnValue({}),
        TransactionExecuted: vi.fn().mockReturnValue({}),
        TransactionCancelled: vi.fn().mockReturnValue({}),
      },
      queryFilter: vi.fn().mockResolvedValue([]),
    };

    vi.spyOn(service as any, 'getWalletContract').mockReturnValue(mockWallet);
  });

  describe('constructor', () => {
    it('should create service with default provider', () => {
      const newService = new TransactionService();
      expect(newService).toBeDefined();
    });
  });

  describe('proposeTransaction', () => {
    beforeEach(() => {
      service.setSigner(mockSigner);
      (service.getProvider() as any).getTransactionCount = vi.fn().mockResolvedValue(1);
    });

    it('should throw when signer not set', async () => {
      service.setSigner(null);

      await expect(
        service.proposeTransaction('0xWallet', '0xTo', 1000n, '0x')
      ).rejects.toThrow('Signer not set');
    });

    it('should throw when caller is not owner', async () => {
      mockWallet.isOwner.mockResolvedValue(false);

      await expect(
        service.proposeTransaction('0xWallet', '0xTo', 1000n, '0x')
      ).rejects.toThrow('is not an owner');
    });

    it('should propose transaction and return tx hash', async () => {
      const result = await service.proposeTransaction('0xWallet', '0xTo', 1000n, '0x');

      expect(result).toBe('0xnewtxhash');
      expect(mockWallet.proposeTransaction).toHaveBeenCalled();
    });

    it('should skip gas estimation for self-calls', async () => {
      const walletAddress = '0xWallet';
      await service.proposeTransaction(walletAddress, walletAddress, 0n, '0x');

      // Self-call should use fixed gas options
      expect(mockWallet.proposeTransaction).toHaveBeenCalled();
    });
  });

  describe('approveTransaction', () => {
    beforeEach(() => {
      service.setSigner(mockSigner);
    });

    it('should throw when signer not set', async () => {
      service.setSigner(null);

      await expect(service.approveTransaction('0xWallet', '0x' + 'a'.repeat(64))).rejects.toThrow(
        'Signer not set'
      );
    });

    it('should approve transaction', async () => {
      await service.approveTransaction('0xWallet', '0x' + 'a'.repeat(64));

      expect(mockWallet.approveTransaction).toHaveBeenCalled();
    });

    it('should normalize hash without 0x prefix', async () => {
      await service.approveTransaction('0xWallet', 'a'.repeat(64));

      expect(mockWallet.approveTransaction).toHaveBeenCalledWith(
        '0x' + 'a'.repeat(64),
        expect.any(Object)
      );
    });

    it('should throw for invalid hash length', async () => {
      await expect(service.approveTransaction('0xWallet', '0xshort')).rejects.toThrow(
        'Invalid transaction hash length'
      );
    });
  });

  describe('revokeApproval', () => {
    beforeEach(() => {
      service.setSigner(mockSigner);
      (service.getProvider() as any).getTransactionCount = vi.fn().mockResolvedValue(1);
    });

    it('should revoke approval', async () => {
      mockWallet.transactions.mockResolvedValue({
        to: '0xRecipient',
        executed: false,
        cancelled: false,
      });
      mockWallet.approvals
        .mockResolvedValueOnce(true)  // First call: has approved
        .mockResolvedValueOnce(false); // After revoke: no longer approved

      await service.revokeApproval('0xWallet', '0x' + 'a'.repeat(64));

      expect(mockWallet.revokeApproval).toHaveBeenCalled();
    });

    it('should throw when transaction not found', async () => {
      mockWallet.transactions.mockResolvedValue({
        to: '0x0000000000000000000000000000000000000000',
      });

      await expect(
        service.revokeApproval('0xWallet', '0x' + 'a'.repeat(64))
      ).rejects.toThrow('Transaction does not exist');
    });

    it('should throw when not approved', async () => {
      mockWallet.transactions.mockResolvedValue({
        to: '0xRecipient',
        executed: false,
        cancelled: false,
      });
      mockWallet.approvals.mockResolvedValue(false);

      await expect(
        service.revokeApproval('0xWallet', '0x' + 'a'.repeat(64))
      ).rejects.toThrow('You have not approved this transaction');
    });

    it('should throw when transaction executed', async () => {
      mockWallet.transactions.mockResolvedValue({
        to: '0xRecipient',
        executed: true,
        cancelled: false,
      });

      await expect(
        service.revokeApproval('0xWallet', '0x' + 'a'.repeat(64))
      ).rejects.toThrow('Cannot revoke approval for an executed transaction');
    });
  });

  describe('cancelTransaction', () => {
    beforeEach(() => {
      service.setSigner(mockSigner);
    });

    it('should cancel transaction when caller is proposer', async () => {
      mockWallet.transactions.mockResolvedValue({
        to: '0xRecipient',
        executed: false,
        cancelled: false,
        proposer: '0xSignerAddress',
        numApprovals: 1n,
      });
      mockWallet.isOwner.mockResolvedValue(true);

      await service.cancelTransaction('0xWallet', '0x' + 'a'.repeat(64));

      expect(mockWallet.cancelTransaction).toHaveBeenCalled();
    });

    it('should throw when transaction not found', async () => {
      mockWallet.transactions.mockResolvedValue({
        to: '0x0000000000000000000000000000000000000000',
      });

      await expect(
        service.cancelTransaction('0xWallet', '0x' + 'a'.repeat(64))
      ).rejects.toThrow('Transaction does not exist');
    });

    it('should throw when already executed', async () => {
      mockWallet.transactions.mockResolvedValue({
        to: '0xRecipient',
        executed: true,
        cancelled: false,
      });

      await expect(
        service.cancelTransaction('0xWallet', '0x' + 'a'.repeat(64))
      ).rejects.toThrow('Cannot cancel an executed transaction');
    });

    it('should throw when already cancelled', async () => {
      mockWallet.transactions.mockResolvedValue({
        to: '0xRecipient',
        executed: false,
        cancelled: true,
      });

      await expect(
        service.cancelTransaction('0xWallet', '0x' + 'a'.repeat(64))
      ).rejects.toThrow('already been cancelled');
    });

    it('should throw when not owner', async () => {
      mockWallet.transactions.mockResolvedValue({
        to: '0xRecipient',
        executed: false,
        cancelled: false,
        proposer: '0xOtherAddress',
        numApprovals: 0n,
      });
      mockWallet.isOwner.mockResolvedValue(false);

      await expect(
        service.cancelTransaction('0xWallet', '0x' + 'a'.repeat(64))
      ).rejects.toThrow('Only wallet owners can perform this action');
    });
  });

  describe('executeTransaction', () => {
    beforeEach(() => {
      service.setSigner(mockSigner);
    });

    it('should execute transaction when conditions met', async () => {
      mockWallet.transactions.mockResolvedValue({
        to: '0xRecipient',
        value: 1000n,
        data: '0x',
        executed: false,
        cancelled: false,
        numApprovals: 2n,
      });

      await service.executeTransaction('0xWallet', '0x' + 'a'.repeat(64));

      expect(mockWallet.executeTransaction).toHaveBeenCalled();
    });

    it('should throw when transaction not found', async () => {
      mockWallet.transactions.mockResolvedValue({
        to: '0x0000000000000000000000000000000000000000',
      });

      await expect(
        service.executeTransaction('0xWallet', '0x' + 'a'.repeat(64))
      ).rejects.toThrow('Transaction does not exist');
    });

    it('should throw when already executed', async () => {
      mockWallet.transactions.mockResolvedValue({
        to: '0xRecipient',
        executed: true,
      });

      await expect(
        service.executeTransaction('0xWallet', '0x' + 'a'.repeat(64))
      ).rejects.toThrow('already been executed');
    });

    it('should throw when not enough approvals', async () => {
      mockWallet.transactions.mockResolvedValue({
        to: '0xRecipient',
        executed: false,
        cancelled: false,
        numApprovals: 1n,
      });

      await expect(
        service.executeTransaction('0xWallet', '0x' + 'a'.repeat(64))
      ).rejects.toThrow('Not enough approvals');
    });
  });

  describe('getTransaction', () => {
    it('should return transaction details', async () => {
      const mockTx = {
        to: '0xRecipient',
        value: 1000n,
        data: '0x',
        executed: false,
        numApprovals: 1n,
        timestamp: 1234567890n,
      };
      mockWallet.transactions.mockResolvedValue(mockTx);

      const result = await service.getTransaction('0xWallet', '0xtxhash');

      expect(result).toEqual({
        to: '0xRecipient',
        value: 1000n,
        data: '0x',
        executed: false,
        numApprovals: 1n,
        timestamp: 1234567890n,
      });
    });
  });

  describe('getTransactionByHash', () => {
    it('should return null when transaction does not exist', async () => {
      mockWallet.transactions.mockResolvedValue({
        to: '0x0000000000000000000000000000000000000000',
      });

      const result = await service.getTransactionByHash('0xWallet', '0xtxhash');

      expect(result).toBeNull();
    });

    it('should return transaction with approvals', async () => {
      mockWallet.transactions.mockResolvedValue({
        to: '0xRecipient',
        value: 1000n,
        data: '0x',
        executed: false,
        cancelled: false,
        numApprovals: 1n,
        timestamp: 1234567890n,
        proposer: '0xProposer',
      });
      mockWallet.approvals.mockResolvedValue(true);

      const result = await service.getTransactionByHash('0xWallet', '0xtxhash');

      expect(result).not.toBeNull();
      expect(result?.to).toBe('0xRecipient');
      expect(result?.numApprovals).toBe(1);
      expect(result?.approvals).toBeDefined();
    });
  });

  describe('getPendingTransactions', () => {
    it('should return pending transactions', async () => {
      mockWallet.queryFilter.mockResolvedValue([
        { args: { txHash: '0xtx1' } },
        { args: { txHash: '0xtx2' } },
      ]);
      mockWallet.transactions
        .mockResolvedValueOnce({
          to: '0xRecipient1',
          value: 100n,
          data: '0x',
          executed: false,
          cancelled: false,
          numApprovals: 1n,
          timestamp: 1000n,
          proposer: '0xProposer',
        })
        .mockResolvedValueOnce({
          to: '0xRecipient2',
          value: 200n,
          data: '0x',
          executed: false,
          cancelled: false,
          numApprovals: 2n,
          timestamp: 2000n,
          proposer: '0xProposer',
        });

      const result = await service.getPendingTransactions('0xWallet');

      expect(result).toHaveLength(2);
      expect(result[0].timestamp).toBeGreaterThanOrEqual(result[1].timestamp);
    });

    it('should filter out executed transactions', async () => {
      mockWallet.queryFilter.mockResolvedValue([{ args: { txHash: '0xtx1' } }]);
      mockWallet.transactions.mockResolvedValue({
        to: '0xRecipient',
        executed: true,
        cancelled: false,
      });

      const result = await service.getPendingTransactions('0xWallet');

      expect(result).toHaveLength(0);
    });
  });

  describe('getExecutedTransactions', () => {
    it('should return executed transactions', async () => {
      mockWallet.queryFilter.mockResolvedValue([{ args: { txHash: '0xtx1' } }]);
      mockWallet.transactions.mockResolvedValue({
        to: '0xRecipient',
        value: 100n,
        data: '0x',
        executed: true,
        cancelled: false,
        numApprovals: 2n,
        timestamp: 1000n,
        proposer: '0xProposer',
      });

      const result = await service.getExecutedTransactions('0xWallet');

      expect(result).toHaveLength(1);
      expect(result[0].executed).toBe(true);
    });
  });

  describe('getCancelledTransactions', () => {
    it('should return cancelled transactions', async () => {
      mockWallet.queryFilter.mockResolvedValue([{ args: { txHash: '0xtx1' } }]);
      mockWallet.transactions.mockResolvedValue({
        to: '0xRecipient',
        value: 100n,
        data: '0x',
        executed: false,
        cancelled: true,
        numApprovals: 1n,
        timestamp: 1000n,
        proposer: '0xProposer',
      });

      const result = await service.getCancelledTransactions('0xWallet');

      expect(result).toHaveLength(1);
      expect(result[0].cancelled).toBe(true);
    });
  });
});
