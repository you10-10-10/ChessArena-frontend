import type { ReactNode } from 'react';
import { Crown, ShieldCheck } from 'lucide-react';

export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main className="relative flex min-h-[70vh] items-center justify-center overflow-hidden px-3 py-8 sm:px-6 sm:py-12">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-24 top-8 h-64 w-64 rounded-full bg-accent/10 blur-3xl" />
        <div className="absolute -right-20 bottom-0 h-72 w-72 rounded-full bg-board-dark/10 blur-3xl" />
      </div>

      <div className="relative grid w-full max-w-5xl overflow-hidden rounded-3xl border border-text-secondary/15 bg-background-secondary shadow-elevated md:grid-cols-[0.9fr_1.1fr]">
        <aside className="relative hidden min-h-full flex-col justify-between overflow-hidden bg-gradient-to-br from-accent/20 via-background-tertiary to-background-secondary p-10 md:flex">
          <div aria-hidden="true" className="absolute -bottom-16 -right-8 select-none text-[15rem] leading-none text-accent/[0.06]">♞</div>
          <div className="relative">
            <div className="mb-10 flex h-12 w-12 items-center justify-center rounded-2xl border border-accent/30 bg-accent/10 text-accent">
              <Crown aria-hidden="true" className="h-6 w-6" />
            </div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-accent">Chess Arena</p>
            <h2 className="mt-4 max-w-xs text-3xl font-bold leading-tight text-text-primary">
              Every great game starts with one move.
            </h2>
            <p className="mt-4 max-w-sm text-sm leading-6 text-text-secondary">
              Play, learn, and meet your next worthy opponent in a space built for chess.
            </p>
          </div>
          <div className="relative flex items-center gap-2 text-xs text-text-secondary">
            <ShieldCheck aria-hidden="true" className="h-4 w-4 text-accent" />
            Your account is protected by Supabase Auth
          </div>
        </aside>

        <section className="p-5 sm:p-8 md:p-10">
          <div className="mx-auto w-full max-w-md">
            <h1 className="text-2xl font-bold tracking-tight text-text-primary sm:text-3xl">{title}</h1>
            <p className="mt-2 text-sm leading-6 text-text-secondary">{description}</p>
            {children}
          </div>
        </section>
      </div>
    </main>
  );
}
