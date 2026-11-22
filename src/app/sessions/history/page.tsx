'use client';

import Link from 'next/link';
import { CalendarClock } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';

export default function SessionsHistoryPage() {
  const { tr } = useI18n();

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 text-text-primary">
      <header className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold md:text-4xl">{tr('My Coaching Sessions')}</h1>
          <p className="mt-1 text-text-secondary">{tr('View upcoming scheduled classes and past session recordings.')}</p>
        </div>
        <Link
          href="/sessions"
          className="px-5 py-3 bg-accent hover:bg-accent-hover text-white font-semibold rounded-xl transition-colors shadow-lg shadow-accent/30 self-start"
        >
          {tr('Book New Session')}
        </Link>
      </header>

      <div className="rounded-2xl border border-text-secondary/15 bg-background-secondary p-10 text-center">
        <CalendarClock className="mx-auto mb-4 h-10 w-10 text-text-muted" />
        <h2 className="text-xl font-bold">{tr('No coaching sessions')}</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm text-text-secondary">
          {tr('Coach scheduling is not available until coaching profiles, payments, and calendar reservations are configured.')}
        </p>
        <Link href="/sessions" className="mt-6 inline-block rounded-lg border border-text-secondary/20 px-5 py-3 text-text-primary">
          {tr('Back to Coaches')}
        </Link>
      </div>
    </div>
  );
}
