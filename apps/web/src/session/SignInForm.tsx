import { useState, type FormEvent } from 'react';
import type { SessionInput } from '@stakehouse/api-client';
import { Button } from '../components/ui';
import { useSession } from './SessionContext';

interface SignInFormProps {
  /** Called with the signed-in identity after the server accepts it. */
  onSuccess: (user: SessionInput) => void;
}

interface SignInInput {
  displayName: string;
  email: string;
}

/**
 * Client-side validation for the demo sign-in. Deliberately plain React —
 * two fields don't earn a form library.
 */
export function validateSignIn(input: SignInInput): { displayName?: string; email?: string } {
  const errors: { displayName?: string; email?: string } = {};
  if (input.displayName.trim().length === 0) {
    errors.displayName = 'display name is required';
  }
  // A pragmatic email check: something@something.tld, no spaces.
  if (!/^\S+@\S+\.\S+$/.test(input.email.trim())) {
    errors.email = 'a valid email is required';
  }
  return errors;
}

/**
 * The house sign-in: display name and email, nothing more. Submitting
 * re-signs the idempotent session route; the server's rejection text is
 * shown as-is when it declines.
 */
export function SignInForm({ onSuccess }: SignInFormProps) {
  const { signIn } = useSession();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [fieldErrors, setFieldErrors] = useState<ReturnType<typeof validateSignIn>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setServerError(null);
    const errors = validateSignIn({ displayName, email });
    setFieldErrors(errors);
    if (errors.displayName || errors.email) return;
    setSubmitting(true);
    signIn({ displayName: displayName.trim(), email: email.trim() })
      .then((user) => {
        onSuccess(user);
      })
      .catch((error: unknown) => {
        setServerError(
          error instanceof Error && error.message.length > 0
            ? error.message
            : 'the house could not seat you — try again',
        );
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <form onSubmit={onSubmit} noValidate>
      <div className="sh-field">
        <label htmlFor="displayName">Display name</label>
        <input
          id="displayName"
          name="displayName"
          type="text"
          autoComplete="nickname"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          aria-invalid={fieldErrors.displayName ? true : undefined}
          aria-describedby={fieldErrors.displayName ? 'displayName-error' : undefined}
        />
        {fieldErrors.displayName ? (
          <p id="displayName-error" className="sh-field__error">
            {fieldErrors.displayName}
          </p>
        ) : null}
      </div>
      <div className="sh-field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={fieldErrors.email ? true : undefined}
          aria-describedby={fieldErrors.email ? 'email-error' : undefined}
        />
        {fieldErrors.email ? (
          <p id="email-error" className="sh-field__error">
            {fieldErrors.email}
          </p>
        ) : null}
      </div>
      {serverError ? (
        <p role="alert" className="sh-field__error">
          {serverError}
        </p>
      ) : null}
      <Button type="submit" disabled={submitting}>
        {submitting ? 'Checking the list…' : 'Take my seat'}
      </Button>
    </form>
  );
}
