import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { About } from './pages/About';
import { WalletDetail } from './pages/WalletDetail';
import { CreateWallet } from './pages/CreateWallet';
import { NewTransaction } from './pages/NewTransaction';
import { TransactionHistory } from './pages/TransactionHistory';
import { LookupTransaction } from './pages/LookupTransaction';
import { DocsIndex } from './pages/docs/DocsIndex';
import { GettingStarted } from './pages/docs/GettingStarted';
import { MultisigWallets } from './pages/docs/MultisigWallets';
import { Modules } from './pages/docs/Modules';
import { SocialRecovery } from './pages/docs/SocialRecovery';
import { FrontendGuide } from './pages/docs/FrontendGuide';
import { DeveloperGuide } from './pages/docs/DeveloperGuide';
import { Security } from './pages/docs/Security';
import { FAQ } from './pages/docs/FAQ';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30000,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <Layout>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/about" element={<About />} />
            <Route path="/docs" element={<DocsIndex />} />
            <Route path="/docs/getting-started" element={<GettingStarted />} />
            <Route path="/docs/multisig-wallets" element={<MultisigWallets />} />
            <Route path="/docs/modules" element={<Modules />} />
            <Route path="/docs/modules/social-recovery" element={<SocialRecovery />} />
            <Route path="/docs/frontend-guide" element={<FrontendGuide />} />
            <Route path="/docs/developer-guide" element={<DeveloperGuide />} />
            <Route path="/docs/security" element={<Security />} />
            <Route path="/docs/faq" element={<FAQ />} />
            <Route path="/create" element={<CreateWallet />} />
            <Route path="/wallet/:address" element={<WalletDetail />} />
            <Route path="/wallet/:address/transaction/new" element={<NewTransaction />} />
            <Route path="/wallet/:address/history" element={<TransactionHistory />} />
            <Route path="/wallet/:address/lookup" element={<LookupTransaction />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Layout>
      </Router>
    </QueryClientProvider>
  );
}

export default App;
