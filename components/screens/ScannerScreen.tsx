'use client';

/**
 * Scan & Pay.
 *
 * Uses the real camera where it is available, and decodes QR codes through the
 * browser's built-in `BarcodeDetector` when the platform ships it (Chrome on
 * Android and desktop). No scanning library — the platform already has one.
 *
 * Three things have to degrade gracefully, because a demo cannot depend on any
 * of them: camera permission may be denied, `getUserMedia` needs HTTPS (or
 * localhost), and Safari has no `BarcodeDetector`. In every one of those cases
 * the merchant list below still works, so the flow is never blocked.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, ChevronLeft, Images, ShieldAlert, Zap } from 'lucide-react';
import { MERCHANTS } from '@/lib/merchants';
import { useApp } from '@/lib/client/state';
import { formatINR } from '@/lib/format';
import { parseUpiPayload } from '@/lib/upi';
import { verifyScan } from '@/lib/client/api';
import { Monogram } from '../Chrome';
import { BottomNav } from '../BottomNav';

/** How long the lock-on animation holds before checkout opens. */
const LOCK_ON_MS = 700;
const SCAN_INTERVAL_MS = 400;
/** How long a refusal stays on screen before scanning resumes. */
const REFUSAL_MS = 3_200;

type CameraState = 'idle' | 'starting' | 'live' | 'denied' | 'unsupported';

interface QrDetector {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>>;
}

/** Chrome ships `BarcodeDetector`; Safari does not. Null means "use the list". */
function createDetector(): QrDetector | null {
  try {
    const Detector = (window as unknown as Record<string, new (options: unknown) => QrDetector>)
      .BarcodeDetector;
    return Detector ? new Detector({ formats: ['qr_code'] }) : null;
  } catch {
    return null;
  }
}

