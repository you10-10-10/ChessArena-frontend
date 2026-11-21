'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { useParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase/client';
import { useI18n } from '@/lib/i18n/context';

type RatingFormat = 'bullet' | 'blitz' | 'rapid' | 'classical';
type RatingRange = '7d' | '30d' | '90d' | '6m' | '1y' | 'all';

interface PlayerRating {
  format: RatingFormat;
  rating: number;
  highest_rating: number;
  lowest_rating: number;
  games_played: number;
  wins: number;
  losses: number;
  draws: number;
}

interface RatingHistoryEntry {
  format: RatingFormat;
  previous_rating: number;
  new_rating: number;
  rating_change: number;
  result: string;
  played_at: string;
}

const RATING_FORMATS: RatingFormat[] = ['bullet', 'blitz', 'rapid', 'classical'];
const RATING_RANGES: { value: RatingRange; label: string; days: number | null }[] = [
  { value: '7d', label: '7 days', days: 7 },
  { value: '30d', label: '30 days', days: 30 },
  { value: '90d', label: '90 days', days: 90 },
  { value: '6m', label: '6 months', days: 183 },
  { value: '1y', label: '1 year', days: 365 },
  { value: 'all', label: 'All time', days: null },
];

interface ProfileData {
  id: string;
  username: string;
  fullName: string;
  avatarUrl: string | null;
  rating: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  joinDate: string;
  preferences: ProfilePreferences;
}

interface ProfilePreferences {
  boardTheme?: string;
  pieceTheme?: string;
  soundEnabled?: boolean;
  timeControl?: string;
}

interface RecentGame {
  id: string;
  whitePlayerId: string;
  blackPlayerId: string | null;
  result: string;
  startedAt: string;
  endedAt: string | null;
  pgn: string | null;
}

