import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '../src/lib/i18n/context';
import { useAuth } from '../src/lib/auth';
import { supabase } from '../src/lib/supabase/client';
import LoginPage from '../src/app/auth/login/page';
import SignUpPage from '../src/app/auth/signup/page';

var mockReplace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace, refresh: jest.fn(), push: mockReplace }),
}));

jest.mock('../src/lib/auth', () => ({
  useAuth: jest.fn(),
}));

jest.mock('../src/lib/supabase/client', () => ({
  supabase: { from: jest.fn() },
}));

const mockUseAuth = useAuth as jest.Mock;
const mockSupabase = supabase as unknown as { from: jest.Mock };

function renderWithI18n(element: React.ReactElement) {
  return render(<I18nProvider>{element}</I18nProvider>);
}

function setupUsernameLookup(result: { data: unknown; error: unknown } = { data: null, error: null }) {
  const query = {
    select: jest.fn(),
    ilike: jest.fn(),
    limit: jest.fn(),
    maybeSingle: jest.fn().mockResolvedValue(result),
  };
  query.select.mockReturnValue(query);
  query.ilike.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  mockSupabase.from.mockReturnValue(query);
  return query;
}

describe('authentication forms', () => {
  const signUp = jest.fn();
  const signInWithOAuth = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    signUp.mockResolvedValue({ error: null, needsEmailConfirmation: true });
    signInWithOAuth.mockResolvedValue({ error: null });
    mockUseAuth.mockReturnValue({
      user: null,
      loading: false,
      signUp,
      signIn: jest.fn().mockResolvedValue({ error: null }),
      signInWithOAuth,
    });
    setupUsernameLookup();
  });

  it('keeps signup disabled for weak or mismatched passwords', async () => {
    renderWithI18n(<SignUpPage />);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'chess_player' } });
    await screen.findByText('Available');

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'player@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Weakpass1!' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'Weakpass1!' } });
    const submit = screen.getByRole('button', { name: 'Create Account' });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'StrongPass123!' } });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'StrongPass123!' } });
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
  });

  it('reports an existing username and does not allow signup', async () => {
    setupUsernameLookup({ data: { id: 'existing-profile' }, error: null });
    renderWithI18n(<SignUpPage />);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'TakenName' } });
    expect(await screen.findByText('Already taken')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Create Account' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('normalizes the submitted username and uses the Supabase OAuth provider button', async () => {
    const query = setupUsernameLookup();
    renderWithI18n(<SignUpPage />);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'Chess_Player' } });
    await screen.findByText('Available');
    expect(query.ilike).toHaveBeenCalledWith('username', 'chess_player');

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'player@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'StrongPass123!' } });
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'StrongPass123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }));
    await waitFor(() => expect(signUp).toHaveBeenCalledWith(
      'player@example.com',
      'StrongPass123!',
      'chess_player',
    ));
  });

  it('starts Google OAuth from the login form', async () => {
    renderWithI18n(<LoginPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
    await waitFor(() => expect(signInWithOAuth).toHaveBeenCalledWith('google'));
    expect((screen.getByRole('button', { name: 'Continue with GitHub' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
