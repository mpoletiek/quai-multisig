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
