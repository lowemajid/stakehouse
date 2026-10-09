import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { colors } from '@stakehouse/theme';
import { formatCents } from '@stakehouse/domain';
import type { LedgerEntryView, LeagueView } from '@stakehouse/api-client';
import { deriveManagerId, formatSignedCents, seatState } from '../lib/ledgerLogic';
import { apiErrorMessage } from '../lib/apiErrors';
import { useApi } from '../state/apiContext';
import { Button, ErrorBox, Loading, Money, Screen, styles } from '../ui/primitives';

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; league: LeagueView; entries: LedgerEntryView[] };

/**
 * Flow 4 of 4: a league's seat and the pot. The buy-in checkout is simulated
 * and says so out loud; the pool figure is derived from ledger evidence, and
 * the pay response's poolCents updates it live.
 */
export function LeagueDetailScreen({
  leagueId,
  onOpenDraft,
}: {
  leagueId: string;
  onOpenDraft(leagueId: string): void;
}): ReactElement {
  const { client, user } = useApi();
  const [state, setState] = useState<LoadState>({ phase: 'loading' });
  const [locallyJoined, setLocallyJoined] = useState(false);
  const [poolCents, setPoolCents] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const myManagerId = useMemo(() => (user ? deriveManagerId(user.email) : null), [user]);

  const load = useCallback(async (): Promise<void> => {
    setState({ phase: 'loading' });
    try {
      const [leagues, ledger] = await Promise.all([
        client.listLeagues(),
        client.getLedger(leagueId),
      ]);
      const league = leagues.find((candidate) => candidate.id === leagueId);
      if (!league) {
        setState({ phase: 'error', message: 'That league is gone.' });
        return;
      }
      setPoolCents(ledger.poolCents);
      setState({ phase: 'ready', league, entries: ledger.entries });
    } catch (caught) {
      setState({ phase: 'error', message: apiErrorMessage(caught) });
    }
  }, [client, leagueId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function join(): Promise<void> {
    setActionError(null);
    setBusy(true);
    try {
      await client.joinLeague(leagueId);
      setLocallyJoined(true);
    } catch (caught) {
      setActionError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function pay(): Promise<void> {
    setActionError(null);
    setBusy(true);
    try {
      const receipt = await client.payBuyIn(leagueId);
      setPoolCents(receipt.poolCents);
      setState((current) =>
        current.phase === 'ready'
          ? { ...current, entries: [...current.entries, receipt.entry] }
          : current,
      );
    } catch (caught) {
      setActionError(apiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  if (state.phase === 'loading') {
    return (
      <Screen>
        <Loading label="Counting the chips…" />
      </Screen>
    );
  }

  if (state.phase === 'error') {
    return (
      <Screen>
        <ErrorBox message={state.message} onRetry={() => void load()} />
      </Screen>
    );
  }

  const { league, entries } = state;
  const seat = seatState(entries, myManagerId, locallyJoined);
  const pool = poolCents ?? league.poolCents;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scrollBody}>
        <Text style={styles.h1}>{league.name}</Text>

        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.label}>Entry fee</Text>
            <Money cents={league.config.entryFeeCents} />
          </View>
          <View style={styles.rowBetween}>
            <Text style={styles.label}>Live pool</Text>
            <Money cents={pool} />
          </View>
          <Text style={styles.lede}>
            {league.seatsFilled}/{league.config.size} seats · {league.config.size}-seat house rules
          </Text>
          <Button
            label="Enter the draft room"
            onPress={() => onOpenDraft(league.id)}
            variant="quiet"
          />
        </View>

        {seat === 'notJoined' ? (
          <Button busy={busy} label="Take a seat (join)" onPress={join} />
        ) : seat === 'joinedUnpaid' ? (
          <View style={styles.simulatedBanner}>
            <Text style={styles.simulatedText}>
              Demo checkout — this payment is simulated. No real money moves, ever.
            </Text>
            <Text style={styles.lede}>
              Your buy-in posts to the league ledger and the pool below updates the moment it lands.
            </Text>
          </View>
        ) : null}

        {seat === 'paid' ? (
          <View style={styles.simulatedBanner}>
            <Text style={styles.simulatedText}>Buy-in posted — you're in the ledger.</Text>
          </View>
        ) : (
          <>
            {actionError ? <ErrorBox message={actionError} /> : null}
            {seat === 'joinedUnpaid' ? (
              <Button
                busy={busy}
                label={`Pay ${formatCents(league.config.entryFeeCents)} (simulated)`}
                onPress={pay}
              />
            ) : null}
          </>
        )}

        <View style={{ gap: 8 }}>
          <Text style={styles.label}>Ledger — recent entries</Text>
          {entries.length === 0 ? (
            <Text style={styles.emptyText}>The pot is empty. First buy-in opens it.</Text>
          ) : (
            entries.slice(-8).map((entry) => {
              const signed = formatSignedCents(entry.amountCents);
              return (
                <View key={entry.id} style={styles.rowBetween}>
                  <Text style={styles.lede}>{entry.memo}</Text>
                  <Text style={[styles.money, signed.tone === 'danger' && { color: colors.blood }]}>
                    {signed.text}
                  </Text>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}
