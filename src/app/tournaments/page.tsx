'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { cn, getErrorMessage } from '@/lib/utils';
import { supabase } from '@/lib/supabase/client';
import { useI18n } from '@/lib/i18n/context';

interface Tournament {
  id: string;
  name: string;
  description: string | null;
  format: 'arena' | 'swiss' | 'knockout' | 'round_robin';
  status: 'upcoming' | 'live' | 'completed';
  timeControl: string;
  startDate: string;
  maxParticipants: number;
  participantsCount: number;
  organizerId: string | null;
  clubName: string | null;
  isRated: boolean;
  isParticipant: boolean;
}

interface OrganizerClub {
  id: string;
  name: string;
}

interface TournamentInvitation {
  id: string;
  tournamentId: string;
  tournamentName: string;
  inviterUsername: string;
}

function getDefaultStartDate() {
  const date = new Date(Date.now() + 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function getTournamentActionError(error: unknown, fallback: string) {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? error.code
    : null;

  if (code === 'PGRST202' || code === '42883') {
    return 'Tournament invitation database functions are missing. Run the latest SQL update in Supabase.';
  }
  if (code === '42501') {
    return 'You are not authorized to perform this action. Sign in again and confirm the latest SQL update was applied.';
  }
  if (code === '23503') {
    return 'Your account is missing its player profile. Apply the latest compatibility SQL in Supabase, then sign in again.';
  }
  return getErrorMessage(error, fallback);
}

export default function TournamentsPage() {
  const { user } = useAuth();
  const { tr, language } = useI18n();
  const [tournaments, setTournaments] = useState<Tournament[]>([]);
  const [organizerClubs, setOrganizerClubs] = useState<OrganizerClub[]>([]);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newFormat, setNewFormat] = useState<Tournament['format']>('swiss');
  const [newTimeControl, setNewTimeControl] = useState('3+2');
  const [newStartDate, setNewStartDate] = useState(getDefaultStartDate);
  const [newCapacity, setNewCapacity] = useState(32);
  const [newClubId, setNewClubId] = useState('');
  const [newIsRated, setNewIsRated] = useState(false);
  const [filter, setFilter] = useState<'all' | 'live' | 'upcoming'>('all');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [startingRoundId, setStartingRoundId] = useState<string | null>(null);
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [inviteUsernames, setInviteUsernames] = useState<Record<string, string>>({});
  const [invitations, setInvitations] = useState<TournamentInvitation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadTournaments = useCallback(async () => {
    if (!supabase) {
      setError('Tournament data is unavailable because the database is not configured.');
      setLoading(false);
      return;
    }

    setError(null);
    try {
      const { data, error: tournamentsError } = await supabase
        .from('tournaments')
        .select('id, name, description, format, status, time_control, start_date, max_participants, organizer_id, club_id, is_rated')
        .order('start_date', { ascending: true });
      if (tournamentsError) throw tournamentsError;

      const tournamentRows = data ?? [];
      const ids = tournamentRows.map((tournament) => tournament.id);
      const clubIds = [...new Set(tournamentRows.flatMap((tournament) => tournament.club_id ? [tournament.club_id] : []))];
      let registrationRows: Array<{ tournament_id: string; user_id: string }> = [];
      let clubNames = new Map<string, string>();
      if (ids.length > 0) {
        const { data: registrations, error: registrationError } = await supabase
          .from('tournament_players')
          .select('tournament_id, user_id')
          .in('tournament_id', ids);
        if (registrationError) throw registrationError;
        registrationRows = registrations ?? [];
      }
      if (clubIds.length > 0) {
        const { data: clubs, error: clubsError } = await supabase
          .from('clubs')
          .select('id, name')
          .in('id', clubIds);
        if (clubsError) throw clubsError;
        clubNames = new Map((clubs ?? []).map((club) => [club.id, club.name]));
      }

      const counts = new Map<string, number>();
      for (const registration of registrationRows) {
        counts.set(registration.tournament_id, (counts.get(registration.tournament_id) ?? 0) + 1);
      }
      setTournaments(tournamentRows.map((tournament) => ({
        id: tournament.id,
        name: tournament.name,
        description: tournament.description,
        format: tournament.format,
        status: tournament.status,
        timeControl: tournament.time_control,
        startDate: tournament.start_date,
        maxParticipants: tournament.max_participants ?? 64,
        participantsCount: counts.get(tournament.id) ?? 0,
        organizerId: tournament.organizer_id,
        clubName: tournament.club_id ? clubNames.get(tournament.club_id) ?? null : null,
        isRated: tournament.is_rated,
        isParticipant: registrationRows.some((row) => row.tournament_id === tournament.id && row.user_id === user?.id),
      })));
    } catch (loadError) {
      console.error('Unable to load tournaments:', loadError);
      const code = typeof loadError === 'object' && loadError !== null && 'code' in loadError
        ? loadError.code
        : null;
      setError(
        code === 'PGRST205' || code === '42703'
          ? 'The tournament database update is missing. Run sql/fix_matchmaking_and_seed_puzzles.sql in the Supabase SQL Editor.'
          : getErrorMessage(loadError, 'Unable to load tournaments.')
      );
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void loadTournaments();
  }, [loadTournaments]);

  const loadOrganizerClubs = useCallback(async () => {
    if (!user || !supabase) {
      setOrganizerClubs([]);
      return;
    }

    try {
      const { data: memberships, error: membershipsError } = await supabase
        .from('club_members')
        .select('club_id')
        .eq('user_id', user.id)
        .in('role', ['owner', 'admin', 'moderator']);
      if (membershipsError) throw membershipsError;
      const ids = [...new Set((memberships ?? []).map((membership) => membership.club_id))];
      if (ids.length === 0) {
        setOrganizerClubs([]);
        return;
      }

      const { data: clubs, error: clubsError } = await supabase
        .from('clubs')
        .select('id, name')
        .in('id', ids)
        .order('name', { ascending: true });
      if (clubsError) throw clubsError;
      setOrganizerClubs(clubs ?? []);
    } catch (loadError) {
      console.error('Unable to load club tournament permissions:', loadError);
      setError(getErrorMessage(loadError, 'Unable to load clubs for tournament creation.'));
    }
  }, [user]);

  useEffect(() => {
    void loadOrganizerClubs();
  }, [loadOrganizerClubs]);

  const loadInvitations = useCallback(async () => {
    if (!user || !supabase) {
      setInvitations([]);
      return;
    }

    try {
      const { data: rows, error: invitationError } = await supabase
        .from('tournament_invitations')
        .select('id, tournament_id, inviter_id')
        .eq('invitee_id', user.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });
      if (invitationError) throw invitationError;

      const invitations = rows ?? [];
      if (invitations.length === 0) {
        setInvitations([]);
        return;
      }

      const tournamentIds = [...new Set(invitations.map((invitation) => invitation.tournament_id))];
      const inviterIds = [...new Set(invitations.map((invitation) => invitation.inviter_id))];
      const [{ data: tournamentRows, error: tournamentError }, { data: inviterRows, error: inviterError }] = await Promise.all([
        supabase.from('tournaments').select('id, name').in('id', tournamentIds),
        supabase.from('profiles').select('id, username').in('id', inviterIds),
      ]);
      if (tournamentError) throw tournamentError;
      if (inviterError) throw inviterError;

      const tournamentNames = new Map((tournamentRows ?? []).map((row) => [row.id, row.name]));
      const inviterNames = new Map((inviterRows ?? []).map((row) => [row.id, row.username]));
      setInvitations(invitations.map((invitation) => ({
        id: invitation.id,
        tournamentId: invitation.tournament_id,
        tournamentName: tournamentNames.get(invitation.tournament_id) ?? 'Tournament',
        inviterUsername: inviterNames.get(invitation.inviter_id) ?? 'A player',
      })));
    } catch (loadError) {
      console.error('Unable to load tournament invitations:', loadError);
      setError(getTournamentActionError(loadError, 'Unable to load tournament invitations.'));
    }
  }, [user]);

  useEffect(() => {
    void loadInvitations();
  }, [loadInvitations]);

  const filteredTournaments = tournaments.filter((tournament) => (
    filter === 'all' || tournament.status === filter
  ));

  const handleCreateTournament = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user || !supabase) {
      setError('Sign in to create a tournament.');
      return;
    }

    const startsAt = new Date(newStartDate);
    if (!Number.isFinite(startsAt.getTime()) || startsAt.getTime() < Date.now() + 5 * 60_000) {
      setError('Choose a start time at least five minutes from now.');
      return;
    }

    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const { error: createError } = await supabase.rpc('create_tournament', {
        p_name: newName.trim(),
        p_description: newDescription.trim() || null,
        p_format: newFormat,
        p_time_control: newTimeControl,
        p_start_date: startsAt.toISOString(),
        p_max_participants: newCapacity,
        p_club_id: newClubId || null,
        p_is_rated: newIsRated,
      });
      if (createError) throw createError;
      setNewName('');
      setNewDescription('');
      setNewCapacity(32);
      setNewClubId('');
      setNewIsRated(false);
      setNewStartDate(getDefaultStartDate());
      setNotice('Tournament created and published.');
      await loadTournaments();
    } catch (createError) {
      console.error('Unable to create tournament:', createError);
      setError(getTournamentActionError(createError, 'Unable to create tournament.'));
    } finally {
      setCreating(false);
    }
  };

  const handleJoin = async (tournament: Tournament) => {
    if (!user || !supabase) {
      setError('Sign in to register for a tournament.');
      return;
    }
    if (tournament.status === 'completed' || tournament.participantsCount >= tournament.maxParticipants) {
      setError('This tournament is closed to new registrations.');
      return;
    }

    setJoiningId(tournament.id);
    setError(null);
    try {
      const { data, error: joinError } = await supabase.rpc('join_tournament', {
        p_tournament_id: tournament.id,
      });
      if (joinError) throw joinError;
      if (data?.status === 'already_registered') {
        setError('You are already registered for this tournament.');
        return;
      }
      if (data?.status !== 'registered') {
        throw new Error('The tournament service returned an unexpected response.');
      }
      await loadTournaments();
    } catch (joinError) {
      console.error('Unable to register for tournament:', joinError);
      setError(getTournamentActionError(joinError, 'Unable to register for tournament.'));
    } finally {
      setJoiningId(null);
    }
  };

  const handleStartRound = async (tournament: Tournament) => {
    if (!user || !supabase) {
      setError('Sign in as the tournament organizer.');
      return;
    }
    if (!['swiss', 'round_robin'].includes(tournament.format)) {
      setError('Arena and knockout round generation are not implemented yet.');
      return;
    }

    setStartingRoundId(tournament.id);
    setError(null);
    setNotice(null);
    try {
      const { data, error: startError } = await supabase.rpc('start_tournament_round', {
        p_tournament_id: tournament.id,
      });
      if (startError) throw startError;
      const roundNumber = typeof data?.roundNumber === 'number'
        ? data.roundNumber
        : null;
      setNotice(roundNumber
        ? `Round ${roundNumber} started with ${data.matchCount ?? 0} matches.`
        : 'Tournament round started.');
      await loadTournaments();
    } catch (startError) {
      console.error('Unable to start tournament round:', startError);
      setError(getTournamentActionError(startError, 'Unable to start tournament round.'));
    } finally {
      setStartingRoundId(null);
    }
  };

  const handleInvite = async (event: FormEvent, tournament: Tournament) => {
    event.preventDefault();
    const username = inviteUsernames[tournament.id]?.trim() ?? '';
    if (!user || !supabase) {
      setError('Sign in to invite players to a tournament.');
      return;
    }
    if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
      setError('Enter a username containing 3–20 letters, numbers, or underscores.');
      return;
    }

    setInvitingId(tournament.id);
    setError(null);
    setNotice(null);
    try {
      const { data, error: inviteError } = await supabase.rpc('invite_tournament_player', {
        p_tournament_id: tournament.id,
        p_username: username,
      });
      if (inviteError) throw inviteError;
      if (data?.status === 'already_registered') {
        setNotice(`${username} is already registered for ${tournament.name}.`);
      } else if (data?.status === 'already_invited') {
        setNotice(`An invitation for ${username} is already pending.`);
      } else if (data?.status === 'invited') {
        setNotice(`Tournament invitation sent to ${username}.`);
        setInviteUsernames((current) => ({ ...current, [tournament.id]: '' }));
      } else {
        throw new Error('The tournament invitation service returned an unexpected response.');
      }
    } catch (inviteError) {
      console.error('Unable to invite player to tournament:', inviteError);
      setError(getTournamentActionError(inviteError, 'Unable to send tournament invitation.'));
    } finally {
      setInvitingId(null);
    }
  };

  const handleInvitationResponse = async (invitation: TournamentInvitation, accept: boolean) => {
    if (!supabase) return;
    setRespondingId(invitation.id);
    setError(null);
    setNotice(null);
    try {
      const { data, error: responseError } = await supabase.rpc('respond_tournament_invitation', {
        p_invitation_id: invitation.id,
        p_accept: accept,
      });
      if (responseError) throw responseError;
      if (!['accepted', 'declined', 'already_registered'].includes(data?.status)) {
        throw new Error('The tournament invitation service returned an unexpected response.');
      }
      setNotice(accept ? `You joined ${invitation.tournamentName}.` : `Invitation declined.`);
      await Promise.all([loadTournaments(), loadInvitations()]);
    } catch (responseError) {
      console.error('Unable to respond to tournament invitation:', responseError);
      setError(getTournamentActionError(responseError, 'Unable to respond to invitation.'));
    } finally {
      setRespondingId(null);
    }
  };

  return (
    <div className="px-4 py-8 text-text-primary">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
          <div>
            <h1 className="text-3xl font-bold md:text-4xl">{tr('Tournaments')}</h1>
            <p className="mt-1 text-text-secondary">{tr('Browse and register for scheduled tournaments.')}</p>
          </div>
          <div className="flex gap-2 rounded-lg border border-text-secondary/10 bg-background-secondary p-1">
            {(['all', 'live', 'upcoming'] as const).map((value) => (
              <button
                key={value}
                onClick={() => setFilter(value)}
                aria-pressed={filter === value}
                className={cn(
                  'rounded-md px-4 py-2 text-sm font-medium capitalize transition-colors',
                  filter === value ? 'bg-accent text-white' : 'text-text-secondary hover:text-text-primary'
                )}
              >
                {tr(value)}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div role="alert" className="mb-5 break-words rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-300">
            {tr(error)}
            {!user && !error.toLowerCase().includes('database update') && (
              <Link href="/auth/login" className="ms-2 underline">{tr('Sign in')}</Link>
            )}
          </div>
        )}
        {notice && <p role="status" className="mb-5 rounded-lg border border-green-500/30 bg-green-500/10 p-4 text-green-300">{tr(notice)}</p>}

        {user && (
          <section className="mb-8 rounded-xl border border-accent/20 bg-background-secondary p-5 md:p-6">
            <div className="mb-4">
              <h2 className="text-xl font-bold">{tr('Create a tournament')}</h2>
              <p className="mt-1 text-sm text-text-secondary">
                {tr('Schedule an event, choose its format and clock, and publish it for players to join.')}
              </p>
            </div>
            <form onSubmit={(event) => void handleCreateTournament(event)} className="grid gap-4 md:grid-cols-2">
              <label className="text-sm text-text-secondary">
                {tr('Tournament name')}
                <input
                  required
                  minLength={3}
                  maxLength={80}
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder={tr('Friday rapid arena')}
                  className="mt-1 w-full rounded-lg border border-text-secondary/20 bg-background-tertiary px-3 py-2 text-text-primary"
                />
              </label>
              <label className="text-sm text-text-secondary">
                {tr('Organizer')}
                <select
                  value={newClubId}
                  onChange={(event) => setNewClubId(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-text-secondary/20 bg-background-tertiary px-3 py-2 text-text-primary"
                >
                  <option value="">{tr('My tournament')}</option>
                  {organizerClubs.map((club) => <option key={club.id} value={club.id}>{club.name}</option>)}
                </select>
                {organizerClubs.length === 0 && (
                  <span className="mt-1 block text-xs">
                    {tr('Want a club event?')} <Link href="/clubs" className="text-accent hover:underline">{tr('Create a club')}</Link> {tr('first.')}
                  </span>
                )}
              </label>
              <label className="text-sm text-text-secondary">
                {tr('Format')}
                <select
                  value={newFormat}
                  onChange={(event) => setNewFormat(event.target.value as Tournament['format'])}
                  className="mt-1 w-full rounded-lg border border-text-secondary/20 bg-background-tertiary px-3 py-2 text-text-primary"
                >
                  <option value="arena">{tr('Arena — play continuously during the event')}</option>
                  <option value="swiss">{tr('Swiss — pair players by score each round')}</option>
                  <option value="knockout">{tr('Knockout — elimination bracket')}</option>
                  <option value="round_robin">{tr('Round robin — everyone plays everyone')}</option>
                </select>
              </label>
              <label className="text-sm text-text-secondary">
                {tr('Time control')}
                <select
                  value={newTimeControl}
                  onChange={(event) => setNewTimeControl(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-text-secondary/20 bg-background-tertiary px-3 py-2 text-text-primary"
                >
                  {['1+0', '3+0', '3+2', '5+0', '10+0', '10+5', '15+10'].map((control) => (
                    <option key={control} value={control}>{control.replace('+', ' min + ')} {tr('sec')}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-text-secondary">
                {tr('Start date and time')}
                <input
                  required
                  type="datetime-local"
                  min={getDefaultStartDate()}
                  value={newStartDate}
                  onChange={(event) => setNewStartDate(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-text-secondary/20 bg-background-tertiary px-3 py-2 text-text-primary"
                />
              </label>
              <label className="text-sm text-text-secondary">
                {tr('Player limit')}
                <input
                  required
                  type="number"
                  min={2}
                  max={512}
                  value={newCapacity}
                  onChange={(event) => setNewCapacity(Number(event.target.value))}
                  className="mt-1 w-full rounded-lg border border-text-secondary/20 bg-background-tertiary px-3 py-2 text-text-primary"
                />
              </label>
              <label className="text-sm text-text-secondary md:col-span-2">
                {tr('Description')}
                <textarea
                  maxLength={1000}
                  rows={2}
                  value={newDescription}
                  onChange={(event) => setNewDescription(event.target.value)}
                  placeholder={tr('Share the rules and event details with players.')}
                  className="mt-1 w-full rounded-lg border border-text-secondary/20 bg-background-tertiary px-3 py-2 text-text-primary"
                />
              </label>
              <label className="flex items-start gap-3 text-sm text-text-secondary md:col-span-2">
                <input
                  type="checkbox"
                  checked={newIsRated}
                  onChange={(event) => setNewIsRated(event.target.checked)}
                  className="mt-1 accent-accent"
                />
                <span>
                  {tr('Rated event')}
                  <span className="mt-0.5 block text-xs">{tr('This marks the event as rated; competitive rating updates are not active yet.')}</span>
                </span>
              </label>
              <div className="flex justify-end md:col-span-2">
                <button
                  type="submit"
                  disabled={creating}
                  className="rounded-lg bg-accent px-5 py-2.5 font-semibold text-white disabled:opacity-50"
                >
                  {creating ? tr('Publishing…') : tr('Publish tournament')}
                </button>
              </div>
            </form>
          </section>
        )}

        {user && invitations.length > 0 && (
          <section className="mb-8 rounded-xl border border-accent/20 bg-background-secondary p-5">
            <h2 className="mb-3 text-xl font-bold">{tr('Tournament invitations')}</h2>
            <ul className="space-y-3">
              {invitations.map((invitation) => (
                <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-background-tertiary p-4">
                  <p><strong>{invitation.inviterUsername}</strong> {tr('invited you to')} <strong>{invitation.tournamentName}</strong>.</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => void handleInvitationResponse(invitation, true)}
                      disabled={respondingId === invitation.id}
                      className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {tr('Accept')}
                    </button>
                    <button
                      onClick={() => void handleInvitationResponse(invitation, false)}
                      disabled={respondingId === invitation.id}
                      className="rounded-lg border border-text-secondary/20 px-3 py-2 text-sm text-text-primary disabled:opacity-50"
                    >
                      {tr('Decline')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {loading ? (
          <p role="status" className="text-text-secondary">{tr('Loading tournaments…')}</p>
        ) : filteredTournaments.length === 0 ? (
          <div className="rounded-xl bg-background-secondary p-8 text-center">
            <p className="text-text-secondary">
              {tr(error ? 'Tournament listings could not be loaded.' : 'No tournaments are available for this filter.')}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {filteredTournaments.map((tournament) => {
              const isFull = tournament.participantsCount >= tournament.maxParticipants;
              const closed = tournament.status === 'completed' || isFull;
              return (
                <article key={tournament.id} className="flex flex-col justify-between rounded-xl border border-text-secondary/10 bg-background-secondary p-6">
                  <div>
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <span className="rounded-full bg-background-tertiary px-3 py-1 text-xs font-semibold uppercase">
                        {tr(tournament.status)}
                      </span>
                      <span className="rounded bg-background-tertiary px-2 py-1 font-mono text-xs text-text-secondary">
                        {tr(tournament.format.replace('_', ' '))} · {tournament.timeControl}
                      </span>
                    </div>
                    <h2 className="mb-2 text-xl font-bold">{tournament.name}</h2>
                    <div className="mb-2 flex flex-wrap gap-2 text-xs">
                      {tournament.clubName && <span className="rounded-full bg-accent/15 px-2.5 py-1 text-accent">{tournament.clubName}</span>}
                      {tournament.isRated && <span className="rounded-full bg-background-tertiary px-2.5 py-1 text-text-secondary">{tr('Rated')}</span>}
                    </div>
                    {tournament.description && <p className="text-sm text-text-secondary">{tournament.description}</p>}
                  </div>
                  <div className="mt-5 border-t border-text-secondary/10 pt-4">
                    <p className="mb-4 flex justify-between text-sm text-text-secondary">
                      <span>{tr('Players')}: {tournament.participantsCount}/{tournament.maxParticipants}</span>
                      <time dateTime={tournament.startDate}>
                        {new Date(tournament.startDate).toLocaleString(language, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </time>
                    </p>
                    <button
                      onClick={() => void handleJoin(tournament)}
                      disabled={joiningId === tournament.id || closed}
                      className="w-full rounded-lg bg-accent py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {tr(joiningId === tournament.id ? 'Registering…' : closed ? 'Registration closed' : 'Register')}
                    </button>
                    {user && tournament.organizerId === user.id &&
                      ['swiss', 'round_robin'].includes(tournament.format) &&
                      tournament.status !== 'completed' && (
                        <button
                          type="button"
                          onClick={() => void handleStartRound(tournament)}
                          disabled={startingRoundId === tournament.id}
                          className="mt-3 w-full rounded-lg border border-accent/30 py-2.5 font-semibold text-accent disabled:opacity-50"
                        >
                          {startingRoundId === tournament.id ? tr('Starting round…') : tr('Start next round')}
                        </button>
                    )}
                    {user && (tournament.isParticipant || tournament.organizerId === user.id) && (
                      <form onSubmit={(event) => void handleInvite(event, tournament)} className="mt-4 flex gap-2">
                        <input
                          type="text"
                          aria-label={`${tr('Username to invite to')} ${tournament.name}`}
                          placeholder={tr('Invite by username')}
                          minLength={3}
                          maxLength={20}
                          pattern="[A-Za-z0-9_]{3,20}"
                          value={inviteUsernames[tournament.id] ?? ''}
                          onChange={(event) => setInviteUsernames((current) => ({ ...current, [tournament.id]: event.target.value }))}
                          disabled={invitingId === tournament.id || tournament.status === 'completed'}
                          className="min-w-0 flex-1 rounded-lg border border-text-secondary/20 bg-background-tertiary px-3 py-2 text-text-primary"
                        />
                        <button
                          type="submit"
                          disabled={invitingId === tournament.id || tournament.status === 'completed'}
                          className="rounded-lg border border-accent/30 px-3 py-2 text-sm font-semibold text-accent disabled:opacity-50"
                        >
                          {invitingId === tournament.id ? tr('Sending…') : tr('Invite')}
                        </button>
                      </form>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
