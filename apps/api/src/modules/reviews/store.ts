import {
  adminReviewListResponseSchema,
  myReviewSchema,
  productReviewsResponseSchema,
  publicReviewSchema,
  reviewTimestampSchema,
  type AdminReview,
  type ReviewImage,
  type AdminReviewListQuery,
  type MyReview,
  type ProductReviewsResponse,
  type ReviewModerationRequest,
  type ReviewReply,
  type ReviewSubmitRequest,
  type ReviewVoteResponse,
  type ReviewVoteVerdict,
  type ReviewableItem,
  reviewVoteResponseSchema,
  reviewVoteVerdictSchema,
  reviewReplySchema,
} from '@nilzora/contracts';
import type { Pool, PoolClient } from 'pg';
import { withAnon, withUser } from '../../db/user-context';
import type { SupabaseClients } from '../../supabase/clients';
import { conform, StoreUnavailableError, toStoreError } from '../commerce/errors';
import { toAdminStoreError } from '../admin/errors';
import { sqlNull, type Page } from '../admin/shared';
import { storedImageSchema, type AttachmentStore, type StoredImage } from '../attachments/store';
import { ownedPicture } from '../media/public-url';
import { pictureFromKey } from '../media/images';
import { z } from 'zod';

/*
 * Review photos
 * -------------
 * The database returns each photo as {id, key}; only this API knows the media address, so it
 * turns keys into public URLs here. A photo whose key cannot be resolved is left out. Until the
 * avatars-and-review-images migration is applied the functions return no "images" at all, which
 * parses to an empty list, so reviews keep working exactly as before.
 */

export interface ReviewStoreOptions {
  /** Public address of the media bucket (undefined when media is not configured). */
  mediaBaseUrl?: string | undefined;
  /** Where moderators' photo lists come from. Without it the queue shows no photos. */
  attachments?: AttachmentStore | undefined;
}

const storedImages = z.array(storedImageSchema).default([]);

/** How many waiting products one page of the account's review reminders shows. */
const REVIEWABLE_LIMIT = 20;

const dbPublicReviewsSchema = productReviewsResponseSchema.extend({
  reviews: z.array(publicReviewSchema.extend({ images: storedImages })),
});

const dbMyReviewSchema = myReviewSchema.extend({
  review: myReviewSchema.shape.review.unwrap().extend({ images: storedImages }).nullable(),
});

/** One delivered line awaiting a review, as the database hands it back (a media key, not a URL). */
const dbReviewableSchema = z
  .array(
    z.object({
      productId: z.uuid(),
      productName: z.string(),
      productSlug: z.string(),
      variantLabel: z.string().nullable(),
      imageKey: z.string().nullable(),
      imageAlt: z.string().nullable(),
      orderNumber: z.string(),
      deliveredAt: reviewTimestampSchema,
    }),
  )
  .default([]);

/** The vote totals of a page, keyed by review id; a review nobody voted on has no entry. */
const voteTotalsSchema = z
  .array(
    z.object({
      review_id: z.uuid(),
      helpful_count: z.coerce.number().int().nonnegative(),
      not_helpful_count: z.coerce.number().int().nonnegative(),
      viewer_vote: reviewVoteVerdictSchema.nullable(),
    }),
  )
  .default([]);

type VoteTotals = Map<
  string,
  { helpfulCount: number; notHelpfulCount: number; viewerVote: ReviewVoteVerdict | null }
>;

function voteTotals(rows: unknown): VoteTotals {
  const parsed = voteTotalsSchema.parse(rows ?? []);
  return new Map(
    parsed.map((row) => [
      row.review_id,
      {
        helpfulCount: row.helpful_count,
        notHelpfulCount: row.not_helpful_count,
        viewerVote: row.viewer_vote,
      },
    ]),
  );
}

/**
 * Attaches the totals to a page of reviews. A review with no votes keeps the contract's zeroes,
 * so the caller never has to ask whether the map has an entry.
 */
