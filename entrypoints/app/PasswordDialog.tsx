import { useEffect, useRef, useState, type FormEvent } from 'react';
import * as Dialog from '@radix-ui/react-dialog';

export default function PasswordDialog({
  open,
  filename,
  error,
  busy,
  origin,
  onSubmit,
  onCancel,
}: {
  readonly open: boolean;
  readonly filename: string;
  readonly error: string;
  readonly busy: boolean;
  readonly origin?: HTMLElement | null;
  readonly onSubmit: (password: string) => void;
  readonly onCancel: () => void;
}) {
  const [password, setPassword] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => {
      setPassword('');
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!busy) onSubmit(password);
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !busy) onCancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className="password-dialog"
          aria-describedby="password-description"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            requestAnimationFrame(() => (origin ?? previousFocusRef.current)?.focus());
          }}
        >
          <Dialog.Title>Unlock PDF</Dialog.Title>
          <Dialog.Description id="password-description">
            <strong>{filename}</strong> is protected. Its password is used only in this local
            browser session.
          </Dialog.Description>
          <form onSubmit={submit}>
            <label>
              Document password
              <input
                ref={inputRef}
                type="password"
                autoComplete="current-password"
                value={password}
                disabled={busy}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? 'password-error' : undefined}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {error ? (
              <p id="password-error" role="alert" className="dialog-error">
                {error}
              </p>
            ) : null}
            <div className="dialog-actions">
              <Dialog.Close asChild>
                <button type="button" disabled={busy}>
                  Cancel
                </button>
              </Dialog.Close>
              <button type="submit" disabled={busy}>
                {busy ? 'Unlocking…' : 'Unlock'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
