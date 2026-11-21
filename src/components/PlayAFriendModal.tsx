'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n/context';
import { Search, UserPlus, Clock, X, Check, AlertCircle, Shield, Sparkles } from 'lucide-react';

interface PlayerProfile {
  id: string;
  username: string;
  full_name: string | null;
  avatar_url: string | null;
  rating: number;
}

interface GameInvitation {
  id: string;
  sender_id: string;
  receiver_id: string;
  game_mode: string;
  time_control: string;
  selected_color: string;
  status: string;
  game_id: string | null;
  expires_at: string;
  created_at: string;
  sender?: PlayerProfile;
  receiver?: PlayerProfile;
}

const TIME_CONTROLS = ['1+0', '3+0', '3+2', '5+0', '10+0', '10+5', '15+10'];

export default function PlayAFriendModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const { tr } = useI18n();
  const router = useRouter();

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PlayerProfile[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerProfile | null>(null);

  const [timeControl, setTimeControl] = useState('3+2');
  const [gameMode, setGameMode] = useState('standard');
  const [selectedColor, setSelectedColor] = useState('random');

  const [sentInvitations, setSentInvitations] = useState<GameInvitation[]>([]);
  const [receivedInvitations, setReceivedInvitations] = useState<GameInvitation[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const searchTimerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchInvitations = async () => {
    if (!user) return;
    try {
      const response = await fetch('/api/invitations', { cache: 'no-store' });
      const payload = await response.json();
      if (response.ok) {
        setSentInvitations(payload.sent || []);
        setReceivedInvitations(payload.received || []);
      }
    } catch (err) {
      console.error('Failed to load invitations:', err);
    }
  };

  useEffect(() => {
    if (!isOpen || !user) return;
    void fetchInvitations();
    const interval = setInterval(() => void fetchInvitations(), 3000);
    return () => clearInterval(interval);
  }, [isOpen, user]);

  useEffect(() => {
    if (!searchQuery || searchQuery.trim().length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);

    setSearching(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const response = await fetch(`/api/players/search?q=${encodeURIComponent(searchQuery.trim())}`);
        const payload = await response.json();
        if (response.ok) {
          setSearchResults(payload.players || []);
        } else {
          setSearchResults([]);
        }
      } catch (err) {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 350);

    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    };
  }, [searchQuery]);

  const handleSendInvite = async (player: PlayerProfile) => {
    setSubmitting(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const response = await fetch('/api/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientUsername: player.username,
          gameMode,
          timeControl,
          selectedColor,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to send game invitation.');
      }
      setSuccessMessage(`${tr('Invitation sent to')} @${player.username}! ${tr('Waiting for response…')}`);
      setSelectedPlayer(null);
      await fetchInvitations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invitation.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRespond = async (invitationId: string, action: 'accept' | 'decline' | 'cancel') => {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/invitations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invitationId, action }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to process invitation action.');
      }
      if (action === 'accept') {
        const gameId = payload.gameId ?? payload.game_id;
        if (typeof gameId !== 'string' || !gameId) {
          throw new Error('Invitation was accepted, but no game link was returned. Refresh and try again.');
        }
        onClose();
        router.push(`/game/${encodeURIComponent(gameId)}`);
        return;
      }
      await fetchInvitations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to process action.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 overflow-y-auto backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="relative w-full max-w-2xl rounded-3xl bg-background-secondary border border-text-secondary/20 p-6 md:p-8 shadow-2xl text-text-primary my-8">

        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-text-secondary/15 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent/20 flex items-center justify-center text-accent">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold">{tr('Play a Friend by Username')}</h2>
              <p className="text-xs text-text-secondary">{tr('Invite registered ChessArena members for live ranked matches.')}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={tr('Close')}
            className="w-9 h-9 rounded-full bg-background-tertiary flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-background transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3.5 bg-red-500/20 border border-red-500/40 rounded-xl text-red-300 text-sm flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{tr(error)}</span>
          </div>
        )}

        {successMessage && (
          <div className="mb-4 p-3.5 bg-green-500/20 border border-green-500/40 rounded-xl text-green-300 text-sm flex items-center gap-2.5">
            <Check className="w-4 h-4 shrink-0" />
            <span>{tr(successMessage)}</span>
          </div>
        )}

        {/* Received Pending Invitations Alert */}
        {receivedInvitations.length > 0 && (
          <div className="mb-6 p-4 rounded-2xl bg-accent/15 border border-accent/40 space-y-3">
            <h3 className="text-sm font-bold text-accent flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              {tr('Incoming Game Invitations')} ({receivedInvitations.length})
            </h3>
            {receivedInvitations.map((inv) => (
              <div key={inv.id} className="flex items-center justify-between bg-background p-3 rounded-xl border border-text-secondary/10">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-accent text-white font-bold flex items-center justify-center text-sm shadow-md">
                    {inv.sender?.username?.charAt(0).toUpperCase() || 'P'}
                  </div>
                  <div>
                    <p className="font-semibold text-sm">@{inv.sender?.username || 'Player'}</p>
                    <p className="text-xs text-text-secondary">
                      {inv.time_control} · {tr('Rating')}: {inv.sender?.rating || 1200}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void handleRespond(inv.id, 'accept')}
                    disabled={submitting}
                    className="px-4 py-2 bg-accent hover:bg-accent-hover text-white text-xs font-bold rounded-lg shadow-md transition-colors"
                  >
                    {tr('Accept')}
                  </button>
                  <button
                    onClick={() => void handleRespond(inv.id, 'decline')}
                    disabled={submitting}
                    className="px-3 py-2 bg-background-tertiary hover:bg-background text-text-secondary hover:text-text-primary text-xs font-semibold rounded-lg border border-text-secondary/20 transition-colors"
                  >
                    {tr('Decline')}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Search Username Section */}
        {!selectedPlayer ? (
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute start-4 top-3.5 w-4 h-4 text-text-secondary" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={tr('Search registered username (e.g. alexander, sarah)...')}
                className="w-full rounded-2xl bg-background-tertiary border border-text-secondary/25 ps-11 pe-4 py-3 text-text-primary text-sm focus:border-accent focus:outline-none"
              />
            </div>

            {searching && (
              <p className="text-xs text-text-secondary text-center py-2">{tr('Searching database…')}</p>
            )}

            {searchResults.length > 0 && (
              <div className="space-y-2 max-h-60 overflow-y-auto pe-1">
                {searchResults.map((player) => (
                  <div
                    key={player.id}
                    onClick={() => setSelectedPlayer(player)}
                    className="flex items-center justify-between p-3.5 rounded-2xl bg-background-tertiary hover:bg-background border border-text-secondary/15 hover:border-accent/40 cursor-pointer transition-all group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-accent/20 text-accent font-bold flex items-center justify-center text-sm group-hover:bg-accent group-hover:text-white transition-colors">
                        {player.username.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-bold text-sm text-text-primary group-hover:text-accent transition-colors">
                          @{player.username}
                        </p>
                        <p className="text-xs text-text-secondary">
                          {player.full_name || tr('Chess Player')} · {tr('Rating')}: <strong className="text-text-primary">{player.rating}</strong>
                        </p>
                      </div>
                    </div>
                    <span className="px-3 py-1.5 bg-accent/20 text-accent text-xs font-semibold rounded-xl group-hover:bg-accent group-hover:text-white transition-colors">
                      {tr('Select Player')}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {searchQuery.trim().length >= 2 && !searching && searchResults.length === 0 && (
              <div className="p-6 text-center text-text-secondary text-sm bg-background-tertiary rounded-2xl border border-text-secondary/10">
                {tr('No registered players found matching')} &quot;{searchQuery}&quot;.
              </div>
            )}
          </div>
        ) : (
          /* Configure & Send Invitation */
          <div className="space-y-6">
            <div className="flex items-center justify-between p-4 bg-background-tertiary rounded-2xl border border-accent/30">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-accent text-white font-bold flex items-center justify-center text-lg shadow-md shadow-accent/30">
                  {selectedPlayer.username.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-bold text-base text-text-primary">@{selectedPlayer.username}</p>
                  <p className="text-xs text-text-secondary">{tr('Rating')}: {selectedPlayer.rating} · {tr('Online')}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedPlayer(null)}
                className="text-xs text-text-secondary hover:text-text-primary underline"
              >
                {tr('Change Player')}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Time Control */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                  {tr('Time Control')}
                </label>
                <select
                  value={timeControl}
                  onChange={(e) => setTimeControl(e.target.value)}
                  className="w-full rounded-xl bg-background-tertiary border border-text-secondary/25 px-3 py-2.5 text-text-primary text-sm font-medium focus:border-accent focus:outline-none"
                >
                  {TIME_CONTROLS.map((tc) => (
                    <option key={tc} value={tc}>{tc} {tr('Blitz / Rapid')}</option>
                  ))}
                </select>
              </div>

              {/* Game Mode */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                  {tr('Game Mode')}
                </label>
                <select
                  value={gameMode}
                  onChange={(e) => setGameMode(e.target.value)}
                  className="w-full rounded-xl bg-background-tertiary border border-text-secondary/25 px-3 py-2.5 text-text-primary text-sm font-medium focus:border-accent focus:outline-none"
                >
                  <option value="standard">{tr('Standard Rated')}</option>
                  <option value="rapid">{tr('Rapid Match')}</option>
                  <option value="blitz">{tr('Blitz Match')}</option>
                </select>
              </div>

              {/* Color Choice */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-text-secondary uppercase tracking-wider">
                  {tr('Your Color')}
                </label>
                <select
                  value={selectedColor}
                  onChange={(e) => setSelectedColor(e.target.value)}
                  className="w-full rounded-xl bg-background-tertiary border border-text-secondary/25 px-3 py-2.5 text-text-primary text-sm font-medium focus:border-accent focus:outline-none"
                >
                  <option value="random">{tr('Random Color')}</option>
                  <option value="white">{tr('Play White')}</option>
                  <option value="black">{tr('Play Black')}</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-text-secondary/15">
              <button
                onClick={() => setSelectedPlayer(null)}
                className="px-5 py-2.5 rounded-xl border border-text-secondary/20 text-text-secondary hover:text-text-primary text-sm font-semibold transition-colors"
              >
                {tr('Back')}
              </button>
              <button
                onClick={() => void handleSendInvite(selectedPlayer)}
                disabled={submitting}
                className="px-6 py-2.5 rounded-xl bg-accent hover:bg-accent-hover text-white text-sm font-bold shadow-lg shadow-accent/25 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                <UserPlus className="w-4 h-4" />
                <span>{submitting ? tr('Sending Invite…') : `${tr('Send Invite to')} @${selectedPlayer.username}`}</span>
              </button>
            </div>
          </div>
        )}

        {/* Sent Pending Invitations Management */}
        {sentInvitations.length > 0 && (
          <div className="mt-8 pt-6 border-t border-text-secondary/15">
            <h3 className="text-sm font-bold text-text-secondary mb-3 flex items-center gap-2">
              <Clock className="w-4 h-4 text-accent" />
              {tr('Pending Sent Invitations')} ({sentInvitations.length})
            </h3>
            <div className="space-y-2">
              {sentInvitations.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between bg-background-tertiary p-3 rounded-xl border border-text-secondary/10">
                  <div>
                    <p className="text-sm font-semibold text-text-primary">
                      {tr('Invited')} <strong className="text-accent">@{inv.receiver?.username || tr('Player')}</strong> ({inv.time_control})
                    </p>
                    <p className="text-xs text-text-secondary">{tr('Waiting for response…')}</p>
                  </div>
                  <button
                    onClick={() => void handleRespond(inv.id, 'cancel')}
                    disabled={submitting}
                    className="px-3 py-1.5 bg-background hover:bg-red-500/20 text-text-secondary hover:text-red-300 text-xs font-semibold rounded-lg border border-text-secondary/20 transition-colors"
                  >
                    {tr('Cancel Invite')}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
