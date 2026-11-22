import { fireEvent, render, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '../src/lib/auth';
import { supabase } from '../src/lib/supabase/client';

jest.mock('../src/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
      onAuthStateChange: jest.fn().mockReturnValue({ data: { subscription: { unsubscribe: jest.fn() } } }),
      signInWithOAuth: jest.fn().mockResolvedValue({ error: null }),
      signUp: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
    },
  },
}));

const mockedAuth = (supabase as NonNullable<typeof supabase>).auth as unknown as {
  signInWithOAuth: jest.Mock;
  signUp: jest.Mock;
};

function AuthActions() {
  const { signInWithOAuth, signUp } = useAuth();
  return (
    <>
      <button onClick={() => void signInWithOAuth('github')}>Start OAuth</button>
      <button onClick={() => void signUp(' Player@Example.COM ', 'StrongPass123!', ' Chess_Player ')}>
        Create account
      </button>
    </>
  );
}

describe('Supabase authentication actions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses the app origin as the OAuth callback and preserves the Supabase session flow', async () => {
    const { getByRole } = render(
      <AuthProvider>
        <AuthActions />
      </AuthProvider>,
    );

    fireEvent.click(getByRole('button', { name: 'Start OAuth' }));
    await waitFor(() => expect(mockedAuth.signInWithOAuth).toHaveBeenCalledWith({
      provider: 'github',
      options: { redirectTo: window.location.origin },
    }));
  });

  it('normalizes email and username before sending Supabase signup metadata', async () => {
    const { getByRole } = render(
      <AuthProvider>
        <AuthActions />
      </AuthProvider>,
    );

    fireEvent.click(getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(mockedAuth.signUp).toHaveBeenCalledWith({
      email: 'player@example.com',
      password: 'StrongPass123!',
      options: { data: { username: 'chess_player' } },
    }));
  });
});