function withVoteTotals<T extends { id: string }>(reviews: readonly T[], totals: VoteTotals): T[] {
  return reviews.map((review) => {
    const found = totals.get(review.id);
    return found === undefined
      ? { ...review, helpfulCount: 0, notHelpfulCount: 0, viewerVote: null }
      : {
          ...review,
          helpfulCount: found.helpfulCount,
          notHelpfulCount: found.notHelpfulCount,
          viewerVote: found.viewerVote,
        };
  });
}

function toImages(rows: readonly StoredImage[], mediaBaseUrl: string | undefined): ReviewImage[] {
  return rows.flatMap((row) => {
    const picture = ownedPicture(row.key, mediaBaseUrl);
    return picture === null ? [] : [{ id: row.id, ...picture }];
  });
}

function publicReviews(payload: unknown, mediaBaseUrl: string | undefined): ProductReviewsResponse {
  const parsed = conform(dbPublicReviewsSchema, payload, 'catalog_product_reviews');
  return {
    ...parsed,
    reviews: parsed.reviews.map((review) => ({
      ...review,
      images: toImages(review.images, mediaBaseUrl),
    })),
  };
}

function myReviewOf(payload: unknown, mediaBaseUrl: string | undefined): MyReview {
  const parsed = conform(dbMyReviewSchema, payload, 'my_product_review');
  return {
    eligible: parsed.eligible,
    review: parsed.review
      ? { ...parsed.review, images: toImages(parsed.review.images, mediaBaseUrl) }
      : null,
  };
}

/** The delivered lines still awaiting a review, with each line's picture as a public URL. */
function reviewableItems(payload: unknown, mediaBaseUrl: string | undefined): ReviewableItem[] {
  return conform(dbReviewableSchema, payload, 'my_reviewable_products').map((row) => ({
    productId: row.productId,
    productName: row.productName,
    productSlug: row.productSlug,
    variantLabel: row.variantLabel,
    image: pictureFromKey(row.imageKey, mediaBaseUrl, row.imageAlt),
    orderNumber: row.orderNumber,
    deliveredAt: row.deliveredAt,
  }));
}

/** The moderation queue with each review's photos, or without them when they cannot be read. */
async function withModeratorImages(
  reviews: AdminReview[],
  caller: { accessToken: string; userId: string },
  options: ReviewStoreOptions,
): Promise<AdminReview[]> {
  if (!options.attachments || reviews.length === 0) return reviews;
  let rows: { reviewId: string; id: string; key: string }[];
  try {
    rows = await options.attachments.adminReviewImages(
      caller,
      reviews.map((review) => review.id),
    );
  } catch {
    return reviews;
  }
  return reviews.map((review) => ({
    ...review,
    images: toImages(
      rows.filter((row) => row.reviewId === review.id),
      options.mediaBaseUrl,
    ),
  }));
}

/**
 * Product reviews. Public reads return approved rows only; writing and moderating run
 * as the signed-in account inside database functions that check eligibility and the
 * `reviews.moderate` permission themselves.
 */
export interface ReviewStore {
  /** Approved reviews of a product and its rating summary (anyone). */
  publicForProduct(
    slug: string,
    page: Page,
    viewer?: { accessToken: string; userId: string },
  ): Promise<ProductReviewsResponse>;
  myReview(accessToken: string, userId: string, productId: string): Promise<MyReview>;
  submit(
    accessToken: string,
    userId: string,
    productId: string,
    input: ReviewSubmitRequest,
  ): Promise<string>;
  list(
    accessToken: string,
    userId: string,
    filters: Pick<AdminReviewListQuery, 'status' | 'q'>,
    page: Page,
  ): Promise<{ reviews: AdminReview[]; total: number }>;
  moderate(
    accessToken: string,
    userId: string,
    reviewId: string,
    input: ReviewModerationRequest,
  ): Promise<void>;
  /** Writes or replaces the store's public answer to one review (`reviews.reply`). */
  reply(accessToken: string, userId: string, reviewId: string, body: string): Promise<ReviewReply>;
  /** Withdraws the store's answer. */
  clearReply(accessToken: string, userId: string, reviewId: string): Promise<void>;
  /** Records, changes or withdraws (null) the caller's own verdict on one review. */
  vote(
    accessToken: string,
    userId: string,
    reviewId: string,
    verdict: ReviewVoteVerdict | null,
  ): Promise<ReviewVoteResponse>;
  /**
   * The delivered lines this customer has not reviewed yet. Only the pooled connection can read
   * them (they need the order tables), so a store built on the data API reports itself
   * unavailable rather than answering "nothing to review", which would be a lie.
   */
  reviewable(accessToken: string, userId: string): Promise<ReviewableItem[]>;
  /**
   * The one delivered product an account visit may ask about: the newest of `reviewable` whose
   * prompt the customer has not closed. Null when there is none, or when this database cannot
   * record a dismissal yet (a prompt that keeps coming back would be worse than none).
   */
  reviewPrompt(accessToken: string, userId: string): Promise<ReviewableItem | null>;
  /** Records that the customer closed the prompt for this product; repeating it is harmless. */
  dismissReviewPrompt(accessToken: string, userId: string, productId: string): Promise<void>;
}

