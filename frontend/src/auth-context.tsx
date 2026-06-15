import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, onAuthStateChanged, type User } from './firebase';
import { proStore } from './pro-store';
import { api } from './api';

interface AuthState {
  user: User | null;
  loading: boolean;
}

const AuthCtx = createContext<AuthState>({ user: null, loading: true });

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Hydrate the synchronous Pro store from AsyncStorage as early as possible
  // so the very first render of the scan tab never reads a stale `false`.
  useEffect(() => {
    proStore.hydrate();
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
      if (u) {
        // Sync the persisted Pro flag with the backend ONCE per login. We
        // upgrade the in-memory boolean (and AsyncStorage) only when the
        // backend confirms is_pro=true — we never downgrade based on a
        // network response, because a transient API error must not knock
        // the user out of Pro mid-session.
        api.getScanCount(u.uid)
          .then((c) => { if (c.is_pro) proStore.setPro(true); })
          .catch(() => { /* keep the cached value */ });
      } else {
        // True logout — drop the flag entirely.
        proStore.reset();
      }
    });
    return unsub;
  }, []);

  return <AuthCtx.Provider value={{ user, loading }}>{children}</AuthCtx.Provider>;
};

export const useAuth = () => useContext(AuthCtx);
