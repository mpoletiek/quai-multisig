import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock document.execCommand for clipboard fallback tests
Object.defineProperty(document, 'execCommand', {
  writable: true,
  value: vi.fn().mockReturnValue(true),
});

// Mock window.matchMedia for responsive tests
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue(''),
  },
});

// Mock window.open for block explorer tests
vi.spyOn(window, 'open').mockImplementation(() => null);

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock import.meta.env
vi.mock('../config/contracts', () => ({
  CONTRACT_ADDRESSES: {
    MULTISIG_IMPLEMENTATION: '0x1234567890123456789012345678901234567890',
    PROXY_FACTORY: '0x2345678901234567890123456789012345678901',
    SOCIAL_RECOVERY_MODULE: '0x3456789012345678901234567890123456789012',
    DAILY_LIMIT_MODULE: '0x4567890123456789012345678901234567890123',
    WHITELIST_MODULE: '0x5678901234567890123456789012345678901234',
  },
  NETWORK_CONFIG: {
    RPC_URL: 'https://rpc.test.quai.network',
    CHAIN_ID: 9000,
    BLOCK_EXPLORER_URL: 'https://quaiscan.io',
  },
  BACKEND_CONFIG: {
    API_URL: '',
    WEBSOCKET_URL: '',
    ENABLED: false,
  },
}));

// Mock quais library
vi.mock('quais', () => ({
  formatQuai: vi.fn((value: string | bigint) => {
    const bigIntValue = typeof value === 'string' ? BigInt(value) : value;
    return (Number(bigIntValue) / 1e18).toString();
  }),
  parseQuai: vi.fn((value: string) => {
    return BigInt(Math.floor(parseFloat(value) * 1e18));
  }),
  Interface: vi.fn().mockImplementation(() => ({
    parseTransaction: vi.fn(),
    encodeFunctionData: vi.fn(),
  })),
  Contract: vi.fn(),
  BrowserProvider: vi.fn(),
  JsonRpcProvider: vi.fn().mockImplementation(function(this: any) {
    this.getNetwork = vi.fn();
  }),
  isAddress: vi.fn((address: string) => /^0x[a-fA-F0-9]{40}$/.test(address)),
  getAddress: vi.fn((address: string) => {
    // Simple checksum implementation - returns address as-is for valid addresses
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new Error('Invalid address');
    }
    return address;
  }),
  AbiCoder: {
    defaultAbiCoder: vi.fn(() => ({
      decode: vi.fn(),
    })),
  },
  ZeroAddress: '0x0000000000000000000000000000000000000000',
}));

// Clean up after each test
afterEach(() => {
  vi.clearAllMocks();
});
