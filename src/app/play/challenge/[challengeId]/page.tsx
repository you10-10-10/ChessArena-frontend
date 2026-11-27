import ShareableChallenge from '@/components/ShareableChallenge';

export default async function ShareableChallengePage({
  params,
}: {
  params: Promise<{ challengeId: string }>;
}) {
  const { challengeId } = await params;
  return <ShareableChallenge challengeId={challengeId} />;
}
