import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ComponentProps, ReactElement, ReactNode } from 'react';
import { colors, fontFamilies } from '@stakehouse/theme';
import { formatCents } from '@stakehouse/domain';
import type { Cents } from '@stakehouse/domain';

/**
 * The mobile StyleSheet twin of the felt-and-brass system. Tokens come from
 * @stakehouse/theme — the same constants the web CSS variables mirror — and
 * brass is reserved for money values, per the spec.
 */

export const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.feltBlack,
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 64,
    paddingBottom: 32,
  },
  scrollBody: { gap: 16, paddingBottom: 24 },
  h1: { color: colors.cream, fontFamily: fontFamilies.display, fontSize: 28, fontWeight: '600' },
  lede: { color: colors.cream, fontFamily: fontFamilies.ui, fontSize: 15, opacity: 0.75 },
  label: { color: colors.cream, fontFamily: fontFamilies.ui, fontSize: 13, opacity: 0.7 },
  input: {
    backgroundColor: colors.felt900,
    borderColor: colors.felt700,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.cream,
    fontFamily: fontFamilies.ui,
    fontSize: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  button: {
    alignItems: 'center',
    backgroundColor: colors.felt500,
    borderRadius: 8,
    paddingVertical: 14,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: colors.cream, fontFamily: fontFamilies.ui, fontSize: 16, fontWeight: '600' },
  money: { color: colors.brass, fontFamily: fontFamilies.mono, fontSize: 15 },
  card: {
    backgroundColor: colors.felt900,
    borderColor: colors.felt700,
    borderRadius: 10,
    borderWidth: 1,
    gap: 6,
    padding: 16,
  },
  cardTitle: { color: colors.cream, fontFamily: fontFamilies.display, fontSize: 19 },
  fieldError: { color: colors.blood, fontFamily: fontFamilies.ui, fontSize: 13 },
  errorBox: {
    backgroundColor: colors.felt900,
    borderColor: colors.blood,
    borderRadius: 8,
    borderWidth: 1,
    gap: 8,
    padding: 12,
  },
  errorText: { color: colors.cream, fontFamily: fontFamilies.ui, fontSize: 14 },
  emptyText: { color: colors.cream, fontFamily: fontFamilies.ui, fontSize: 14, opacity: 0.6 },
  segmentedRow: { flexDirection: 'row', gap: 8 },
  segment: {
    backgroundColor: colors.felt900,
    borderColor: colors.felt700,
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
  },
  segmentActive: { backgroundColor: colors.felt500, borderColor: colors.cream },
  segmentText: { color: colors.cream, fontFamily: fontFamilies.ui, fontSize: 14 },
  simulatedBanner: {
    backgroundColor: colors.felt700,
    borderColor: colors.brass,
    borderRadius: 8,
    borderWidth: 1,
    gap: 4,
    padding: 12,
  },
  simulatedText: { color: colors.cream, fontFamily: fontFamilies.ui, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});

export function Screen({ children }: { children: ReactNode }): ReactElement {
  return <View style={styles.screen}>{children}</View>;
}

export function Button({
  busy = false,
  disabled = false,
  label,
  onPress,
  variant = 'primary',
}: {
  busy?: boolean;
  disabled?: boolean;
  label: string;
  onPress(): void;
  variant?: 'primary' | 'quiet';
}): ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || busy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === 'quiet' && { backgroundColor: colors.felt900 },
        disabled && styles.buttonDisabled,
        pressed && { opacity: 0.8 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={colors.cream} />
      ) : (
        <Text style={styles.buttonText}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Input(props: ComponentProps<typeof TextInput>): ReactElement {
  return <TextInput placeholderTextColor="#6B7264" style={styles.input} {...props} />;
}

/**
 * Money renders in brass and IBM Plex Mono — brass shows up nowhere else.
 * Wire views carry validated integers; the Cents cast documents that
 * contract and the safe-integer guard keeps it honest at runtime.
 */
export function Money({ cents }: { cents: number }): ReactElement {
  const text = Number.isSafeInteger(cents) ? formatCents(cents as Cents) : String(cents);
  return <Text style={styles.money}>{text}</Text>;
}

export function FieldError({ message }: { message?: string }): ReactElement | null {
  if (!message) return null;
  return <Text style={styles.fieldError}>{message}</Text>;
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?(): void }) {
  return (
    <View style={styles.errorBox}>
      <Text style={styles.errorText}>{message}</Text>
      {onRetry ? <Button label="Try again" onPress={onRetry} variant="quiet" /> : null}
    </View>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <View style={{ alignItems: 'center', gap: 10, paddingVertical: 32 }}>
      <ActivityIndicator color={colors.cream} />
      <Text style={styles.lede}>{label}</Text>
    </View>
  );
}
