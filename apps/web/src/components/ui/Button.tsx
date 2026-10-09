import './ui.css';

import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual weight — primary for the main action, danger for destructive ones. */
  variant?: ButtonVariant;
}

/** Base action button. Palette comes only from the theme custom properties. */
export function Button({ variant = 'primary', type = 'button', className, ...rest }: ButtonProps) {
  const classes = ['sh-btn', `sh-btn--${variant}`, className].filter(Boolean).join(' ');
  return <button type={type} className={classes} {...rest} />;
}
