'use client';

import Link from 'next/link';
import { Radio } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';

export default function LiveStreamRoomPage() {
  const { tr } = useI18n();

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 text-center text-text-primary">
      <div className="rounded-2xl border border-text-secondary/15 bg-background-secondary p-10">
        <Radio className="mx-auto mb-4 h-12 w-12 text-text-muted" />
        <h1 className="text-2xl font-bold">{tr('Live broadcast unavailable')}</h1>
        <p className="mx-auto mt-3 max-w-xl text-sm text-text-secondary">
          {tr('This broadcast could not be resolved because live-stream infrastructure is not configured.')}
        </p>
        <Link href="/live" className="mt-6 inline-block rounded-lg border border-text-secondary/20 px-5 py-3">
          {tr('Back to Live Hub')}
        </Link>
      </div>
    </div>
  );
}
