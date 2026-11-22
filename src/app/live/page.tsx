'use client';

import Link from 'next/link';
import { Radio } from 'lucide-react';
import { useI18n } from '@/lib/i18n/context';

export default function LiveBroadcastsPage() {
  const { tr } = useI18n();

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 text-text-primary">
      <header className="mb-8">
        <span className="inline-flex items-center gap-2 rounded-full border border-red-500/30 bg-red-500/20 px-3 py-1 text-xs font-semibold text-red-400">
          <Radio className="h-3.5 w-3.5" />
          {tr('Live Chess')}
        </span>
        <h1 className="mt-3 text-3xl font-bold md:text-4xl">{tr('Watch Live Chess')}</h1>
      </header>
      <div className="rounded-2xl border border-text-secondary/15 bg-background-secondary p-10 text-center">
        <h2 className="text-xl font-bold">{tr('No live broadcasts available')}</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-text-secondary">
          {tr('Live broadcasting requires authenticated stream setup, moderator controls, viewer chat, and durable real-time delivery.')}
        </p>
        <Link href="/play" className="mt-6 inline-block rounded-lg bg-accent px-5 py-3 font-semibold text-white">
          {tr('Play Chess')}
        </Link>
      </div>
    </div>
  );
}
