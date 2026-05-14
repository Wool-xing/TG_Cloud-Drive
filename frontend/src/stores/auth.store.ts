import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User } from '../types';
import { deriveMEK, setSessionMEK, clearSessionMEK } from '../utils/crypto';
import { queryClient } from '../main';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  mekSalt: string | null;
  mekDerived: boolean;

  setAuth: (
    user: User,
    accessToken: string,
    refreshToken: string,
    mekSalt: string,
    rememberMe?: boolean,
  ) => void;
  setUser: (user: User) => void;
  deriveMEK: (password: string) => Promise<void>;
  logout: () => void;
  isAdmin: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      mekSalt: null,
      mekDerived: false,

      setAuth: (user, accessToken, refreshToken, mekSalt, rememberMe = false) => {
        localStorage.setItem('accessToken', accessToken);
        localStorage.setItem('refreshToken', refreshToken);
        // "记住我" sentinel — main.tsx reads this on every boot to decide
        // whether tokens should survive a browser-close cycle. Always written
        // (true / false) so a previous "记住我=1" gets correctly cleared on
        // the next login without remember-me.
        localStorage.setItem('rememberMe', rememberMe ? '1' : '0');
        set({ user, accessToken, refreshToken, mekSalt, mekDerived: false });
      },

      setUser: (user) => set({ user }),

      deriveMEK: async (password: string) => {
        const { mekSalt } = get();
        if (!mekSalt) return;
        const mek = await deriveMEK(password, mekSalt);
        setSessionMEK(mek, mekSalt);
        set({ mekDerived: true });
      },

      logout: () => {
        // P1-F12: purge React Query cache so the next signed-in user (or the
        // login screen) doesn't briefly see the previous user's data when
        // hooks rehydrate before fresh fetches resolve. Sidebar.handleLogout
        // also calls queryClient.clear() for its own UX path; keeping the
        // call here makes any future caller of logout() automatically safe.
        try { queryClient.clear(); } catch { /* main hasn't booted yet */ }
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('rememberMe');
        clearSessionMEK();
        // P1-F28: purge any legacy session-storage entries from older builds.
        // F17 already moved private-space token to in-memory, but a browser
        // that hasn't reloaded since pre-F17 may still carry stale entries.
        try {
          sessionStorage.removeItem('private_space_token');
          sessionStorage.removeItem('private_space_expiry');
        } catch { /* private mode / disabled storage */ }
        set({ user: null, accessToken: null, refreshToken: null, mekSalt: null, mekDerived: false });
      },

      isAdmin: () => get().user?.role === 'admin',
    }),
    {
      name: 'auth',
      partialize: (s) => ({ user: s.user, accessToken: s.accessToken, refreshToken: s.refreshToken, mekSalt: s.mekSalt }),
    },
  ),
);
