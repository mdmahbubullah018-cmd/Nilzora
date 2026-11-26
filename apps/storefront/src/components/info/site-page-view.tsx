import type { PublicSitePage } from '@nilzora/contracts';
import { InfoPageFrame } from '@/components/info/info-page';
import { formatLongDate } from '@/lib/format';
import { parsePageText } from '@/lib/site-page-text';

/*
 * A page the store wrote in the admin workspace. The text is plain: it is parsed into
 * headings, paragraphs and lists (see lib/site-page-text.ts) and drawn as ordinary elements,
 * so there is no HTML injection of any kind and no dangerouslySetInnerHTML. The layout is
 * the same reading column the built-in information pages use.
 */
export function SitePageView({ page }: { page: PublicSitePage }) {
  const blocks = parsePageText(page.body);
  return (
    <InfoPageFrame crumb={page.title}>
      <header className="grid gap-3 border-b border-border pb-6">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-balance text-foreground sm:text-4xl">
          {page.title}
        </h1>
        <p className="text-xs text-muted-foreground">
          Last updated <time dateTime={page.updatedAt}>{formatLongDate(page.updatedAt)}</time>
        </p>
      </header>
      <div className="grid max-w-[68ch] gap-4">
        {blocks.map((block, index) => {
          if (block.kind === 'heading') {
            const Tag = block.level === 2 ? 'h2' : 'h3';
            return (
              <Tag
                key={index}
                className="mt-4 font-display text-lg font-semibold tracking-tight text-foreground sm:text-xl"
              >
                {block.text}
              </Tag>
            );
          }
          if (block.kind === 'list') {
            return (
              <ul key={index} role="list" className="grid gap-2">
                {block.items.map((item, itemIndex) => (
                  <li
                    key={itemIndex}
                    className="flex gap-3 leading-relaxed wrap-break-word text-body"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-2 size-1.5 shrink-0 rounded-full bg-primary"
                    />
                    <span className="min-w-0">{item}</span>
                  </li>
                ))}
              </ul>
            );
          }
          return (
            <p
              key={index}
              className="leading-relaxed wrap-break-word whitespace-pre-line text-pretty text-body"
            >
              {block.text}
            </p>
          );
        })}
      </div>
    </InfoPageFrame>
  );
}