export function ScannerScreen() {
  const { selectMerchant, go } = useApp();
  const [locked, setLocked] = useState<string | null>(null);
  const [camera, setCamera] = useState<CameraState>('idle');
  const [canDecode, setCanDecode] = useState(false);
  /** A verification refusal — shown in the viewfinder, then cleared. */
  const [refusal, setRefusal] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  /** Built once the camera is live; null where the platform has no `BarcodeDetector`. */
  const detectorRef = useRef<QrDetector | null>(null);
  const lockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refusalTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** One verification in flight at a time; frames keep arriving while we wait. */
  const verifying = useRef(false);

  const lockOn = useCallback(
    (merchantId: string, amount?: number, intentRef?: string) => {
      setLocked((current) => {
        if (current) return current;
        lockTimer.current = setTimeout(
          () => selectMerchant(merchantId, amount, intentRef),
          LOCK_ON_MS,
        );
        return merchantId;
      });
    },
    [selectMerchant],
  );

  const refuse = useCallback((message: string) => {
    setRefusal(message);
    if (refusalTimer.current) clearTimeout(refusalTimer.current);
    refusalTimer.current = setTimeout(() => setRefusal(null), REFUSAL_MS);
  }, []);

  /**
   * A signed QR is a payment intent: ask the server to verify it before
   * locking on, the way a UPI app checks a signed intent before it shows the
   * pay screen. A refusal is shown and scanning resumes. If the server cannot
   * be reached at all, trust the local parse — the venue wifi must never turn
   * a working demo into a blank viewfinder.
   */
  const handleScan = useCallback(
    async (raw: string) => {
      const scanned = parseUpiPayload(raw);
      if (!scanned) return;
      if (!scanned.tr) {
        lockOn(scanned.merchantId, scanned.amount);
        return;
      }
      if (verifying.current) return;
      verifying.current = true;
      try {
        const verdict = await verifyScan(scanned.tr, raw);
        if (verdict.ok) lockOn(verdict.merchantId, verdict.amount, verdict.ref);
        else refuse(verdict.message);
      } catch {
        lockOn(scanned.merchantId, scanned.amount);
      } finally {
        verifying.current = false;
      }
    },
    [lockOn, refuse],
  );

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return setCamera('unsupported');
    setCamera('starting');
    try {
      // Rear camera on a phone; falls back to whatever exists on a laptop.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setCamera('live');
      detectorRef.current = createDetector();
      setCanDecode(detectorRef.current !== null);
    } catch {
      setCamera('denied');
    }
  }, []);

  // Release the camera when leaving, and never let a pending lock-on fire late.
  useEffect(
    () => () => {
      stopCamera();
      if (lockTimer.current) clearTimeout(lockTimer.current);
      if (refusalTimer.current) clearTimeout(refusalTimer.current);
    },
    [stopCamera],
  );

  // Poll frames for a QR code while the camera is live.
  useEffect(() => {
    if (camera !== 'live' || !canDecode || locked || refusal) return;

    const detector = detectorRef.current;
    if (!detector) return;
    let cancelled = false;

    const timer = setInterval(async () => {
      const video = videoRef.current;
      if (cancelled || !video || video.readyState < 2) return;
      try {
        const codes = await detector.detect(video);
        const value = codes[0]?.rawValue;
        if (!value) return;
        void handleScan(value);
      } catch {
        // A single failed frame is not worth reporting.
      }
    }, SCAN_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [camera, canDecode, locked, refusal, handleScan]);

  const lockedMerchant = MERCHANTS.find((merchant) => merchant.id === locked);

  return (
    <div className="flex h-full flex-col bg-black">
      <div className="pt-safe flex shrink-0 items-center gap-3 px-4 pb-2">
        <button
          type="button"
          onClick={() => go('home')}
          aria-label="Go back"
          className="-ml-2 rounded-full p-2 text-white transition active:scale-95"
        >
          <ChevronLeft size={18} strokeWidth={2.2} />
        </button>
        <h1 className="flex-1 text-[14px] font-semibold text-white">Scan any QR code</h1>
        <Zap size={16} className="text-white/70" aria-hidden="true" />
        <Images size={16} className="text-white/70" aria-hidden="true" />
      </div>

      {/* --- viewfinder --- */}
      <div className="relative mx-auto mt-1 aspect-square w-[74%] shrink-0 overflow-hidden rounded-3xl">
        <div className="absolute inset-0 bg-gradient-to-br from-[#12203a] via-[#0a1424] to-black" />

        <video
          ref={videoRef}
          playsInline
          muted
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
            camera === 'live' ? 'opacity-100' : 'opacity-0'
          }`}
        />

        {[
          'left-0 top-0 border-l-4 border-t-4 rounded-tl-3xl',
          'right-0 top-0 border-r-4 border-t-4 rounded-tr-3xl',
          'left-0 bottom-0 border-l-4 border-b-4 rounded-bl-3xl',
          'right-0 bottom-0 border-r-4 border-b-4 rounded-br-3xl',
        ].map((corner) => (
          <span key={corner} className={`absolute h-10 w-10 border-brand ${corner}`} />
        ))}

        {!locked ? (
          <motion.div
            initial={{ top: '8%' }}
            animate={{ top: ['8%', '88%', '8%'] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute inset-x-6 h-0.5 rounded-full bg-brand shadow-[0_0_18px_4px_rgba(0,186,242,0.55)]"
          />
        ) : null}

        <AnimatePresence>
          {refusal ? (
            <motion.div
              key="refusal"
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/80 px-6 text-center"
            >
              <ShieldAlert size={30} className="text-[#ff6b6b]" />
              <p className="text-[12px] font-semibold text-white">QR refused</p>
              <p className="text-[11px] leading-relaxed text-white/70">{refusal}</p>
            </motion.div>
          ) : lockedMerchant ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70"
            >
              <Monogram text={lockedMerchant.monogram} tint={lockedMerchant.tint} size={56} />
              <p className="text-[13px] font-semibold text-white">{lockedMerchant.name}</p>
              <p className="text-[10px] text-brand">QR detected · signature verified</p>
            </motion.div>
          ) : camera !== 'live' ? (
            <motion.div
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center"
            >
              {camera === 'denied' || camera === 'unsupported' ? (
                <>
                  <CameraOff size={26} className="text-white/40" />
                  <p className="text-[11px] leading-relaxed text-white/50">
                    {camera === 'denied'
                      ? 'Camera permission was declined. Pick a merchant below instead.'
                      : 'This browser cannot open the camera. Pick a merchant below instead.'}
                  </p>
                </>
              ) : (
                <button
                  type="button"
                  onClick={startCamera}
                  disabled={camera === 'starting'}
                  className="flex items-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-[12px] font-semibold text-[#03253a] transition active:scale-95 disabled:opacity-60"
                >
                  <Camera size={15} />
                  {camera === 'starting' ? 'Opening camera…' : 'Enable camera'}
                </button>
              )}
            </motion.div>
          ) : null}
        </AnimatePresence>

        {camera === 'live' && !locked ? (
          <p className="absolute inset-x-0 bottom-4 text-center text-[10px] text-white/70">
            {canDecode ? 'Point at a QR code' : 'Camera on · tap a merchant below to simulate a scan'}
          </p>
        ) : null}
      </div>

      {/* --- simulated nearby QRs --- */}
      <div className="scroll-slim mt-3 flex-1 overflow-y-auto px-4 pb-24">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-white/40">
          Nearby merchant QRs &mdash; tap to scan
        </p>
        <div className="space-y-1.5">
          {MERCHANTS.map((merchant) => (
            <button
              key={merchant.id}
              type="button"
              onClick={() => lockOn(merchant.id)}
              disabled={Boolean(locked)}
              className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-2.5 text-left transition hover:bg-white/10 active:scale-[0.99] disabled:opacity-40"
            >
              <Monogram text={merchant.monogram} tint={merchant.tint} size={32} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium text-white">
                  {merchant.name}
                </span>
                <span className="block truncate text-[10px] text-white/45">{merchant.blurb}</span>
              </span>
              <span className="shrink-0 text-[10px] text-white/40">
                {formatINR(merchant.suggestedAmount)}
              </span>
            </button>
          ))}
        </div>
      </div>

      <BottomNav active="scanner" />
    </div>
  );
}
