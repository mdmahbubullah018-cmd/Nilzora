import type { Metadata } from 'next';
import { Inter, Noto_Sans_Bengali, Poppins } from 'next/font/google';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { htmlLang, LANGUAGE_COOKIE, parseLanguage } from '@/lib/language';
import { LanguageProvider } from '@/lib/i18n/provider';
import { parseSidebarMode, SIDEBAR_COOKIE, SIDEBAR_SCRIPT } from '@/lib/sidebar';
import { parseThemePreference, serverTheme, THEME_COOKIE, THEME_SCRIPT } from '@/lib/theme';
import './globals.css';
import { AutoText } from '@/components/i18n/translate';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-poppins',
  display: 'swap',
});
// Bengali glyphs only; not preloaded, so it downloads only when Bengali text renders.
const notoBengali = Noto_Sans_Bengali({
  subsets: ['bengali'],
  variable: '--font-bengali',
  display: 'swap',
  preload: false,
});

export const metadata: Metadata = {
  title: { default: 'Nilzora Admin', template: '%s · Nilzora Admin' },
  description: 'Nilzora operations dashboard',
  robots: { index: false, follow: false },
};

/**
 * The theme, the language and the sidebar width come from the visitor's preference cookies
 * (lib/theme.ts, lib/language.ts, lib/sidebar.ts), applied on the server so the first paint is
 * already in that theme, that language and that rail width — no flash and no layout shift. A
 * "system" theme is resolved by THEME_SCRIPT in <head>, before the first paint; <html> therefore
 * opts out of the hydration attribute check, since that script may have changed data-theme. Every
 * admin page is dynamic (each one verifies the session), so reading the cookies costs no caching.
 */
export default async function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const jar = await cookies();
  const preference = parseThemePreference(jar.get(THEME_COOKIE)?.value);
  const sidebar = parseSidebarMode(jar.get(SIDEBAR_COOKIE)?.value);
  const language = parseLanguage(jar.get(LANGUAGE_COOKIE)?.value);
  return (
    <html
      lang={htmlLang(language)}
      data-language={language}
      data-theme={serverTheme(preference)}
      data-theme-preference={preference}
      data-sidebar={sidebar}
      data-sidebar-effective={sidebar === 'auto' ? 'expanded' : sidebar}
      suppressHydrationWarning
      className={`${inter.variable} ${poppins.variable} ${notoBengali.variable}`}
    >
      <head>
        {/* Fixed strings (no user input): paint the device theme and the rail's real width
            before the first paint. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_SCRIPT }} />
      </head>
      <body className="min-h-dvh antialiased" suppressHydrationWarning>
        <LanguageProvider initialLanguage={language}>
          <AutoText value={children} />
        </LanguageProvider>
      </body>
    </html>
  );
}
