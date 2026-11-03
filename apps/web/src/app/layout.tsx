import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { brand } from '@/lib/brand';
import './globals.css';

export const metadata: Metadata = {
  title: brand.name,
  description: brand.tagline,
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icons/icon-192.png', apple: '/icons/icon-192.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0b1f3a',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans antialiased">{children}</body>
    </html>
  );
}
