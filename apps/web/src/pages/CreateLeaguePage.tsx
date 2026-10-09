import { useState } from 'react';
import { ApiError } from '@stakehouse/api-client';
import { useApi } from '../state/ApiContext';
import { Button } from '../components/ui';
import { navigateTo } from '../router/route';
import { useLeagues } from '../state/LeaguesContext';
import {
  parseCreateLeagueForm,
  type CreateLeagueFieldErrors,
  type CreateLeagueFormValues,
  type ScoringPreset,
} from './createLeagueForm';

const INITIAL_VALUES: CreateLeagueFormValues = {
  name: '',
  entryFeeDollars: '25',
  size: '8',
  roster: { QB: '1', RB: '2', WR: '2', TE: '1', FLEX: '1', K: '1', DEF: '1' },
  preset: 'standard',
  weeks: '10',
  playoffTeams: '4',
  split: ['50', '30', '20'],
};

/** Map an API error's field paths onto the form's field keys. */
function serverFieldErrors(error: ApiError): CreateLeagueFieldErrors {
  const errors: CreateLeagueFieldErrors = {};
  for (const detail of error.details ?? []) {
    const path = detail.path;
    if (path === 'name') errors.name = detail.message;
    else if (path === 'entryFeeCents') errors.entryFee = detail.message;
    else if (path === 'roster') errors.roster = detail.message;
    else if (path === 'regularSeasonWeeks') errors.weeks = detail.message;
    else if (path === 'payoutSplitPct') errors.split = detail.message;
    else if (Object.keys(errors).length === 0) errors.split = detail.message; // first unknown path surfaces somewhere
  }
  if (Object.keys(errors).length === 0) errors.split = error.message;
  return errors;
}

/**
 * The commissioner's form. Every rule the API enforces is surfaced here
 * first — the split sum, whole-cent fees, the bracket-week floor — because a
 * form that waits for the server to say no wastes the commissioner's time.
 */
export function CreateLeaguePage() {
  const api = useApi();
  const { reload } = useLeagues();
  const [values, setValues] = useState<CreateLeagueFormValues>(INITIAL_VALUES);
  const [errors, setErrors] = useState<CreateLeagueFieldErrors>({});
  const [busy, setBusy] = useState(false);

  const splitSum = values.split.reduce((sum, raw) => sum + (Number.parseInt(raw, 10) || 0), 0);
  const splitOk = splitSum === 100;

  function set<K extends keyof CreateLeagueFormValues>(key: K, value: CreateLeagueFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsed = parseCreateLeagueForm(values);
    if (!parsed.ok) {
      setErrors(parsed.fieldErrors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const league = await api.createLeague(parsed.config);
      await reload();
      navigateTo({ name: 'league', leagueId: league.id, tab: 'overview' });
    } catch (error) {
      if (error instanceof ApiError) setErrors(serverFieldErrors(error));
      else throw error;
    } finally {
      setBusy(false);
    }
  }

  const field = (label: string, node: React.ReactNode, error?: string) => (
    <div className="sh-form__field">
      <label className="sh-form__label">
        <span>{label}</span>
        {node}
      </label>
      {error ? (
        <p className="sh-form__error" aria-live="polite">
          {error}
        </p>
      ) : null}
    </div>
  );

  return (
    <div className="sh-page">
      <h1 className="sh-page__title">Create a league</h1>
      <p className="sh-muted">
        You are the commissioner: set the stakes, the seats, and the payout split. The demo checkout
        labels every dollar as simulated.
      </p>
      <form className="sh-form" onSubmit={(event) => void submit(event)} noValidate>
        {field(
          'League name',
          <input
            type="text"
            value={values.name}
            onChange={(event) => set('name', event.target.value)}
            placeholder="Tuesday Night Kitchen League"
          />,
          errors.name,
        )}
        <div className="sh-form__row">
          {field(
            'Entry fee (USD)',
            <input
              type="number"
              min={0}
              step="0.01"
              value={values.entryFeeDollars}
              onChange={(event) => set('entryFeeDollars', event.target.value)}
            />,
            errors.entryFee,
          )}
          {field(
            'League size',
            <select value={values.size} onChange={(event) => set('size', event.target.value)}>
              {[4, 6, 8, 10, 12].map((size) => (
                <option key={size} value={size}>
                  {size} managers
                </option>
              ))}
            </select>,
          )}
          {field(
            'Scoring preset',
            <select
              value={values.preset}
              onChange={(event) => set('preset', event.target.value as ScoringPreset)}
            >
              <option value="standard">Standard</option>
              <option value="half">Half PPR</option>
              <option value="full">Full PPR</option>
            </select>,
          )}
        </div>
        <fieldset className="sh-form__fieldset">
          <legend>Starting roster</legend>
          <div className="sh-form__row sh-form__row--roster">
            {(['QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DEF'] as const).map((slot) =>
              field(
                `${slot} slots`,
                <input
                  type="number"
                  min={0}
                  value={values.roster[slot]}
                  onChange={(event) =>
                    set('roster', { ...values.roster, [slot]: event.target.value })
                  }
                />,
              ),
            )}
          </div>
          {errors.roster ? (
            <p className="sh-form__error" aria-live="polite">
              {errors.roster}
            </p>
          ) : null}
        </fieldset>
        <div className="sh-form__row">
          {field(
            'Regular-season weeks',
            <input
              type="number"
              min={1}
              value={values.weeks}
              onChange={(event) => set('weeks', event.target.value)}
            />,
            errors.weeks,
          )}
          {field(
            'Playoff teams',
            <select
              value={values.playoffTeams}
              onChange={(event) => set('playoffTeams', event.target.value)}
            >
              <option value="0">None — straight regular season</option>
              <option value="2">2 — the final</option>
              <option value="4">4 — seeded bracket</option>
            </select>,
          )}
        </div>
        <fieldset className="sh-form__fieldset">
          <legend>Payout split</legend>
          <div className="sh-form__row">
            {(['1st place %', '2nd place %', '3rd place %'] as const).map((label, index) =>
              field(
                label,
                <input
                  type="number"
                  min={0}
                  value={values.split[index]}
                  onChange={(event) => {
                    const next = [...values.split] as CreateLeagueFormValues['split'];
                    next[index] = event.target.value;
                    set('split', next);
                  }}
                />,
              ),
            )}
          </div>
          <p className={splitOk ? 'sh-form__sum' : 'sh-form__sum sh-form__sum--off'}>
            Split total: {splitSum}%
          </p>
          {(() => {
            // The split total is the one rule worth showing live — the
            // commissioner sees the sum move as they type, before submitting.
            const splitError = !splitOk ? 'the payout split must total exactly 100%' : errors.split;
            return splitError ? (
              <p className="sh-form__error" aria-live="polite">
                {splitError}
              </p>
            ) : null;
          })()}
        </fieldset>
        <Button type="submit" disabled={busy}>
          {busy ? 'Opening the league…' : 'Open the league'}
        </Button>
      </form>
    </div>
  );
}
