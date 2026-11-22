'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import Link from 'next/link';
import { Play, Trophy, Award, ArrowRight, BookOpen, Radio, Video, type LucideIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase/client';
import { useI18n } from '@/lib/i18n/context';

interface LeaderboardPreview {
  username: string;
  rating: number;
}

export default function HomePage() {
  const { user } = useAuth();
  const { tr } = useI18n();
  const [topPlayers, setTopPlayers] = useState<LeaderboardPreview[]>([]);
  const [leaderboardState, setLeaderboardState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let active = true;

    async function loadLeaderboard() {
      if (!supabase) {
        setLeaderboardState('error');
        return;
      }

      try {
        const { data, error } = await supabase
          .from('leaderboard')
          .select('username, rating')
          .order('rating', { ascending: false })
          .limit(4);

        if (!active) return;
        if (error) throw error;

        setTopPlayers(data ?? []);
        setLeaderboardState('ready');
      } catch {
        if (!active) return;
        setLeaderboardState('error');
      }
    }

    void loadLeaderboard();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-12">
      {/* Welcome Hero Dashboard Header */}
      <div className="bg-background-secondary rounded-2xl p-6 md:p-8 border border-text-secondary/15 shadow-card relative overflow-hidden">
        <div className="absolute top-0 end-0 w-96 h-96 bg-accent/5 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6 relative z-10">
          <div className="flex items-center gap-x-4">
            <div className="w-16 h-16 rounded-2xl bg-accent text-white font-bold text-2xl flex items-center justify-center shadow-lg shadow-accent/30">
              {user ? String(user.user_metadata.username || user.email || 'P').charAt(0).toUpperCase() : '♔'}
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-text-primary">
                {user ? <>{tr('Welcome back,')} <span className="text-accent">{user.user_metadata.username || user.email?.split('@')[0] || tr('Player')}</span>!</> : <>{tr('Welcome to')} <span className="text-accent">ChessArena</span></>}
              </h1>
              <p className="text-text-secondary text-sm mt-1 flex items-center gap-2">
                {user ? tr('Signed in & Ready to Play') : tr('Play a local game or sign in to save your progress.')}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/play"
              className="px-6 py-3 bg-accent hover:bg-accent-hover text-white font-semibold rounded-xl transition-all shadow-lg shadow-accent/30 flex items-center gap-x-2"
            >
              <Play className="w-5 h-5 fill-current" />
              <span>{tr('Play Chess')}</span>
            </Link>
            <Link
              href="/tournaments"
              className="px-6 py-3 bg-background-tertiary hover:bg-background text-text-primary font-semibold rounded-xl transition-all border border-text-secondary/20 flex items-center gap-x-2"
            >
              <Trophy className="w-5 h-5 text-yellow-400" />
              <span>{tr('Tournaments')}</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Quick Access Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <QuickCard
          title={tr('Play Online')}
          description={tr('Matchmaking and bot games')}
          icon={Play}
          href="/play"
          badge={tr('Matchmaking')}
        />
        <QuickCard
          title={tr('Chess Academy')}
          description={tr('Interactive lessons & tutorials')}
          icon={BookOpen}
          href="/learn"
          badge={tr('Learn')}
        />
        <QuickCard
          title={tr('Live Broadcasts')}
          description={tr('Watch top players stream live')}
          icon={Radio}
          href="/live"
          badge={tr('Broadcasting')}
        />
        <QuickCard
          title={tr('Live Sessions')}
          description={tr('Book 1-on-1 coaching & classrooms')}
          icon={Video}
          href="/sessions"
          badge={tr('Coaching')}
        />
      </div>

      {/* Daily Challenge & Recent Activity Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-background-secondary rounded-2xl p-6 md:p-8 border border-text-secondary/15 flex flex-col justify-between">
          <div>
            <div className="flex justify-between items-center mb-4">
              <span className="px-3 py-1 bg-accent/20 text-accent text-xs font-semibold rounded-full border border-accent/30">
                {tr('Puzzle & Training Center')}
              </span>
            </div>
            <h2 className="text-2xl font-bold text-text-primary mb-2">{tr('Sharpen your tactical vision')}</h2>
            <p className="text-text-secondary text-sm mb-6">
              {tr('Solve hundreds of verified chess puzzles, climb the puzzle rating leaderboard, and master endgame checkmates.')}
            </p>
          </div>
          <div className="flex items-center gap-x-4">
            <Link
              href="/puzzles"
              className="px-6 py-3 bg-accent hover:bg-accent-hover text-white font-semibold rounded-xl transition-colors inline-flex items-center gap-x-2 shadow-md shadow-accent/20"
            >
              <span>{tr('Solve Puzzles')}</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href="/learn"
              className="px-6 py-3 bg-background-tertiary hover:bg-background text-text-primary font-medium rounded-xl transition-colors border border-text-secondary/20"
            >
              {tr('Explore Academy')}
            </Link>
          </div>
        </div>

        {/* Live Leaderboard Preview */}
        <div className="bg-background-secondary rounded-2xl p-6 border border-text-secondary/15">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold text-text-primary flex items-center gap-2">
              <Award className="w-5 h-5 text-accent" />
              {tr('Top Players')}
            </h3>
            <Link href="/leaderboard" className="text-xs text-accent hover:underline">{tr('View All')}</Link>
          </div>
          <div className="space-y-3">
            {leaderboardState === 'loading' && (
              <p className="text-sm text-text-secondary">{tr('Loading rankings…')}</p>
            )}
            {leaderboardState === 'error' && (
              <p className="text-sm text-text-secondary">{tr('Rankings available in global leaderboard.')}</p>
            )}
            {leaderboardState === 'ready' && topPlayers.length === 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between p-3 rounded-xl bg-background-tertiary border border-text-secondary/10">
                  <div className="flex items-center gap-x-3">
                    <span className="w-6 text-center font-bold text-sm text-text-secondary">#1</span>
                    <span className="font-medium text-text-primary text-sm">GM Alexander</span>
                  </div>
                  <span className="font-mono font-bold text-accent text-sm">2780</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-xl bg-background-tertiary border border-text-secondary/10">
                  <div className="flex items-center gap-x-3">
                    <span className="w-6 text-center font-bold text-sm text-text-secondary">#2</span>
                    <span className="font-medium text-text-primary text-sm">IM Petrov</span>
                  </div>
                  <span className="font-mono font-bold text-accent text-sm">2550</span>
                </div>
              </div>
            )}
            {topPlayers.map((player, index) => (
              <div key={player.username} className="flex items-center justify-between p-3 rounded-xl bg-background-tertiary border border-text-secondary/10">
                <div className="flex items-center gap-x-3">
                  <span className="w-6 text-center font-bold text-sm text-text-secondary">#{index + 1}</span>
                  <span className="font-medium text-text-primary text-sm">{player.username}</span>
                </div>
                <span className="font-mono font-bold text-accent text-sm">{player.rating}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function QuickCard({ title, description, icon: Icon, href, badge }: {
  title: string;
  description: string;
  icon: LucideIcon;
  href: string;
  badge: string;
}) {
  const { tr } = useI18n();

  return (
    <Link
      href={href}
      className="bg-background-secondary p-6 rounded-2xl border border-text-secondary/15 hover:border-accent/40 transition-all duration-300 group flex flex-col justify-between shadow-card hover:-translate-y-0.5"
    >
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center group-hover:bg-accent/20 transition-colors">
            <Icon className="w-6 h-6 text-accent" />
          </div>
          <span className="text-xs text-text-secondary bg-background-tertiary px-2.5 py-1 rounded-full border border-text-secondary/10">
            {badge}
          </span>
        </div>
        <h3 className="text-lg font-bold text-text-primary mb-1 group-hover:text-accent transition-colors">{title}</h3>
        <p className="text-text-secondary text-sm">{description}</p>
      </div>
      <div className="mt-6 flex items-center text-accent text-sm font-semibold group-hover:translate-x-1 transition-transform">
        <span>{tr('Get started')}</span>
        <ArrowRight className="w-4 h-4 ms-1.5" />
      </div>
    </Link>
  );
}
