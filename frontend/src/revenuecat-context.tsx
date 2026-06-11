import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './auth-context';
import {
  configureForUser,
  getCustomerInfo,
  hasProAccess,
  addCustomerInfoUpdateListener,
  isRevenueCatAvailable,
} from './revenuecat';

interface RCState {
  isPro: boolean;
  loading: boolean;
  available: boolean;
  refresh: () => Promise<void>;
}

const RCContext = createContext<RCState>({
  isPro: false,
  loading: false,
  available: false,
  refresh: async () => {},
});

export const RevenueCatProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  const [isPro, setIsPro] = useState(false);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    const info = await getCustomerInfo();
    setIsPro(hasProAccess(info));
  };

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setIsPro(false);
      return;
    }
    (async () => {
      setLoading(true);
      await configureForUser(user.uid);
      const info = await getCustomerInfo();
      if (!cancelled) setIsPro(hasProAccess(info));
      setLoading(false);
    })();
    const off = addCustomerInfoUpdateListener((info) => {
      if (!cancelled) setIsPro(hasProAccess(info));
    });
    return () => { cancelled = true; off(); };
  }, [user?.uid]);

  return (
    <RCContext.Provider value={{ isPro, loading, available: isRevenueCatAvailable(), refresh }}>
      {children}
    </RCContext.Provider>
  );
};

export const useRevenueCat = () => useContext(RCContext);
