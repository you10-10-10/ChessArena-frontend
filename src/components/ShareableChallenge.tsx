'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/context';

interface ChallengeDetails {
  id: string;
  status: 'pending' | 'accepted' | 'expired' | 'cancelled';
  timeControl: string;
  selectedColor: 'white' | 'black' | 'random';
  creator: { username: string; rating: number };
  recipientUsername: string | null;
  isCreator: boolean;
  isRecipient: boolean;
  isAcceptedPlayer: boolean;
  gameId: string | null;
}

export default function ShareableChallenge({ challengeId }: { challengeId: string }) {
  const { user, loading: authLoading } = useAuth();
  const { tr } = useI18n();
  const router = useRouter();
  const [challenge, setChallenge] = useState<ChallengeDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadChallenge = useCallback(async () => {
    if (!user) return;
    try {
      const response = await fetch(`/api/challenges/${encodeURIComponent(challengeId)}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'Unable to load this challenge.');
      }
      setChallenge(payload as ChallengeDetails);
      if (
        payload.status === 'accepted'
        && payload.gameId
        && (payload.isCreator || payload.isAcceptedPlayer)
      ) {
        router.replace(`/game/${encodeURIComponent(payload.gameId)}`);
      }
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load this challenge.');
    } finally {
      setLoading(false);
    }
  }, [challengeId, router, user]);

  useEffect(() => {
    if (authLoading || !user) return;
    void loadChallenge();
    if (challenge?.status !== 'pending') return;
    const interval = setInterval(() => void loadChallenge(), 4000);
    return () => clearInterval(interval);
  }, [authLoading, challenge?.status, loadChallenge, user]);

  const handleAction = async (action: 'accept' | 'cancel') => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/challenges/${encodeURIComponent(challengeId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(typeof payload.error === 'string' ? payload.error : 'Unable to process this challenge.');
      }
      if (action === 'accept' && typeof payload.gameId === 'string') {
        router.push(`/game/${encodeURIComponent(payload.gameId)}`);
        return;
      }
      await loadChallenge();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'Unable to process this challenge.');
    } finally {
      setSubmitting(false);
    }
  };

  const redirectTo = `/play/challenge/${encodeURIComponent(challengeId)}`;

  return (
    <main className="mx-auto max-w-xl px-4 py-12 text-text-primary">
      <section className="rounded-2xl border border-text-secondary/15 bg-background-secondary p-6 shadow-card sm:p-8">
        <h1 className="text-2xl font-bold">{tr('Chess challenge')}</h1>
        <p className="mt-2 text-sm text-text-secondary">
          {tr('Join a live game with')} <span className="font-semibold text-text-primary">@{challenge?.creator.username || tr('a ChessArena player')}</span>
          {challenge?.recipientUsername && <>; {tr('this invitation is for')} <span className="font-semibold text-text-primary">@{challenge.recipientUsername}</span></>}.
        </p>

        {(authLoading || (user && loading)) && (
          <p role="status" className="mt-6 text-sm text-text-secondary">{tr('Loading challenge…')}</p>
        )}

        {!authLoading && !user && (
          <div className="mt-6 rounded-xl border border-accent/25 bg-accent/10 p-4">
            <p className="text-sm">{tr('Sign in to accept this challenge. The link will bring you back here.')}</p>
            <Link
              href={`/auth/login?redirectTo=${encodeURIComponent(redirectTo)}`}
              className="mt-4 inline-flex rounded-xl bg-accent px-4 py-2.5 text-sm font-bold text-white hover:bg-accent-hover"
            >
              {tr('Sign in to continue')}
            </Link>
          </div>
        )}

        {error && (
          <div role="alert" className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
            {tr(error)}
          </div>
        )}

        {challenge && (
          <div className="mt-6 space-y-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-background-tertiary p-3">
                <dt className="text-xs text-text-secondary">{tr('Time Control')}</dt>
                <dd className="mt-1 font-semibold">{challenge.timeControl}</dd>
              </div>
              <div className="rounded-xl bg-background-tertiary p-3">
                <dt className="text-xs text-text-secondary">{tr('Host color')}</dt>
                <dd className="mt-1 font-semibold capitalize">{tr(challenge.selectedColor)}</dd>
              </div>
            </dl>

            {challenge.status === 'pending' && challenge.isCreator && (
              <div role="status" className="rounded-xl border border-accent/25 bg-accent/10 p-4 text-sm">
                {tr('Waiting for your friend to accept. This page will open the game as soon as they join.')}
                <button
                  type="button"
                  onClick={() => void handleAction('cancel')}
                  disabled={submitting}
                  className="mt-3 block rounded-lg border border-text-secondary/20 px-3 py-2 text-xs font-semibold hover:bg-background-tertiary disabled:opacity-50"
                >
                  {tr('Cancel challenge')}
                </button>
              </div>
            )}

            {challenge.status === 'pending' && !challenge.isCreator && challenge.isRecipient && (
              <button
                type="button"
                onClick={() => void handleAction('accept')}
                disabled={submitting}
                className="w-full rounded-xl bg-accent px-5 py-3 font-bold text-white hover:bg-accent-hover disabled:opacity-50"
              >
                {submitting ? tr('Joining game…') : `${tr('Accept challenge from')} @${challenge.creator.username}`}
              </button>
            )}

            {challenge.status === 'pending' && !challenge.isCreator && !challenge.isRecipient && (
              <p className="rounded-xl bg-background-tertiary p-4 text-sm">
                {tr('This invitation is for')} @{challenge.recipientUsername}. {tr('Sign in with that account to accept it.')}
              </p>
            )}

            {challenge.status === 'accepted' && challenge.gameId && (
              challenge.isCreator || challenge.isAcceptedPlayer
                ? (
                  <Link href={`/game/${encodeURIComponent(challenge.gameId)}`} className="block rounded-xl bg-accent px-5 py-3 text-center font-bold text-white hover:bg-accent-hover">
                    {tr('Open game')}
                  </Link>
                )
                : <p className="rounded-xl bg-background-tertiary p-4 text-sm">{tr('This challenge has already been accepted by another player.')}</p>
            )}
            {challenge.status === 'expired' && <p className="rounded-xl bg-background-tertiary p-4 text-sm">{tr('This challenge link has expired. Ask your friend to create a new one.')}</p>}
            {challenge.status === 'cancelled' && <p className="rounded-xl bg-background-tertiary p-4 text-sm">{tr('This challenge was cancelled by its creator.')}</p>}
          </div>
        )}
      </section>
    </main>
  );
}
