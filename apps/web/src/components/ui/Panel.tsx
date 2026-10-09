import './ui.css';

import type { ReactNode } from 'react';

export type PanelTone = 'card' | 'raised';

export interface PanelProps {
  title?: ReactNode;
  /** Cards sit on the page background; raised panels float above them. */
  tone?: PanelTone;
  className?: string;
  children: ReactNode;
}

/** Surface container for grouping league content. */
export function Panel({ title, tone = 'card', className, children }: PanelProps) {
  const classes = ['sh-panel', `sh-panel--${tone}`, className].filter(Boolean).join(' ');
  return (
    <section className={classes}>
      {title ? <div className="sh-panel__title">{title}</div> : null}
      <div className="sh-panel__body">{children}</div>
    </section>
  );
}
