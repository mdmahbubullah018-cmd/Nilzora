import { z } from 'zod';
import { chatMessageKindSchema, chatParticipantRoleSchema } from './chat-enums';

/*
 * The one line a reply shows above itself
 * ---------------------------------------
 * A quote cannot be resolved from the loaded page alone — the message being answered may be far
 * older — so the API resolves it and sends this leaf with the message that quotes it.
 *
 * `deleted` is how a quote of a message that was taken down stays honest instead of vanishing:
 * the quote still says who wrote it and that it is gone, and `body` is null in that case only.
 *
 * This module is deliberately a leaf: it imports the two vocabularies and nothing else, so both
 * the message shape (`chat.ts`) and the file-message request (`chat-admin.ts`) can use it without
 * the two importing each other.
 */

export const chatReplySummarySchema = z.object({
  id: z.uuid(),
  seq: z.number().int().nonnegative(),
  senderId: z.uuid().nullable(),
  senderRole: chatParticipantRoleSchema,
  senderName: z.string().nullable(),
  kind: chatMessageKindSchema,
  /** The quoted text, or null when it was deleted or carried only a file. */
  body: z.string().nullable(),
  /** True when the quoted message carried a file, so a quote can say "Photo". */
  hasAttachment: z.boolean().default(false),
  deleted: z.boolean().default(false),
});
export type ChatReplySummary = z.infer<typeof chatReplySummarySchema>;
