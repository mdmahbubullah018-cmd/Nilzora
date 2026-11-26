import type { ChatPinnedMessage } from '@nilzora/contracts';

/*
 * One line of a pinned strip.
 *
 * A pinned message can be a file with no text at all, which used to render as an empty line.
 * The API sends a safe attachment summary (kind, name, and a recording's length) and never an
 * object key or a storage address, so this only decides how to say it: "Photo · parcel.webp",
 * "Voice message · 0:07", "PDF · invoice.pdf", "File · notes.docx".
 *
 * The same wording is used by the customer's widget and the staff workspace, so both sides of a
 * conversation read a pin the same way.
 */

function clockOf(milliseconds: number): string {
  const total = Math.max(0, Math.round(milliseconds / 1000));
  return `${String(Math.floor(total / 60))}:${String(total % 60).padStart(2, '0')}`;
}

export function pinnedPinLabel(pin: ChatPinnedMessage): string {
  const attachment = pin.attachment;
  if (attachment === null || attachment === undefined) {
    return pin.body ?? 'A message that has since been removed.';
  }

  const text = pin.body?.trim() ?? '';
  const { fileName, contentType, durationMs } = attachment;
  let described: string;

  if (contentType.startsWith('image/')) {
    described = `Photo · ${fileName}`;
  } else if (contentType.startsWith('audio/')) {
    described =
      durationMs === null || durationMs === undefined
        ? `Voice message · ${fileName}`
        : `Voice message · ${clockOf(durationMs)}`;
  } else if (contentType === 'application/pdf') {
    described = `PDF · ${fileName}`;
  } else {
    described = `File · ${fileName}`;
  }

  return text === '' ? described : `${described} — ${text}`;
}
