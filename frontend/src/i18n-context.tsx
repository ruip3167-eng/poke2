import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import * as Localization from 'expo-localization';
import { storage } from '@/src/utils/storage';
import { dictionaries, type Dict, type Locale } from './i18n';

const STORAGE_KEY = 'pv.locale';

interface I18nState {
  locale: Locale;
  t: Dict;
  setLocale: (loc: Locale) => Promise<void>;
  toggleLocale: () => Promise<void>;
}

const I18nCtx = createContext<I18nState>({
  locale: 'pt',
  t: dictionaries.pt,
  setLocale: async () => {},
  toggleLocale: async () => {},
});

function detectDeviceLocale(): Locale {
  try {
    const locales = Localization.getLocales();
    const tag = (locales[0]?.languageTag ?? locales[0]?.languageCode ?? '').toLowerCase();
    // Only English gets EN — everything else (including 'pt-PT', 'pt-BR', 'es',
    // 'fr', etc.) defaults to PT per the product spec.
    return tag.startsWith('en') ? 'en' : 'pt';
  } catch {
    return 'pt';
  }
}

export const I18nProvider = ({ children }: { children: React.ReactNode }) => {
  const [locale, setLocaleState] = useState<Locale>('pt');

  useEffect(() => {
    (async () => {
      const saved = await storage.getItem<string>(STORAGE_KEY, '');
      if (saved === 'pt' || saved === 'en') {
        setLocaleState(saved);
      } else {
        setLocaleState(detectDeviceLocale());
      }
    })();
  }, []);

  const setLocale = async (loc: Locale) => {
    setLocaleState(loc);
    await storage.setItem(STORAGE_KEY, loc);
  };

  const toggleLocale = async () => {
    await setLocale(locale === 'pt' ? 'en' : 'pt');
  };

  const value = useMemo<I18nState>(
    () => ({ locale, t: dictionaries[locale], setLocale, toggleLocale }),
    [locale],
  );

  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>;
};

export const useI18n = () => useContext(I18nCtx);
export const useT = () => useContext(I18nCtx).t;