/** Customer-facing refusals the database raises (NZ460–NZ465). */
export type ReviewRefusal =
  | 'review_invalid'
  | 'review_duplicate'
  | 'review_not_eligible'
  | 'review_account_blocked'
  | 'review_own';

export class ReviewRefusalError extends Error {
  override readonly name = 'ReviewRefusalError';
  readonly refusal: ReviewRefusal;

  constructor(refusal: ReviewRefusal) {
    super(`Refused by the database: ${refusal}`);
    this.refusal = refusal;
  }
}

const REVIEW_REFUSALS: Readonly<Record<string, ReviewRefusal>> = {
  NZ460: 'review_invalid',
  NZ461: 'review_duplicate',
  NZ462: 'review_invalid',
  NZ463: 'review_not_eligible',
  NZ464: 'review_account_blocked',
  NZ465: 'review_own',
};

function pageNumber({ limit, offset }: Page): number {
  return Math.floor(offset / limit) + 1;
}

function statusOf(query: Pick<AdminReviewListQuery, 'status'>): string {
  return query.status ?? 'pending';
}

function searchOf(query: Pick<AdminReviewListQuery, 'q'>): string | null {
  return query.q === undefined || query.q === '' ? null : query.q;
}

export function createSupabaseReviewStore(
  clients: SupabaseClients,
  options: ReviewStoreOptions = {},
): ReviewStore {
  /** The vote totals for one page, read as the viewer when there is one and anonymously otherwise. */
  async function totalsViaRpc(
    client: SupabaseClients,
    reviewIds: readonly string[],
    viewer?: { accessToken: string; userId: string },
  ): Promise<VoteTotals> {
    if (reviewIds.length === 0) return new Map();
    const rpc = viewer ? client.asUser(viewer.accessToken) : client.public();
    const { data, error } = await rpc.rpc('review_vote_summaries', {
      p_review_ids: [...reviewIds],
    });
    // The totals are a convenience: a store that predates them, or a failed read, hides the
    // counts rather than taking the whole page of reviews down with it.
    if (error) return new Map();
    return voteTotals(data);
  }

  return {
    async publicForProduct(slug, page, viewer) {
      const { data, error } = await clients.public().rpc('catalog_product_reviews', {
        p_product_slug: slug,
        p_page: pageNumber(page),
        p_page_size: page.limit,
      });
      if (error) throw toStoreError(error, 'catalog_product_reviews');
      const response = publicReviews(data, options.mediaBaseUrl);
      return {
        ...response,
        reviews: withVoteTotals(
          response.reviews,
          await totalsViaRpc(
            clients,
            response.reviews.map((review) => review.id),
            viewer,
          ),
        ),
      };
    },

    async myReview(accessToken, _userId, productId) {
      const { data, error } = await clients
        .asUser(accessToken)
        .rpc('my_product_review', { p_product_id: productId });
      if (error) throw toStoreError(error, 'my_product_review');
      return myReviewOf(data, options.mediaBaseUrl);
    },

    async submit(accessToken, _userId, productId, input) {
      const { data, error } = await clients.asUser(accessToken).rpc('submit_product_review', {
        p_product_id: productId,
        p_rating: input.rating,
        p_body: input.body,
        p_title: sqlNull(input.title ?? null),
      });
      if (error) throw toStoreError(error, 'submit_product_review');
      if (typeof data !== 'string') {
        throw new StoreUnavailableError('submit_product_review returned no review id');
      }
      return data;
    },

    async list(accessToken, userId, filters, page) {
      const { data, error } = await clients.asUser(accessToken).rpc('admin_list_product_reviews', {
        p_status: statusOf(filters),
        p_product_search: sqlNull(searchOf(filters)),
        p_page: pageNumber(page),
        p_page_size: page.limit,
      });
      if (error) throw toAdminStoreError(error, 'admin_list_product_reviews');
      const parsed = conform(adminReviewListResponseSchema, data, 'admin_list_product_reviews');
      return {
        reviews: withVoteTotals(
          await withModeratorImages(parsed.reviews, { accessToken, userId }, options),
          await totalsViaRpc(
            clients,
            parsed.reviews.map((review) => review.id),
            {
              accessToken,
              userId,
            },
          ),
        ),
        total: parsed.total,
      };
    },

    async moderate(accessToken, _userId, reviewId, input) {
      const { error } = await clients.asUser(accessToken).rpc('admin_set_product_review_status', {
        p_review_id: reviewId,
        p_status: input.status,
        p_note: sqlNull(input.note ?? null),
      });
      if (error) throw toAdminStoreError(error, 'admin_set_product_review_status');
    },

    async reply(accessToken, _userId, reviewId, body) {
      const { data, error } = await clients
        .asUser(accessToken)
        .rpc('admin_reply_to_review', { p_review_id: reviewId, p_body: body });
      if (error) throw toAdminStoreError(error, 'admin_reply_to_review');
      return reviewReplySchema.parse(data);
    },

    async clearReply(accessToken, _userId, reviewId) {
      const { error } = await clients
        .asUser(accessToken)
        .rpc('admin_clear_review_reply', { p_review_id: reviewId });
      if (error) throw toAdminStoreError(error, 'admin_clear_review_reply');
    },

    async vote(accessToken, _userId, reviewId, verdict) {
      const { data, error } = await clients.asUser(accessToken).rpc('vote_product_review', {
        p_review_id: reviewId,
        p_helpful: sqlNull(verdict === null ? null : verdict === 'helpful'),
      });
      if (error) throw toStoreError(error, 'vote_product_review');
      return reviewVoteResponseSchema.parse(data);
    },

    /** Reading the customer's own order lines needs the direct connection; see the interface. */
    reviewable() {
      return Promise.reject(
        new StoreUnavailableError('review reminders need the direct database connection'),
      );
    },

    reviewPrompt() {
      return Promise.reject(
        new StoreUnavailableError('review reminders need the direct database connection'),
      );
    },

    dismissReviewPrompt() {
      return Promise.reject(
        new StoreUnavailableError('review reminders need the direct database connection'),
      );
    },
  };
}

