import Decimal from 'decimal.js';
import { D, addMonths, toKobo } from './money';

/**
 * Loan oracle — source of truth: "LOAN PRODUCT SPECIFICATIONS.docx".
 *
 *  Nano & Payday (§2.2, §3.2):  I = P × r × d    (r = daily rate, d = days selected),  A = P + I
 *    Payday early settlement: interest recalculated on active days used only.
 *  Personal Loan (§4.2) and Public Sector Loan (confirmed by Product: same two models),
 *  admin-configurable interest engine per product:
 *    Model A — "Monthly equal" (Fixed tenor, monthly FLAT rate): interest = P₀ × r every month (uniform).
 *    Model B — "Monthly reducing" (Fixed tenor, REDUCING balance): interest = Pₘ × r on the balance
 *              outstanding before that month's payment; decreases as principal is repaid.
 *    Both models repay equal principal P₀ / N each month.
 *  Early payoff in month k (§4.4), either model, no penalty:
 *    A_early = remaining outstanding principal (after month k−1) + month k's interest;
 *    interest for months k+1…N is waived.
 *
 *  Rounding: half-up to kobo per posted line (Clarity X3 default); the final month's principal
 *  absorbs any kobo remainder so the balance closes at exactly ₦0.00.
 */

export type InterestModel = 'A' | 'B';
export const MODEL_LABEL: Record<InterestModel, string> = { A: 'Monthly equal (flat rate)', B: 'Monthly reducing (reducing balance)' };

export type LoanProduct = 'NANO' | 'PAYDAY' | 'PERSONAL';

/** Product bounds (§1). All configurable on the admin portal — these are the documented defaults. */
export const LOAN_BOUNDS = {
  NANO: { minAmount: 5_000, maxAmount: 50_000, minDays: 1, maxDays: 30, minTier: 1 },
  PAYDAY: { minAmount: 0.01, maxAmount: 500_000, minDays: 7, maxDays: 30, minTier: 2 },
  // Personal min tier is NOT stated in LoanSpec (only "privately employed salary earners") — Tier 2 assumed, see @open:L-PERSONAL-TIER.
  PERSONAL: { minAmount: 0.01, maxAmount: 30_000_000, minMonths: 3, maxMonths: 24, minTier: 2 },
} as const;

export type BoundsCheck = { ok: true } | { ok: false; reason: 'AMOUNT_BELOW_MIN' | 'AMOUNT_ABOVE_MAX' | 'TENOR_BELOW_MIN' | 'TENOR_ABOVE_MAX' | 'TIER' };

export function checkBounds(product: LoanProduct, amount: Decimal.Value, tenor: number, tier: 1 | 2 | 3 = 3): BoundsCheck {
  const b = LOAN_BOUNDS[product];
  const a = D(amount);
  if (tier < b.minTier) return { ok: false, reason: 'TIER' };
  if (a.lt(b.minAmount)) return { ok: false, reason: 'AMOUNT_BELOW_MIN' };
  if (a.gt(b.maxAmount)) return { ok: false, reason: 'AMOUNT_ABOVE_MAX' };
  const [lo, hi] = 'minDays' in b ? [b.minDays, b.maxDays] : [b.minMonths, b.maxMonths];
  if (tenor < lo) return { ok: false, reason: 'TENOR_BELOW_MIN' };
  if (tenor > hi) return { ok: false, reason: 'TENOR_ABOVE_MAX' };
  return { ok: true };
}

/* ---------------------------------------------------------------- Nano & Payday ---- */

/** I = P × r × d, A = P + I (Nano §2.2, Payday §3.2). */
export function proratedInterest(principal: Decimal.Value, dailyRatePct: Decimal.Value, days: number): { interest: Decimal; totalRepayable: Decimal } {
  const interest = toKobo(D(principal).mul(dailyRatePct).div(100).mul(days));
  return { interest, totalRepayable: D(principal).plus(interest) };
}

/** Payday early settlement (§3.2): interest capped to the active days actually used. */
export function paydayEarlySettlement(principal: Decimal.Value, dailyRatePct: Decimal.Value, daysUsed: number, daysSelected: number) {
  const used = Math.max(1, Math.min(daysUsed, daysSelected));
  const settled = proratedInterest(principal, dailyRatePct, used);
  const scheduled = proratedInterest(principal, dailyRatePct, daysSelected);
  return { ...settled, interestSaved: scheduled.interest.minus(settled.interest) };
}

/** Payday: amount capped as a % of monthly salary (Payday app spec §4) and by the product max (§3.1). */
export function paydayCap(monthlySalary: Decimal.Value, capPct: number): Decimal {
  return Decimal.min(toKobo(D(monthlySalary).mul(capPct).div(100)), LOAN_BOUNDS.PAYDAY.maxAmount);
}

/* ---------------------------------------------------------------- Personal (Model A/B) ---- */

export interface ScheduleRow {
  n: number;
  dueDate: Date;
  principal: Decimal;
  interest: Decimal;
  totalDue: Decimal;
  balanceAfter: Decimal;
}

