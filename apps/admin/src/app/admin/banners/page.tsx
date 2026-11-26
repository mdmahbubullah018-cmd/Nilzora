import type { AdminBanner } from '@nilzora/contracts';
import { GalleryHorizontal, Pencil, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { AccessGate } from '@/components/access/access-gate';
import { Chip } from '@/components/admin-kit/chip';
import { PageToolbar } from '@/components/admin-kit/page-toolbar';
import { adminRead } from '@/components/admin-kit/read';
import { SectionCard } from '@/components/admin-kit/section-card';
import { EmptyPanel } from '@/components/catalog/catalog-ui';
import { readCategories } from '@/components/catalog/load-catalog';
import { PageFailure, PageForbidden } from '@/components/catalog/page-states';
import {
  BannerForm,
  BannerImageForm,
  BannerMobileImageForm,
  DeleteBannerForm,
  MoveBannerForm,
} from '@/components/merch/banner-forms';
import { SavedBannerPreview } from '@/components/merch/banner-preview';
import { WorkspaceShell } from '@/components/shell/workspace-shell';
import { bannerName } from '@/lib/banner-name';
import { workspaceGate } from '@/lib/access';
import { signInPath } from '@/lib/workspace-access';
import { AutoText } from '@/components/i18n/translate';

export const metadata: Metadata = { title: 'Banners', robots: { index: false, follow: false } };

const PLACEMENT_NAMES = {
  home_hero: 'Homepage hero',
  home_secondary: 'Homepage campaign',
  category: 'Category strip',
} as const;

function schedule(banner: AdminBanner): string {
  const format = (iso: string) =>
    new Intl.DateTimeFormat('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Dhaka',
    }).format(new Date(iso));
  if (!banner.startsAt && !banner.endsAt) return 'No schedule';
  return `${banner.startsAt ? format(banner.startsAt) : 'Now'} → ${banner.endsAt ? format(banner.endsAt) : 'no end'}`;
}

interface Group {
  key: string;
  title: string;
  banners: AdminBanner[];
}

/** The banners of one placement (and, for category strips, one category), first shown first. */
function groupBanners(
  banners: readonly AdminBanner[],
  categoryName: (banner: AdminBanner) => string,
): Group[] {
  const groups = new Map<string, Group>();
  banners.forEach((banner) => {
    const key = `${banner.placement}:${banner.categoryId ?? ''}`;
    const group = groups.get(key) ?? {
      key,
      title:
        banner.placement === 'category'
          ? `${PLACEMENT_NAMES.category}: ${categoryName(banner)}`
          : PLACEMENT_NAMES[banner.placement],
      banners: [],
    };
    group.banners.push(banner);
    groups.set(key, group);
  });
  const rank = (key: string) =>
    key.startsWith('home_hero') ? 0 : key.startsWith('home_secondary') ? 1 : 2;
  return [...groups.values()]
    .map((group) => ({
      ...group,
      banners: [...group.banners].sort((a, b) => a.sortOrder - b.sortOrder),
    }))
    .sort((a, b) => rank(a.key) - rank(b.key) || a.title.localeCompare(b.title));
}

