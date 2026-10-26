import Decimal from 'decimal.js';
import { D, addMonths, toKobo } from './money';

/**
 * Loan oracle (Nano, Payday, Personal, Public Sector).
 * Sources: the four loan Customer App Specs. Rates/fees are config-driven and confirmed
 * only in the offer, so these functions take the confirmed terms as inputs.
 *
 * ASSUMPTION (to confirm with Finance — QA Strategy §23 Gate 1 requires external validation
 * of the real engine regardless): multi-instalment loans amortise on a reducing balance with
 * equal monthly instalments (annuity); single-repayment loans (Nano, Payday) charge flat
 * interest for the term.
 */

export function flatInterest(principal: Decimal.Value, termRatePct: Decimal.Value): { interest: Decimal; totalRepayment: Decimal } {
  const interest = toKobo(D(principal).mul(termRatePct).div(100));
  return { interest, totalRepayment: D(principal).plus(interest) };
}

/** Payday: amount capped at a % of monthly salary (spec §4 step 2, e.g. 50%). */
export function paydayCap(monthlySalary: Decimal.Value, capPct: number): Decimal {
  return toKobo(D(monthlySalary).mul(capPct).div(100));
}

export function monthlyInstalment(principal: Decimal.Value, annualRatePct: Decimal.Value, months: number): Decimal {
  const r = D(annualRatePct).div(100).div(12);
  if (r.isZero()) return toKobo(D(principal).div(months));
  const factor = r.plus(1).pow(-months);
  return toKobo(D(principal).mul(r).div(D(1).minus(factor)));
}

export interface ScheduleRow {
  n: number;
  dueDate: Date;
  instalment: Decimal;
  interest: Decimal;
  principal: Decimal;
  balanceAfter: Decimal;
}

export function amortisationSchedule(principal: Decimal.Value, annualRatePct: Decimal.Value, months: number, firstDue: Date): ScheduleRow[] {
  const r = D(annualRatePct).div(100).div(12);
  const pmt = monthlyInstalment(principal, annualRatePct, months);
  let balance = D(principal);
  const rows: ScheduleRow[] = [];
  for (let n = 1; n <= months; n++) {
    const interest = toKobo(balance.mul(r));
    // Final instalment absorbs rounding so the balance closes at exactly zero.
    const principalPart = n === months ? balance : pmt.minus(interest);
    const instalment = n === months ? principalPart.plus(interest) : pmt;
    balance = balance.minus(principalPart);
    rows.push({ n, dueDate: addMonths(firstDue, n - 1), instalment, interest, principal: principalPart, balanceAfter: balance });
  }
  return rows;
}

/** Early settlement (Personal §7 / Public Sector §7): outstanding principal + accrued interest + fee. */
export function earlySettlementAmount(outstandingPrincipal: Decimal.Value, accruedInterest: Decimal.Value, feePct = 0, flatFee = 0): Decimal {
  const fee = toKobo(D(outstandingPrincipal).mul(feePct).div(100).plus(flatFee));
  return toKobo(D(outstandingPrincipal).plus(accruedInterest).plus(fee));
}

/** Catch-up (Personal §7): missed instalment(s) + late fees. */
export function catchUpAmount(missedInstalments: Decimal.Value[], lateFees: Decimal.Value = 0): Decimal {
  return toKobo(missedInstalments.reduce<Decimal>((s, m) => s.plus(m), D(0)).plus(lateFees));
}

/** Public Sector: tenor ≤ whole months remaining to retirement (spec §4 step 3). */
export function maxTenorByRetirement(today: Date, retirement: Date): number {
  let months = (retirement.getUTCFullYear() - today.getUTCFullYear()) * 12 + (retirement.getUTCMonth() - today.getUTCMonth());
  if (retirement.getUTCDate() < today.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

/**
 * Public Sector / Personal affordability: the largest principal whose instalment fits within
 * salaryBasis × DTI − existing deductions (corridor rules).
 */
export function maxAffordablePrincipal(salaryBasis: Decimal.Value, dtiPct: number, existingDeductions: Decimal.Value, annualRatePct: Decimal.Value, months: number): Decimal {
  const capacity = D(salaryBasis).mul(dtiPct).div(100).minus(existingDeductions);
  if (capacity.lte(0)) return D(0);
  const r = D(annualRatePct).div(100).div(12);
  if (r.isZero()) return toKobo(capacity.mul(months));
  return D(capacity).mul(D(1).minus(r.plus(1).pow(-months))).div(r).toDecimalPlaces(2, Decimal.ROUND_DOWN);
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
