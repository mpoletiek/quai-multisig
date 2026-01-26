import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OwnerService } from './OwnerService';
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

describe('OwnerService', () => {
  let service: OwnerService;
  let mockTransactionService: any;
  let mockSigner: any;
  let mockWallet: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockTransactionService = {
      setSigner: vi.fn(),
      proposeTransaction: vi.fn().mockResolvedValue('0xproposedtxhash'),
      getPendingTransactions: vi.fn().mockResolvedValue([]),
    };

    service = new OwnerService(undefined, mockTransactionService as unknown as TransactionService);

    mockSigner = {
      getAddress: vi.fn().mockResolvedValue('0xSignerAddress'),
    };

    mockWallet = {
      isOwner: vi.fn().mockResolvedValue(false),
      getOwners: vi.fn().mockResolvedValue(['0xOwner1', '0xOwner2']),
      threshold: vi.fn().mockResolvedValue(2n),
      modules: vi.fn().mockResolvedValue(false),
      interface: {
        encodeFunctionData: vi.fn().mockReturnValue('0xencoded'),
        decodeFunctionData: vi.fn(),
      },
    };

    vi.spyOn(service as any, 'getWalletContract').mockReturnValue(mockWallet);
  });

  describe('constructor', () => {
    it('should create service with default transaction service', () => {
      const newService = new OwnerService();
      expect(newService).toBeDefined();
    });

    it('should create service with provided transaction service', () => {
      const newService = new OwnerService(undefined, mockTransactionService);
      expect(newService).toBeDefined();
    });
  });

  describe('setSigner', () => {
    it('should set signer on both services', () => {
      service.setSigner(mockSigner);

      expect(mockTransactionService.setSigner).toHaveBeenCalledWith(mockSigner);
    });
  });

  describe('addOwner', () => {
    beforeEach(() => {
      service.setSigner(mockSigner);
    });

    it('should throw when signer not set', async () => {
      service.setSigner(null);

      await expect(
        service.addOwner('0xWallet', '0x0000000000000000000000000000000000000001')
      ).rejects.toThrow('Signer not set');
    });

    it('should throw for invalid address', async () => {
      await expect(service.addOwner('0xWallet', 'invalid')).rejects.toThrow('Invalid address');
    });

    it('should throw when address is already an owner', async () => {
      mockWallet.isOwner.mockResolvedValue(true);

      await expect(
        service.addOwner('0xWallet', '0x0000000000000000000000000000000000000001')
      ).rejects.toThrow('Address is already an owner');
    });

    it('should propose addOwner transaction', async () => {
      mockWallet.isOwner.mockResolvedValue(false);

      const result = await service.addOwner('0xWallet', '0x0000000000000000000000000000000000000001');

      expect(result).toBe('0xproposedtxhash');
      expect(mockWallet.interface.encodeFunctionData).toHaveBeenCalledWith('addOwner', [
        '0x0000000000000000000000000000000000000001',
      ]);
      expect(mockTransactionService.proposeTransaction).toHaveBeenCalledWith(
        '0xWallet',
        '0xWallet', // self-call
        0n,
        '0xencoded'
      );
    });

    it('should throw when pending addOwner exists for same address', async () => {
      mockWallet.isOwner.mockResolvedValue(false);
      mockTransactionService.getPendingTransactions.mockResolvedValue([
        {
          to: '0xwallet',
          data: '0x7065cb48000000000000000000000000', // addOwner selector
          hash: '0xpendingtx',
        },
      ]);
      mockWallet.interface.decodeFunctionData.mockReturnValue([
        '0x0000000000000000000000000000000000000001',
      ]);

      await expect(
        service.addOwner('0xWallet', '0x0000000000000000000000000000000000000001')
      ).rejects.toThrow('already pending');
    });
  });

  describe('removeOwner', () => {
    beforeEach(() => {
      service.setSigner(mockSigner);
    });

    it('should throw when signer not set', async () => {
      service.setSigner(null);

      await expect(
        service.removeOwner('0xWallet', '0x0000000000000000000000000000000000000001')
      ).rejects.toThrow('Signer not set');
    });

    it('should throw for invalid address', async () => {
      await expect(service.removeOwner('0xWallet', 'invalid')).rejects.toThrow('Invalid address');
    });

    it('should throw when address is not an owner', async () => {
      mockWallet.isOwner.mockResolvedValue(false);

      await expect(
        service.removeOwner('0xWallet', '0x0000000000000000000000000000000000000001')
      ).rejects.toThrow('Address is not an owner');
    });

    it('should throw when removing would violate threshold', async () => {
      mockWallet.isOwner.mockResolvedValue(true);
      mockWallet.getOwners.mockResolvedValue(['0xOwner1', '0xOwner2']);
      mockWallet.threshold.mockResolvedValue(2n);

      await expect(
        service.removeOwner('0xWallet', '0x0000000000000000000000000000000000000001')
      ).rejects.toThrow('Cannot remove owner');
    });

    it('should propose removeOwner transaction', async () => {
      mockWallet.isOwner.mockResolvedValue(true);
      mockWallet.getOwners.mockResolvedValue(['0xOwner1', '0xOwner2', '0xOwner3']);
      mockWallet.threshold.mockResolvedValue(2n);

      const result = await service.removeOwner('0xWallet', '0x0000000000000000000000000000000001');

      expect(result).toBe('0xproposedtxhash');
      expect(mockWallet.interface.encodeFunctionData).toHaveBeenCalledWith('removeOwner', [
        expect.any(String),
      ]);
    });
  });

  describe('changeThreshold', () => {
    beforeEach(() => {
      service.setSigner(mockSigner);
    });

    it('should throw when signer not set', async () => {
      service.setSigner(null);

      await expect(service.changeThreshold('0xWallet', 2)).rejects.toThrow('Signer not set');
    });

    it('should throw when threshold is less than 1', async () => {
      await expect(service.changeThreshold('0xWallet', 0)).rejects.toThrow(
        'Threshold must be at least 1'
      );
    });

    it('should throw when threshold exceeds owner count', async () => {
      mockWallet.getOwners.mockResolvedValue(['0xOwner1', '0xOwner2']);

      await expect(service.changeThreshold('0xWallet', 3)).rejects.toThrow(
        'Threshold cannot exceed number of owners'
      );
    });

    it('should propose changeThreshold transaction', async () => {
      mockWallet.getOwners.mockResolvedValue(['0xOwner1', '0xOwner2', '0xOwner3']);

      const result = await service.changeThreshold('0xWallet', 2);

      expect(result).toBe('0xproposedtxhash');
      expect(mockWallet.interface.encodeFunctionData).toHaveBeenCalledWith('changeThreshold', [2]);
    });
  });

  describe('enableModule', () => {
    beforeEach(() => {
      service.setSigner(mockSigner);
    });

    it('should throw when signer not set', async () => {
      service.setSigner(null);

      await expect(
        service.enableModule('0xWallet', '0x0000000000000000000000000000000000000001')
      ).rejects.toThrow('Signer not set');
    });

    it('should throw for invalid address', async () => {
      await expect(service.enableModule('0xWallet', 'invalid')).rejects.toThrow('Invalid address');
    });

    it('should throw when module is already enabled', async () => {
      mockWallet.modules.mockResolvedValue(true);

      await expect(
        service.enableModule('0xWallet', '0x0000000000000000000000000000000000000001')
      ).rejects.toThrow('Module is already enabled');
    });

    it('should propose enableModule transaction', async () => {
      mockWallet.modules.mockResolvedValue(false);

      const result = await service.enableModule(
        '0xWallet',
        '0x0000000000000000000000000000000000000001'
      );

      expect(result).toBe('0xproposedtxhash');
      expect(mockWallet.interface.encodeFunctionData).toHaveBeenCalledWith('enableModule', [
        '0x0000000000000000000000000000000000000001',
      ]);
    });
  });

  describe('disableModule', () => {
    beforeEach(() => {
      service.setSigner(mockSigner);
    });

    it('should throw when signer not set', async () => {
      service.setSigner(null);

      await expect(
        service.disableModule('0xWallet', '0x0000000000000000000000000000000000000001')
      ).rejects.toThrow('Signer not set');
    });

    it('should throw for invalid address', async () => {
      await expect(service.disableModule('0xWallet', 'invalid')).rejects.toThrow('Invalid address');
    });

    it('should throw when module is not enabled', async () => {
      mockWallet.modules.mockResolvedValue(false);

      await expect(
        service.disableModule('0xWallet', '0x0000000000000000000000000000000000000001')
      ).rejects.toThrow('Module is not enabled');
    });

    it('should propose disableModule transaction', async () => {
      mockWallet.modules.mockResolvedValue(true);

      const result = await service.disableModule(
        '0xWallet',
        '0x0000000000000000000000000000000000000001'
      );

      expect(result).toBe('0xproposedtxhash');
      expect(mockWallet.interface.encodeFunctionData).toHaveBeenCalledWith('disableModule', [
        '0x0000000000000000000000000000000000000001',
      ]);
    });
  });
});
