import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User } from '../types';
import { deriveMEK, setSessionMEK, clearSessionMEK } from '../utils/crypto';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  mekSalt: string | null;
  mekDerived: boolean;

  setAuth: (user: User, accessToken: string, refreshToken: string, mekSalt: string) => void;
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

      setAuth: (user, accessToken, refreshToken, mekSalt) => {
        localStorage.setItem('accessToken', accessToken);
        localStorage.setItem('refreshToken', refreshToken);
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
        localStorage.removeItem('accessToken');
        localStorage.removeItem('refreshToken');
        clearSessionMEK();
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
