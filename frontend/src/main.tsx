import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import * as Sentry from '@sentry/react';
import App from './App';
import './index.css';

// Initialize Sentry for frontend error tracking
const sentryDsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE || 'development',
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
  });
}

// Initialize dark mode before first render to avoid FOUC
;(function () {
  const saved = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  if (saved === 'dark' || (!saved && prefersDark)) {
    document.documentElement.classList.add('dark');
  }
})();

// "记住我" lifecycle.
//
// Pre-fix: the Login checkbox toggled a local state that nothing read — every
// session was effectively "remember forever", because tokens were always
// written to localStorage and survived browser close.
//
// Strategy: use a sessionStorage sentinel to detect a fresh browser session
// (sessionStorage clears when the last tab of an origin closes). When the
// sentinel is missing on boot AND rememberMe was set false, the previous
// "session" has ended → purge tokens + auth state. localStorage stays the
// single token source so existing axios / auth.store code is untouched.
;(function () {
  try {
    const isNewBrowserSession = !sessionStorage.getItem('session-alive');
    sessionStorage.setItem('session-alive', '1');
    const wasRememberMe = localStorage.getItem('rememberMe') === '1';
    if (isNewBrowserSession && !wasRememberMe) {
      // Previous "no-remember" session ended (all tabs closed). Drop auth.
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('auth');
    }
  } catch { /* private mode / disabled storage — fall through */ }
})();

// Register service worker for PWA offline shell
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

// Exported so non-component code (e.g. auth.store.logout) can clear cache too.
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<p>An error occurred — our team has been notified.</p>}>
      <QueryClientProvider client={queryClient}>
        <App />
        <Toaster position="top-right" toastOptions={{ duration: 3000 }} />
      </QueryClientProvider>
    </Sentry.ErrorBoundary>
  </React.StrictMode>,
);
