import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.jsx';
import { MusicControl } from './audio/MusicControl.jsx';

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      // WS pushes keep the cache fresh; disable polling / refetch storms.
      refetchOnWindowFocus: false,
      staleTime: Infinity,
    },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('#root not found in index.html');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <App />
      <MusicControl />
    </QueryClientProvider>
  </StrictMode>,
);
