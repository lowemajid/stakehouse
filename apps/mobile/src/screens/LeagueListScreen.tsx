import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { LeagueView } from '@stakehouse/api-client';
import { apiErrorMessage } from '../lib/apiErrors';
import { useApi } from '../state/apiContext';
import { Button, ErrorBox, Loading, Money, Screen, styles } from '../ui/primitives';

/** Flow 2 of 4: every league, its seat count, and the live pool. */
export function LeagueListScreen({
  onCreate,
  onOpen,
}: {
  onCreate(): void;
  onOpen(leagueId: string): void;
}): ReactElement {
  const { client } = useApi();
  const [leagues, setLeagues] = useState<LeagueView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      setLeagues(await client.listLeagues());
    } catch (caught) {
      setError(apiErrorMessage(caught));
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen>
      <View style={styles.rowBetween}>
        <Text style={styles.h1}>Leagues</Text>
        <Button label="New league" onPress={onCreate} variant="quiet" />
      </View>

      {error ? (
        <ErrorBox message={error} onRetry={() => void load()} />
      ) : leagues === null ? (
        <Loading label="Dealing you in…" />
      ) : leagues.length === 0 ? (
        <Text style={styles.emptyText}>No leagues yet. Create one and deal the seats.</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollBody}>
          {leagues.map((league) => (
            <Pressable
              accessibilityRole="button"
              key={league.id}
              onPress={() => onOpen(league.id)}
              style={styles.card}
            >
              <Text style={styles.cardTitle}>{league.name}</Text>
              <View style={styles.rowBetween}>
                <Text style={styles.lede}>
                  {league.seatsFilled}/{league.config.size} seats
                </Text>
                <View style={styles.row}>
                  <Text style={styles.label}>Pool </Text>
                  <Money cents={league.poolCents} />
                </View>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}
