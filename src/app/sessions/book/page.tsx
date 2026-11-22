'use client';

import Link from 'next/link';
import { ArrowLeft, CalendarClock } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';

export default function BookSessionPage() {
  const { tr } = useI18n();

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 text-text-primary">
      <Link href="/sessions" className="mb-6 flex items-center gap-2 text-sm text-text-secondary hover:text-accent">
        <ArrowLeft className="h-4 w-4" />
        {tr('Back to Coaches')}
      </Link>
      <div className="rounded-2xl border border-text-secondary/15 bg-background-secondary p-10 text-center">
        <CalendarClock className="mx-auto mb-4 h-12 w-12 text-text-muted" />
        <h1 className="text-2xl font-bold">{tr('Coach booking unavailable')}</h1>
        <p className="mx-auto mt-3 max-w-xl text-sm text-text-secondary">
          {tr('Coach profiles, payments, availability, and session reservations are not configured yet. No booking or payment has been created.')}
        </p>
        <Link href="/sessions/history" className="mt-6 inline-block rounded-lg bg-accent px-5 py-3 font-semibold text-white">
          {tr('View My Sessions')}
        </Link>
      </div>
    </div>
  );
}
