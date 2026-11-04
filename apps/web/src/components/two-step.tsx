'use client';

// Two-step sign-in screens, shared by the Control Centre and the organisation portals:
// the second sign-in step, setting it up (QR code, key, first code, recovery codes) and the
// profile card. Every rule is enforced by the API; these screens only collect what it asks for.
import {
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Alert, Button } from '@/components/ui';
import { Notice, PortalButton } from '@/components/portal-ui';
import {
  apiFetch,
  describeError,
  type CurrentUser,
  type TwoStepSetup,
  type TwoStepStatus,
} from '@/lib/api';

type Tone = 'error' | 'success' | 'info';
type Variant = 'primary' | 'secondary' | 'quiet';

/** Look of the screens: the Control Centre's own, or the organisation's portal branding. */
export interface TwoStepLook {
  Button: (
    props: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean },
  ) => ReactNode;
  Message: (props: { tone: Tone; children: ReactNode }) => ReactNode;
  label: string;
  field: string;
  muted: string;
  heading: string;
}

export const CONSOLE_LOOK: TwoStepLook = {
  Button: ({ variant = 'primary', ...props }) => (
    <Button {...props} variant={variant === 'quiet' ? 'ghost' : variant} />
  ),
  Message: ({ tone, children }) => (
    <Alert tone={tone === 'error' ? 'critical' : tone === 'success' ? 'good' : 'info'}>
      {children}
    </Alert>
  ),
  label: 'block text-sm font-medium text-navy-900',
  field:
    'mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-ink shadow-sm focus:border-teal-500 focus:ring-2 focus:ring-teal-500/30 focus:outline-none',
  muted: 'text-sm text-muted',
  heading: 'text-lg font-semibold text-navy-900',
};

export const PORTAL_LOOK: TwoStepLook = {
  Button: (props) => <PortalButton {...props} />,
  Message: ({ tone, children }) => <Notice tone={tone}>{children}</Notice>,
  label: 'block text-base font-medium text-slate-900',
  field:
    'mt-2 block w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 shadow-sm focus:border-[var(--brand-primary)] focus:ring-2 focus:ring-[var(--brand-accent)] focus:outline-none',
  muted: 'text-base text-slate-600',
  heading: 'text-xl font-semibold text-slate-900',
};

// ---------------------------------------------------------------------------------------------
// Second sign-in step
// ---------------------------------------------------------------------------------------------

