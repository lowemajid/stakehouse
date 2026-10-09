import './ui.css';

export interface ClockProps {
  /** Seconds left on the pick clock. */
  secondsRemaining: number;
  className?: string;
}

/** Remaining seconds at which the clock starts pulsing. */
export const CLOCK_URGENT_SECONDS = 10;

/** Formats seconds as m:ss, clamped at zero. */
export function formatClock(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const minutes = Math.trunc(clamped / 60);
  const remaining = clamped % 60;
  return `${minutes}:${String(remaining).padStart(2, '0')}`;
}

/** The draft pick clock — mono numerals; pulses once the deadline nears. */
export function Clock({ secondsRemaining, className }: ClockProps) {
  const urgent = secondsRemaining <= CLOCK_URGENT_SECONDS;
  const classes = ['sh-clock', urgent ? 'sh-clock--urgent' : undefined, className]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={classes} role="timer" data-urgent={urgent ? 'true' : 'false'}>
      {formatClock(secondsRemaining)}
    </div>
  );
}
