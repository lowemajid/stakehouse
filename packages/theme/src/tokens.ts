/**
 * Stakehouse design tokens — the single source of truth.
 *
 * Dark felt, brass reserved for money, cream text. Spec: §Design direction.
 * The web app mirrors the colors as CSS custom properties (../tokens.css,
 * kept in sync by tokens.css.test.ts); the React Native StyleSheet twin
 * consumes these constants directly.
 *
 * This package must stay dependency-free and framework-agnostic —
 * standalone.test.ts enforces it.
 */

/** A CSS custom property name, e.g. `--sh-brass`. */
export type CssCustomProperty = `--sh-${string}`;

/** Hex color string, e.g. `#C9A227`. */
export type HexColor = `#${string}`;

/** Color roles in the felt-and-brass system. */
export const colors = {
  feltBlack: '#0B0E0B',
  felt900: '#101612',
  felt700: '#16261D',
  felt500: '#1F3A2B',
  brass: '#C9A227',
  cream: '#F2EDE3',
  blood: '#B4522F',
} as const;

export type ColorToken = keyof typeof colors;

/**
 * The CSS custom-property layer, exactly per the spec table. Mirror rules:
 * every entry must appear in tokens.css, and tokens.css must declare nothing
 * else (tokens.css.test.ts enforces both directions).
 */
export const cssCustomProperties = {
  '--sh-felt-black': '#0B0E0B', // page background
  '--sh-felt-900': '#101612', // screens, cards
  '--sh-felt-700': '#16261D', // raised panels, table heads
  '--sh-felt-500': '#1F3A2B', // active/selected accents
  '--sh-brass': '#C9A227', // money and money only
  '--sh-cream': '#F2EDE3', // primary text
  '--sh-blood': '#B4522F', // negative ledger values, losses
} as const satisfies Record<CssCustomProperty, HexColor>;

/** Font families bundled with the web app as self-hosted woff2. */
export const fontFamilies = {
  display: 'Fraunces',
  ui: 'Inter',
  mono: 'IBM Plex Mono',
} as const;

export type FontRole = keyof typeof fontFamilies;

/**
 * Full CSS font stacks per role. Web consumes these as variables
 * (apps/web/src/styles/fonts.css, sync-checked by no-network.test.ts);
 * mobile loads the same families natively.
 */
export const fontStacks: Record<FontRole, string> = {
  display: `'Fraunces', Georgia, 'Times New Roman', serif`,
  ui: `'Inter', system-ui, -apple-system, sans-serif`,
  mono: `'IBM Plex Mono', 'SFMono-Regular', Consolas, monospace`,
};
