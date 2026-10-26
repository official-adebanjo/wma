import { request, APIRequestContext } from 'playwright-core';
import Decimal from 'decimal.js';
import { D, addDays, addMonths, toKobo } from '../../shared/calc/money';
import { applyWht } from '../../shared/calc/wht';
import * as reap from '../../shared/calc/reap';
import type { PenaltyBand, RateMatrix } from '../../shared/calc/rtn';
import { env, required } from '../../shared/config/env';

/**
 * Fixtures shared by the REAP / RTN / Grow-home mobile specs.
 * Kept here (not in shared/) so the specs own their seed data; values are seeded into the
 * backend via QA hooks so the oracle and the app agree on the configuration in force.
 */

// ── Dates ────────────────────────────────────────────────────────────────────────────────
export function today(): Date {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
export const daysAgo = (n: number): Date => addDays(today(), -n);
export const daysFromNow = (n: number): Date => addDays(today(), n);
export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

// ── REAP ─────────────────────────────────────────────────────────────────────────────────
/**
 * One rate per tenor, locked at creation (Clarity E2 default). The Calculator Spec §3.1 says the
 * rate varies by target-balance range instead — specs that read the rate are tagged @open:E2.
 */
export const REAP_RATES: Record<number, number> = { 3: 10, 6: 12, 12: 15, 24: 18 };

export interface SeededReapPlan {
  start: Date;
  tenorMonths: number;
  target: number;
  frequency: reap.Frequency;
  contributionAmount: number;
  contributions: reap.Contribution[];
}

/** Builds a REAP plan whose schedule started `startedDaysAgo` days ago and whose every scheduled contribution so far has landed. */
export function reapPlanOnSchedule(o: {
  startedDaysAgo: number; tenorMonths: number; target: number; frequency: Exclude<reap.Frequency, 'ON_DEMAND'>; contributionAmount: number;
}): SeededReapPlan {
  const start = daysAgo(o.startedDaysAgo);
  const maturity = reap.maturityDate(start, o.tenorMonths);
  const contributions = reap
    .scheduleDates(start, maturity, o.frequency)
    .filter((d) => d <= today())
    .map((on) => ({ amount: o.contributionAmount, on }));
  return { start, tenorMonths: o.tenorMonths, target: o.target, frequency: o.frequency, contributionAmount: o.contributionAmount, contributions };
}

/** Start date such that a plan of `tenorMonths` matures exactly `daysToMaturity` days from today. */
export function startForMaturityIn(daysToMaturity: number, tenorMonths: number): Date {
  return addMonths(daysFromNow(daysToMaturity), -tenorMonths);
}

/** Serialises a REAP plan into the `extra` payload of hooks.seedInvestment (contract: docs/TEST-HOOKS.md). */
export function reapSeedExtra(p: SeededReapPlan, more: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    startedOn: isoDate(p.start),
    tenorMonths: p.tenorMonths,
    target: p.target,
    frequency: p.frequency,
    contributionAmount: p.contributionAmount,
    contributions: p.contributions.map((c) => ({ amount: D(c.amount).toNumber(), on: isoDate(c.on) })),
    ...more,
  };
}

/**
 * Projected total on a booking Step 3 tenor card ("projected total at maturity if target is met").
 * The spec does not say which contribution rhythm the card assumes (frequency is picked at Step 4).
 * Assumption (@open:E5 / @open:X4): target reached by equal MONTHLY contributions starting today,
 * card shows target + interest NET of WHT (X4 default: net is the primary figure).
 */
export function reapTenorCardProjectedTotal(target: Decimal.Value, tenorMonths: number, ratePct: number, start = today()): Decimal {
  const monthly = D(target).div(tenorMonths);
  const gross = reap.projectedInterest(start, tenorMonths, 'MONTHLY', monthly, ratePct);
  return toKobo(D(target).plus(applyWht(gross).net));
}

/**
 * Projected short-fall shown on Adjust plan (REAP §10): target − (balance + amount × remaining
 * scheduled contributions from today to maturity). Interest ignored in pace (E5 default).
 */
export function reapProjectedShortfall(o: { balance: Decimal.Value; target: Decimal.Value; maturity: Date; frequency: reap.Frequency; amount: Decimal.Value }): Decimal {
  const remaining = reap.scheduleDates(today(), o.maturity, o.frequency).length;
  return Decimal.max(0, D(o.target).minus(D(o.balance).plus(D(o.amount).mul(remaining))));
}

