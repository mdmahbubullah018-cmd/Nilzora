import type {
  MyReview,
  ProductReviewsResponse,
  PublicReview,
  RatingSummary,
  ReviewSubmitRequest,
  ReviewVoteVerdict,
} from '@nilzora/contracts';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';
import { useMemo } from 'react';
import { useApi } from '@/api/api-context';
import { useSignedInUserId } from '@/auth/session-context';
import { ApiNotConfiguredError } from '@/lib/errors';
import { queryKeys, useAuthorizedApi } from '@/query';

/*
 * Product reviews. The public list is only ever the approved reviews, and the rating
 * summary is counted by the API from those reviews — the app never computes an average.
 * A customer's own review and their eligibility come from the server too: receiving the
 * product is what makes someone eligible, and nobody can mark their own review approved.
 */

const REVIEW_PAGE_SIZE = 10;

export interface ProductReviewFeed {
  query: UseInfiniteQueryResult<InfiniteData<ProductReviewsResponse, number>, Error>;
  /** Every published review loaded so far, each once. */
  reviews: PublicReview[];
  summary: RatingSummary | undefined;
  total: number | null;
}

/** The published reviews of a product, a page at a time. */
export function useProductReviews(slug: string): ProductReviewFeed {
  const api = useApi();
  const query = useInfiniteQuery<
    ProductReviewsResponse,
    Error,
    InfiniteData<ProductReviewsResponse, number>,
    ReturnType<typeof queryKeys.catalog.reviews>,
    number
  >({
    queryKey: queryKeys.catalog.reviews(slug),
    queryFn: ({ pageParam, signal }) => {
      if (api === null) return Promise.reject(new ApiNotConfiguredError());
      return api.productReviews(slug, { page: pageParam, pageSize: REVIEW_PAGE_SIZE }, { signal });
    },
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });

  const pages = query.data?.pages;
  const reviews = useMemo(() => {
    const seen = new Set<string>();
    const list: PublicReview[] = [];
    for (const page of pages ?? []) {
      for (const review of page.reviews) {
        if (seen.has(review.id)) continue;
        seen.add(review.id);
        list.push(review);
      }
    }
    return list;
  }, [pages]);
  // The summary is the same on every page, so the first page carries it.
  const summary = pages?.[0]?.summary;
  const total = pages?.[pages.length - 1]?.total ?? null;
  return { query, reviews, summary, total };
}

/**
 * The signed-in customer's own review of a product, and whether the server says they may
 * write one. Disabled while nobody is signed in, so it never asks anonymously.
 */
export function useMyReview(productId: string) {
  const run = useAuthorizedApi();
  const userId = useSignedInUserId();
  return useQuery<MyReview>({
    queryKey: queryKeys.reviews.mine(userId, productId),
    queryFn: ({ signal }) =>
      run((api, accessToken) => api.myProductReview(accessToken, productId, { signal })),
    enabled: userId !== null,
  });
}

/**
 * The one delivered, unreviewed product the account screen may ask about (or null). The API
 * decides eligibility from this account's own delivered orders; nothing here guesses it.
 */
export function useReviewPrompt() {
  const run = useAuthorizedApi();
  const userId = useSignedInUserId();
  return useQuery({
    queryKey: queryKeys.reviews.prompt(userId),
    queryFn: ({ signal }) => run((api, accessToken) => api.reviewPrompt(accessToken, { signal })),
    enabled: userId !== null,
    staleTime: 5 * 60_000,
  });
}

/** Delivered products this account has not reviewed yet, newest delivery first (server-decided). */
export function usePendingReviews(enabled = true) {
  const run = useAuthorizedApi();
  const userId = useSignedInUserId();
  return useQuery({
    queryKey: queryKeys.reviews.pending(userId),
    queryFn: ({ signal }) => run((api, accessToken) => api.pendingReviews(accessToken, { signal })),
    enabled: enabled && userId !== null,
    staleTime: 60_000,
  });
}

/** "Not now": the prompt is not shown again for this product, on any device. */
export function useDismissReviewPrompt() {
  const run = useAuthorizedApi();
  const userId = useSignedInUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (productId: string) =>
      run((api, accessToken) => api.dismissReviewPrompt(accessToken, productId)),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.reviews.prompt(userId) }),
  });
}

/**
 * Sends a review. It is saved as waiting for the store to check it, so only the customer's
 * own review is refreshed: the public list cannot contain it yet.
 */
export function useSubmitReview(productId: string, options: { refresh?: boolean } = {}) {
  const refresh = options.refresh ?? true;
  const run = useAuthorizedApi();
  const userId = useSignedInUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ReviewSubmitRequest) =>
      run((api, accessToken) => api.submitProductReview(accessToken, productId, body)),
    onSuccess: async () => {
      if (!refresh) return;
      await queryClient.invalidateQueries({
        queryKey: queryKeys.reviews.mine(userId, productId),
      });
    },
  });
}

/**
 * Re-reads the customer's own review. The form calls this itself, once the photos have been
 * attempted, because the review replaces the form on screen as soon as it is re-read.
 */
export function useRefreshMyReview(productId: string) {
  const userId = useSignedInUserId();
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.reviews.mine(userId, productId) });
}

/**
 * Helpful / not helpful on one review.
 *
 * The same call carries all three actions: a verdict sets or replaces the caller's single vote,
 * and `null` takes it back. Who may vote — signed in, not the author, on a published review — is
 * decided by the server, so nothing here is a security boundary.
 */
export function useVoteReview(slug: string) {
  const run = useAuthorizedApi();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: { reviewId: string; verdict: ReviewVoteVerdict | null }) =>
      run((api, accessToken) =>
        api.voteProductReview(accessToken, input.reviewId, { verdict: input.verdict }),
      ),
    onSuccess: () =>
      // The counts are counted from the votes, so the page is re-read rather than patched.
      queryClient.invalidateQueries({ queryKey: queryKeys.catalog.reviews(slug) }),
  });
  return {
    vote: mutation.mutate,
    pending: mutation.isPending,
    error: mutation.error,
  };
}