/** Asks for the six-digit code (or a recovery code) after a correct password. */
export function TwoStepSignIn({
  challengeToken,
  look,
  onSignedIn,
  onStartAgain,
}: {
  challengeToken: string;
  look: TwoStepLook;
  onSignedIn: () => void;
  onStartAgain: () => void;
}) {
  const [useRecovery, setUseRecovery] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { Button: Btn, Message } = look;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/auth/login/two-step', {
        method: 'POST',
        body: useRecovery
          ? { challengeToken, recoveryCode: value }
          : { challengeToken, code: value.replace(/\s/g, '') },
      });
      onSignedIn();
    } catch (caught) {
      setError(describeError(caught));
      setBusy(false);
      setValue('');
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5" aria-label="Two-step sign-in">
      <div>
        <h2 className={look.heading}>Two-step sign-in</h2>
        <p className={`mt-1 ${look.muted}`}>
          {useRecovery
            ? 'Type one of the recovery codes you saved when you set up two-step sign-in. Each code works once.'
            : 'Open your authenticator app and type the 6-digit code shown for Constitution Intelligence.'}
        </p>
      </div>
      {error && <Message tone="error">{error}</Message>}
      <label className={look.label}>
        {useRecovery ? 'Recovery code' : 'Authenticator code'}
        <input
          key={useRecovery ? 'recovery' : 'code'}
          name={useRecovery ? 'recoveryCode' : 'code'}
          required
          autoFocus
          autoComplete="one-time-code"
          inputMode={useRecovery ? 'text' : 'numeric'}
          pattern={useRecovery ? undefined : '[0-9 ]{6,7}'}
          maxLength={useRecovery ? 20 : 7}
          spellCheck={false}
          autoCapitalize="none"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className={`${look.field} tracking-[0.2em]`}
        />
      </label>
      <Btn type="submit" busy={busy} className="w-full">
        Continue
      </Btn>
      <div className="flex flex-col items-center gap-2">
        <Btn
          type="button"
          variant="quiet"
          onClick={() => {
            setUseRecovery((current) => !current);
            setValue('');
            setError(null);
          }}
        >
          {useRecovery ? 'Use my authenticator app instead' : 'Use a recovery code instead'}
        </Btn>
        <Btn type="button" variant="quiet" onClick={onStartAgain}>
          Start again
        </Btn>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------
// Setting it up
// ---------------------------------------------------------------------------------------------

function groupKey(secret: string): string {
  return secret.replace(/(.{4})/g, '$1 ').trim();
}

/** Shows recovery codes once, with a way to copy them, and waits for the person to confirm. */
export function RecoveryCodes({
  codes,
  look,
  onDone,
}: {
  codes: string[];
  look: TwoStepLook;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const { Button: Btn, Message } = look;
  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <section aria-labelledby="recovery-codes-heading" className="space-y-4">
      <h2 id="recovery-codes-heading" className={look.heading}>
        Save your recovery codes
      </h2>
      <Message tone="info">
        If you lose your phone, each of these codes lets you sign in once. They are shown only now.
        Write them down or print them, and keep them somewhere safe, away from your phone.
      </Message>
      <ol
        aria-label="Recovery codes"
        className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 font-mono text-base text-slate-900"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ol>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Btn type="button" variant="secondary" onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy codes'}
        </Btn>
        <Btn type="button" onClick={onDone}>
          I have saved my recovery codes
        </Btn>
      </div>
    </section>
  );
}

/** QR code and key, then the first code. Calls onEnabled with the recovery codes. */
export function TwoStepSetupSteps({
  look,
  onEnabled,
  onCancel,
}: {
  look: TwoStepLook;
  onEnabled: (recoveryCodes: string[]) => void;
  onCancel?: () => void;
}) {
  const [setup, setSetup] = useState<TwoStepSetup | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { Button: Btn, Message } = look;

  useEffect(() => {
    let cancelled = false;
    apiFetch<TwoStepSetup>('/auth/two-step/setup', { method: 'POST' })
      .then((result) => {
        if (!cancelled) setSetup(result);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(describeError(caught));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ recoveryCodes: string[] }>('/auth/two-step/confirm', {
        method: 'POST',
        body: { code: code.replace(/\s/g, '') },
      });
      onEnabled(result.recoveryCodes);
    } catch (caught) {
      setError(describeError(caught));
      setBusy(false);
      setCode('');
    }
  }

  if (!setup) {
    return error ? (
      <Message tone="error">{error}</Message>
    ) : (
      <p className={look.muted}>Preparing your setup code…</p>
    );
  }

  return (
    <div className="space-y-5">
      <ol className={`list-decimal space-y-2 pl-5 ${look.muted}`}>
        <li>
          Install an authenticator app on your phone if you do not have one (for example Google
          Authenticator, Microsoft Authenticator or 2FAS).
        </li>
        <li>In the app, add an account and scan this QR code.</li>
        <li>Type the 6-digit code the app then shows.</li>
      </ol>
      <div className="flex justify-center">
        <img
          src={setup.qrCode}
          alt="QR code for your authenticator app"
          width={208}
          height={208}
          className="rounded-lg border border-slate-200 bg-white p-2"
        />
      </div>
      <div>
        <p className={look.muted}>
          Cannot scan it? Choose “enter a setup key” in the app and type:
        </p>
        <p
          className="mt-2 rounded-lg bg-slate-100 px-3 py-2 text-center font-mono text-base break-all text-slate-900"
          aria-label="Setup key"
          data-testid="two-step-setup-key"
        >
          {groupKey(setup.secret)}
        </p>
      </div>
      <form onSubmit={confirm} className="space-y-4" aria-label="Confirm two-step sign-in">
        {error && <Message tone="error">{error}</Message>}
        <label className={look.label}>
          6-digit code from the app
          <input
            name="code"
            required
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9 ]{6,7}"
            maxLength={7}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            className={`${look.field} tracking-[0.2em]`}
          />
        </label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Btn type="submit" busy={busy}>
            Turn on two-step sign-in
          </Btn>
          {onCancel && (
            <Btn type="button" variant="quiet" onClick={onCancel}>
              Cancel
            </Btn>
          )}
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Profile card (organisation Owners and Administrators; Super Admins see it too)
// ---------------------------------------------------------------------------------------------

type Mode = 'idle' | 'setup' | 'codes' | 'new-codes' | 'disable';

/** Status and controls. Shows nothing for people who cannot use two-step sign-in. */
export function TwoStepCard({
  look,
  wrap,
}: {
  look: TwoStepLook;
  /** Puts the content in the page's own card ("panel") component. */
  wrap: (props: { title: string; description: string; children: ReactNode }) => ReactNode;
}) {
  const [status, setStatus] = useState<TwoStepStatus | null>(null);
  const [mode, setMode] = useState<Mode>('idle');
  const [codes, setCodes] = useState<string[]>([]);
  const [message, setMessage] = useState<{ tone: Tone; text: string } | null>(null);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const { Button: Btn, Message } = look;

  async function load() {
    try {
      const me = await apiFetch<CurrentUser>('/auth/me');
      setStatus(me.twoStep);
    } catch {
      setStatus(null);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  if (!status || !status.available) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      if (mode === 'disable') {
        await apiFetch('/auth/two-step/disable', {
          method: 'POST',
          body: { password, code: code.replace(/\s/g, '') },
        });
        setMode('idle');
        setMessage({ tone: 'success', text: 'Two-step sign-in has been turned off.' });
      } else {
        const result = await apiFetch<{ recoveryCodes: string[] }>(
          '/auth/two-step/recovery-codes',
          {
            method: 'POST',
            body: { code: code.replace(/\s/g, '') },
          },
        );
        setCodes(result.recoveryCodes);
        setMode('codes');
      }
      setPassword('');
      setCode('');
      await load();
    } catch (caught) {
      setMessage({ tone: 'error', text: describeError(caught) });
    } finally {
      setBusy(false);
    }
  }

  const description = status.required
    ? 'Required for Constitution Intelligence staff: a code from an app on your phone after your password.'
    : 'Recommended for owners and administrators: after your password, you also type a code from an app on your phone. Someone who learns your password still cannot sign in.';

  return wrap({
    title: 'Two-step sign-in',
    description,
    children: (
      <div className="space-y-4">
        {message && <Message tone={message.tone}>{message.text}</Message>}
        {mode === 'setup' && (
          <TwoStepSetupSteps
            look={look}
            onCancel={() => setMode('idle')}
            onEnabled={(recoveryCodes) => {
              setCodes(recoveryCodes);
              setMode('codes');
              void load();
            }}
          />
        )}
        {mode === 'codes' && (
          <RecoveryCodes
            codes={codes}
            look={look}
            onDone={() => {
              setCodes([]);
              setMode('idle');
              setMessage({ tone: 'success', text: 'Two-step sign-in is on.' });
            }}
          />
        )}
        {mode === 'idle' && (
          <>
            <p className={look.muted}>
              {status.enabled
                ? `On. ${status.recoveryCodesRemaining} unused recovery code${status.recoveryCodesRemaining === 1 ? '' : 's'} left.`
                : 'Off.'}
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              {!status.enabled && (
                <Btn type="button" onClick={() => setMode('setup')}>
                  Set up two-step sign-in
                </Btn>
              )}
              {status.enabled && (
                <Btn type="button" variant="secondary" onClick={() => setMode('new-codes')}>
                  New recovery codes
                </Btn>
              )}
              {status.enabled && !status.required && (
                <Btn type="button" variant="quiet" onClick={() => setMode('disable')}>
                  Turn off
                </Btn>
              )}
            </div>
          </>
        )}
        {(mode === 'disable' || mode === 'new-codes') && (
          <form
            onSubmit={submit}
            className="space-y-4"
            aria-label={mode === 'disable' ? 'Turn off two-step sign-in' : 'New recovery codes'}
          >
            <p className={look.muted}>
              {mode === 'disable'
                ? 'To turn it off, type your password and a current code from your authenticator app.'
                : 'Your old recovery codes will stop working. Type a current code from your authenticator app.'}
            </p>
            {mode === 'disable' && (
              <label className={look.label}>
                Password
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  className={look.field}
                />
              </label>
            )}
            <label className={look.label}>
              Authenticator code
              <input
                required
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9 ]{6,7}"
                maxLength={7}
                value={code}
                onChange={(event) => setCode(event.target.value)}
                className={look.field}
              />
            </label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Btn type="submit" busy={busy}>
                {mode === 'disable' ? 'Turn off two-step sign-in' : 'Make new codes'}
              </Btn>
              <Btn type="button" variant="quiet" onClick={() => setMode('idle')}>
                Cancel
              </Btn>
            </div>
          </form>
        )}
      </div>
    ),
  });
}
