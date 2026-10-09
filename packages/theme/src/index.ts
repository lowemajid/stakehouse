/**
 * Stakehouse design tokens — dark felt, brass reserved for money, cream text.
 * The spec's design section is the source of truth; web mirrors these as CSS
 * custom properties (apps/web/src/styles.css), mobile consumes them directly.
 */
export const colors = {
  feltBlack: '#0B0E0B',
  felt900: '#101612',
  felt700: '#16261D',
  felt500: '#1F3A2B',
  brass: '#C9A227',
  cream: '#F2EDE3',
  blood: '#B4522F',
} as const;
