import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import './lib/i18n';
import { registerSW } from 'virtual:pwa-register';

const updateSW = registerSW({
  onNeedRefresh() {
    // Dispatch a custom event instead of blocking the main thread with confirm()
    window.dispatchEvent(new CustomEvent('pwa-update-available', {
      detail: {
        update: () => updateSW(true)
      }
    }));
  },
  onOfflineReady() {
    console.log('Praeventio Guard está listo para operar sin conexión.');
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
