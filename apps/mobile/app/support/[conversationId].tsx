import { useLocalSearchParams } from 'expo-router';
import { SignedInGate } from '@/auth/signed-in-gate';
import { STACK_EDGES } from '@/components/screen';
import { SupportConversationScreen } from '@/features/support/conversation-screen';

export default function SupportConversationRoute() {
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const id = typeof conversationId === 'string' ? conversationId : '';
  // The route only names the thread; the API decides whether this account may read it.
  return (
    <SignedInGate returnTo={`/support/${id}`} purpose="read this conversation" edges={STACK_EDGES}>
      <SupportConversationScreen conversationId={id} />
    </SignedInGate>
  );
}