export function createPostgresReviewStore(
  pool: Pool,
  options: ReviewStoreOptions = {},
): ReviewStore {
  function failure(error: unknown, operation: string): Error {
    if (error instanceof StoreUnavailableError || error instanceof ReviewRefusalError) return error;
    const fields = error as { code?: unknown; message?: unknown; detail?: unknown } | null;
    const code = typeof fields?.code === 'string' ? fields.code : '';
    const database = {
      code,
      message: typeof fields?.message === 'string' ? fields.message : 'database request failed',
      details: typeof fields?.detail === 'string' ? fields.detail : null,
    };
    const refusal = REVIEW_REFUSALS[code];
    if (refusal) return new ReviewRefusalError(refusal);
    return toAdminStoreError(database, operation);
  }

  function asUser<T>(userId: string, run: (client: PoolClient) => Promise<T>, operation: string) {
    return withUser(pool, userId, run).catch((error: unknown) => {
      throw failure(error, operation);
    });
  }

  /** The totals for a page, in whichever transaction the caller already opened. */
  async function totalsViaClient(
    client: PoolClient,
    reviewIds: readonly string[],
  ): Promise<VoteTotals> {
    if (reviewIds.length === 0) return new Map();
    try {
      const result = await client.query<Record<string, unknown>>(
        'select * from public.review_vote_summaries($1::uuid[])',
        [[...reviewIds]],
      );
      return voteTotals(result.rows);
    } catch {
      // Counts are a convenience; a store without them shows no tallies rather than no reviews.
      return new Map();
    }
  }

  return {
    /** No account identity by default: the read runs as `anon`, the same role the public client uses. */
    async publicForProduct(slug, page, viewer) {
      const read = async (client: PoolClient): Promise<ProductReviewsResponse> => {
        const result = await client.query<{ payload: unknown }>(
          'select public.catalog_product_reviews($1::text, $2::int, $3::int) as payload',
          [slug, pageNumber(page), page.limit],
        );
        const response = publicReviews(result.rows[0]?.payload, options.mediaBaseUrl);
        const totals = await totalsViaClient(
          client,
          response.reviews.map((review) => review.id),
        );
        return { ...response, reviews: withVoteTotals(response.reviews, totals) };
      };
      // A signed-in reader learns their own verdict; an anonymous one is told nothing of it.
      try {
        return viewer ? await withUser(pool, viewer.userId, read) : await withAnon(pool, read);
      } catch (error) {
        throw failure(error, 'catalog_product_reviews');
      }
    },

    myReview: (_accessToken, userId, productId) =>
      asUser(
        userId,
        async (client) => {
          const result = await client.query<{ payload: unknown }>(
            'select public.my_product_review($1::uuid) as payload',
            [productId],
          );
          return myReviewOf(result.rows[0]?.payload, options.mediaBaseUrl);
        },
        'my_product_review',
      ),

    submit: (_accessToken, userId, productId, input) =>
      asUser(
        userId,
        async (client) => {
          const result = await client.query<{ id: string }>(
            'select public.submit_product_review($1::uuid, $2::int, $3::text, $4::text) as id',
            [productId, input.rating, input.body, input.title ?? null],
          );
          const id = result.rows[0]?.id;
          if (typeof id !== 'string') {
            throw new StoreUnavailableError('submit_product_review returned no review id');
          }
          return id;
        },
        'submit_product_review',
      ),

    list: (accessToken, userId, filters, page) =>
      asUser(
        userId,
        async (client) => {
          const result = await client.query<{ payload: unknown }>(
            'select public.admin_list_product_reviews($1::text, $2::text, $3::int, $4::int) as payload',
            [statusOf(filters), searchOf(filters), pageNumber(page), page.limit],
          );
          const parsed = conform(
            adminReviewListResponseSchema,
            result.rows[0]?.payload,
            'admin_list_product_reviews',
          );
          const totals = await totalsViaClient(
            client,
            parsed.reviews.map((review) => review.id),
          );
          return {
            reviews: withVoteTotals(
              await withModeratorImages(parsed.reviews, { accessToken, userId }, options),
              totals,
            ),
            total: parsed.total,
          };
        },
        'admin_list_product_reviews',
      ),

    moderate: (_accessToken, userId, reviewId, input) =>
      asUser(
        userId,
        async (client) => {
          await client.query(
            'select public.admin_set_product_review_status($1::uuid, $2::text, $3::text)',
            [reviewId, input.status, input.note ?? null],
          );
        },
        'admin_set_product_review_status',
      ),

    reply: (_accessToken, userId, reviewId, body) =>
      asUser(
        userId,
        async (client) => {
          const result = await client.query<{ payload: unknown }>(
            'select public.admin_reply_to_review($1::uuid, $2::text) as payload',
            [reviewId, body],
          );
          return reviewReplySchema.parse(result.rows[0]?.payload);
        },
        'admin_reply_to_review',
      ),

    clearReply: (_accessToken, userId, reviewId) =>
      asUser(
        userId,
        async (client) => {
          await client.query('select public.admin_clear_review_reply($1::uuid)', [reviewId]);
        },
        'admin_clear_review_reply',
      ),

    vote: (_accessToken, userId, reviewId, verdict) =>
      asUser(
        userId,
        async (client) => {
          const result = await client.query<{ payload: unknown }>(
            'select public.vote_product_review($1::uuid, $2::boolean) as payload',
            [reviewId, verdict === null ? null : verdict === 'helpful'],
          );
          return reviewVoteResponseSchema.parse(result.rows[0]?.payload);
        },
        'vote_product_review',
      ),

    /**
     * Filtered by the caller's own account id, not by the policies alone: staff roles may read
     * every order, so "my orders" has to be said outright. `my_product_review` then supplies the
     * one fact the order tables cannot — whether this customer already reviewed the product.
     */
    reviewable: (_accessToken, userId) =>
      asUser(
        userId,
        async (client) => {
          const result = await client.query<{ payload: unknown }>(
            `select coalesce(
                      jsonb_agg(
                        jsonb_build_object(
                          'productId', d.product_id,
                          'productName', d.product_name,
                          'productSlug', d.product_slug,
                          'variantLabel', d.variant_label,
                          'imageKey', d.image_key,
                          'imageAlt', d.image_alt,
                          'orderNumber', d.order_number,
                          'deliveredAt', d.delivered_at
                        )
                        order by d.delivered_at desc, d.product_id
                      ),
                      '[]'::jsonb
                    ) as payload
               from (
                 select distinct on (oi.product_id)
                        oi.product_id, oi.product_name, oi.product_slug, oi.variant_label,
                        oi.image_key, oi.image_alt, o.order_number,
                        coalesce(history.delivered_at, o.placed_at) as delivered_at
                   from public.orders o
                   join public.order_items oi on oi.order_id = o.id
                   cross join lateral (
                     select public.my_product_review(oi.product_id) as payload
                   ) mine
                   left join lateral (
                     select max(h.created_at) as delivered_at
                       from public.order_status_history h
                      where h.order_id = o.id and h.to_status = 'delivered'
                   ) history on true
                  where o.user_id = $1::uuid
                    and o.status = 'delivered'
                    and mine.payload -> 'eligible' = 'true'::jsonb
                    and mine.payload -> 'review' = 'null'::jsonb
                  order by oi.product_id, o.placed_at desc, o.id
               ) d`,
            [userId],
          );
          return reviewableItems(result.rows[0]?.payload, options.mediaBaseUrl).slice(
            0,
            REVIEWABLE_LIMIT,
          );
        },
        'my_reviewable_products',
      ),

    async reviewPrompt(accessToken, userId) {
      const items = await this.reviewable(accessToken, userId);
      if (items.length === 0) return null;
      let dismissed: Set<string>;
      try {
        dismissed = await withUser(pool, userId, async (client) => {
          const result = await client.query<{ product_id: string }>(
            'select product_id from public.review_prompt_dismissals where user_id = $1::uuid',
            [userId],
          );
          return new Set(result.rows.map((row) => row.product_id));
        });
      } catch (error) {
        // No dismissals table on this database yet (migration 20261227090000): ask nothing.
        if ((error as { code?: unknown } | null)?.code === '42P01') return null;
        throw failure(error, 'review_prompt_dismissals');
      }
      return items.find((item) => !dismissed.has(item.productId)) ?? null;
    },

    dismissReviewPrompt: (_accessToken, userId, productId) =>
      asUser(
        userId,
        async (client) => {
          // The policy only lets an account write its own rows; the id is the verified caller.
          await client.query(
            `insert into public.review_prompt_dismissals (user_id, product_id)
             values ($1::uuid, $2::uuid)
             on conflict (user_id, product_id) do update set dismissed_at = now()`,
            [userId, productId],
          );
        },
        'review_prompt_dismissals',
      ),
  };
}