export default function ProfilePage() {
  const usernameParam = useParams().username;
  const username = Array.isArray(usernameParam) ? usernameParam[0] : usernameParam;
  const { user, loading } = useAuth();
  const { tr } = useI18n();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [recentGames, setRecentGames] = useState<RecentGame[]>([]);
  const [playerRatings, setPlayerRatings] = useState<PlayerRating[]>([]);
  const [ratingHistory, setRatingHistory] = useState<RatingHistoryEntry[]>([]);
  const [ratingError, setRatingError] = useState<string | null>(null);
  const [ratingLoading, setRatingLoading] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState<RatingFormat>('blitz');
  const [selectedRange, setSelectedRange] = useState<RatingRange>('90d');
  const [activeTab, setActiveTab] = useState('profile');
  const [error, setError] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [academyProgress, setAcademyProgress] = useState<{ passed: number; attempts: number; bestScore: number }>(
    { passed: 0, attempts: 0, bestScore: 0 }
  );

  const loadProfile = useCallback(async () => {
    if (loading) return;
    if (!username) {
      setProfileLoading(false);
      return;
    }

    setProfileLoading(true);
    setProfile(null);
    setRecentGames([]);
    setPlayerRatings([]);
    setRatingHistory([]);
    setRatingError(null);
    setError(null);
    try {
      if (!supabase) {
        throw new Error('Supabase is not configured.');
      }

      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, username, full_name, avatar_url, rating, games_played, wins, losses, draws, join_date')
        .eq('username', username)
        .single();

      if (profileError) throw profileError;

      let preferences: ProfilePreferences = {};
      if (user?.id === profile.id) {
        const { data: preferencesRow, error: preferencesError } = await supabase
          .from('user_preferences')
          .select('preferences')
          .eq('user_id', profile.id)
          .maybeSingle();
        if (preferencesError) throw preferencesError;
        if (preferencesRow?.preferences && typeof preferencesRow.preferences === 'object') {
          preferences = preferencesRow.preferences as ProfilePreferences;
        }
      }

      setProfile({
        id: profile.id,
        username: profile.username,
        fullName: profile.full_name || '',
        avatarUrl: profile.avatar_url,
        rating: profile.rating ?? 200,
        gamesPlayed: profile.games_played || 0,
        wins: profile.wins || 0,
        losses: profile.losses || 0,
        draws: profile.draws || 0,
        joinDate: profile.join_date ? new Date(profile.join_date).toLocaleDateString() : '',
        preferences,
      });

      const passedIds = new Set<string>();
      let attempts = 0;
      let bestScore = 0;
      const { data: academyRows } = await supabase
        .from('academy_progress')
        .select('lesson_id, passed, attempts, best_score')
        .eq('user_id', profile.id);
      if (academyRows) {
        academyRows.forEach((row) => {
          if (row.passed) passedIds.add(row.lesson_id);
        });
        attempts = academyRows.reduce((total, row) => total + (row.attempts || 0), 0);
        bestScore = academyRows.reduce((highest, row) => Math.max(highest, row.best_score || 0), 0);
      }
      if (typeof window !== 'undefined') {
        for (let index = 0; index < 10; index += 1) {
          const lessonId = `l1-${String(index + 1).padStart(2, '0')}`;
          try {
            const local = JSON.parse(window.localStorage.getItem(`chessarena_academy_${lessonId}`) || '{}');
            if (local.passed) passedIds.add(lessonId);
            attempts += local.attempts || 0;
            bestScore = Math.max(bestScore, local.score || 0);
          } catch {
            // Ignore invalid optional local progress.
          }
        }
      }
      setAcademyProgress({ passed: Math.min(passedIds.size, 10), attempts, bestScore });

      setRatingLoading(true);
      try {
        const { data: ratings, error: ratingsError } = await supabase
          .from('player_ratings')
          .select('format, rating, highest_rating, lowest_rating, games_played, wins, losses, draws')
          .eq('profile_id', profile.id);
        if (ratingsError) throw ratingsError;
        if (ratings) setPlayerRatings(ratings as PlayerRating[]);

        const { data: history, error: historyError } = await supabase
          .from('rating_history')
          .select('format, previous_rating, new_rating, rating_change, result, played_at')
          .eq('profile_id', profile.id)
          .order('played_at', { ascending: true })
          .limit(500);
        if (historyError) throw historyError;
        if (history) setRatingHistory(history as RatingHistoryEntry[]);
      } catch (ratingLoadError) {
        console.error('Failed to load player ratings:', ratingLoadError);
        setRatingError(ratingLoadError instanceof Error
          ? ratingLoadError.message
          : 'Unable to load rating history.');
      } finally {
        setRatingLoading(false);
      }

      // Fetch recent games
      const { data: games, error: gamesError } = await supabase
        .from('games')
        .select('id, white_player_id, black_player_id, result, started_at, ended_at, pgn')
        .or(`white_player_id.eq.${profile.id},black_player_id.eq.${profile.id}`)
        .order('started_at', { ascending: false })
        .limit(5);

      if (gamesError) throw gamesError;
      if (games) {
        const parsedGames = games.map((g) => ({
          id: g.id,
          whitePlayerId: g.white_player_id,
          blackPlayerId: g.black_player_id,
          result: g.result,
          startedAt: g.started_at,
          endedAt: g.ended_at,
          pgn: g.pgn,
        }));
        setRecentGames(parsedGames);
      }
    } catch (err) {
      console.error('Failed to load profile:', err);
      setError(err instanceof Error ? err.message : 'Failed to load profile.');
    } finally {
      setProfileLoading(false);
    }
  }, [loading, user, username]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  if (loading || profileLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h2 className="text-xl font-bold text-text-primary mb-4">{tr('Profile Loading...')}</h2>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center p-8">
          <h1 className="text-2xl font-bold text-text-primary mb-4">
            {tr('Profile Not Found')}
          </h1>
          <p role={error ? 'alert' : undefined} className={error ? 'text-red-300' : 'text-text-secondary'}>
            {tr(error || 'The requested profile could not be found.')}
          </p>
        </div>
      </div>
    );
  }

  const isOwnProfile = user?.id === profile.id;
  const selectedRating = playerRatings.find((rating) => rating.format === selectedFormat);
  const displayRating = selectedRating?.rating ?? profile.rating;

  const handleUpdatePreferences = async (newPrefs: ProfilePreferences) => {
    if (!isOwnProfile) {
      throw new Error('You can only change your own preferences.');
    }
    if (!supabase) {
      throw new Error('Supabase is not configured.');
    }

    const { error: updateError } = await supabase
      .from('user_preferences')
      .upsert(
        { user_id: profile.id, preferences: newPrefs, updated_at: new Date().toISOString() },
        { onConflict: 'user_id' }
      );
    if (updateError) {
      throw new Error(updateError.message);
    }

    setProfile({ ...profile, preferences: newPrefs });
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto p-4">
        {error && (
          <div role="alert" className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-300">
            {tr(error)}
          </div>
        )}

        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-x-3">
            {profile.avatarUrl ? (
              <Image
                src={profile.avatarUrl}
                alt={profile.username}
                width={40}
                height={40}
                unoptimized
                className="w-10 h-10 rounded-full object-cover border-2 border-accent"
              />
            ) : (
              <div className="w-10 h-10 rounded-full bg-accent text-white font-bold text-lg flex items-center justify-center">
                {profile.username.charAt(0).toUpperCase()}
              </div>
            )}
            <div>
              <h1 className="text-2xl font-bold text-text-primary">{profile.fullName || profile.username}</h1>
              <p className="text-text-secondary">{profile.joinDate}</p>
            </div>
          </div>

          {/* Rating and Actions */}
          <div className="flex items-center gap-x-3">
            <div className="text-3xl md:text-4xl font-bold text-accent">{displayRating}</div>
            <div className={`px-3 py-1 rounded-full text-sm ${
              user?.user_metadata?.username === profile.username ? 'bg-accent/20 text-accent' :
              'bg-text-secondary/20 text-text-secondary'
            }`}>
              {tr('ChessArena Rating')}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <button
            onClick={() => setActiveTab('profile')}
            className={`px-4 py-2 rounded-lg ${
              activeTab === 'profile' ? 'bg-accent text-white' :
              'text-text-primary hover:text-accent hover:bg-accent/10 transition-colors'
            }`}
          >
            {tr('Profile')}
          </button>
          <button
            onClick={() => setActiveTab('ratings')}
            className={`px-4 py-2 rounded-lg ${
              activeTab === 'ratings' ? 'bg-accent text-white' :
              'text-text-primary hover:text-accent hover:bg-accent/10 transition-colors'
            }`}
          >
            {tr('Ratings')}
          </button>
          <button
            onClick={() => setActiveTab('games')}
            className={`px-4 py-2 rounded-lg ${
              activeTab === 'games' ? 'bg-accent text-white' :
              'text-text-primary hover:text-accent hover:bg-accent/10 transition-colors'
            }`}
          >
            {tr('Games')}
          </button>
          {isOwnProfile && (
            <button
              onClick={() => setActiveTab('preferences')}
              className={`px-4 py-2 rounded-lg ${
                activeTab === 'preferences' ? 'bg-accent text-white' :
                'text-text-primary hover:text-accent hover:bg-accent/10 transition-colors'
              }`}
            >
              {tr('Preferences')}
            </button>
          )}
        </div>

        {/* Profile Content */}
        {activeTab === 'ratings' ? (
          <PlayerRatingsDashboard
            ratings={playerRatings}
            history={ratingHistory}
            loading={ratingLoading}
            error={ratingError}
            format={selectedFormat}
            range={selectedRange}
            onFormatChange={setSelectedFormat}
            onRangeChange={setSelectedRange}
          />
        ) : activeTab === 'games' && recentGames.length > 0 ? (
          <RecentGames section={recentGames} />
        ) : (
          <div className="bg-background-secondary rounded-lg p-6">
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <h3 className="text-sm font-medium text-text-secondary mb-1">{tr('Games Played')}</h3>
                <p className="text-3xl font-bold text-accent">{profile.gamesPlayed}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-text-secondary mb-1">{tr('Win Rate')}</h3>
                <p className="text-3xl font-bold text-green-400">
                  {(profile.wins / Math.max(1, profile.gamesPlayed) * 100).toFixed(1)}%
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <h3 className="text-sm font-medium text-text-secondary mb-1">{tr('Wins')}</h3>
                <p className="text-xl text-green-400">{profile.wins}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-text-secondary mb-1">{tr('Losses')}</h3>
                <p className="text-xl text-red-400">{profile.losses}</p>
              </div>
              <div>
                <h3 className="text-sm font-medium text-text-secondary mb-1">{tr('Draws')}</h3>
                <p className="text-xl text-yellow-400">{profile.draws}</p>
              </div>
            </div>

            <div className="mt-6 rounded-xl border border-accent/20 bg-accent/5 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="font-bold text-text-primary">Chess Academy</h3>
                  <p className="mt-1 text-sm text-text-secondary">
                    {academyProgress.passed} lessons passed · {academyProgress.attempts} quiz attempts
                  </p>
                </div>
                <div className="text-end">
                  <p className="text-xs text-text-secondary">Best quiz</p>
                  <p className="text-lg font-bold text-accent">{academyProgress.bestScore}/20</p>
                </div>
              </div>
            </div>

            <p className="text-text-secondary mt-4">
              {' '}
              {' '}
              {' '}
              {' '}
              {' '}
              {' '}
              {' '}
              {' '}
              {' '}
              {' '}
              {' '}
              {' '}
              {' '}
              {' '}
              {' '}
              {' '}
              {' '}
            </p>
          </div>
        )}

        {activeTab === 'preferences' && isOwnProfile && (
          <PreferencesModal
            profile={profile}
            onUpdate={handleUpdatePreferences}
            onClose={() => setActiveTab('profile')}
          />
        )}
      </div>
    </div>
  );
}

