'use client';

/**
 * Bottom sheet with swipe-to-dismiss.
 *
 * Dragging is started from the header only, via `dragControls`, rather than
 * being armed on the whole panel. That distinction matters: if the entire sheet
 * were draggable, every attempt to scroll the content would fight the gesture
 * and the sheet would close by accident.
 *
 * A sheet closes on a deliberate drag (far enough, or fast enough), on a
 * backdrop tap, and on Escape.
 */

import { AnimatePresence, motion, useDragControls } from 'framer-motion';
import { useEffect, type ReactNode } from 'react';

/** Past this many pixels, or this much downward speed, the gesture is a dismiss. */
const DISMISS_DISTANCE = 110;
const DISMISS_VELOCITY = 500;

export function Sheet({
  open,
  onClose,
  header,
  children,
  maxHeightClass = 'max-h-[88%]',
  label,
}: {
  open: boolean;
  onClose: () => void;
  /** Rendered in the fixed drag area, alongside the grab handle. */
  header?: ReactNode;
  children: ReactNode;
  maxHeightClass?: string;
  label: string;
}) {
  const dragControls = useDragControls();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.button
            type="button"
            aria-label={`Close ${label}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 z-40 bg-black/65"
          />

          <motion.div
            role="dialog"
            aria-label={label}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 32 }}
            drag="y"
            dragListener={false}
            dragControls={dragControls}
            dragConstraints={{ top: 0, bottom: 0 }}
            // Downward rubber-banding only — the sheet should never lift off.
            dragElastic={{ top: 0, bottom: 0.45 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > DISMISS_DISTANCE || info.velocity.y > DISMISS_VELOCITY) onClose();
            }}
            className={`absolute inset-x-0 bottom-0 z-50 flex ${maxHeightClass} flex-col rounded-t-3xl border-t border-line bg-surface`}
          >
            <div
              onPointerDown={(event) => dragControls.start(event)}
              className="shrink-0 cursor-grab touch-none select-none active:cursor-grabbing"
            >
              <div className="mx-auto mb-1 mt-3 h-1 w-10 rounded-full bg-white/20" />
              {header}
            </div>

            {children}
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
