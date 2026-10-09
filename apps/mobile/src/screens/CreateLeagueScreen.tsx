import { useState } from 'react';
import type { ReactElement } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { LeagueView } from '@stakehouse/api-client';
import { buildLeagueConfig, DEFAULT_ROSTER, SCORING_PRESETS } from '../lib/leagueForm';
import type { LeagueFormFieldErrors, LeagueFormState } from '../lib/leagueForm';
import { apiErrorMessage } from '../lib/apiErrors';
import { useApi } from '../state/apiContext';
import { Button, ErrorBox, FieldError, Input, Screen, styles } from '../ui/primitives';

const INITIAL_FORM: LeagueFormState = {
  name: '',
  entryFeeDollars: '25',
  size: 8,
  regularSeasonWeeks: '10',
  playoffTeams: 4,
  split: ['50', '30', '20'],
  scoringPreset: 'halfPpr',
};

const SIZES = [4, 6, 8, 10, 12] as const;

function Segmented({
  active,
  labels,
  onPick,
}: {
  active: number;
  labels: readonly string[];
  onPick(index: number): void;
}): ReactElement {
  return (
    <View style={styles.segmentedRow}>
      {labels.map((label, index) => (
        <Pressable
          accessibilityRole="button"
          key={label}
          onPress={() => onPick(index)}
          style={[styles.segment, index === active ? styles.segmentActive : null]}
        >
          <Text style={styles.segmentText}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Flow 3 of 4: create a league — the server's schema is the arbiter. */
export function CreateLeagueScreen({
  onBack,
  onCreated,
}: {
  onBack(): void;
  onCreated(league: LeagueView): void;
}): ReactElement {
  const { client } = useApi();
  const [form, setForm] = useState<LeagueFormState>(INITIAL_FORM);
  const [fieldErrors, setFieldErrors] = useState<LeagueFormFieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function patch(partial: Partial<LeagueFormState>): void {
    setForm((current) => ({ ...current, ...partial }));
  }

  async function submit(): Promise<void> {
    setSubmitError(null);
    const result = buildLeagueConfig(form);
    if (!result.ok) {
      setFieldErrors(result.fieldErrors);
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      onCreated(await client.createLeague(result.config));
    } catch (error) {
      setSubmitError(apiErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scrollBody}>
        <Text style={styles.h1}>New league</Text>
        <Text style={styles.lede}>
          Roster: {DEFAULT_ROSTER.QB === 1 ? '1 QB' : `${DEFAULT_ROSTER.QB} QB`}, 2 RB, 2 WR, 1 TE,
          1 FLEX, 1 K, 1 DEF. Rules below follow the house standard.
        </Text>

        <View style={{ gap: 6 }}>
          <Text style={styles.label}>League name</Text>
          <Input
            onChangeText={(name) => patch({ name })}
            placeholder="The Chester Royales"
            value={form.name}
          />
          <FieldError message={fieldErrors.name} />
        </View>

        <View style={{ gap: 6 }}>
          <Text style={styles.label}>Entry fee (USD, demo)</Text>
          <Input
            inputMode="decimal"
            keyboardType="decimal-pad"
            onChangeText={(entryFeeDollars) => patch({ entryFeeDollars })}
            value={form.entryFeeDollars}
          />
          <FieldError message={fieldErrors.entryFee} />
        </View>

        <View style={{ gap: 6 }}>
          <Text style={styles.label}>Seats</Text>
          <Segmented
            active={SIZES.indexOf(form.size)}
            labels={SIZES.map(String)}
            onPick={(index) => patch({ size: SIZES[index]! })}
          />
        </View>

        <View style={{ gap: 6 }}>
          <Text style={styles.label}>Regular-season weeks</Text>
          <Input
            inputMode="numeric"
            keyboardType="number-pad"
            onChangeText={(regularSeasonWeeks) => patch({ regularSeasonWeeks })}
            value={form.regularSeasonWeeks}
          />
          <FieldError message={fieldErrors.regularSeasonWeeks} />
        </View>

        <View style={{ gap: 6 }}>
          <Text style={styles.label}>Playoff teams</Text>
          <Segmented
            active={[0, 2, 4].indexOf(form.playoffTeams)}
            labels={['none', '2', '4']}
            onPick={(index) => patch({ playoffTeams: [0, 2, 4][index]! as 0 | 2 | 4 })}
          />
          <FieldError message={fieldErrors.playoffTeams} />
        </View>

        <View style={{ gap: 6 }}>
          <Text style={styles.label}>Scoring</Text>
          <Segmented
            active={['standard', 'halfPpr', 'fullPpr'].indexOf(form.scoringPreset)}
            labels={['standard', 'half PPR', 'full PPR']}
            onPick={(index) =>
              patch({
                scoringPreset: ['standard', 'halfPpr', 'fullPpr'][
                  index
                ]! as keyof typeof SCORING_PRESETS,
              })
            }
          />
        </View>

        <View style={{ gap: 6 }}>
          <Text style={styles.label}>Payout split — 1st / 2nd / 3rd (%)</Text>
          <View style={styles.segmentedRow}>
            {form.split.map((part, index) => (
              <View key={index} style={{ flex: 1, gap: 6 }}>
                <Input
                  inputMode="numeric"
                  keyboardType="number-pad"
                  onChangeText={(value) => {
                    const next = [...form.split] as [string, string, string];
                    next[index] = value;
                    patch({ split: next });
                  }}
                  value={part}
                />
              </View>
            ))}
          </View>
          <FieldError message={fieldErrors.split} />
        </View>

        {submitError ? <ErrorBox message={submitError} /> : null}

        <View style={styles.segmentedRow}>
          <View style={{ flex: 1 }}>
            <Button label="Back" onPress={onBack} variant="quiet" />
          </View>
          <View style={{ flex: 2 }}>
            <Button busy={submitting} label="Open the league" onPress={submit} />
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}
