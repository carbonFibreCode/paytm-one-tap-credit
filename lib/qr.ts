/**
 * One QR renderer for the sticker page, the bill generator and the intent
 * image route, so all three draw the same code the same way.
 */

import QRCode from 'qrcode';

const OPTIONS = {
  type: 'svg' as const,
  margin: 1,
  errorCorrectionLevel: 'M' as const,
  color: { dark: '#05070f', light: '#ffffff' },
};

export function renderQrSvg(payload: string): Promise<string> {
  return QRCode.toString(payload, OPTIONS);
}
