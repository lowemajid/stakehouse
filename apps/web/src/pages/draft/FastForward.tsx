import { useState } from 'react';
import { ApiError } from '@stakehouse/api-client';
import { Button } from '../../components/ui/Button';

/**
 * The commissioner's fast-forward control: a button plus the confirm modal
 * the room states promise ("picks cascade instantly", no take-backs). The
 * confirm runs the caller's intent; an ApiError keeps the modal open with
 * the server's human reason instead of vanishing into a toast.
 */
export function FastForward({ onConfirm }: { onConfirm: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      setOpen(false);
    } catch (error) {
      if (error instanceof ApiError) setError(error.message);
      else throw error;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Fast-forward
      </Button>
      {open ? (
        <div className="sh-modal" onClick={() => setOpen(false)} role="presentation">
          <div
            className="sh-modal__card"
            role="dialog"
            aria-modal="true"
            aria-label="Fast-forward the draft"
          >
            <h2 className="sh-modal__title">Fast-forward the draft?</h2>
            <p className="sh-modal__body">
              The engine resolves every remaining pick instantly — no take-backs. Queues and
              autopick preferences are honored where they can be.
            </p>
            {error ? (
              <p className="sh-form__error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="sh-modal__actions">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button disabled={busy} onClick={() => void confirm()}>
                {busy ? 'Resolving…' : 'Resolve every pick'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