function PlayerRatingsDashboard({
  ratings,
  history,
  loading,
  error,
  format,
  range,
  onFormatChange,
  onRangeChange,
}: {
  ratings: PlayerRating[];
  history: RatingHistoryEntry[];
  loading: boolean;
  error: string | null;
  format: RatingFormat;
  range: RatingRange;
  onFormatChange: (format: RatingFormat) => void;
  onRangeChange: (range: RatingRange) => void;
}) {
  const { language, tr } = useI18n();
  const [now] = useState(() => Date.now());
  const rating = ratings.find((entry) => entry.format === format);
  const currentRating = rating?.rating ?? 200;
  const formatHistory = history.filter((entry) => entry.format === format);
  const rangeDefinition = RATING_RANGES.find((entry) => entry.value === range);
  const cutoff = rangeDefinition?.days === null || rangeDefinition?.days === undefined
    ? null
    : now - rangeDefinition.days * 24 * 60 * 60 * 1000;
  const visibleHistory = formatHistory.filter((entry) =>
    cutoff === null || new Date(entry.played_at).getTime() >= cutoff
  );
  const weekChange = formatHistory
    .filter((entry) => new Date(entry.played_at).getTime() >= now - 7 * 24 * 60 * 60 * 1000)
    .reduce((total, entry) => total + entry.rating_change, 0);
  const monthChange = formatHistory
    .filter((entry) => new Date(entry.played_at).getTime() >= now - 30 * 24 * 60 * 60 * 1000)
    .reduce((total, entry) => total + entry.rating_change, 0);
  const ratingsInChart = visibleHistory.map((entry) => entry.new_rating);
  const minRating = Math.min(...ratingsInChart, currentRating);
  const maxRating = Math.max(...ratingsInChart, currentRating);
  const chartSpan = Math.max(1, maxRating - minRating);
  const chartPoints = visibleHistory.map((entry, index) => {
    const x = visibleHistory.length === 1 ? 300 : 16 + (index / (visibleHistory.length - 1)) * 568;
    const y = 164 - ((entry.new_rating - minRating) / chartSpan) * 142;
    return { entry, x, y };
  });
  const chartLine = chartPoints.map((point) => `${point.x},${point.y}`).join(' ');

  return (
    <section className="space-y-6" aria-labelledby="rating-overview-title">
      <div className="rounded-2xl border border-text-secondary/15 bg-background-secondary p-5 md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 id="rating-overview-title" className="text-xl font-bold text-text-primary">{tr('ChessArena Rating')}</h2>
            <p className="mt-1 text-sm text-text-secondary">{tr('Separate ratings for each time format, based on rated games.')}</p>
          </div>
          <label className="text-sm text-text-secondary">
            {tr('Rating format')}
            <select
              value={format}
              onChange={(event) => onFormatChange(event.target.value as RatingFormat)}
              className="ms-2 rounded-lg border border-text-secondary/20 bg-background px-3 py-2 text-text-primary"
            >
              {RATING_FORMATS.map((item) => (
                <option key={item} value={item}>{tr(item[0].toUpperCase() + item.slice(1))}</option>
              ))}
            </select>
          </label>
        </div>

        {error && (
          <p role="alert" className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            {tr('Rating data could not be loaded:')} {tr(error)}. {tr('Re-run the player intelligence migration in Supabase.')}
          </p>
        )}

        {loading ? (
          <p role="status" className="mt-6 text-sm text-text-secondary">{tr('Loading rating history…')}</p>
        ) : (
          <>
            <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-5">
              <RatingStat label={`${format[0].toUpperCase() + format.slice(1)} rating`} value={currentRating} />
              <RatingStat label={tr('Highest')} value={rating?.highest_rating ?? currentRating} />
              <RatingStat label={tr('Lowest')} value={rating?.lowest_rating ?? currentRating} />
              <RatingStat label={tr('This week')} value={`${weekChange > 0 ? '+' : ''}${weekChange}`} />
              <RatingStat label={tr('This month')} value={`${monthChange > 0 ? '+' : ''}${monthChange}`} />
            </div>

            <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-semibold text-text-primary">{tr('Rating progression')}</h3>
              <div className="flex flex-wrap gap-2" aria-label={tr('Rating chart date range')}>
                {RATING_RANGES.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    aria-pressed={range === item.value}
                    onClick={() => onRangeChange(item.value)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                      range === item.value
                        ? 'bg-accent text-white'
                        : 'bg-background-tertiary text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    {tr(item.label)}
                  </button>
                ))}
              </div>
            </div>

            {visibleHistory.length === 0 ? (
              <p className="mt-4 rounded-xl bg-background p-6 text-center text-sm text-text-secondary">
                {tr('Play rated')} {tr(format[0].toUpperCase() + format.slice(1))} {tr('games to see your real rating history. No historical data is invented.')}
              </p>
            ) : (
              <div className="mt-4 overflow-hidden rounded-xl bg-background p-3">
                <svg
                  viewBox="0 0 600 180"
                  role="img"
                  aria-label={`${tr(format[0].toUpperCase() + format.slice(1))} ${tr('rating history chart')}`}
                  className="h-52 w-full"
                  preserveAspectRatio="none"
                >
                  <line x1="12" y1="164" x2="588" y2="164" stroke="currentColor" opacity="0.2" />
                  <line x1="12" y1="22" x2="588" y2="22" stroke="currentColor" opacity="0.1" />
                  {chartPoints.length > 1 && (
                    <polyline
                      points={chartLine}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      className="text-accent"
                      vectorEffect="non-scaling-stroke"
                    />
                  )}
                  {chartPoints.map(({ entry, x, y }, index) => (
                    <circle
                      key={`${entry.played_at}-${index}`}
                      cx={x}
                      cy={y}
                      r="5"
                      fill="currentColor"
                      className="text-accent"
                    >
                      <title>
                        {`${new Date(entry.played_at).toLocaleDateString(language)}: ${entry.new_rating} (${entry.rating_change > 0 ? '+' : ''}${entry.rating_change}), ${tr(entry.result.replace('_', ' '))}`}
                      </title>
                    </circle>
                  ))}
                  <text x="12" y="178" fill="currentColor" opacity="0.7" fontSize="11">
                    {new Date(visibleHistory[0].played_at).toLocaleDateString(language)}
                  </text>
                  <text x="588" y="178" textAnchor="end" fill="currentColor" opacity="0.7" fontSize="11">
                    {new Date(visibleHistory[visibleHistory.length - 1].played_at).toLocaleDateString(language)}
                  </text>
                </svg>
              </div>
            )}

            <p className="mt-3 text-xs text-text-secondary">
              {rating?.games_played ?? 0} {tr('rated games')} · {rating?.wins ?? 0} {tr('wins')} · {rating?.draws ?? 0} {tr('draws')} · {rating?.losses ?? 0} {tr('losses')}
            </p>
          </>
        )}
      </div>
    </section>
  );
}

function RatingStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl bg-background p-4">
      <p className="text-xs text-text-secondary">{label}</p>
      <p className="mt-1 text-xl font-bold text-text-primary">{value}</p>
    </div>
  );
}

function RecentGames({ section }: { section: RecentGame[] }) {
  const { tr, language } = useI18n();

  return (
    <div className="space-y-3">
      {section.map((game, index) => (
        <div
          key={index}
          className="flex items-center justify-between p-3 rounded-lg bg-background-tertiary hover:bg-accent/5 transition-colors"
        >
          <div className="flex items-center gap-x-2">
            {game.result ? (
              <span className={`text-sm font-medium ${
                game.result.includes('white_wins') ? 'text-green-400' :
                game.result.includes('black_wins') ? 'text-red-400' :
                'text-yellow-400'
              }`}>
                {tr(game.result.replace('_', ' '))}
              </span>
            ) : (
              <span className="text-sm text-text-secondary">{tr('In Progress')}</span>
            )}
            <span className="text-xs text-text-secondary">
              {new Date(game.startedAt).toLocaleDateString(language)}
            </span>
          </div>
          <span className="text-xs text-text-secondary">
            {game.endedAt ? new Date(game.endedAt).toLocaleDateString(language) : tr('Ongoing')}
          </span>
        </div>
      ))}
    </div>
  );
}

