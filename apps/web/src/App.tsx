import { colors } from '@stakehouse/theme';

const styles = {
  main: { maxWidth: 640, margin: '0 auto', padding: '4rem 1.5rem' },
  heading: { color: colors.cream, marginBottom: 0 },
  rule: { border: 'none', borderTop: `2px solid ${colors.brass}`, margin: '1rem 0 2rem' },
  text: { color: colors.cream, lineHeight: 1.6 },
  muted: { color: colors.cream, opacity: 0.6, fontSize: '0.9rem' },
} as const;

export default function App() {
  return (
    <main style={styles.main}>
      <h1 style={styles.heading}>Stakehouse</h1>
      <hr style={styles.rule} />
      <p style={styles.text}>
        Demo-money fantasy leagues where the ledger is the product — transparent pots, live snake
        drafts, AI managers, and season-end payouts.
      </p>
      <p style={styles.muted}>
        Scaffold build — the league engine, draft room, and payouts land in upcoming slices.
        Checkout is simulated; no real money moves here.
      </p>
    </main>
  );
}
