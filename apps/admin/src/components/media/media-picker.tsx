'use client';

import type { MediaAsset } from '@nilzora/contracts';
import { cn, Dialog, formatBytes } from '@nilzora/ui';
import { Check, Images, Loader2, Search, Upload } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import type { CsrfInput } from '@/components/auth/csrf-field';
import { PictureUploadForm } from '@/components/admin-kit/picture-upload-form';
import { searchMediaAction, uploadMediaAction } from '@/lib/media-actions';
import type { UploadGuidance } from '@/lib/upload-guidance';
import { MediaUploader } from './media-controls';
import { AutoText } from '@/components/i18n/translate';
import { useTx } from '@/lib/i18n/provider';

/*
 * One picture picker, used by every image field in the admin.
 *
 * It opens over the page instead of taking the browser to the library, so everything already
 * typed stays where it is, and both ways of getting a picture live in the same place: the
 * library (search, then choose) and an upload (the same queue, endpoint and Server Action the
 * media page uses). Choosing only writes a key into the field; the page's own Save still saves.
 *
 * The dialog is portalled to <body>: an image field usually sits inside the page's <form>, and
 * a <dialog> — with the upload form inside it — nested in another form would be invalid markup.
 * It is mounted only while open, so every opening lists the library afresh.
 */

type PickerTab = 'library' | 'upload';

const TABS: readonly { id: PickerTab; label: string; icon: typeof Images }[] = [
  { id: 'library', label: 'Media library', icon: Images },
  { id: 'upload', label: 'Upload a picture', icon: Upload },
];

/** What the picker hands back: enough to fill the field and show its picture at once. */
export interface PickedPicture {
  key: string;
  url: string;
  thumbUrl: string;
}

export interface MediaPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (picture: PickedPicture) => void;
  csrf: CsrfInput;
  /** The key already in the field, so the library can mark it. */
  selectedKey?: string | undefined;
  /** What the field stores: a library key (usual) or the address itself. */
  valueKind?: 'key' | 'url';
  initialTab?: PickerTab;
  /**
   * The shape this field shows its picture in. Given one, the upload tab offers the cropper
   * locked to that shape, so a picture is never stretched or blindly cut.
   */
  guidance?: UploadGuidance;
}

export function MediaPicker({ open, ...rest }: MediaPickerProps) {
  // Only reachable after a click, so `document` exists; the server renders nothing.
  if (!open || typeof document === 'undefined') return null;
  return createPortal(<PickerDialog {...rest} />, document.body);
}

