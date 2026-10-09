/* eslint-disable @typescript-eslint/no-require-imports -- Expo loads fonts at
   runtime through Metro asset requires; import syntax does not carry assets. */
import { fontFamilies } from '@stakehouse/theme';

/**
 * The three house faces (plus weights the UI uses), keyed by the exact
 * family names the StyleSheet twin references. Loaded once in App with
 * expo-font; family names stay the single source of truth from the theme.
 */
export const FONT_MAP: Record<string, number> = {
  [fontFamilies.display]: require('../assets/fonts/fraunces-latin-400-normal.woff2'),
  FrauncesSemiBold: require('../assets/fonts/fraunces-latin-600-normal.woff2'),
  [fontFamilies.ui]: require('../assets/fonts/inter-latin-400-normal.woff2'),
  InterMedium: require('../assets/fonts/inter-latin-500-normal.woff2'),
  InterSemiBold: require('../assets/fonts/inter-latin-600-normal.woff2'),
  [fontFamilies.mono]: require('../assets/fonts/ibm-plex-mono-latin-400-normal.woff2'),
  PlexMonoSemiBold: require('../assets/fonts/ibm-plex-mono-latin-600-normal.woff2'),
};
