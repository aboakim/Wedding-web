'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LANGS, normalizeLang, t as translate, translateError } from '@/lib/i18n';

const Ctx = createContext(null);

export function LanguageProvider({ initial, children }) {
  const router = useRouter();
  const [lang, setLangState] = useState(normalizeLang(initial));

  useEffect(() => {
    setLangState(normalizeLang(initial));
  }, [initial]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo(() => {
    function setLang(next) {
      const safe = normalizeLang(next);
      document.cookie = `lang=${safe};path=/;max-age=31536000;samesite=lax`;
      setLangState(safe);
      document.documentElement.lang = safe;
      router.refresh();
    }
    function text(key, params) {
      return translate(lang, key, params);
    }
    function fault(item, fallback = 'error.generic') {
      if (!item) return '';
      if (item.key) return translate(lang, item.key, item.params);
      return translateError(lang, item.code, item.message) || translate(lang, fallback);
    }
    return { lang, setLang, t: text, fault };
  }, [lang, router]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('language');
  return ctx;
}

const NAMES = { hy: 'Հայ', en: 'EN', ru: 'RU' };

export function LanguageSwitch() {
  const { lang, setLang, t } = useI18n();
  return (
    <div className="langbar" role="group" aria-label={t('lang.choose')}>
      {LANGS.map((code) => (
        <button
          key={code}
          type="button"
          className={lang === code ? 'on' : ''}
          aria-pressed={lang === code}
          onClick={() => { if (code !== lang) setLang(code); }}
        >
          {NAMES[code]}
        </button>
      ))}
    </div>
  );
}

export function apiFault(body) {
  if (!body?.error) return null;
  return { code: body.error.code || '', message: body.error.message || '' };
}
