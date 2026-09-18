import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'One-Tap Credit — Paytm Build for India AI Hackathon',
  description:
    'A real-time decision layer that surfaces pre-approved credit at the moment of paying — and explains every decision, including the ones where it stays silent.',
};

export const viewport: Viewport = {
  themeColor: '#05070f',
  width: 'device-width',
  initialScale: 1,
  // The demo is a phone UI; pinch-zooming it mid-presentation helps nobody.
  maximumScale: 1,
  // Required for env(safe-area-inset-*) to report real values — without it the
  // insets are always 0 and headers sit under the notch.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
