import { acceptInvitationRequestSchema } from '@nilzora/contracts';
import { single } from '@/components/admin-kit/href';

/** The invitation link's token hash, only when it has the shape the API accepts. */
export function inviteTokenFrom(
  params: Partial<Record<string, string | string[]>>,
): string | undefined {
  const parsed = acceptInvitationRequestSchema.shape.tokenHash.safeParse(single(params.token_hash));
  return parsed.success ? parsed.data : undefined;
}
