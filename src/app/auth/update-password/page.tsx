'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { PasswordField } from '@/components/auth/PasswordField';
import { PasswordRequirements } from '@/components/auth/PasswordRequirements';
import { useAuth } from '@/lib/auth';
import { isStrongPassword } from '@/lib/auth/validation';
import { useI18n } from '@/lib/i18n/context';

export default function UpdatePasswordPage() {
  const router = useRouter();
  const { user, loading, updatePassword } = useAuth();
  const { tr } = useI18n();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setError('');

    if (!isStrongPassword(password)) {
      setError('Password does not meet the security requirements.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      const result = await updatePassword(password);
      if (result.error) {
        setError('Unable to update your password. Request a new reset link and try again.');
        setBusy(false);
        return;
      }
      router.replace('/play');
      router.refresh();
    } catch {
      setError('Unable to update your password. Request a new reset link and try again.');
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-[65vh] items-center justify-center px-3 py-8 sm:px-6">
      <div className="w-full max-w-lg rounded-3xl border border-text-secondary/15 bg-background-secondary p-5 shadow-card sm:p-8">
        <h1 className="text-2xl font-bold text-text-primary">{tr('Choose a new password')}</h1>
        <p className="mb-6 mt-2 text-sm leading-6 text-text-secondary">
          {tr('Choose a strong password to secure your Chess Arena account.')}
        </p>
        {error && <p role="alert" className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{tr(error)}</p>}
        {!loading && !user ? (
          <div className="space-y-4">
            <p role="status" className="text-sm text-text-secondary">{tr('Your password reset session has expired. Request a new reset link.')}</p>
            <Link href="/auth/reset-password" className="inline-flex rounded-xl bg-accent px-4 py-3 font-semibold text-white transition hover:bg-accent-hover">
              {tr('Request a new reset link')}
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <PasswordField
                id="new-password"
                label={tr('New password')}
                value={password}
                onChange={setPassword}
                autoComplete="new-password"
                disabled={busy || loading}
              />
              <PasswordRequirements password={password} />
            </div>
            <div>
              <PasswordField
                id="confirm-new-password"
                label={tr('Confirm password')}
                value={confirmPassword}
                onChange={setConfirmPassword}
                autoComplete="new-password"
                disabled={busy || loading}
              />
              {confirmPassword && password !== confirmPassword && (
                <p role="alert" className="mt-1.5 text-xs text-red-300">{tr('Passwords do not match.')}</p>
              )}
            </div>
            <button
              type="submit"
              disabled={busy || loading || !isStrongPassword(password) || password !== confirmPassword}
              className="w-full rounded-xl bg-accent px-4 py-3 font-semibold text-white transition hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? tr('Updating…') : tr('Update password')}
            </button>
          </form>
        )}
        <Link href="/auth/login" className="mt-6 inline-block text-sm text-accent hover:underline">{tr('Back to sign in')}</Link>
      </div>
    </div>
  );
}
