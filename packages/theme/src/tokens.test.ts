import { describe, expect, it } from 'vitest';
import { colors, cssCustomProperties, fontFamilies, fontStacks } from './tokens';

// The spec's design-direction table, transcribed verbatim — the golden reference.
const SPEC_TABLE = {
  '--sh-felt-black': '#0B0E0B',
  '--sh-felt-900': '#101612',
  '--sh-felt-700': '#16261D',
  '--sh-felt-500': '#1F3A2B',
  '--sh-brass': '#C9A227',
  '--sh-cream': '#F2EDE3',
  '--sh-blood': '#B4522F',
} as const;

const sameHex = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

describe('design tokens (spec §Design direction)', () => {
  it('defines the CSS custom-property layer exactly per the spec table', () => {
    expect(Object.keys(cssCustomProperties).sort()).toEqual(Object.keys(SPEC_TABLE).sort());
    for (const [name, hex] of Object.entries(SPEC_TABLE)) {
      const value = cssCustomProperties[name as keyof typeof cssCustomProperties];
      expect(sameHex(value, hex), `${name} must be ${hex}, got ${value}`).toBe(true);
    }
  });

  it('keeps the role colors and the CSS layer in agreement', () => {
    expect(sameHex(colors.feltBlack, cssCustomProperties['--sh-felt-black'])).toBe(true);
    expect(sameHex(colors.felt900, cssCustomProperties['--sh-felt-900'])).toBe(true);
    expect(sameHex(colors.felt700, cssCustomProperties['--sh-felt-700'])).toBe(true);
    expect(sameHex(colors.felt500, cssCustomProperties['--sh-felt-500'])).toBe(true);
    expect(sameHex(colors.brass, cssCustomProperties['--sh-brass'])).toBe(true);
    expect(sameHex(colors.cream, cssCustomProperties['--sh-cream'])).toBe(true);
    expect(sameHex(colors.blood, cssCustomProperties['--sh-blood'])).toBe(true);
  });

  it('names exactly the three bundled font families', () => {
    expect(fontFamilies.display).toBe('Fraunces');
    expect(fontFamilies.ui).toBe('Inter');
    expect(fontFamilies.mono).toBe('IBM Plex Mono');
  });

  it('bases every font stack on its bundled family', () => {
    expect(fontStacks.display.startsWith("'Fraunces'")).toBe(true);
    expect(fontStacks.ui.startsWith("'Inter'")).toBe(true);
    expect(fontStacks.mono.startsWith("'IBM Plex Mono'")).toBe(true);
  });
});
