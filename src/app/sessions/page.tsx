'use client';

import Link from 'next/link';
import { CalendarClock, Video } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';

export default function SessionsPage() {
  const { tr } = useI18n();

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 text-text-primary">
      <header className="mb-8">
        <span className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/20 px-3 py-1 text-xs font-semibold text-accent">
          <Video className="h-3.5 w-3.5" />
          {tr('Coaching & Classrooms')}
        </span>
        <h1 className="mt-3 text-3xl font-bold md:text-4xl">{tr('Coaching & Classrooms')}</h1>
        <p className="mt-1 text-text-secondary">{tr('Private coaching is not enabled yet.')}</p>
      </header>
      <div className="rounded-2xl border border-text-secondary/15 bg-background-secondary p-10 text-center">
        <CalendarClock className="mx-auto mb-4 h-12 w-12 text-text-muted" />
        <h2 className="text-xl font-bold">{tr('Coaching profiles and booking are unavailable')}</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-text-secondary">
          {tr('Coach scheduling requires verified coaches, availability, payment handling, and a durable classroom session backend.')}
        </p>
        <Link href="/sessions/history" className="mt-6 inline-block rounded-lg border border-text-secondary/20 px-5 py-3">
          {tr('View My Sessions')}
        </Link>
      </div>
    </div>
  );
}
