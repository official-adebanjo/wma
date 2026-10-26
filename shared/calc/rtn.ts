import Decimal from 'decimal.js';
import { D, DAYS_IN_YEAR, addDays, daysBetween, toKobo } from './money';
import { applyWht, InterestBreakdown } from './wht';

/**
 * RTN oracle.
 * Sources: RTN Customer App Spec; Calculator Spec §3.3; Clarity Questions T1–T17.
 *
 * Whole-amount rate looked up from the amount × tenor matrix, lower-inclusive bands (T1 default).
 * Tenor starts at activation (T3 default). WHT after any penalty (T6 default).
 */

export interface AmountBand {
  min: number;
  /** exclusive upper edge; undefined = open-ended */
  max?: number;
}

export interface RateMatrix {
  bands: AmountBand[];
  tenorsDays: number[];
  /** rates[bandIndex][tenorIndex] in % p.a. */
  rates: number[][];
}

export function lookupRate(matrix: RateMatrix, amount: Decimal.Value, tenorDays: number): number {
  const a = D(amount);
  const bandIdx = matrix.bands.findIndex((b) => a.gte(b.min) && (b.max === undefined || a.lt(b.max)));
  if (bandIdx < 0) throw new Error(`Amount ${a} falls outside the rate matrix`);
  const tenorIdx = matrix.tenorsDays.indexOf(tenorDays);
  if (tenorIdx < 0) throw new Error(`Tenor ${tenorDays} not offered`);
  return matrix.rates[bandIdx][tenorIdx];
}

export function interest(amount: Decimal.Value, ratePct: Decimal.Value, tenorDays: number): InterestBreakdown {
  return applyWht(D(amount).mul(ratePct).div(100).mul(tenorDays).div(DAYS_IN_YEAR));
}

export type InterestTiming = 'UPFRONT' | 'AT_MATURITY';

export interface BookingProjection extends InterestBreakdown {
  /** Paid to wallet at booking (upfront timing only). */
  paidAtBooking: Decimal;
  /** Paid to destination at maturity. */
  paidAtMaturity: Decimal;
  maturityDate: Date;
}

export function bookingProjection(amount: Decimal.Value, ratePct: Decimal.Value, tenorDays: number, timing: InterestTiming, activatedOn: Date): BookingProjection {
  const i = interest(amount, ratePct, tenorDays);
  return {
    ...i,
    paidAtBooking: timing === 'UPFRONT' ? i.net : D(0),
    paidAtMaturity: timing === 'UPFRONT' ? D(amount) : D(amount).plus(i.net),
    maturityDate: addDays(activatedOn, tenorDays),
  };
}

export type PenaltyBasis = 'PCT_ACCRUED_INTEREST' | 'PCT_PRINCIPAL' | 'FLAT';

export interface PenaltyBand {
  /** % of tenor elapsed, lower-inclusive */
  fromPctElapsed: number;
  toPctElapsed: number;
  basis: PenaltyBasis;
  value: number;
}

export function accruedInterest(amount: Decimal.Value, ratePct: Decimal.Value, activatedOn: Date, asOf: Date, tenorDays: number): Decimal {
  const days = Math.min(Math.max(daysBetween(activatedOn, asOf), 0), tenorDays);
  return toKobo(D(amount).mul(ratePct).div(100).mul(days).div(DAYS_IN_YEAR));
}

export function penaltyFor(ladder: PenaltyBand[], amount: Decimal.Value, accrued: Decimal.Value, pctElapsed: number): Decimal {
  const band = ladder.find((b) => pctElapsed >= b.fromPctElapsed && pctElapsed < b.toPctElapsed) ?? ladder[ladder.length - 1];
  switch (band.basis) {
    case 'PCT_ACCRUED_INTEREST':
      return toKobo(D(accrued).mul(band.value).div(100));
    case 'PCT_PRINCIPAL':
      return toKobo(D(amount).mul(band.value).div(100));
    case 'FLAT':
      return toKobo(band.value);
  }
}

export interface LiquidationSummary {
  principal: Decimal;
  accruedInterest: Decimal;
  penalty: Decimal;
  wht: Decimal;
  /** Unearned upfront interest clawed back (T4 — still open; default: recover from principal). */
  upfrontRecovery: Decimal;
  netToWallet: Decimal;
}

/**
 * Force-liquidate Screen 2: amount + accrued interest − penalty − WHT = net (spec §7).
 * Interest penalty first, WHT on the interest that remains (T6 default).
 * For UPFRONT placements the unearned interest already paid is recovered (T4 default — BLOCKER, unconfirmed).
 */
export function forceLiquidation(args: {
  amount: Decimal.Value; ratePct: Decimal.Value; tenorDays: number; activatedOn: Date; asOf: Date;
  timing: InterestTiming; ladder: PenaltyBand[];
}): LiquidationSummary {
  const elapsedDays = Math.min(Math.max(daysBetween(args.activatedOn, args.asOf), 0), args.tenorDays);
  const pctElapsed = (elapsedDays / args.tenorDays) * 100;
  const accrued = accruedInterest(args.amount, args.ratePct, args.activatedOn, args.asOf, args.tenorDays);
  const penalty = penaltyFor(args.ladder, args.amount, accrued, pctElapsed);

  if (args.timing === 'UPFRONT') {
    const paidNet = interest(args.amount, args.ratePct, args.tenorDays).net;
    const earnedNet = applyWht(Decimal.max(0, accrued.minus(penalty))).net;
    const upfrontRecovery = toKobo(paidNet.minus(earnedNet));
    return {
      principal: D(args.amount), accruedInterest: accrued, penalty, wht: D(0), upfrontRecovery,
      netToWallet: D(args.amount).minus(upfrontRecovery),
    };
  }
  const interestAfterPenalty = Decimal.max(0, accrued.minus(penalty));
  const { wht, net } = applyWht(interestAfterPenalty);
  // If the penalty exceeds accrued interest (principal/flat bases) the excess comes off principal.
  const principalHit = Decimal.max(0, penalty.minus(accrued));
  return {
    principal: D(args.amount), accruedInterest: accrued, penalty, wht, upfrontRecovery: D(0),
    netToWallet: D(args.amount).minus(principalHit).plus(net),
  };
}

export type BankTransferOutcome =
  | { state: 'ACTIVE'; excessToWallet: Decimal }
  | { state: 'UNDERFUNDED'; received: Decimal; shortfall: Decimal }
  | { state: 'CANCELLED'; refundToWallet: Decimal };

/** Underfunded bank-transfer handling — RTN spec §9 edge cases. */
export function bankTransferOutcome(required: Decimal.Value, received: Decimal.Value, arrivedWithinWindow: boolean): BankTransferOutcome {
  const req = D(required);
  const got = D(received);
  if (!arrivedWithinWindow) return { state: 'CANCELLED', refundToWallet: got };
  if (got.lt(req)) return { state: 'UNDERFUNDED', received: got, shortfall: req.minus(got) };
  return { state: 'ACTIVE', excessToWallet: got.minus(req) };
}

/** T10 default: rollover carries principal + net interest; pays out if the new amount is invalid. */
export function rolloverAmount(amount: Decimal.Value, ratePct: Decimal.Value, tenorDays: number, timing: InterestTiming): Decimal {
  return timing === 'UPFRONT' ? D(amount) : D(amount).plus(interest(amount, ratePct, tenorDays).net);
}
