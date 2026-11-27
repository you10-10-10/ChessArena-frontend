import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import PlayAFriendModal from '../src/components/PlayAFriendModal';
import { I18nProvider } from '../src/lib/i18n/context';

var mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock('../src/lib/auth', () => ({
  useAuth: () => ({ user: { id: '00000000-0000-4000-8000-000000000001' } }),
}));

describe('Play a Friend game navigation', () => {
  let fetchMock: jest.Mock;
  let originalFetch: PropertyDescriptor | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    fetchMock = jest.fn();
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    });
  });

  afterEach(() => {
    cleanup();
    if (originalFetch) {
      Object.defineProperty(globalThis, 'fetch', originalFetch);
    } else {
      Reflect.deleteProperty(globalThis, 'fetch');
    }
  });

  it('sends the invited player to the game ID returned by acceptance', async () => {
    const gameId = '00000000-0000-4000-8000-000000000003';
    fetchMock.mockImplementation((_url, options) => {
      if (options?.method === 'PATCH') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ status: 'accepted', gameId }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          received: [{
            id: '00000000-0000-4000-8000-000000000002',
            sender_id: '00000000-0000-4000-8000-000000000009',
            receiver_id: '00000000-0000-4000-8000-000000000001',
            status: 'pending',
            time_control: '3+2',
            expires_at: new Date(Date.now() + 60_000).toISOString(),
          }],
          sent: [],
        }),
      });
    });

    render(
      <I18nProvider>
        <PlayAFriendModal isOpen onClose={jest.fn()} />
      </I18nProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith(`/game/${gameId}`));
  });

  it('shows a direct Play link for an accepted sent invitation', async () => {
    const invitationId = '00000000-0000-4000-8000-000000000002';
    const gameId = '00000000-0000-4000-8000-000000000003';
    fetchMock.mockImplementation(() => Promise.resolve({
      ok: true,
      json: async () => ({
        received: [],
        sent: [{
          id: invitationId,
          sender_id: '00000000-0000-4000-8000-000000000001',
          receiver_id: '00000000-0000-4000-8000-000000000009',
          status: 'accepted',
          game_id: gameId,
          time_control: '3+2',
          expires_at: new Date(Date.now() + 60_000).toISOString(),
          created_at: new Date().toISOString(),
          updated_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
        }],
      }),
    }));

    render(
      <I18nProvider>
        <PlayAFriendModal isOpen onClose={jest.fn()} />
      </I18nProvider>,
    );

    await screen.findByText('Invitation accepted');
    const playLink = screen.getByRole('link', { name: 'Play' });
    expect(playLink.getAttribute('href')).toBe(`/game/${gameId}`);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('creates a challenge link targeted to the entered friend username', async () => {
    const challengeId = '00000000-0000-4000-8000-000000000004';
    fetchMock.mockImplementation((url, options) => {
      if (url === '/api/challenges' && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          json: async () => ({ status: 'created', challengeId }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ received: [], sent: [] }),
      });
    });

    render(
      <I18nProvider>
        <PlayAFriendModal isOpen onClose={jest.fn()} />
      </I18nProvider>,
    );

    fireEvent.change(screen.getByLabelText('Friend username (optional)'), {
      target: { value: 'friend_name' },
    });
    fireEvent.change(screen.getByLabelText('Time Control'), { target: { value: '5+0' } });
    fireEvent.change(screen.getByLabelText('Host color'), { target: { value: 'white' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create challenge link' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/challenges', expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          timeControl: '5+0',
          selectedColor: 'white',
          recipientUsername: 'friend_name',
        }),
      }));
    });
    expect(await screen.findByDisplayValue(`http://localhost/play/challenge/${challengeId}`)).toBeTruthy();
  });
});
