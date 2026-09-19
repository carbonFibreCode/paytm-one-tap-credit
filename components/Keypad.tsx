'use client';

/**
 * The numeric pad.
 *
 * Lifted out of the checkout screen so the PIN sheet uses the same keys rather
 * than a second copy of them — same hit areas, same press feedback, same
 * blank centre slot in the bottom row.
 */

export function Keypad({
  onPress,
  deleteLabel,
}: {
  onPress: (key: string) => void;
  deleteLabel: string;
}) {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'];
  return (
    <div className="grid shrink-0 grid-cols-3 gap-px border-t border-line bg-line/40">
      {keys.map((key, index) =>
        key === '' ? (
          <div key={index} className="bg-ink py-3" />
        ) : (
          <button
            key={index}
            type="button"
            onClick={() => onPress(key)}
            aria-label={key === 'back' ? deleteLabel : key}
            className="bg-ink py-3 text-[19px] font-medium text-body transition active:bg-elevated"
          >
            {key === 'back' ? '⌫' : key}
          </button>
        ),
      )}
    </div>
  );
}
