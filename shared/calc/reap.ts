import Decimal from 'decimal.js';
import { D, DAYS_IN_YEAR, addDays, addMonths, daysBetween, toKobo } from './money';
import { applyWht } from './wht';

/**
 * REAP oracle.
 * Sources: REAP Customer App Spec; Calculator Spec §3.1; Clarity Questions E1–E14.
 *
 * Daily accrual on running balance (Calculator Spec §3.1):
 *   Daily interest = running balance × annual rate / 365
 * Simple to maturity (E1 default). Contributions start earning the day after funding (X2 default).
 * Target met = contributions only, tested at maturity (E3 default).
 * Break or missed target = principal only, 100% interest forfeited (E6 default). Principal never reduced.
 */

export type Frequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'ON_DEMAND';

export interface Contribution {
  amount: Decimal.Value;
  on: Date;
}

export function accruedInterest(contributions: Contribution[], ratePct: Decimal.Value, asOf: Date): Decimal {
  const rate = D(ratePct).div(100);
  let total = D(0);
  for (const c of contributions) {
    const days = Math.max(0, daysBetween(c.on, asOf) - 1); // earns from the day after funding
    total = total.plus(D(c.amount).mul(rate).mul(days).div(DAYS_IN_YEAR));
  }
  return toKobo(total);
}

export function principal(contributions: Contribution[]): Decimal {
  return contributions.reduce((s, c) => s.plus(c.amount), D(0));
}

export function maturityDate(start: Date, tenorMonths: number): Date {
  return addMonths(start, tenorMonths);
}

export function scheduleDates(start: Date, maturity: Date, frequency: Frequency): Date[] {
  if (frequency === 'ON_DEMAND') return [];
  const dates: Date[] = [];
  let i = 0;
  for (;;) {
    const d =
      frequency === 'DAILY' ? addDays(start, i) : frequency === 'WEEKLY' ? addDays(start, i * 7) : addMonths(start, i);
    if (d >= maturity) break;
    dates.push(d);
    i += 1;
  }
  return dates;
}

/** Projected principal at maturity if every scheduled contribution lands. */
export function projectedPrincipal(start: Date, tenorMonths: number, frequency: Frequency, amount: Decimal.Value, opening: Decimal.Value = 0): Decimal {
  const n = scheduleDates(start, maturityDate(start, tenorMonths), frequency).length;
  return D(opening).plus(D(amount).mul(n));
}

/** "Projected interest earned (if target met)" on the review screen. */
export function projectedInterest(start: Date, tenorMonths: number, frequency: Frequency, amount: Decimal.Value, ratePct: Decimal.Value): Decimal {
  const maturity = maturityDate(start, tenorMonths);
  const contributions = scheduleDates(start, maturity, frequency).map((on) => ({ amount, on }));
  return accruedInterest(contributions, ratePct, maturity);
}

export interface MaturityOutcome {
  targetMet: boolean;
  principal: Decimal;
  grossInterest: Decimal;
  wht: Decimal;
  netInterest: Decimal;
  forfeitedInterest: Decimal;
  payout: Decimal;
}

export function maturityOutcome(contributions: Contribution[], target: Decimal.Value, ratePct: Decimal.Value, maturity: Date): MaturityOutcome {
  const p = principal(contributions);
  const accrued = accruedInterest(contributions, ratePct, maturity);
  const targetMet = p.gte(target);
  if (!targetMet) {
    return { targetMet, principal: p, grossInterest: D(0), wht: D(0), netInterest: D(0), forfeitedInterest: accrued, payout: p };
  }
  const { gross, wht, net } = applyWht(accrued);
  return { targetMet, principal: p, grossInterest: gross, wht, netInterest: net, forfeitedInterest: D(0), payout: p.plus(net) };
}

/** Break request (admin-approved): principal returned, all accrued interest forfeited. */
export function breakOutcome(contributions: Contribution[], ratePct: Decimal.Value, requestDate: Date): { principalReturned: Decimal; interestForfeited: Decimal } {
  return { principalReturned: principal(contributions), interestForfeited: accruedInterest(contributions, ratePct, requestDate) };
}

export type PaceStatus = 'ON_TRACK' | 'AHEAD' | 'BEHIND';

/**
 * E5 default: tolerance of one scheduled contribution; straight-line pace for On-demand;
 * interest ignored. Expected balance is linear over the tenor.
 */
export function paceStatus(args: {
  start: Date; maturity: Date; asOf: Date; target: Decimal.Value; balance: Decimal.Value; contributionAmount?: Decimal.Value;
}): PaceStatus {
  const total = daysBetween(args.start, args.maturity);
  const elapsed = Math.min(Math.max(daysBetween(args.start, args.asOf), 0), total);
  const expected = D(args.target).mul(elapsed).div(total);
  const tolerance = D(args.contributionAmount ?? 0);
  const diff = D(args.balance).minus(expected);
  if (diff.gt(tolerance)) return 'AHEAD';
  if (diff.lt(tolerance.neg())) return 'BEHIND';
  return 'ON_TRACK';
}

/** Months needed to reach the target at a frequency/amount — the booking pace preview. */
export function periodsToTarget(target: Decimal.Value, amount: Decimal.Value, opening: Decimal.Value = 0): number {
  const remaining = D(target).minus(opening);
  if (remaining.lte(0)) return 0;
  return remaining.div(amount).ceil().toNumber();
}

export function progressPct(balance: Decimal.Value, target: Decimal.Value): Decimal {
  return D(balance).div(target).mul(100).toDecimalPlaces(0, Decimal.ROUND_DOWN);
}
