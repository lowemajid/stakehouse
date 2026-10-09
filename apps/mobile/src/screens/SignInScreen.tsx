import { useState } from 'react';
import type { ReactElement } from 'react';
import { Text, View } from 'react-native';
import { useApi } from '../state/apiContext';
import { validateSessionInput } from '../lib/sessionInput';
import { apiErrorMessage } from '../lib/apiErrors';
import { Button, ErrorBox, FieldError, Input, Screen, styles } from '../ui/primitives';

/** Flow 1 of 4: display name + email → session cookie via POST /api/session. */
export function SignInScreen(): ReactElement {
  const { client, setUser } = useApi();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<'displayName' | 'email', string>>>(
    {},
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(): Promise<void> {
    setSubmitError(null);
    const validation = validateSessionInput({ displayName, email });
    if (!validation.ok) {
      setFieldErrors(validation.fieldErrors);
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      const user = await client.signIn(validation.value);
      setUser(user);
    } catch (error) {
      setSubmitError(apiErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <View style={styles.scrollBody}>
        <Text style={styles.h1}>Stakehouse</Text>
        <Text style={styles.lede}>The house keeps the ledger. You keep the team.</Text>

        <View style={{ gap: 6 }}>
          <Text style={styles.label}>Display name</Text>
          <Input
            autoCapitalize="none"
            onChangeText={setDisplayName}
            placeholder="Marge Two Beers"
            value={displayName}
          />
          <FieldError message={fieldErrors.displayName} />
        </View>

        <View style={{ gap: 6 }}>
          <Text style={styles.label}>Email</Text>
          <Input
            autoCapitalize="none"
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="you@example.com"
            value={email}
          />
          <FieldError message={fieldErrors.email} />
        </View>

        {submitError ? <ErrorBox message={submitError} /> : null}

        <Button busy={submitting} label="Take a seat" onPress={submit} />
      </View>
    </Screen>
  );
}
