'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/context';

export default function ResetPasswordPage() {
  const { resetPassword } = useAuth();
  const { tr } = useI18n();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading) return;
    setError('');
    setSent(false);
    setLoading(true);

    try {
      const result = await resetPassword(email);
      if (result.error) {
        setError('Unable to send reset instructions right now. Please try again later.');
      } else {
        setSent(true);
      }
    } catch {
      setError('Unable to send reset instructions right now. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-[65vh] items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl border border-text-secondary/10 bg-background-secondary p-8">
        <h1 className="mb-2 text-2xl font-bold text-text-primary">{tr('Reset your password')}</h1>
        <p className="mb-6 text-sm text-text-secondary">{tr('We’ll send a password reset link if an account exists for that email.')}</p>
        {error && <p role="alert" className="mb-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{tr(error)}</p>}
        {sent && <p role="status" className="mb-4 rounded-lg bg-green-500/10 p-3 text-sm text-green-300">{tr('If the account exists, reset instructions have been sent.')}</p>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <label htmlFor="reset-email" className="block text-sm text-text-secondary">{tr('Email')}</label>
          <input
            id="reset-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            required
            disabled={loading}
            className="w-full rounded-lg border border-text-secondary/20 bg-background-tertiary px-4 py-3 text-text-primary"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-accent px-4 py-3 font-semibold text-white disabled:opacity-50"
          >
            {loading ? tr('Sending…') : tr('Send reset link')}
          </button>
        </form>
        <Link href="/auth/login" className="mt-6 inline-block text-sm text-accent hover:underline">{tr('Back to sign in')}</Link>
      </div>
    </div>
  );
}