function PreferencesModal({ profile, onUpdate, onClose }: {
  profile: ProfileData;
  onUpdate: (newPrefs: ProfilePreferences) => Promise<void>;
  onClose: () => void;
}) {
  const { tr } = useI18n();
  const [preferences, setPreferences] = useState<ProfilePreferences>(profile.preferences);
  const [error, setError] = useState('');

  const handleSave = async () => {
    try {
      setError('');
      await onUpdate(preferences);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : tr('Failed to save preferences.'));
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-background p-8 rounded-xl w-full max-w-md">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-text-primary">{tr('Preferences')}</h2>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary text-xl">&times;</button>
        </div>

        <form onSubmit={(e) => {
          e.preventDefault();
          void handleSave();
        }}>
          {error && <p role="alert" className="mb-4 text-sm text-red-300">{tr(error)}</p>}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                {tr('Board Theme')}
              </label>
              <select
                value={preferences.boardTheme || 'dark'}
                onChange={(e) => setPreferences({
                  ...preferences,
                  boardTheme: e.target.value,
                })}
                className="w-full px-4 py-3 bg-background-tertiary border border-text-secondary/20 rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="dark">{tr('Dark')}</option>
                <option value="light">{tr('Light')}</option>
                <option value="wood">{tr('Wood')}</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                {tr('Piece Theme')}
              </label>
              <select
                value={preferences.pieceTheme || 'standard'}
                onChange={(e) => setPreferences({
                  ...preferences,
                  pieceTheme: e.target.value,
                })}
                className="w-full px-4 py-3 bg-background-tertiary border border-text-secondary/20 rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <option value="standard">{tr('Standard')}</option>
                <option value="merida">{tr('Merida')}</option>
                <option value="cps">CPS</option>
              </select>
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-text-secondary mb-1">
              {tr('Sound')}
            </label>
            <select
              value={String(preferences.soundEnabled !== false)}
              onChange={(e) => setPreferences({
                ...preferences,
                soundEnabled: e.target.value !== 'false',
              })}
              className="w-full px-4 py-3 bg-background-tertiary border border-text-secondary/20 rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="true">{tr('Enabled')}</option>
              <option value="false">{tr('Disabled')}</option>
            </select>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-text-secondary mb-1">
              {tr('Time Control')}
            </label>
            <select
              value={preferences.timeControl || '3+2'}
              onChange={(e) => setPreferences({
                ...preferences,
                timeControl: e.target.value,
              })}
              className="w-full px-4 py-3 bg-background-tertiary border border-text-secondary/20 rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            >
              <option value="1+0">1+0 {tr('Bullet')}</option>
              <option value="3+2">3+2 {tr('Blitz')}</option>
              <option value="5+0">5+0 {tr('Blitz')}</option>
              <option value="10+0">10+0 {tr('Rapid')}</option>
              <option value="15+10">15+10</option>
            </select>
          </div>

          <button
            type="submit"
            className="w-full py-3 bg-accent hover:bg-accent-hover text-white font-semibold rounded-lg transition-colors"
          >
            {tr('Save Preferences')}
          </button>
        </form>
      </div>
    </div>
  );
}