// ── RTN ──────────────────────────────────────────────────────────────────────────────────
/** Known rate matrix seeded via hooks.setProductConfig so lookupRate and the app agree (T1 default bands). */
export const RTN_MATRIX: RateMatrix = {
  bands: [
    { min: 1_000_000, max: 5_000_000 },
    { min: 5_000_000, max: 10_000_000 },
    { min: 10_000_000, max: 50_000_000 },
    { min: 50_000_000 },
  ],
  tenorsDays: [30, 60, 90, 120, 180, 365],
  rates: [
    [10, 11, 12, 13, 14, 16],
    [10.5, 11.5, 12.5, 13.5, 14.5, 16.5],
    [11, 12, 13, 14, 15, 17],
    [12, 13, 14, 15, 16, 18],
  ],
};

/** A second matrix used to simulate a rate change (every cell +1%). */
export const RTN_MATRIX_BUMPED: RateMatrix = { ...RTN_MATRIX, rates: RTN_MATRIX.rates.map((row) => row.map((r) => r + 1)) };

/** Linked penalty ladder fixed at booking (T5 default). Last band closes at 100.01 so day == tenor is covered. */
export const RTN_LADDER: PenaltyBand[] = [
  { fromPctElapsed: 0, toPctElapsed: 25, basis: 'PCT_ACCRUED_INTEREST', value: 50 },
  { fromPctElapsed: 25, toPctElapsed: 50, basis: 'PCT_ACCRUED_INTEREST', value: 40 },
  { fromPctElapsed: 50, toPctElapsed: 75, basis: 'PCT_ACCRUED_INTEREST', value: 30 },
  { fromPctElapsed: 75, toPctElapsed: 100.01, basis: 'PCT_ACCRUED_INTEREST', value: 20 },
];

export const rtnConfigPatch = (matrix: RateMatrix = RTN_MATRIX, more: Record<string, unknown> = {}) => ({
  rateMatrix: matrix,
  penaltyLadder: RTN_LADDER,
  ...more,
});

/** Mobile/test-ID friendly band index for an amount (lower-inclusive, T1 default). */
export function bandIndex(matrix: RateMatrix, amount: Decimal.Value): number {
  const a = D(amount);
  return matrix.bands.findIndex((b) => a.gte(b.min) && (b.max === undefined || a.lt(b.max)));
}

// ── QA admin hooks (break-request decisions, corporate docs, linked banks) ───────────────
/**
 * Extra QA-only endpoints the REAP/RTN mobile specs need beyond shared/api/qa-hooks.ts.
 * These endpoints are ASSUMED and must be added to docs/TEST-HOOKS.md by the backend team:
 *   POST /admin/reap/break-request/decide   { investmentId, decision: APPROVE|DECLINE, reason? }
 *   POST /seed/corporate-docs                { customerId, status: VERIFIED|PENDING|NONE }
 *   POST /seed/linked-bank-account           { customerId, bankName, accountNumber }
 */
export class QaAdminHooks {
  private constructor(private readonly ctx: APIRequestContext) {}

  static async create(): Promise<QaAdminHooks> {
    const ctx = await request.newContext({
      baseURL: env.qaHooksBaseUrl || required('QA_HOOKS_BASE_URL'),
      extraHTTPHeaders: { 'X-QA-Token': required('QA_HOOKS_TOKEN'), Accept: 'application/json' },
    });
    return new QaAdminHooks(ctx);
  }

  private async call<T>(path: string, data: unknown): Promise<T> {
    const res = await this.ctx.post(path, { data });
    if (!res.ok()) throw new Error(`QA hook ${path} failed: ${res.status()} ${await res.text()}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  decideReapBreak(investmentId: string, decision: 'APPROVE' | 'DECLINE', reason?: string) {
    return this.call<void>('/admin/reap/break-request/decide', { investmentId, decision, reason });
  }

  setCorporateDocs(customerId: string, status: 'VERIFIED' | 'PENDING' | 'NONE') {
    return this.call<void>('/seed/corporate-docs', { customerId, status });
  }

  linkBankAccount(customerId: string, bankName = 'Test Bank', accountNumber = '0123456789') {
    return this.call<void>('/seed/linked-bank-account', { customerId, bankName, accountNumber });
  }

  async dispose(): Promise<void> {
    await this.ctx.dispose();
  }
}

/** Matches a REAP pace status to the on-plan copy (REAP §5). */
export const paceCopy: Record<reap.PaceStatus, RegExp> = {
  ON_TRACK: /on track/i,
  AHEAD: /ahead of schedule/i,
  BEHIND: /behind schedule/i,
};

/** Escapes dynamic values (plan names, ₦ amounts) for use inside copy-assertion regexes. */
export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
