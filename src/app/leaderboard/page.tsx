'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/client';
import { TableSkeleton } from '@/components/LoadingSkeleton';
import { Award, RefreshCw, Trophy } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';

interface LeaderboardEntry {
  username: string;
  rating: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  rank: number;
}

export default function LeaderboardPage() {
  const { tr } = useI18n();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadLeaderboard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (!supabase) {
        throw new Error('Supabase is not configured. Set the public Supabase URL and key.');
      }

      const { data: leaderboardData, error: queryError } = await supabase
        .from('leaderboard')
        .select('*')
        .order('rating', { ascending: false })
        .limit(50);

      if (queryError) throw queryError;
      let data = leaderboardData;

      // Fallback to profiles if leaderboard is empty
      if (!data || data.length === 0) {
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('username, rating, games_played, wins, losses, draws')
          .order('rating', { ascending: false })
          .limit(50);

        if (profileError) throw profileError;
        data = profileData;
      }

      const parsedEntries = (data ?? []).map((entry, index) => ({
        rank: index + 1,
        username: entry.username,
        rating: entry.rating ?? 200,
        gamesPlayed: entry.games_played ?? 0,
        wins: entry.wins ?? 0,
        losses: entry.losses ?? 0,
        draws: entry.draws ?? 0,
      }));
      setEntries(parsedEntries);
    } catch (err) {
      console.error('Error loading leaderboard:', err);
      setError(err instanceof Error ? err.message : 'Failed to load leaderboard');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLeaderboard();
  }, [loadLeaderboard]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 text-text-primary">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 bg-background-secondary p-6 rounded-2xl border border-text-secondary/15 shadow-card">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Trophy className="w-8 h-8 text-yellow-400" />
            <span>{tr('Leaderboard')}</span>
          </h1>
          <p className="text-text-secondary text-sm mt-1">
            {tr('Top-rated grandmasters and challengers competing on ChessArena.')}
          </p>
        </div>
        <button
          onClick={() => void loadLeaderboard()}
          disabled={loading}
          className="px-4 py-2 bg-background-tertiary hover:bg-background text-text-primary text-xs font-semibold rounded-xl border border-text-secondary/20 transition-colors flex items-center gap-2 self-start md:self-auto disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-accent ${loading ? 'animate-spin' : ''}`} />
          <span>{tr('Refresh')}</span>
        </button>
      </div>

      {error && (
        <div role="alert" className="mb-6 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-red-300 flex items-center justify-between">
          <span>{tr(error)}</span>
          <button
            onClick={() => void loadLeaderboard()}
            className="px-3 py-1.5 bg-red-500/20 hover:bg-red-500/30 rounded-lg text-xs font-semibold transition-colors"
          >
            {tr('Retry')}
          </button>
        </div>
      )}

      {loading ? (
        <TableSkeleton rows={8} />
      ) : entries.length === 0 && !error ? (
        <div className="bg-background-secondary rounded-2xl p-12 text-center border border-text-secondary/15">
          <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center mx-auto mb-4">
            <Award className="w-8 h-8 text-accent" />
          </div>
          <h3 className="text-xl font-bold text-text-primary mb-2">{tr('No ranked players yet')}</h3>
          <p className="text-text-secondary text-sm mb-6">{tr('Be the first to play a match and claim the #1 spot!')}</p>
          <Link
            href="/play"
            className="px-6 py-3 bg-accent hover:bg-accent-hover text-white font-semibold rounded-xl transition-all shadow-lg shadow-accent/25 inline-flex items-center gap-2 text-sm"
          >
            <span>{tr('Play First Match')}</span>
          </Link>
        </div>
      ) : (
        <div className="bg-background-secondary rounded-2xl border border-text-secondary/15 overflow-hidden shadow-card">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-text-secondary/15 bg-background-tertiary/50">
                  <th className="text-start p-4 text-text-secondary font-semibold text-xs uppercase tracking-wider">{tr('Rank')}</th>
                  <th className="text-start p-4 text-text-secondary font-semibold text-xs uppercase tracking-wider">{tr('Player')}</th>
                  <th className="text-center p-4 text-text-secondary font-semibold text-xs uppercase tracking-wider">{tr('Rating')}</th>
                  <th className="text-center p-4 text-text-secondary font-semibold text-xs uppercase tracking-wider">{tr('Games')}</th>
                  <th className="text-center p-4 text-text-secondary font-semibold text-xs uppercase tracking-wider">{tr('Wins')}</th>
                  <th className="text-center p-4 text-text-secondary font-semibold text-xs uppercase tracking-wider">{tr('Win Rate')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-text-secondary/10">
                {entries.map((entry) => (
                  <tr key={entry.username} className="hover:bg-accent/5 transition-colors">
                    <td className="p-4 font-mono font-bold text-sm text-text-secondary">
                      <span className={`inline-flex items-center justify-center w-7 h-7 rounded-lg ${
                        entry.rank === 1 ? 'bg-yellow-500/20 text-yellow-400 font-extrabold' :
                        entry.rank === 2 ? 'bg-slate-300/20 text-slate-300 font-extrabold' :
                        entry.rank === 3 ? 'bg-amber-600/20 text-amber-500 font-extrabold' :
                        'bg-background-tertiary text-text-secondary'
                      }`}>
                        #{entry.rank}
                      </span>
                    </td>
                    <td className="p-4 font-semibold text-text-primary">
                      <Link
                        href={`/profile/${encodeURIComponent(entry.username)}`}
                        className="hover:text-accent transition-colors flex items-center gap-2"
                      >
                        <div className="w-8 h-8 rounded-full bg-accent/20 text-accent font-bold flex items-center justify-center text-xs">
                          {entry.username.charAt(0).toUpperCase()}
                        </div>
                        <span>{entry.username}</span>
                      </Link>
                    </td>
                    <td className="p-4 text-center font-mono font-bold text-lg text-accent">
                      {entry.rating}
                    </td>
                    <td className="p-4 text-center font-mono text-sm text-text-secondary">
                      {entry.gamesPlayed}
                    </td>
                    <td className="p-4 text-center font-mono text-sm text-green-400 font-semibold">
                      {entry.wins}
                    </td>
                    <td className="p-4 text-center font-mono text-sm text-green-300 font-medium">
                      {(entry.wins / Math.max(1, entry.gamesPlayed) * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="p-4 bg-background-tertiary/30 border-t border-text-secondary/15 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-text-secondary">
            <span>{tr('Showing top')} {entries.length} {tr('players')}</span>
            <Link href="/play" className="text-accent hover:underline font-semibold flex items-center gap-1">
              <span>{tr('Play online matches to increase your ELO rating')}</span>
              <span>→</span>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
