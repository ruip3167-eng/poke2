import React, { createContext, useContext, useEffect, useState } from 'react';
import { auth, onAuthStateChanged, type User } from './firebase';

interface AuthState {
  user: User | null;
  loading: boolean;
}

const AuthCtx = createContext<AuthState>({ user: null, loading: true });

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  return <AuthCtx.Provider value={{ user, loading }}>{children}</AuthCtx.Provider>;
};

export const useAuth = () => useContext(AuthCtx);
