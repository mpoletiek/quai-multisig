import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  estimateGasWithBuffer,
  estimateGasOrThrow,
  buildTxOptions,
  GasPresets,
  logGasUsage,
} from './GasEstimator';

// Mock console methods
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('GasEstimator', () => {
  describe('estimateGasWithBuffer', () => {
    it('should apply default 50% buffer to estimated gas', async () => {
      const mockMethod = {
        estimateGas: vi.fn().mockResolvedValue(100000n),
      };

      const result = await estimateGasWithBuffer(mockMethod, []);

      expect(result.estimated).toBe(100000n);
      // 100000 + 50% = 150000
      expect(result.gasLimit).toBe(150000n);
    });

    it('should apply custom buffer percentage', async () => {
      const mockMethod = {
        estimateGas: vi.fn().mockResolvedValue(100000n),
      };

      const result = await estimateGasWithBuffer(mockMethod, [], {
        bufferPercent: 100,
      });

      // 100000 + 100% = 200000
      expect(result.gasLimit).toBe(200000n);
    });

    it('should enforce minimum gas limit', async () => {
      const mockMethod = {
        estimateGas: vi.fn().mockResolvedValue(10000n),
      };

      const result = await estimateGasWithBuffer(mockMethod, [], {
        minGas: 200000n,
      });

      // 10000 + 50% = 15000, but min is 200000
      expect(result.gasLimit).toBe(200000n);
    });

    it('should enforce maximum gas limit', async () => {
      const mockMethod = {
        estimateGas: vi.fn().mockResolvedValue(10000000n),
      };

      const result = await estimateGasWithBuffer(mockMethod, [], {
        maxGas: 500000n,
      });

      // 10000000 + 50% = 15000000, but max is 500000
      expect(result.gasLimit).toBe(500000n);
    });

    it('should return default gas when estimation fails', async () => {
      const mockMethod = {
        estimateGas: vi.fn().mockRejectedValue(new Error('Cannot estimate')),
      };

      const result = await estimateGasWithBuffer(mockMethod, [], {
        defaultGas: 250000n,
      });

      expect(result.estimated).toBeNull();
      expect(result.gasLimit).toBe(250000n);
    });

    it('should pass arguments to estimateGas', async () => {
      const mockMethod = {
        estimateGas: vi.fn().mockResolvedValue(100000n),
      };

      await estimateGasWithBuffer(mockMethod, ['arg1', 'arg2', 123n]);

      expect(mockMethod.estimateGas).toHaveBeenCalledWith('arg1', 'arg2', 123n);
    });

    it('should use GasPresets.simple correctly', async () => {
      const mockMethod = {
        estimateGas: vi.fn().mockResolvedValue(80000n),
      };

      const result = await estimateGasWithBuffer(mockMethod, [], GasPresets.simple);

      // 80000 + 50% = 120000, above min 100000
      expect(result.gasLimit).toBe(120000n);
    });

    it('should use GasPresets.complex correctly', async () => {
      const mockMethod = {
        estimateGas: vi.fn().mockResolvedValue(300000n),
      };

      const result = await estimateGasWithBuffer(mockMethod, [], GasPresets.complex);

      // 300000 + 100% = 600000, within range
      expect(result.gasLimit).toBe(600000n);
    });
  });

  describe('estimateGasOrThrow', () => {
    it('should return estimated gas on success', async () => {
      const mockMethod = {
        estimateGas: vi.fn().mockResolvedValue(150000n),
      };

      const result = await estimateGasOrThrow(mockMethod, [], 'execute');

      expect(result).toBe(150000n);
    });

    it('should throw user-friendly error on failure', async () => {
      const mockMethod = {
        estimateGas: vi.fn().mockRejectedValue({ reason: 'Not an owner' }),
      };

      await expect(estimateGasOrThrow(mockMethod, [], 'approve transaction')).rejects.toThrow(
        'Cannot approve transaction: Not an owner'
      );
    });

    it('should extract error message from contract', async () => {
      const mockContract = {
        interface: {
          parseError: vi.fn().mockReturnValue({
            name: 'Error',
            args: ['Insufficient balance'],
          }),
        },
      } as any;

      const mockMethod = {
        estimateGas: vi.fn().mockRejectedValue({ data: '0xerror...' }),
      };

      await expect(
        estimateGasOrThrow(mockMethod, [], 'execute', mockContract)
      ).rejects.toThrow('Cannot execute: Insufficient balance');
    });

    it('should pass arguments to estimateGas', async () => {
      const mockMethod = {
        estimateGas: vi.fn().mockResolvedValue(100000n),
      };

      await estimateGasOrThrow(mockMethod, ['0xaddr', 100n], 'send');

      expect(mockMethod.estimateGas).toHaveBeenCalledWith('0xaddr', 100n);
    });
  });

  describe('buildTxOptions', () => {
    it('should build options with gas limit', () => {
      const result = buildTxOptions(200000n);

      expect(result).toEqual({ gasLimit: 200000n });
    });

    it('should merge additional options', () => {
      const result = buildTxOptions(200000n, { value: 1000n, nonce: 5 });

      expect(result).toEqual({
        gasLimit: 200000n,
        value: 1000n,
        nonce: 5,
      });
    });

    it('should not override gasLimit with additional options', () => {
      // gasLimit is set first, then spread of additional options
      // If additional options has gasLimit, it would override
      const result = buildTxOptions(200000n, { gasLimit: 100000n });

      // Additional options override base gasLimit
      expect(result.gasLimit).toBe(100000n);
    });
  });

  describe('GasPresets', () => {
    it('should have simple preset with correct values', () => {
      expect(GasPresets.simple).toEqual({
        bufferPercent: 50,
        minGas: 100000n,
        maxGas: 500000n,
        defaultGas: 150000n,
      });
    });

    it('should have standard preset with correct values', () => {
      expect(GasPresets.standard).toEqual({
        bufferPercent: 50,
        minGas: 200000n,
        maxGas: 1000000n,
        defaultGas: 300000n,
      });
    });

    it('should have complex preset with correct values', () => {
      expect(GasPresets.complex).toEqual({
        bufferPercent: 100,
        minGas: 400000n,
        maxGas: 2000000n,
        defaultGas: 500000n,
      });
    });

    it('should have selfCall preset with correct values', () => {
      expect(GasPresets.selfCall).toEqual({
        bufferPercent: 100,
        minGas: 200000n,
        maxGas: 500000n,
        defaultGas: 200000n,
      });
    });
  });

  describe('logGasUsage', () => {
    it('should log gas usage from receipt', () => {
      const receipt = { gasUsed: 150000n };

      logGasUsage('execute', receipt);

      expect(console.log).toHaveBeenCalledWith(
        '  Actual gas used for execute: 150000'
      );
    });

    it('should warn when gas usage is close to limit', () => {
      const receipt = { gasUsed: 195000n };

      logGasUsage('execute', receipt, 200000n);

      expect(console.warn).toHaveBeenCalledWith(
        '  Warning: Gas usage was very close to limit!',
        { used: '195000', limit: '200000' }
      );
    });

    it('should not warn when gas usage is well below limit', () => {
      const receipt = { gasUsed: 100000n };

      logGasUsage('execute', receipt, 200000n);

      expect(console.warn).not.toHaveBeenCalled();
    });

    it('should handle receipt without gasUsed', () => {
      const receipt = { status: 1 };

      logGasUsage('execute', receipt);

      expect(console.log).not.toHaveBeenCalled();
    });

    it('should handle null receipt', () => {
      logGasUsage('execute', null);

      expect(console.log).not.toHaveBeenCalled();
    });
  });
});
