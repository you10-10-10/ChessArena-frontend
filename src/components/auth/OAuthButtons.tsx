'use client';

import type { OAuthProvider } from '@/lib/auth';

export function OAuthButtons({
  busy,
  disabled = false,
  onSelect,
}: {
  busy: OAuthProvider | null;
  disabled?: boolean;
  onSelect: (provider: OAuthProvider) => void;
}) {
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => onSelect('google')}
        disabled={disabled || busy !== null}
        className="flex min-h-12 w-full items-center justify-center gap-3 rounded-xl border border-text-secondary/20 bg-background-tertiary px-4 py-3 text-sm font-semibold text-text-primary transition hover:border-accent/60 hover:bg-background-tertiary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5">
          <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
          <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
          <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88z" />
          <path fill="#EA4335" d="M12 4.36c1.62 0 3.07.56 4.21 1.64l3.15-3.15C17.45.99 14.96 0 12 0A11 11 0 0 0 2.18 7.06l3.66 2.84c.87-2.6 3.3-5.54 6.16-5.54z" />
        </svg>
        {busy === 'google' ? 'Connecting to Google…' : 'Continue with Google'}
      </button>
      <button
        type="button"
        onClick={() => onSelect('github')}
        disabled={disabled || busy !== null}
        className="flex min-h-12 w-full items-center justify-center gap-3 rounded-xl border border-text-secondary/20 bg-background-tertiary px-4 py-3 text-sm font-semibold text-text-primary transition hover:border-accent/60 hover:bg-background-tertiary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-60"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-current">
          <path d="M12 .5A11.5 11.5 0 0 0 8.36 22.91c.58.1.79-.25.79-.56v-2.02c-3.22.7-3.9-1.36-3.9-1.36-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.2 1.77 1.2 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.57-.29-5.28-1.29-5.28-5.73 0-1.27.45-2.3 1.2-3.11-.12-.29-.52-1.47.11-3.06 0 0 .98-.31 3.17 1.19a11 11 0 0 1 5.77 0c2.2-1.5 3.17-1.19 3.17-1.19.63 1.59.24 2.77.12 3.06.74.81 1.19 1.84 1.19 3.11 0 4.45-2.71 5.44-5.3 5.72.42.36.78 1.06.78 2.14v3.18c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
        </svg>
        {busy === 'github' ? 'Connecting to GitHub…' : 'Continue with GitHub'}
      </button>
    </div>
  );
}
