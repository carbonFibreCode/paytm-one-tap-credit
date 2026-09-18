/**
 * GET /api/intents/[ref]/qr — the intent as an SVG QR code.
 *
 * Rendered on demand from the stored payload. This is the "where is the QR
 * stored" answer: the database holds the signed string, and the image is a
 * deterministic function of it — so there is nothing to keep in sync.
 */

import QRCode from 'qrcode';
import { findIntent } from '@/lib/intents/store';

type Context = { params: Promise<{ ref: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { ref } = await params;
  const intent = await findIntent(ref).catch(() => null);
  if (!intent) return new Response('Unknown intent', { status: 404 });

  const svg = await QRCode.toString(intent.payload, {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark: '#05070f', light: '#ffffff' },
  });
  return new Response(svg, {
    headers: {
      'Content-Type': 'image/svg+xml',
      // Static codes never change; dynamic ones are short-lived anyway.
      'Cache-Control': intent.kind === 'static' ? 'public, max-age=86400' : 'no-store',
    },
  });
}