function PickerDialog({
  onOpenChange,
  onPick,
  csrf,
  selectedKey = '',
  valueKind = 'key',
  initialTab = 'library',
  guidance,
}: Omit<MediaPickerProps, 'open'>) {
  const tx = useTx();
  const [tab, setTab] = useState<PickerTab>(initialTab);
  const [assets, setAssets] = useState<readonly MediaAsset[] | null>(null);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The first listing: the request is awaited before any state is written, and an answer that
  // arrives after the dialog closes is dropped.
  useEffect(() => {
    let live = true;
    const body = new FormData();
    body.set(csrf.name, csrf.token);
    void (async () => {
      try {
        const answer = await searchMediaAction(body);
        if (!live) return;
        if (!answer.ok) {
          setError(answer.message);
          setAssets([]);
          return;
        }
        setAssets(answer.assets);
        setTotal(answer.total);
      } catch {
        if (!live) return;
        setError('The media library could not be read. Close this and try again.');
        setAssets([]);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
    // One listing per opening: the dialog mounts when it opens and unmounts when it closes.
  }, [csrf.name, csrf.token]);

  const search = async (text: string) => {
    setLoading(true);
    setError(null);
    const body = new FormData();
    body.set(csrf.name, csrf.token);
    body.set('q', text);
    try {
      const answer = await searchMediaAction(body);
      if (!answer.ok) {
        setError(answer.message);
        setAssets([]);
        return;
      }
      setAssets(answer.assets);
      setTotal(answer.total);
    } catch {
      setError('The media library could not be read. Close this and try again.');
      setAssets([]);
    } finally {
      setLoading(false);
    }
  };

  const valueOf = (asset: MediaAsset) => (valueKind === 'url' ? asset.url : asset.key);
  const choose = (picture: PickedPicture) => {
    onPick(picture);
    onOpenChange(false);
  };
  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void search(query);
  };

  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      title={tx("Choose a picture")}
      description={tx("Pick one from the library or upload a new one. Nothing changes on the storefront until you save this page.")}
      closeLabel="Close the picture picker"
      className="sm:max-w-3xl"
    >
      <div className="grid gap-4">
        <div
          role="tablist"
          aria-label={tx("Where the picture comes from")}
          className="flex gap-1 rounded-xl bg-surface-muted p-1"
        >
          {TABS.map((entry) => {
            const Icon = entry.icon;
            const active = entry.id === tab;
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls={`media-panel-${entry.id}`}
                id={`media-tab-${entry.id}`}
                onClick={() => {
                  setTab(entry.id);
                }}
                className={cn(
                  'inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors max-sm:min-h-11',
                  active
                    ? 'bg-surface text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon aria-hidden="true" className="size-4" />
                {entry.label}
              </button>
            );
          })}
        </div>

        {tab === 'library' ? (
          <section
            id="media-panel-library"
            role="tabpanel"
            aria-labelledby="media-tab-library"
            className="grid gap-3"
          >
            <form onSubmit={submitSearch} className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                  }}
                  aria-label={tx("Search the media library")}
                  placeholder={tx("Description or file name")}
                  className="w-full rounded-xl border border-input-border bg-surface py-1.5 pr-3 pl-8 text-sm max-sm:h-11"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="rounded-xl border border-input-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-neutral-soft disabled:opacity-50 max-sm:min-h-11"
              ><AutoText>Search</AutoText></button>
            </form>

            {error === null ? null : (
              <p role="alert" className="text-sm text-danger-ink">
                {error}
              </p>
            )}

            {loading ? (
              <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 aria-hidden="true" className="size-4 motion-safe:animate-spin" /><AutoText>Reading the library…</AutoText></p>
            ) : assets === null || assets.length === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">
                {error !== null
                  ? 'The library could not be listed.'
                  : query.trim() === ''
                    ? 'No pictures yet. Open “Upload a picture” to add the first one.'
                    : 'Nothing matches that search. Try another word, or upload a new picture.'}
              </p>
            ) : (
              <>
                <ul
                  aria-label={tx("Media library")}
                  className="grid max-h-[min(52vh,26rem)] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-4"
                >
                  {assets.map((asset) => {
                    const chosen = valueOf(asset) === selectedKey;
                    const label = asset.alt ?? asset.originalName ?? 'Untitled picture';
                    return (
                      <li key={asset.id}>
                        <button
                          type="button"
                          onClick={() => {
                            choose({ key: asset.key, url: asset.url, thumbUrl: asset.thumbUrl });
                          }}
                          aria-pressed={chosen}
                          className={cn(
                            'group grid w-full gap-1 rounded-xl border p-1.5 text-left transition-colors',
                            chosen
                              ? 'border-info-ink ring-2 ring-info-line'
                              : 'border-hairline hover:border-info-line',
                          )}
                        >
                          <span className="relative block aspect-4/3 overflow-hidden rounded-md bg-neutral-soft">
                            {/* eslint-disable-next-line @next/next/no-img-element -- served from the media origin, unknown at build time */}
                            <img
                              src={asset.thumbUrl}
                              alt=""
                              loading="lazy"
                              className="size-full object-cover"
                            />
                            {chosen ? (
                              <Check
                                aria-hidden="true"
                                className="absolute top-1 right-1 size-4 rounded-full bg-info-ink p-0.5 text-surface"
                              />
                            ) : null}
                          </span>
                          <span className="truncate text-xs font-medium text-foreground">
                            {label}
                          </span>
                          <span className="text-[0.6875rem] text-muted-foreground">
                            {`${String(asset.width)}×${String(asset.height)} · ${formatBytes(asset.bytes)}`}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <p className="text-xs text-muted-foreground">
                  {total > assets.length
                    ? `Showing the newest ${String(assets.length)} of ${String(total)} pictures. Search to narrow it down.`
                    : `Showing all ${String(assets.length)} pictures.`}
                </p>
              </>
            )}
          </section>
        ) : (
          <section
            id="media-panel-upload"
            role="tabpanel"
            aria-labelledby="media-tab-upload"
            className="grid gap-3"
          >
            <p className="text-sm text-muted-foreground">
              The new picture is added to the library and selected for this field straight away. It
              is used on the storefront only after you save this page.
            </p>
            {guidance === undefined ? (
              <MediaUploader
                csrf={csrf}
                onUploaded={(picture) => {
                  choose(picture);
                }}
              />
            ) : (
              <PictureUploadForm
                kind="media"
                csrf={csrf}
                label={tx("Upload a picture")}
                action={uploadMediaAction}
                guidance={guidance}
                onUploaded={choose}
              />
            )}
          </section>
        )}

        <p className="text-xs text-muted-foreground"><AutoText>Closing this window leaves the page exactly as it was.</AutoText></p>
      </div>
    </Dialog>
  );
}
