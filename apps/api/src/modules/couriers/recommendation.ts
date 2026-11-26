import type { CourierQuoteKind, CourierRecommendation } from '@nilzora/contracts';

/*
 * Which courier to suggest for one parcel. Deterministic: the same quotes, history and
 * settings always give the same answer. It only suggests; it never books.
 *
 *  - Only couriers that can take the parcel are eligible (the caller decides that from the
 *    mode, whether the courier is enabled, and whether a price is available).
 *  - Cost: delivery charge plus COD fee. The cheapest scores 1, others cheapest / theirs.
 *  - Delivery history counts only for a courier with at least `minHistorySample` settled
 *    parcels, so two early failures cannot rule a courier out. A courier without enough
 *    history is given the average rate of those that have it (neutral); with no history
 *    anywhere, cost alone decides.
 *  - Score = 0.6 × cost + 0.4 × delivery rate (or cost alone), rounded to 4 decimals.
 *  - A tie goes to the preferred courier, then to the alphabetically first id.
 */

const COST_WEIGHT = 0.6;
const RATE_WEIGHT = 0.4;

export interface RecommendationCandidate {
  provider: string;
  displayName: string;
  /** Whether this courier can take the parcel at all. */
  eligible: boolean;
  quoteKind: CourierQuoteKind;
  deliveryChargeMinor: number | null;
  codFeeMinor: number | null;
  /** Why the courier is not eligible, or other facts worth saying (in plain English). */
  notes: string[];
}

export interface ProviderHistory {
  provider: string;
  settled: number;
  delivered: number;
  failed: number;
}

export interface RecommendationSettings {
  minHistorySample: number;
  preferredProvider: string | null;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function percent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export function recommendCourier(
  candidates: readonly RecommendationCandidate[],
  history: readonly ProviderHistory[],
  settings: RecommendationSettings,
): CourierRecommendation {
  const byProvider = new Map(history.map((row) => [row.provider, row]));
  const rows = [...candidates]
    .sort((a, b) => a.provider.localeCompare(b.provider))
    .map((candidate) => {
      const stats = byProvider.get(candidate.provider);
      const sample = stats?.settled ?? 0;
      const rate =
        stats && sample >= settings.minHistorySample && sample > 0
          ? stats.delivered / sample
          : null;
      const eligible = candidate.eligible && candidate.deliveryChargeMinor !== null;
      const totalCost = eligible
        ? (candidate.deliveryChargeMinor ?? 0) + (candidate.codFeeMinor ?? 0)
        : null;
      const notes = [...candidate.notes];
      if (eligible && candidate.codFeeMinor === null) {
        notes.push('COD fee unknown: set the courier’s COD fee to include it');
      }
      if (rate === null) {
        notes.push(
          sample === 0
            ? 'No settled deliveries yet'
            : `Only ${sample} settled deliveries (history counts from ${settings.minHistorySample})`,
        );
      }
      return { candidate, eligible, totalCost, rate, sample, notes };
    });

  const eligible = rows.filter((row) => row.eligible && row.totalCost !== null);
  const known = eligible.filter((row) => row.rate !== null).map((row) => row.rate ?? 0);
  const neutralRate = known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : null;
  const minCost = eligible.length > 0 ? Math.min(...eligible.map((row) => row.totalCost ?? 0)) : 0;

  const scored = rows.map((row) => {
    if (!row.eligible || row.totalCost === null) return { ...row, score: null as number | null };
    const costScore = row.totalCost === 0 ? 1 : minCost / row.totalCost;
    const score =
      neutralRate === null
        ? costScore
        : COST_WEIGHT * costScore + RATE_WEIGHT * (row.rate ?? neutralRate);
    return { ...row, score: round4(score) };
  });

  const ranked = scored
    .filter((row): row is typeof row & { score: number } => row.score !== null)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aPreferred = a.candidate.provider === settings.preferredProvider ? 0 : 1;
      const bPreferred = b.candidate.provider === settings.preferredProvider ? 0 : 1;
      if (aPreferred !== bPreferred) return aPreferred - bPreferred;
      return a.candidate.provider.localeCompare(b.candidate.provider);
    });

  const best = ranked[0];
  const reasons: string[] = [];
  if (best) {
    const name = best.candidate.displayName;
    const others = ranked.slice(1);
    if (others.length === 0) {
      reasons.push(`${name} is the only courier that can take this parcel`);
    } else {
      const cheapest = others.every((row) => (best.totalCost ?? 0) <= (row.totalCost ?? 0));
      if (cheapest) {
        reasons.push(
          best.candidate.quoteKind === 'internal_estimate'
            ? `${name} has the lowest expected cost (internal estimate: delivery plus COD fee)`
            : `${name} has the lowest expected cost (delivery plus COD fee)`,
        );
      }
      const bestRate = best.rate;
      if (bestRate !== null && others.every((row) => row.rate === null || bestRate >= row.rate)) {
        reasons.push(
          `${name} has the best delivery rate (${percent(bestRate)} of ${best.sample} settled parcels)`,
        );
      }
      const tied = others.some((row) => row.score === best.score);
      if (tied) {
        reasons.push(
          best.candidate.provider === settings.preferredProvider
            ? `${name} is the preferred courier, which breaks the tie`
            : `Equal scores: ${name} was chosen by name order`,
        );
      }
      if (!cheapest && !tied) {
        reasons.push(`${name} has the best balance of cost and delivery history`);
      }
    }
    if (best.candidate.quoteKind === 'internal_estimate') {
      reasons.push('Prices are internal estimates from the rate card, not live courier quotes');
    }
  }

  return {
    provider: best?.candidate.provider ?? null,
    reasons,
    candidates: scored.map((row) => ({
      provider: row.candidate.provider,
      eligible: row.eligible,
      score: row.score,
      totalCostMinor: row.totalCost,
      deliveryRate: row.rate === null ? null : round4(row.rate),
      historySample: row.sample,
      notes: row.notes,
    })),
  };
}
