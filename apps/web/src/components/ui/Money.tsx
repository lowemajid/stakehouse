import './ui.css';

export interface MoneyProps {
  /** Integer cents — the only money representation in Stakehouse. */
  cents: number;
  className?: string;
}

/**
 * Formats integer cents as USD: 1250 -> "$12.50", -2500 -> "-$25.00".
 * Pure string math (no locale, no float formatting) so ledger text is
 * byte-stable across server, browser, and React Native.
 */
export function formatCents(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new Error(`formatCents expects integer cents, received ${cents}`);
  }
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.trunc(abs / 100);
  const remaining = abs % 100;
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}$${grouped}.${String(remaining).padStart(2, '0')}`;
}

/** A money amount — brass while positive, blood once negative. */
export function Money({ cents, className }: MoneyProps) {
  const classes = ['sh-money', cents < 0 ? 'sh-money--negative' : undefined, className]
    .filter(Boolean)
    .join(' ');
  return <span className={classes}>{formatCents(cents)}</span>;
}
