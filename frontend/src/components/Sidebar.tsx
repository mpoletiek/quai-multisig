import { Link, useLocation } from 'react-router-dom';
import { useWallet } from '../hooks/useWallet';
import { useMultisig } from '../hooks/useMultisig';
import { WalletCard } from './WalletCard';

export function Sidebar() {
  const { connected } = useWallet();
  const { userWallets, isLoadingWallets, isRefetchingWallets } = useMultisig();
  const location = useLocation();

  return (
    <aside className="fixed left-0 top-[4.5rem] h-[calc(100vh-4.5rem)] w-48 bg-vault-dark-2 border-r-2 border-dark-700 flex flex-col z-20 overflow-hidden">

      {/* Quick Actions */}
      {connected && (
        <div className="px-2 py-2 border-b border-dark-700">
          <Link
            to="/create"
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs font-semibold transition-all w-full ${
              location.pathname === '/create'
                ? 'text-primary-400 vault-text-glow bg-vault-dark-4'
                : 'text-dark-400 hover:text-dark-200 hover:bg-vault-dark-4'
            }`}
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Create
          </Link>
        </div>
      )}

      {/* Wallets List */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {!connected ? (
          <div className="text-center py-8">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-vault-dark-4 border-2 border-primary-600/30 mb-3">
              <svg className="w-6 h-6 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <p className="text-xs text-dark-500 font-medium mb-1">Connect Wallet</p>
            <p className="text-xs text-dark-600 font-mono uppercase tracking-wider">
              To view your vaults
            </p>
          </div>
        ) : isLoadingWallets ? (
          <div className="text-center py-8">
            <div className="relative inline-block">
              <div className="absolute inset-0 bg-primary-600/20 blur-xl animate-pulse"></div>
              <div className="relative inline-block h-6 w-6 animate-spin rounded-full border-2 border-solid border-primary-600 border-r-transparent"></div>
            </div>
            <p className="mt-3 text-xs text-dark-400 font-semibold">Loading vaults...</p>
          </div>
        ) : !userWallets || userWallets.length === 0 ? (
          <div className="text-center py-6">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-vault-dark-4 border-2 border-dark-600 mb-3">
              <svg className="w-5 h-5 text-dark-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
            </div>
            <p className="text-xs text-dark-400 font-semibold mb-1">No Vaults</p>
            <p className="text-xs text-dark-600 font-mono mb-3">
              Create your first vault
            </p>
            <Link
              to="/create"
              className="btn-primary text-xs py-1.5 px-3 inline-flex items-center gap-1.5"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Create Vault
            </Link>
          </div>
        ) : (
          <div className="space-y-1">
            <div className="flex items-center justify-between mb-1 px-1">
              <div className="flex items-center gap-1.5">
                <h2 className="text-xs font-display font-bold text-dark-200 uppercase tracking-wider">
                  Vaults
                </h2>
                {isRefetchingWallets && (
                  <div className="w-2 h-2 border border-primary-600 border-t-transparent rounded-full animate-spin"></div>
                )}
              </div>
              <span className="vault-badge text-xs">
                {userWallets.length}
              </span>
            </div>
            <div className="space-y-1">
              {userWallets.map((walletAddress) => {
                const isActive = location.pathname === `/wallet/${walletAddress}` || location.pathname.startsWith(`/wallet/${walletAddress}/`);
                return (
                  <div
                    key={walletAddress}
                    className={`vault-panel p-2 hover:border-primary-600/50 transition-all ${
                      isActive ? 'border-primary-600/50 bg-vault-dark-4' : ''
                    }`}
                  >
                    <Link
                      to={`/wallet/${walletAddress}`}
                      className="block"
                    >
                      <WalletCard walletAddress={walletAddress} compact={true} />
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
