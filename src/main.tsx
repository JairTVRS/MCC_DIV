import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SessaoProvider } from './auth/Sessao';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessaoProvider>
      <App />
    </SessaoProvider>
  </StrictMode>,
);
