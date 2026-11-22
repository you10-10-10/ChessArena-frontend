'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/AuthShell';
import { OAuthButtons } from '@/components/auth/OAuthButtons';
import { PasswordField } from '@/components/auth/PasswordField';
import { PasswordRequirements } from '@/components/auth/PasswordRequirements';
import { useAuth, type OAuthProvider } from '@/lib/auth';
import { supabase } from '@/lib/supabase/client';
import {
  getPublicSignUpError,
  isStrongPassword,
  normalizeEmail,
  normalizeUsername,
  validateUsername,
} from '@/lib/auth/validation';
import { useI18n } from '@/lib/i18n/context';

type UsernameStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid' | 'error';

const usernameStatusCopy: Record<UsernameStatus, string> = {
  idle: '',
  checking: 'Checking username…',
  available: 'Available',
  taken: 'Already taken',
  invalid: 'Please enter a valid username.',
  error: 'Could not check username availability. Try again.',
};

export default function SignUpPage() {
  const router = useRouter();
  const { user, loading: authLoading, signUp, signInWithOAuth } = useAuth();
  const { tr } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState<'email' | OAuthProvider | null>(null);
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');
  const normalizedUsername = useMemo(() => normalizeUsername(username), [username]);
  const usernameError = useMemo(() => validateUsername(username), [username]);
  const passwordIsStrong = isStrongPassword(password);
  const passwordsMatch = Boolean(confirmPassword) && password === confirmPassword;
  const passwordsMismatch = Boolean(confirmPassword) && password !== confirmPassword;

  useEffect(() => {
    if (!authLoading && user) {
      router.replace('/play');
    }
  }, [authLoading, router, user]);

  useEffect(() => {
    if (!normalizedUsername) {
      setUsernameStatus('idle');
      return;
    }
    if (usernameError) {
      setUsernameStatus('invalid');
      return;
    }
    if (!supabase) {
      setUsernameStatus('error');
      return;
    }

    const client = supabase;
    let active = true;
    setUsernameStatus('checking');
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const { data, error: queryError } = await client
            .from('profiles')
            .select('id')
            .ilike('username', normalizedUsername)
            .limit(1)
            .maybeSingle();
          if (!active) return;
          if (queryError) {
            setUsernameStatus('error');
            return;
          }
          setUsernameStatus(data ? 'taken' : 'available');
        } catch {
          if (active) setUsernameStatus('error');
        }
      })();
    }, 300);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [normalizedUsername, usernameError]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setError('');
    setSuccess('');

    if (usernameError) {
      setError(usernameError);
      return;
    }
    if (usernameStatus !== 'available') {
      setError(usernameStatus === 'taken' ? 'That username is already taken.' : 'Wait until username availability is confirmed.');
      return;
    }
    if (!passwordIsStrong) {
      setError('Password does not meet the security requirements.');
      return;
    }
    if (!passwordsMatch) {
      setError('Passwords do not match.');
      return;
    }

    setBusy('email');
    try {
      const result = await signUp(normalizeEmail(email), password, normalizedUsername);
      if (result.error) {
        setError(getPublicSignUpError(result.error));
        setBusy(null);
      } else if (result.needsEmailConfirmation) {
        setSuccess('If this email can be registered, check your inbox for a confirmation link. You can sign in or reset your password if you already have an account.');
        setBusy(null);
      } else {
        router.replace('/play');
        router.refresh();
      }
    } catch (signupError) {
      setError(getPublicSignUpError(
        signupError instanceof Error ? signupError : new Error('Unable to create account.'),
      ));
      setBusy(null);
    }
  };

  const handleOAuth = async (provider: OAuthProvider) => {
    if (busy) return;
    setBusy(provider);
    setError('');
    setSuccess('');
    try {
      const result = await signInWithOAuth(provider);
      if (result.error) {
        setError(`Unable to start ${provider === 'google' ? 'Google' : 'GitHub'} sign-in. Please try again.`);
        setBusy(null);
      }
    } catch {
      setError(`Unable to start ${provider === 'google' ? 'Google' : 'GitHub'} sign-in. Please try again.`);
      setBusy(null);
    }
  };

  const statusColor = {
    idle: 'text-text-muted',
    checking: 'text-text-secondary',
    available: 'text-accent',
    taken: 'text-red-300',
    invalid: 'text-red-300',
    error: 'text-amber-300',
  }[usernameStatus];

  return (
    <AuthShell
      title={tr('Create Account')}
      description={tr('Join ChessArena and start playing')}
    >
      <div className="mt-7 space-y-5">
        {error && (
          <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {tr(error)}
          </div>
        )}
        {success && (
          <div role="status" className="rounded-xl border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-300">
            {tr(success)}
          </div>
        )}

        <OAuthButtons
          busy={busy === 'google' || busy === 'github' ? busy : null}
          disabled={busy !== null}
          onSelect={handleOAuth}
        />

        <div className="flex items-center gap-3 text-xs text-text-muted">
          <span className="h-px flex-1 bg-text-secondary/15" />
          <span>{tr('or sign up with email')}</span>
          <span className="h-px flex-1 bg-text-secondary/15" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="username" className="mb-1.5 block text-sm font-medium text-text-secondary">
              {tr('Username')}
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(event) => {
                setUsername(event.target.value);
                setError('');
              }}
              className="w-full rounded-xl border border-text-secondary/20 bg-background-tertiary px-4 py-3 text-text-primary transition placeholder:text-text-muted focus:border-accent/70 focus:outline-none focus:ring-2 focus:ring-accent/25"
              required
              minLength={3}
              maxLength={20}
              pattern="^[A-Za-z0-9_]+$"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              disabled={busy !== null}
              aria-invalid={Boolean(username && usernameError) || usernameStatus === 'taken'}
              aria-describedby="username-help username-status"
            />
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-1 text-xs">
              <span id="username-help" className="text-text-muted">{tr('3-20 characters, letters, numbers, and underscores only')}</span>
              <span id="username-status" role="status" className={statusColor}>
                {tr(usernameError ?? usernameStatusCopy[usernameStatus])}
              </span>
            </div>
          </div>

          <div>
            <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-text-secondary">
              {tr('Email')}
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-xl border border-text-secondary/20 bg-background-tertiary px-4 py-3 text-text-primary transition placeholder:text-text-muted focus:border-accent/70 focus:outline-none focus:ring-2 focus:ring-accent/25"
              required
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              disabled={busy !== null}
            />
          </div>

          <div>
            <PasswordField
              id="password"
              label={tr('Password')}
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              disabled={busy !== null}
            />
            <PasswordRequirements password={password} />
          </div>

          <div>
            <PasswordField
              id="confirmPassword"
              label={tr('Confirm Password')}
              value={confirmPassword}
              onChange={setConfirmPassword}
              autoComplete="new-password"
              disabled={busy !== null}
            />
            {passwordsMismatch && (
              <p role="alert" className="mt-1.5 text-xs text-red-300">{tr('Passwords do not match.')}</p>
            )}
            {passwordsMatch && (
              <p className="mt-1.5 text-xs text-accent">{tr('Passwords match')}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={
              busy !== null ||
              !email.trim() ||
              Boolean(usernameError) ||
              usernameStatus !== 'available' ||
              !passwordIsStrong ||
              !passwordsMatch
            }
            className="w-full rounded-xl bg-accent px-4 py-3 font-semibold text-white shadow-lg shadow-accent/15 transition hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background-secondary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === 'email' ? tr('Creating Account...') : tr('Create Account')}
          </button>
        </form>

        <p className="text-center text-sm text-text-secondary">
          {tr('Already have an account?')}{' '}
          <Link href="/auth/login" className="font-semibold text-accent transition hover:text-accent-hover">
            {tr('Sign in')}
          </Link>
        </p>
        <Link href="/" className="block text-center text-sm text-text-muted transition hover:text-text-primary">
          {tr('Back to Home')}
        </Link>
      </div>
    </AuthShell>
  );
}
