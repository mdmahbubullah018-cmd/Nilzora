import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/** Development-only tooling routes; they render 404 in production builds. */
export default function DevLayout({ children }: Readonly<{ children: ReactNode }>) {
  if (process.env.NODE_ENV === 'production') notFound();
  return children;
}
