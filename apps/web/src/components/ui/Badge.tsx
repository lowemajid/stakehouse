import './ui.css';

import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'active' | 'money' | 'danger';

export interface BadgeProps {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}

/** Small status pill — the money tone is the only legitimate brass usage. */
export function Badge({ tone = 'neutral', className, children }: BadgeProps) {
  const classes = ['sh-badge', `sh-badge--${tone}`, className].filter(Boolean).join(' ');
  return <span className={classes}>{children}</span>;
}