/** Monthly schedule for Model A (flat) or Model B (reducing). Rate is the MONTHLY rate in %. */
export function loanSchedule(principal: Decimal.Value, monthlyRatePct: Decimal.Value, months: number, model: InterestModel, firstDue: Date = new Date()): ScheduleRow[] {
  const P0 = D(principal);
  const r = D(monthlyRatePct).div(100);
  const basePrincipal = toKobo(P0.div(months));
  let balance = P0;
  const rows: ScheduleRow[] = [];
  for (let n = 1; n <= months; n++) {
    const interest = toKobo(model === 'A' ? P0.mul(r) : balance.mul(r));
    const principalPart = n === months ? balance : basePrincipal;
    balance = balance.minus(principalPart);
    rows.push({ n, dueDate: addMonths(firstDue, n - 1), principal: principalPart, interest, totalDue: principalPart.plus(interest), balanceAfter: balance });
  }
  return rows;
}

export function scheduleTotals(rows: ScheduleRow[]): { principal: Decimal; interest: Decimal; totalRepayable: Decimal } {
  const sum = (f: (r: ScheduleRow) => Decimal) => rows.reduce((s, r) => s.plus(f(r)), D(0));
  return { principal: sum((r) => r.principal), interest: sum((r) => r.interest), totalRepayable: sum((r) => r.totalDue) };
}

/** Highest monthly instalment (month 1 for both models) — what affordability/DTI must cover. */
export function firstInstalment(principal: Decimal.Value, monthlyRatePct: Decimal.Value, months: number, model: InterestModel): Decimal {
  return loanSchedule(principal, monthlyRatePct, months, model)[0].totalDue;
}

export interface EarlyPayoff {
  month: number;
  outstandingPrincipal: Decimal;
  activeMonthInterest: Decimal;
  payoff: Decimal;
  waivedInterest: Decimal;
}

/** Early payoff in month k (§4.4): remaining principal + month k interest; months k+1…N interest waived; no penalty. */
export function earlyPayoff(principal: Decimal.Value, monthlyRatePct: Decimal.Value, months: number, model: InterestModel, k: number): EarlyPayoff {
  if (k < 1 || k > months) throw new Error(`Payoff month ${k} outside tenor 1…${months}`);
  const rows = loanSchedule(principal, monthlyRatePct, months, model);
  const outstandingPrincipal = k === 1 ? D(principal) : rows[k - 2].balanceAfter;
  const activeMonthInterest = rows[k - 1].interest;
  const waivedInterest = rows.slice(k).reduce((s, r) => s.plus(r.interest), D(0));
  return { month: k, outstandingPrincipal, activeMonthInterest, payoff: outstandingPrincipal.plus(activeMonthInterest), waivedInterest };
}

/** Converts a quoted annual rate to the monthly rate the engine applies (rate ÷ 12). */
export const monthlyFromAnnual = (annualRatePct: Decimal.Value): Decimal => D(annualRatePct).div(12);

/* ---------------------------------------------------------------- Servicing & eligibility ---- */

/** Catch-up (Personal app spec §7): missed instalment(s) + late fees. */
export function catchUpAmount(missedInstalments: Decimal.Value[], lateFees: Decimal.Value = 0): Decimal {
  return toKobo(missedInstalments.reduce<Decimal>((s, m) => s.plus(m), D(0)).plus(lateFees));
}

/** Public Sector: tenor ≤ whole months remaining to retirement (Public Sector app spec §4 step 3). */
export function maxTenorByRetirement(today: Date, retirement: Date): number {
  let months = (retirement.getUTCFullYear() - today.getUTCFullYear()) * 12 + (retirement.getUTCMonth() - today.getUTCMonth());
  if (retirement.getUTCDate() < today.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

/**
 * Affordability: largest principal whose month-1 instalment (P/N + P×r for both models)
 * fits salaryBasis × DTI − existing deductions.
 */
export function maxAffordablePrincipal(salaryBasis: Decimal.Value, dtiPct: number, existingDeductions: Decimal.Value, monthlyRatePct: Decimal.Value, months: number): Decimal {
  const capacity = D(salaryBasis).mul(dtiPct).div(100).minus(existingDeductions);
  if (capacity.lte(0)) return D(0);
  const perNaira = D(1).div(months).plus(D(monthlyRatePct).div(100));
  return capacity.div(perNaira).toDecimalPlaces(2, Decimal.ROUND_DOWN);
}

export function dti(monthlyObligations: Decimal.Value, monthlyIncome: Decimal.Value): Decimal {
  return D(monthlyObligations).div(monthlyIncome).mul(100).toDecimalPlaces(2);
}

export type ReferralTier = 'LOW' | 'MEDIUM' | 'HIGH';

/** Payday referral routing — LOW auto-approves; MEDIUM → CRM; HIGH → Credit Manager. Thresholds config-driven. */
export function referralTier(amount: Decimal.Value, thresholds: { mediumFrom: number; highFrom: number }): ReferralTier {
  const a = D(amount);
  if (a.gte(thresholds.highFrom)) return 'HIGH';
  if (a.gte(thresholds.mediumFrom)) return 'MEDIUM';
  return 'LOW';
}

export type ApprovalBand = 'TEAM_LEAD' | 'CRM' | 'GM' | 'EXECUTIVE';

/** Personal / Public Sector amount-band routing (Admin PRD conventions): Team Lead → CRM → GM → Executive. */
export function approvalBand(amount: Decimal.Value, bandCeilings: [number, number, number]): ApprovalBand {
  const a = D(amount);
  if (a.lte(bandCeilings[0])) return 'TEAM_LEAD';
  if (a.lte(bandCeilings[1])) return 'CRM';
  if (a.lte(bandCeilings[2])) return 'GM';
  return 'EXECUTIVE';
}
