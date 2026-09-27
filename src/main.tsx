import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

import { resolveSpaRedirectUrl } from '@/lib/spaRedirect';

// GitHub Pages SPA fallback (see public/404.html): when a deep link like
// /shivansh-stores/admin/stock is opened directly, GitHub serves 404.html,
// which redirects here with the real path packed into ?spa_redirect=...
// Unpack it and restore the URL via history.replaceState *before* React
// Router mounts, so it renders the correct route on first paint instead of
// flashing the home route.
const restoredUrl = resolveSpaRedirectUrl(window.location.pathname, window.location.search, window.location.hash);
if (restoredUrl) {
  window.history.replaceState(null, '', restoredUrl);
}

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found in index.html');
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>
);
