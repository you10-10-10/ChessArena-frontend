'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AuthShell } from '@/components/auth/AuthShell';
import { OAuthButtons } from '@/components/auth/OAuthButtons';
import { PasswordField } from '@/components/auth/PasswordField';
import { useAuth, type OAuthProvider } from '@/lib/auth';
import { getPublicSignInError, normalizeEmail } from '@/lib/auth/validation';
import { useI18n } from '@/lib/i18n/context';

export default function LoginPage() {
  const router = useRouter();
  const { user, loading: authLoading, signIn, signInWithOAuth } = useAuth();
  const { tr } = useI18n();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<'email' | OAuthProvider | null>(null);

  useEffect(() => {
    if (!authLoading && user) {
      router.replace('/play');
    }
  }, [authLoading, router, user]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;

    setBusy('email');
    setError('');
    try {
      const result = await signIn(normalizeEmail(email), password);
      if (result.error) {
        setError(getPublicSignInError());
        setBusy(null);
        return;
      }

      router.replace('/play');
      router.refresh();
    } catch {
      setError(getPublicSignInError());
      setBusy(null);
    }
  };

  const handleOAuth = async (provider: OAuthProvider) => {
    if (busy) return;
    setBusy(provider);
    setError('');
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

  return (
    <AuthShell
      title={tr('Welcome Back')}
      description={tr('Sign in to your ChessArena account')}
    >
      <div className="mt-7 space-y-5">
        {error && (
          <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {tr(error)}
          </div>
        )}

        <OAuthButtons
          busy={busy === 'google' || busy === 'github' ? busy : null}
          disabled={busy !== null}
          onSelect={handleOAuth}
        />

        <div className="flex items-center gap-3 text-xs text-text-muted">
          <span className="h-px flex-1 bg-text-secondary/15" />
          <span>{tr('or continue with email')}</span>
          <span className="h-px flex-1 bg-text-secondary/15" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
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

          <PasswordField
            id="password"
            label={tr('Password')}
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            disabled={busy !== null}
          />

          <div className="flex justify-end">
            <Link href="/auth/reset-password" className="text-sm font-medium text-accent transition hover:text-accent-hover">
              {tr('Forgot password?')}
            </Link>
          </div>

          <button
            type="submit"
            disabled={busy !== null || !email.trim() || !password}
            className="w-full rounded-xl bg-accent px-4 py-3 font-semibold text-white shadow-lg shadow-accent/15 transition hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background-secondary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === 'email' ? tr('Signing in...') : tr('Sign In')}
          </button>
        </form>

        <p className="text-center text-sm text-text-secondary">
          {tr("Don't have an account?")}{' '}
          <Link href="/auth/signup" className="font-semibold text-accent transition hover:text-accent-hover">
            {tr('Sign up')}
          </Link>
        </p>
        <Link href="/" className="block text-center text-sm text-text-muted transition hover:text-text-primary">
          {tr('Back to Home')}
        </Link>
      </div>
    </AuthShell>
  );
}
