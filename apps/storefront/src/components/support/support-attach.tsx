'use client';

import {
  CHAT_ATTACHMENT_MAX_PER_MESSAGE,
  CHAT_DOCUMENT_TYPES,
  CHAT_IMAGE_TYPES,
  chatMediaKindOf,
  chatMediaMaxBytes,
  chatMediaMaxLabel,
} from '@nilzora/contracts';
import { formatBytes } from '@nilzora/ui';
import { Camera, FileText, ImageIcon, Paperclip, X } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { type SelectedChatFile } from './support-upload';
import { useObjectUrl } from './use-object-url';

/*
 * The composer's attachment picker
 * --------------------------------
 * One attach button opens a compact menu of what the chat really accepts. Choosing a file only
 * checks it against the shared limits and shows a preview chip; nothing is uploaded until Send.
 */

const PHOTO_TYPES: readonly string[] = CHAT_IMAGE_TYPES;
const FILE_TYPES: readonly string[] = CHAT_DOCUMENT_TYPES;

/** What the customer may pick, in words: shown when a chosen file is refused. */
const SUPPORTED_SENTENCE =
  'Attach a JPEG, PNG or WebP picture, or a PDF, TXT, CSV, DOCX or XLSX file.';

/** The extension a file card leads with, or "FILE" when the name has none. */
function typeLabel(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return 'FILE';
  return name.slice(dot + 1).toUpperCase();
}

/**
 * Checks one chosen file against the contract: the type must be a picture or a document, it must
 * not be empty, and it must fit the ceiling for its kind. A recording is made with the microphone,
 * never picked here, so an audio file is refused like any other type this menu does not offer.
 */
export function checkChosenFile(file: File): { file: File; durationMs: null } | string {
  const contentType = (file.type || '').split(';')[0]?.trim().toLowerCase() ?? '';
  const kind = chatMediaKindOf(contentType);
  if (kind === null || kind === 'audio') return `${file.name}: ${SUPPORTED_SENTENCE}`;
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > chatMediaMaxBytes(kind)) {
    return `${file.name} is larger than ${chatMediaMaxLabel(kind)}.`;
  }
  return { file, durationMs: null };
}

