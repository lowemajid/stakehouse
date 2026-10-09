import { colors, fontFamilies } from '@stakehouse/theme';
import type { TextStyle } from 'react-native';

/**
 * StyleSheet twin of the felt system. Every value is drawn from
 * @stakehouse/theme — nothing restyled here.
 *
 * Brass is deliberately NOT exported under its material name: a screen that
 * wants it must reference `palette.money`, so "brass is for money and money
 * only" stays true at the API level, not just in review.
 */
export const palette = {
  screen: colors.feltBlack,
  card: colors.felt900,
  panel: colors.felt700,
  accent: colors.felt500,
  text: colors.cream,
  danger: colors.blood,
  money: colors.brass,
} as const;

/** Shared type styles for the twin; per-screen styles compose on top. */
export const typography = {
  display: {
    fontFamily: fontFamilies.display,
    fontSize: 28,
    fontWeight: '600' as const,
    color: palette.text,
  },
  title: {
    fontFamily: fontFamilies.ui,
    fontSize: 18,
    fontWeight: '600' as const,
    color: palette.text,
  },
  body: {
    fontFamily: fontFamilies.ui,
    fontSize: 15,
    color: palette.text,
  },
  muted: {
    fontFamily: fontFamilies.ui,
    fontSize: 13,
    color: palette.text,
    opacity: 0.7,
  },
  moneyHero: {
    fontFamily: fontFamilies.mono,
    fontSize: 32,
    fontWeight: '600' as const,
    color: palette.money,
  },
  moneyRow: {
    fontFamily: fontFamilies.mono,
    fontSize: 14,
    color: palette.money,
  },
} satisfies Record<string, TextStyle>;
