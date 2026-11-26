import { z } from 'zod';

/*
 * The five words a chat message is classified with
 * ------------------------------------------------
 * These two vocabularies sit below every other chat contract, so they live in a leaf module:
 * `chat.ts` (the conversation and message shapes), `chat-reply.ts` (the one-line quote) and
 * `chat-admin.ts` (the file-message post) all describe messages, and none of them may import
 * another one of the three at module-evaluation time without creating a cycle. `chat.ts`
 * re-exports everything here, so nothing outside this package needs to know the file exists.
 */

export const CHAT_MESSAGE_KINDS = ['text', 'system', 'order_event', 'automated'] as const;
export type ChatMessageKind = (typeof CHAT_MESSAGE_KINDS)[number];
export const chatMessageKindSchema = z.enum(CHAT_MESSAGE_KINDS);

export const CHAT_PARTICIPANT_ROLES = ['customer', 'staff', 'moderator', 'system'] as const;
export type ChatParticipantRole = (typeof CHAT_PARTICIPANT_ROLES)[number];
export const chatParticipantRoleSchema = z.enum(CHAT_PARTICIPANT_ROLES);
