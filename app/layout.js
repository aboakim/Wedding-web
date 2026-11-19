import './globals.css';
import { cookies } from 'next/headers';
import { LanguageProvider, LanguageSwitch } from '@/components/Language';
import { normalizeLang, t } from '@/lib/i18n';

export async function generateMetadata() {
  const lang = await currentLang();
  return {
    title: t(lang, 'meta.title'),
    description: t(lang, 'meta.description'),
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
    appleWebApp: { capable: true, statusBarStyle: 'default', title: t(lang, 'meta.short') },
  };
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#f3eee7',
};

async function currentLang() {
  const jar = await cookies();
  return normalizeLang(jar.get('lang')?.value);
}

export default async function RootLayout({ children }) {
  const lang = await currentLang();
  return (
    <html lang={lang}>
      <body>
        <LanguageProvider initial={lang}>
          <LanguageSwitch />
          {children}
        </LanguageProvider>
      </body>
    </html>
  );
}
