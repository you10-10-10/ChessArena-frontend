'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { supabase } from '@/lib/supabase/client';
import { getErrorMessage } from '@/lib/utils';
import { useI18n } from '@/lib/i18n/context';

interface Friendship {
  id: string;
  user_id: string;
  friend_id: string;
  status: 'pending' | 'accepted' | 'blocked';
}

interface Player {
  id: string;
  username: string;
  rating: number;
}

interface FriendRow extends Player {
  relationshipId: string;
  relationshipStatus: Friendship['status'];
  canAccept: boolean;
}

interface DirectMessage {
  id: string;
  sender_id: string;
  recipient_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
}

const CHAT_EMOJIS = ['😀', '😄', '😂', '🥰', '👏', '🔥', '🙌', '❤️', '🤔', '😮', '♟️', '😭'];

function getChatError(error: unknown, fallback: string): string {
  const message = getErrorMessage(error, fallback);
  if (/direct_messages|send_direct_message|mark_direct_messages_read|schema cache/i.test(message)) {
    return 'Private chat needs the latest database update. Apply sql/fix_matchmaking_and_seed_puzzles.sql in your Supabase SQL Editor.';
  }
  return message;
}

export default function SocialPage() {
  const { user } = useAuth();
  const { tr, language } = useI18n();
  const userId = user?.id;
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Player[]>([]);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedFriendId, setSelectedFriendId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [messageDraft, setMessageDraft] = useState('');
  const [chatError, setChatError] = useState<string | null>(null);
  const [chatLoading, setChatLoading] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const loadFriends = useCallback(async () => {
    if (!userId || !supabase) {
      setFriends([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { data: relationships, error: relationError } = await supabase
        .from('friendships')
        .select('id, user_id, friend_id, status')
        .or(`user_id.eq.${userId},friend_id.eq.${userId}`);
      if (relationError) throw relationError;

      const rows = (relationships ?? []) as Friendship[];
      const playerIds = [...new Set(rows.map((row) => row.user_id === userId ? row.friend_id : row.user_id))];
      if (playerIds.length === 0) {
        setFriends([]);
        return;
      }

      const { data: players, error: playerError } = await supabase
        .from('profiles')
        .select('id, username, rating')
        .in('id', playerIds);
      if (playerError) throw playerError;

      const byId = new Map((players ?? []).map((player) => [player.id, player as Player]));
      setFriends(rows.flatMap((row) => {
        const playerId = row.user_id === userId ? row.friend_id : row.user_id;
        const player = byId.get(playerId);
        if (!player || row.status === 'blocked') return [];
        return [{
          ...player,
          relationshipId: row.id,
          relationshipStatus: row.status,
          canAccept: row.status === 'pending' && row.friend_id === userId,
        }];
      }));
    } catch (loadError) {
      console.error('Unable to load friend relationships:', loadError);
      setError(loadError instanceof Error ? loadError.message : 'Unable to load friends.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void loadFriends();
  }, [loadFriends]);

  const selectedFriend = friends.find(
    (friend) => friend.id === selectedFriendId && friend.relationshipStatus === 'accepted',
  );

  const refreshConversation = useCallback(async (friendId: string, isActive: () => boolean = () => true) => {
    if (!userId || !supabase) return;
    try {
      const { data, error: messagesError } = await supabase
        .from('direct_messages')
        .select('id, sender_id, recipient_id, body, created_at, read_at')
        .or(`and(sender_id.eq.${userId},recipient_id.eq.${friendId}),and(sender_id.eq.${friendId},recipient_id.eq.${userId})`)
        .order('created_at', { ascending: false })
        .limit(100);
      if (messagesError) throw messagesError;
      if (!isActive()) return;

      setMessages(((data ?? []) as DirectMessage[]).reverse());
      setChatError(null);
      const { error: readError } = await supabase.rpc('mark_direct_messages_read', {
        p_sender_id: friendId,
      });
      if (readError) throw readError;
    } catch (loadError) {
      if (!isActive()) return;
      console.error('Unable to load private messages:', loadError);
      setChatError(getChatError(loadError, 'Unable to load this conversation.'));
    }
  }, [userId]);

  useEffect(() => {
    if (!selectedFriend || !userId || !supabase) {
      setMessages([]);
      setChatLoading(false);
      setChatError(null);
      return;
    }

    let active = true;
    const refresh = () => refreshConversation(selectedFriend.id, () => active);
    setMessages([]);
    setChatLoading(true);
    void refresh().finally(() => {
      if (active) setChatLoading(false);
    });
    const intervalId = window.setInterval(() => void refresh(), 5000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [refreshConversation, selectedFriend, userId]);

  const handleSendMessage = async (event: FormEvent) => {
    event.preventDefault();
    const body = messageDraft.trim();
    if (!user || !supabase || !selectedFriend || !body || sendingMessage) return;

    setSendingMessage(true);
    setChatError(null);
    try {
      const { error: sendError } = await supabase.rpc('send_direct_message', {
        p_recipient_id: selectedFriend.id,
        p_body: body,
      });
      if (sendError) throw sendError;
      setMessageDraft('');
      await refreshConversation(selectedFriend.id);
    } catch (sendError) {
      console.error('Unable to send private message:', sendError);
      setChatError(getChatError(sendError, 'Unable to send this message.'));
    } finally {
      setSendingMessage(false);
    }
  };

  const handleSearch = async (event: FormEvent) => {
    event.preventDefault();
    const query = searchQuery.trim();
    setError(null);
    setSearchResults([]);
    if (!user) {
      setError('Sign in to find players.');
      return;
    }
    if (!supabase) {
      setError('Player search is unavailable because the database is not configured.');
      return;
    }
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(query)) {
      setError('Enter a username containing 3–20 letters, numbers, or underscores.');
      return;
    }

    setSearching(true);
    try {
      const { data, error: searchError } = await supabase
        .from('profiles')
        .select('id, username, rating')
        .ilike('username', `${query}%`)
        .neq('id', user.id)
        .limit(10);
      if (searchError) throw searchError;
      setSearchResults((data ?? []) as Player[]);
    } catch (searchError) {
      console.error('Player search failed:', searchError);
      setError(searchError instanceof Error ? searchError.message : 'Player search failed.');
    } finally {
      setSearching(false);
    }
  };

  const handleAddFriend = async (player: Player) => {
    if (!user || !supabase) return;
    setActionId(player.id);
    setError(null);
    try {
      const { data, error: requestError } = await supabase.rpc('send_friend_request', {
        p_friend_id: player.id,
      });
      if (requestError) throw requestError;
      if (data?.status === 'incoming_request') {
        setActionNotice('This player already sent you a friend request.');
      } else if (data?.status === 'already_friends') {
        setActionNotice('You are already friends.');
      } else if (data?.status === 'already_requested') {
        setActionNotice('Friend request already sent.');
      } else {
        setActionNotice(`Friend request sent to ${player.username}.`);
      }
      setSearchResults((current) => current.filter((result) => result.id !== player.id));
      await loadFriends();
    } catch (actionError) {
      console.error('Friend request failed:', actionError);
      setError(actionError instanceof Error ? actionError.message : 'Unable to send friend request.');
    } finally {
      setActionId(null);
    }
  };

  const handleAccept = async (friend: FriendRow) => {
    if (!supabase) return;
    setActionId(friend.relationshipId);
    setError(null);
    try {
      const { error: responseError } = await supabase.rpc('respond_friend_request', {
        p_relationship_id: friend.relationshipId,
        p_accept: true,
      });
      if (responseError) throw responseError;
      setActionNotice(`You are now friends with ${friend.username}.`);
      await loadFriends();
    } catch (actionError) {
      console.error('Accepting friend request failed:', actionError);
      setError(actionError instanceof Error ? actionError.message : 'Unable to accept friend request.');
    } finally {
      setActionId(null);
    }
  };

  const handleChallenge = async (friend: FriendRow) => {
    if (!user) {
      setError('Sign in to challenge a friend.');
      return;
    }
    setChallengeId(friend.id);
    setError(null);
    setActionNotice(null);
    try {
      const response = await fetch('/api/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientUsername: friend.username,
          gameMode: 'standard',
          timeControl: '3+2',
          selectedColor: 'random',
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to send friend challenge.');
      }
      setActionNotice(`Challenge sent to ${friend.username}.`);
    } catch (challengeError) {
      console.error('Friend challenge failed:', challengeError);
      setError(challengeError instanceof Error ? challengeError.message : 'Unable to send friend challenge.');
    } finally {
      setChallengeId(null);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 text-text-primary">
      <header className="mb-8">
        <h1 className="text-3xl font-bold md:text-4xl">{tr('Community')}</h1>
        <p className="mt-1 text-text-secondary">{tr('Find players and manage friend requests.')}</p>
      </header>

      {!user && (
        <div className="mb-6 rounded-xl bg-background-secondary p-5">
          {tr('Sign in to search for players and manage friendships.')}{' '}
          <Link href="/auth/login" className="text-accent hover:underline">{tr('Sign in')}</Link>
        </div>
      )}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-accent/20 bg-background-secondary p-5">
        <div>
          <h2 className="font-semibold">{tr('Find your chess club')}</h2>
          <p className="mt-1 text-sm text-text-secondary">{tr('Join a community, meet local players, and organize club events.')}</p>
        </div>
        <Link href="/clubs" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white">{tr('Explore clubs')}</Link>
      </div>
      {error && <div role="alert" className="mb-5 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-red-300">{tr(error)}</div>}
      {actionNotice && <div role="status" className="mb-5 rounded-lg border border-green-500/30 bg-green-500/10 p-4 text-green-300">{tr(actionNotice)}</div>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-text-secondary/10 bg-background-secondary p-6">
          <h2 className="mb-4 text-xl font-bold">{tr('Friends and requests')}</h2>
          {loading ? (
            <p role="status" className="text-sm text-text-secondary">{tr('Loading relationships…')}</p>
          ) : friends.length === 0 ? (
            <p className="text-sm text-text-secondary">{tr('No accepted friends or pending requests.')}</p>
          ) : (
            <ul className="space-y-3">
              {friends.map((friend) => (
                <li key={friend.relationshipId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-background-tertiary p-4">
                  <div>
                    <Link href={`/profile/${encodeURIComponent(friend.username)}`} className="font-semibold hover:text-accent">
                      {friend.username}
                    </Link>
                    <p className="text-xs text-text-secondary">
                      {tr('Rating')} {friend.rating} · {tr(friend.relationshipStatus === 'accepted' ? 'Friend' : friend.canAccept ? 'Incoming request' : 'Request sent')}
                    </p>
                  </div>
                  {friend.canAccept && (
                    <button
                      onClick={() => void handleAccept(friend)}
                      disabled={actionId === friend.relationshipId}
                      className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    >
                      {actionId === friend.relationshipId ? tr('Accepting…') : tr('Accept')}
                    </button>
                  )}
                  {friend.relationshipStatus === 'accepted' && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void handleChallenge(friend)}
                        disabled={challengeId === friend.id}
                        className="rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                      >
                        {challengeId === friend.id ? tr('Sending…') : tr('Challenge')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedFriendId(friend.id);
                          setChatError(null);
                        }}
                        aria-pressed={selectedFriendId === friend.id}
                        className="rounded-lg border border-accent/30 px-3 py-2 text-sm text-accent"
                      >
                        {tr(selectedFriendId === friend.id ? 'Chat open' : 'Message')}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-text-secondary/10 bg-background-secondary p-6">
          <h2 className="mb-4 text-xl font-bold">{tr('Find players')}</h2>
          <form onSubmit={(event) => void handleSearch(event)} className="flex gap-2">
            <input
              type="search"
              aria-label={tr('Search usernames')}
              placeholder={tr('Search username')}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              minLength={3}
              maxLength={20}
              className="min-w-0 flex-1 rounded-lg border border-text-secondary/20 bg-background-tertiary px-4 py-2.5 text-text-primary"
            />
            <button
              type="submit"
              disabled={searching || !user}
              className="rounded-lg bg-accent px-4 py-2.5 font-semibold text-white disabled:opacity-50"
            >
              {searching ? tr('Searching…') : tr('Search')}
            </button>
          </form>

          {searchResults.length > 0 && (
            <ul className="mt-4 divide-y divide-text-secondary/10">
              {searchResults.map((player) => (
                <li key={player.id} className="flex items-center justify-between gap-3 py-3">
                  <div>
                    <p className="font-medium">{player.username}</p>
                    <p className="text-xs text-text-secondary">{tr('Rating')} {player.rating}</p>
                  </div>
                  <button
                    onClick={() => void handleAddFriend(player)}
                    disabled={actionId === player.id}
                    className="rounded-lg border border-accent/30 px-3 py-2 text-sm text-accent disabled:opacity-50"
                  >
                    {actionId === player.id ? tr('Sending…') : tr('Add Friend')}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {searching === false && searchQuery.length > 0 && searchResults.length === 0 && !error && (
            <p className="mt-4 text-sm text-text-secondary">{tr('No matching players found.')}</p>
          )}
        </section>
      </div>

      {selectedFriend && (
        <section className="mt-6 rounded-xl border border-text-secondary/10 bg-background-secondary p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold">{tr('Chat with')} {selectedFriend.username}</h2>
              <p className="mt-1 text-xs text-text-secondary">{tr('Private messages refresh automatically every 5 seconds.')}</p>
            </div>
            <button
              type="button"
              onClick={() => setSelectedFriendId(null)}
              className="rounded-lg border border-text-secondary/20 px-3 py-2 text-sm"
            >
              {tr('Close chat')}
            </button>
          </div>

          {chatError && <p role="alert" className="mb-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{tr(chatError)}</p>}
          <div
            aria-label={`${tr('Messages with')} ${selectedFriend.username}`}
            aria-live="polite"
            className="mb-4 flex max-h-96 min-h-32 flex-col gap-3 overflow-y-auto rounded-lg bg-background-tertiary p-4"
          >
            {chatLoading ? (
              <p role="status" className="text-sm text-text-secondary">{tr('Loading messages…')}</p>
            ) : messages.length === 0 ? (
              <p className="m-auto text-sm text-text-secondary">{tr('No messages yet. Say hello!')}</p>
            ) : messages.map((message) => {
              const isOwnMessage = message.sender_id === user?.id;
              return (
                <article
                  key={message.id}
                  className={`max-w-[85%] rounded-xl px-4 py-2 ${isOwnMessage ? 'ml-auto bg-accent text-white' : 'mr-auto bg-background-secondary'}`}
                >
                  <p className="whitespace-pre-wrap break-words">{message.body}</p>
                  <p className={`mt-1 text-end text-[11px] ${isOwnMessage ? 'text-white/70' : 'text-text-secondary'}`}>
                    {new Date(message.created_at).toLocaleTimeString(language, { hour: 'numeric', minute: '2-digit' })}
                    {isOwnMessage && message.read_at ? ` · ${tr('Read')}` : ''}
                  </p>
                </article>
              );
            })}
          </div>

          <form onSubmit={(event) => void handleSendMessage(event)} className="space-y-3">
            <label htmlFor="private-message" className="sr-only">{tr('Write a message')}</label>
            <textarea
              id="private-message"
              value={messageDraft}
              onChange={(event) => setMessageDraft(event.target.value)}
              maxLength={2000}
              rows={3}
              placeholder={tr('Write a message… (Shift+Enter for a new line)')}
              className="w-full resize-y rounded-lg border border-text-secondary/20 bg-background-tertiary px-4 py-3 text-text-primary"
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  aria-label={tr('Toggle emoji picker')}
                  aria-expanded={showEmojiPicker}
                  onClick={() => setShowEmojiPicker((current) => !current)}
                  className="rounded-lg border border-text-secondary/20 px-3 py-2 text-sm"
                >
                  {tr(showEmojiPicker ? 'Hide emojis' : 'Add emoji')}
                </button>
                <span className="text-xs text-text-secondary">{messageDraft.length}/2000</span>
              </div>
              <button
                type="submit"
                disabled={sendingMessage || !messageDraft.trim()}
                className="rounded-lg bg-accent px-5 py-2.5 font-semibold text-white disabled:opacity-50"
              >
                {sendingMessage ? tr('Sending…') : tr('Send message')}
              </button>
            </div>
            {showEmojiPicker && (
              <div aria-label={tr('Choose an emoji')} className="flex flex-wrap gap-2 rounded-lg border border-text-secondary/10 p-3">
                {CHAT_EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    aria-label={`Add ${emoji} emoji`}
                    onClick={() => setMessageDraft((current) => `${current}${emoji}`)}
                    className="rounded-md p-2 text-xl hover:bg-background-tertiary"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </form>
        </section>
      )}
    </div>
  );
}