/** Promotional banners for the homepage and category pages. */
export default async function BannersPage() {
  const gate = await workspaceGate('admin', '/admin/banners');
  if (gate.access !== 'allowed') {
    return <AccessGate {...gate} workspace="admin" retryHref="/admin/banners" />;
  }
  const { user, csrf } = gate;
  const shell = (children: ReactNode) => (
    <WorkspaceShell workspace="admin" user={user} csrf={csrf}>
      {children}
    </WorkspaceShell>
  );
  if (!user.permissions.includes('settings.manage')) {
    return shell(<PageForbidden title="Banners" permission="settings.manage" />);
  }

  const [banners, categories] = await Promise.all([
    adminRead((api, token) => api.adminListBanners(token).then((response) => response.banners)),
    readCategories(),
  ]);
  if (banners.kind === 'signed_out') redirect(signInPath('/admin/banners'));
  if (banners.kind !== 'ok') {
    return shell(
      <PageFailure
        title="Banners"
        failure={banners.kind}
        retryHref="/admin/banners"
        permission="settings.manage"
      />,
    );
  }
  const categoryList = categories.kind === 'ok' ? categories.value : [];
  const groups = groupBanners(
    banners.value,
    (banner) =>
      categoryList.find((category) => category.id === banner.categoryId)?.name ??
      banner.categorySlug ??
      'a category',
  );

  return shell(
    <div className="grid gap-6">
      <PageToolbar
        icon={GalleryHorizontal}
        title="Banners"
        description="Campaigns on the homepage and short strips on category pages. The store shows only active banners inside their schedule, first shown first."
      />

      <SectionCard
        title="New banner"
        icon={Plus}
        description="Create it, then upload a wide picture: about 2100×800 for the hero, 1600×700 for campaigns and 1600×400 for category strips. A separate small-screen picture is optional."
        className="nz-panel-strong"
      >
        <details className="group" open={banners.value.length === 0}>
          <summary className="inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-xl bg-primary-action px-4 text-sm font-semibold text-primary-action-foreground max-sm:min-h-11 [&::-webkit-details-marker]:hidden">
            <Plus aria-hidden="true" className="size-4" strokeWidth={1.75} />
            <span className="group-open:hidden"><AutoText>Create banner</AutoText></span>
            <span className="hidden group-open:inline"><AutoText>Close</AutoText></span>
          </summary>
          <div className="mt-5">
            <BannerForm categories={categoryList} csrf={csrf} />
          </div>
        </details>
      </SectionCard>

      {banners.value.length === 0 ? (
        <section className="nz-panel rounded-2xl border border-dashed">
          <EmptyPanel
            icon={GalleryHorizontal}
            title="No banners yet"
            description="Without banners, the store shows its built-in homepage and plain category headers."
            className="py-12"
          />
        </section>
      ) : (
        groups.map((group) => {
          const order = group.banners.map((banner) => banner.id).join(',');
          return (
            <SectionCard
              key={group.key}
              title={group.title}
              icon={GalleryHorizontal}
              description={`${String(group.banners.length)} ${group.banners.length === 1 ? 'banner' : 'banners'}, first shown first.`}
              className="nz-panel-strong"
              flush
            >
              <ul role="list" className="divide-y divide-hairline border-t border-hairline">
                {group.banners.map((banner, index) => (
                  <li key={banner.id}>
                    <details className="group">
                      <summary className="grid cursor-pointer list-none items-center gap-4 px-5 py-4 transition-colors hover:bg-info-soft/30 sm:grid-cols-[13rem_minmax(0,1fr)_auto] [&::-webkit-details-marker]:hidden">
                        <SavedBannerPreview banner={banner} compact />
                        <span className="grid min-w-0 gap-1.5">
                          <span className="truncate font-semibold text-foreground">
                            {bannerName(banner)}
                          </span>
                          <span className="flex flex-wrap items-center gap-1.5">
                            <Chip tone="primary">{PLACEMENT_NAMES[banner.placement]}</Chip>
                            {banner.categorySlug ? (
                              <Chip tone="neutral">/{banner.categorySlug}</Chip>
                            ) : null}
                            <Chip tone={banner.isActive ? 'success' : 'neutral'} dot>
                              {banner.isActive ? 'Active' : 'Inactive'}
                            </Chip>
                            {banner.mobileImage ? (
                              <Chip tone="violet"><AutoText>Small-screen picture</AutoText></Chip>
                            ) : null}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Position {index + 1} · {schedule(banner)}
                          </span>
                        </span>
                        <span className="inline-flex h-9 items-center gap-1.5 justify-self-start rounded-xl px-3 text-xs font-semibold text-link ring-1 ring-hairline group-open:bg-info-soft sm:justify-self-end max-sm:h-11">
                          <Pencil aria-hidden="true" className="size-3.5" strokeWidth={1.75} /><AutoText>Edit</AutoText></span>
                      </summary>
                      <div className="grid gap-6 border-t border-hairline bg-neutral-soft/40 px-5 py-5">
                        <SavedBannerPreview banner={banner} />
                        <MoveBannerForm
                          banner={banner}
                          order={order}
                          index={index}
                          count={group.banners.length}
                          csrf={csrf}
                        />
                        <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
                          <BannerForm banner={banner} categories={categoryList} csrf={csrf} />
                          <div className="grid content-start gap-6">
                            <BannerImageForm banner={banner} csrf={csrf} />
                            <BannerMobileImageForm banner={banner} csrf={csrf} />
                            <DeleteBannerForm banner={banner} csrf={csrf} />
                          </div>
                        </div>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            </SectionCard>
          );
        })
      )}
    </div>,
  );
}
