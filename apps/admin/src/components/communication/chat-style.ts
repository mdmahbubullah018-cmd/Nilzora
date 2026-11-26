/*
 * The communication workspace's shared look
 * -----------------------------------------
 * The inbox is drawn from a handful of surfaces repeated many times: columns, controls,
 * icon buttons, pills and message bubbles. They live here so a change to the chat's look is
 * one edit, and so a new panel cannot drift from the rest.
 *
 * Colours and shadows stay on the admin theme tokens (surface, border, info-soft, primary-action,
 * nz-panel-strong); nothing here introduces a second palette.
 */

/** A column of the workspace: queue, thread, details. */
export const chatColumn =
  'nz-panel-strong flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/70 shadow-[0_1px_2px_rgb(15_23_42/0.04)]';

/** The small select every queue and thread control uses. */
export const chatSelect =
  'h-8 min-w-0 rounded-lg border border-input-border bg-surface pr-7 pl-2 text-xs font-medium text-foreground outline-none transition-colors hover:border-ring/60 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60';

export const chatIconButton =
  'grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50';

export const chatGhostButton =
  'inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60';

export const chatPrimaryButton =
  'inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary-action px-3 text-xs font-semibold text-primary-action-foreground shadow-[0_1px_2px_rgb(2_132_199/0.35)] transition hover:bg-primary-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60';

export const chatField =
  'h-9 w-full rounded-xl border border-input-border bg-surface px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30';

/** The timeline's paper: a very light wash so bubbles read as raised. */
export const chatTimeline =
  'nz-scroll min-h-0 flex-1 overflow-y-auto bg-gradient-to-b from-surface-muted/45 via-surface/20 to-transparent px-3 py-4 sm:px-5';

/** The segmented control used for scope, reply/note and queue filters. */
export const chatSegmented =
  'inline-flex items-center gap-0.5 rounded-xl border border-border/70 bg-surface-muted/70 p-0.5';

export function chatSegment(active: boolean, tone: 'primary' | 'moderator' = 'primary'): string {
  return [
    'inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold transition-colors',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
    active
      ? tone === 'moderator'
        ? 'bg-surface text-teal-ink shadow-sm ring-1 ring-teal-line'
        : 'bg-surface text-foreground shadow-sm ring-1 ring-border'
      : 'text-muted-foreground hover:text-foreground',
  ].join(' ');
}

/** An avatar disc; moderation threads use the moderator accent. */
export function chatAvatar(moderation: boolean, size = 'size-9'): string {
  return [
    size,
    'grid shrink-0 place-items-center rounded-full text-xs font-semibold ring-1 ring-inset',
    moderation
      ? 'bg-teal-soft text-teal-ink ring-teal-line'
      : 'bg-violet-soft text-violet-ink ring-violet-line',
  ].join(' ');
}
