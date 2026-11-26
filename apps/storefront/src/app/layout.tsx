import type { Metadata, Viewport } from 'next';
import { Inter, Noto_Sans_Bengali, Poppins } from 'next/font/google';
import type { ReactNode } from 'react';
import { rootMetadata } from '@/lib/seo';
import './globals.css';

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

/**
 * The site-wide metadata every page starts from: the store's own name, default title and
 * description (see rootMetadata), so what the store publishes in Admin → Store profile is
 * what search engines and share cards show. A page that sets its own title, description,
 * canonical or share card overrides these.
 */
export async function generateMetadata(): Promise<Metadata> {
  return rootMetadata();
}

export const viewport: Viewport = {
  themeColor: '#0F172A',
  /**
   * The storefront is a light-mode site, so it tells the browser that outright: with
   * `color-scheme: light` the UA keeps form controls, scrollbars and the address bar light even
   * when the device or browser prefers dark, and Chrome's forced-dark experiment leaves the page
   * alone. It is the one place the policy is declared, next to the theme colour.
   */
  colorScheme: 'light',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${poppins.variable} ${notoBengali.variable}`}>
      <body className="min-h-dvh antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
