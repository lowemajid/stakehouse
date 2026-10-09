import { SignInForm } from '../session/SignInForm';
import { navigateTo } from '../router/route';
import { Panel } from '../components/ui';

/**
 * The sign-in screen. Success lands back in the lobby with the session
 * live; the shell reflects the identity from there.
 */
export function SignInPage() {
  return (
    <Panel className="sh-page" title="Sign in to the house">
      <p className="sh-muted">
        A display name and an email — that's the whole membership form. No password, no payment:
        this house runs on demo money.
      </p>
      <SignInForm onSuccess={() => navigateTo({ name: 'lobby' })} />
    </Panel>
  );
}
