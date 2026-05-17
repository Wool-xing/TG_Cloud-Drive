import React, { createContext, useContext, useState, useCallback } from 'react';
import { t, setLang, getLang } from './translations';

interface I18nContextValue {
  t: (key: string, params?: Record<string, string | number>) => string;
  lang: string;
  setLang: (lang: string) => void;
}

const I18nContext = createContext<I18nContextValue>({
  t,
  lang: getLang(),
  setLang: () => {},
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState(getLang());

  const changeLang = useCallback((l: string) => {
    setLang(l);
    setLangState(l);
  }, []);

  return (
    <I18nContext.Provider value={{ t, lang, setLang: changeLang }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
