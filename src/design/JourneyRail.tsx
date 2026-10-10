/*
 * Progress rail for user-paced tours: stations joined by connectors that fill
 * up to the current index. Purely state-driven (no timers); every station is a
 * real button so the tour stays keyboard-operable.
 */
import * as React from 'react';
import './journey.css';

export interface JourneyRailProps {
  count: number;
  index: number;
  onSelect?: (i: number) => void;
  /** Accessible name per station, 1-based number passed in. */
  stationLabel?: (n: number) => string;
  className?: string;
}

export function JourneyRail({ count, index, onSelect, stationLabel = (n) => `خطوة ${n}`, className }: JourneyRailProps) {
  return (
    <div className={['journey-rail', className].filter(Boolean).join(' ')} role="group">
      {Array.from({ length: count }, (_, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="journey-rail-seg" data-on={i <= index ? 'true' : undefined} aria-hidden="true" />}
          <button
            type="button"
            className="journey-rail-dot"
            data-state={i < index ? 'done' : i === index ? 'current' : 'pending'}
            aria-current={i === index ? 'step' : undefined}
            aria-label={stationLabel(i + 1)}
            title={stationLabel(i + 1)}
            onClick={() => onSelect?.(i)}
          />
        </React.Fragment>
      ))}
    </div>
  );
}