/** A compact thumbnail for a chosen picture, or an icon, the type and the size for a document. */
function SelectedFileChip({
  entry,
  onRemove,
  disabled,
}: {
  entry: SelectedChatFile;
  onRemove: () => void;
  disabled: boolean;
}) {
  const preview = useObjectUrl(entry.file, entry.kind === 'image');
  return (
    <li className="relative flex min-w-0 items-center gap-2 rounded-xl border border-border bg-surface p-1.5 pr-12">
      {preview === null ? (
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-muted">
          <FileText aria-hidden className="size-4 text-muted-foreground" />
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- a local blob, never a stored URL
        <img src={preview} alt="" className="size-10 shrink-0 rounded-lg object-cover" />
      )}
      <span className="grid min-w-0">
        <span className="max-w-36 truncate text-[11px] font-medium text-foreground">
          {entry.name}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {entry.kind === 'image' ? 'Photo' : typeLabel(entry.name)} ·{' '}
          {formatBytes(entry.file.size)}
        </span>
      </span>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${entry.name}`}
        className="absolute top-1/2 right-1 grid size-11 -translate-y-1/2 place-items-center rounded-full text-muted-foreground transition hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40"
      >
        <X aria-hidden className="size-3.5" />
      </button>
    </li>
  );
}

/** The files chosen but not yet sent, each removable before Send. Nothing here touches the network. */
export function SelectedFileList({
  selected,
  onRemove,
  onClear,
  disabled,
}: {
  selected: readonly SelectedChatFile[];
  onRemove: (localId: string) => void;
  onClear: () => void;
  disabled: boolean;
}) {
  if (selected.length === 0) return null;
  return (
    <div className="mb-2 grid gap-1">
      <ul aria-label="Files ready to send" className="flex flex-wrap gap-1.5">
        {selected.map((entry) => (
          <SelectedFileChip
            key={entry.localId}
            entry={entry}
            disabled={disabled}
            onRemove={() => onRemove(entry.localId)}
          />
        ))}
      </ul>
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span>
          {String(selected.length)} of {String(CHAT_ATTACHMENT_MAX_PER_MESSAGE)}
        </span>
        <button
          type="button"
          onClick={onClear}
          disabled={disabled}
          className="inline-flex min-h-11 sm:min-h-0 pointer-coarse:min-h-11 items-center rounded px-1.5 py-1 transition hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40"
        >
          Clear all
        </button>
      </div>
    </div>
  );
}

const subscribeNever = () => () => undefined;

/** A browser where "Camera" means something: a touch screen, where `capture` opens the camera. */
function hasTouchCamera(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches) {
    return true;
  }
  return typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
}

const MENU_ITEM =
  'flex min-h-11 w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-foreground hover:bg-surface-muted focus-visible:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring';

/**
 * The composer's one attach control.
 *
 * A single button opens a compact menu: Photos (JPEG, PNG, WebP) and Files (PDF, TXT, CSV, DOCX,
 * XLSX), plus Camera on a touch screen, where `capture` opens the phone's camera. Voice is the
 * microphone button beside Send, not an entry here. Every refusal is reported through
 * `onProblems`, one sentence per file, and files over the per-message limit are named as such
 * instead of being dropped silently.
 */
export function AttachMenuButton({
  count,
  onAdd,
  onProblems,
  disabled,
}: {
  /** How many files the message already carries. */
  count: number;
  onAdd: (files: { file: File; durationMs: number | null }[]) => void;
  onProblems: (problems: string[]) => void;
  disabled: boolean;
}) {
  const photoInput = useRef<HTMLInputElement | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const cameraInput = useRef<HTMLInputElement | null>(null);
  const root = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // A device fact, read in the browser only: the server render and the first paint say "no camera".
  const camera = useSyncExternalStore(subscribeNever, hasTouchCamera, () => false);

  // Escape and a press outside close the menu, like every other floating control in the widget.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    const onPress = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPress);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPress);
    };
  }, [menuOpen]);

  const room = CHAT_ATTACHMENT_MAX_PER_MESSAGE - count;

  const chooseFiles = (list: FileList | null) => {
    if (list === null || list.length === 0) return;
    const accepted: { file: File; durationMs: number | null }[] = [];
    const problems: string[] = [];
    let overflow = false;
    for (const file of [...list]) {
      if (count + accepted.length >= CHAT_ATTACHMENT_MAX_PER_MESSAGE) {
        overflow = true;
        continue;
      }
      const verdict = checkChosenFile(file);
      if (typeof verdict === 'string') {
        problems.push(verdict);
        continue;
      }
      accepted.push(verdict);
    }
    if (overflow) {
      problems.push(`A message carries at most ${String(CHAT_ATTACHMENT_MAX_PER_MESSAGE)} files.`);
    }
    onProblems(problems);
    if (accepted.length > 0) onAdd(accepted);
  };

  const open = (input: HTMLInputElement | null) => {
    setMenuOpen(false);
    input?.click();
  };

  const onChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    chooseFiles(event.target.files);
    event.target.value = '';
  };

  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label="Attach a photo or file"
        disabled={disabled || room <= 0}
        onClick={() => setMenuOpen((value) => !value)}
        className="grid size-11 place-items-center rounded-lg sm:size-10 pointer-coarse:size-11 text-muted-foreground transition hover:bg-surface-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Paperclip aria-hidden className="size-5" />
      </button>
      {menuOpen ? (
        <div
          role="menu"
          aria-label="Attach"
          className="absolute bottom-full left-0 z-10 mb-1 w-44 overflow-hidden rounded-xl border border-border bg-background shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => open(photoInput.current)}
            className={MENU_ITEM}
          >
            <ImageIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            Photos
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => open(fileInput.current)}
            className={MENU_ITEM}
          >
            <FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            Files
          </button>
          {camera ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => open(cameraInput.current)}
              className={MENU_ITEM}
            >
              <Camera aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              Camera
            </button>
          ) : null}
        </div>
      ) : null}

      <input
        ref={photoInput}
        type="file"
        multiple
        accept={PHOTO_TYPES.join(',')}
        disabled={disabled}
        onChange={onChange}
        className="sr-only"
        tabIndex={-1}
        aria-label="Choose photos"
      />
      <input
        ref={fileInput}
        type="file"
        multiple
        accept={FILE_TYPES.join(',')}
        disabled={disabled}
        onChange={onChange}
        className="sr-only"
        tabIndex={-1}
        aria-label="Choose files"
      />
      {camera ? (
        <input
          ref={cameraInput}
          type="file"
          accept={PHOTO_TYPES.join(',')}
          capture="environment"
          disabled={disabled}
          onChange={onChange}
          className="sr-only"
          tabIndex={-1}
          aria-label="Take a photo"
        />
      ) : null}
    </div>
  );
}
