// Contract addresses from environment variables
export const CONTRACT_ADDRESSES = {
  MULTISIG_IMPLEMENTATION: import.meta.env.VITE_MULTISIG_IMPLEMENTATION || '',
  PROXY_FACTORY: import.meta.env.VITE_PROXY_FACTORY || '',
  SOCIAL_RECOVERY_MODULE: import.meta.env.VITE_SOCIAL_RECOVERY_MODULE || '',
  DAILY_LIMIT_MODULE: import.meta.env.VITE_DAILY_LIMIT_MODULE || '',
  WHITELIST_MODULE: import.meta.env.VITE_WHITELIST_MODULE || '',
};

// Network configuration
export const NETWORK_CONFIG = {
  RPC_URL: import.meta.env.VITE_RPC_URL || 'https://rpc.orchard.quai.network',
  CHAIN_ID: Number(import.meta.env.VITE_CHAIN_ID) || 9000,
};

// Optional backend configuration
export const BACKEND_CONFIG = {
  API_URL: import.meta.env.VITE_BACKEND_API_URL || '',
  WEBSOCKET_URL: import.meta.env.VITE_WEBSOCKET_URL || '',
  ENABLED: Boolean(import.meta.env.VITE_BACKEND_API_URL),
};
