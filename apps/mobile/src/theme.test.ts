import { colors, fontFamilies } from '@stakehouse/theme';
import { describe, expect, it } from 'vitest';
import { palette, typography } from './theme';

/**
 * The StyleSheet twin must draw every value from @stakehouse/theme — nothing
 * redefined here. Brass is exported only as `money`: a screen that wants it
 * must admit it is styling money, which keeps "brass is for money and money
 * only" true at the API level, not just in review.
 */
describe('mobile theme twin', () => {
  it('maps the felt system exactly', () => {
    expect(palette.screen).toBe(colors.feltBlack);
    expect(palette.card).toBe(colors.felt900);
    expect(palette.panel).toBe(colors.felt700);
    expect(palette.accent).toBe(colors.felt500);
    expect(palette.text).toBe(colors.cream);
    expect(palette.danger).toBe(colors.blood);
  });

  it('exposes brass only under the money role', () => {
    expect(palette.money).toBe(colors.brass);
    expect(Object.keys(palette)).not.toContain('brass');
  });

  it('binds typography to the shared font families', () => {
    expect(typography.display.fontFamily).toBe(fontFamilies.display);
    expect(typography.body.fontFamily).toBe(fontFamilies.ui);
    expect(typography.moneyHero.fontFamily).toBe(fontFamilies.mono);
  });
});
