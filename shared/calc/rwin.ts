import Decimal from 'decimal.js';
import { D, DAYS_IN_YEAR, addDays, daysBetween, toKobo } from './money';
import { applyWht, InterestBreakdown } from './wht';
import { productConfig } from '../config/env';

/**
 * RWIN 2.0 oracle.
 * Sources: RWIN 2.0 Customer App Spec; Calculator Spec §3.2; Clarity Questions W1–W10.
 *
 * Simple interest within a cycle (W1 default, Calculator Spec §3.2):
 *   Gross = Principal × rate × days / 365
 * Each top-up / autosave is its own tranche at the rate in force when it lands,
 * running a full 90-day cycle from funding (W9 default).
 */
const cfg = productConfig.rwin;

export interface Tranche {
  id?: string;
  principal: Decimal.Value;
  ratePct: Decimal.Value;
  fundedOn: Date;
}

export function cycleInterest(principal: Decimal.Value, ratePct: Decimal.Value, days = cfg.cycleDays): InterestBreakdown {
  const gross = D(principal).mul(ratePct).div(100).mul(days).div(DAYS_IN_YEAR);
  return applyWht(gross);
}

/** "You'll earn ₦X over your 90-day cycle" — the live projection on booking step 2 (gross). */
export function projectedCycleEarnings(principal: Decimal.Value, ratePct: Decimal.Value): Decimal {
  return cycleInterest(principal, ratePct).gross;
}

export function accruedInterest(tranche: Tranche, asOf: Date): Decimal {
  const days = Math.max(0, Math.min(daysBetween(tranche.fundedOn, asOf), cfg.cycleDays));
  return toKobo(D(tranche.principal).mul(tranche.ratePct).div(100).mul(days).div(DAYS_IN_YEAR));
}

export function cycleEndDate(tranche: Pick<Tranche, 'fundedOn'>): Date {
  return addDays(tranche.fundedOn, cfg.cycleDays);
}

/** W10 default: day 30 is the first withdrawable day. Absolute rule — no admin bypass. */
export function withdrawableFrom(tranche: Pick<Tranche, 'fundedOn'>): Date {
  return addDays(tranche.fundedOn, cfg.minHoldingDays);
}

export function isWithdrawable(tranche: Pick<Tranche, 'fundedOn'>, asOf: Date): boolean {
  return daysBetween(tranche.fundedOn, asOf) >= cfg.minHoldingDays;
}

export function planBalance(tranches: Tranche[]): Decimal {
  return tranches.reduce((sum, t) => sum.plus(t.principal), D(0));
}

/** W7 default: oldest-first, only tranches past day 30. */
export function withdrawableAmount(tranches: Tranche[], asOf: Date): Decimal {
  return tranches.filter((t) => isWithdrawable(t, asOf)).reduce((s, t) => s.plus(t.principal), D(0));
}

export type WithdrawalValidation =
  | { ok: true }
  | { ok: false; reason: 'MIN_HOLDING' | 'BELOW_MIN_RETAINED' | 'EXCEEDS_WITHDRAWABLE' };

/**
 * Partial withdrawals must leave ≥ ₦50k (principal only — W8 default) in the plan.
 * A full withdrawal of everything withdrawable is always allowed.
 */
export function validateWithdrawal(tranches: Tranche[], amount: Decimal.Value, asOf: Date): WithdrawalValidation {
  const amt = D(amount);
  const available = withdrawableAmount(tranches, asOf);
  if (available.isZero()) return { ok: false, reason: 'MIN_HOLDING' };
  if (amt.gt(available)) return { ok: false, reason: 'EXCEEDS_WITHDRAWABLE' };
  const remaining = planBalance(tranches).minus(amt);
  if (!remaining.isZero() && remaining.lt(cfg.minRetained)) return { ok: false, reason: 'BELOW_MIN_RETAINED' };
  return { ok: true };
}

export type TopUpValidation = { ok: true } | { ok: false; reason: 'BELOW_MIN' | 'EXCEEDS_CAP' };

/** W4 default: cap is per customer across all RWIN plans. */
export function validateDeposit(existingRwinTotal: Decimal.Value, amount: Decimal.Value, minAmount = cfg.minDeposit): TopUpValidation {
  if (D(amount).lt(minAmount)) return { ok: false, reason: 'BELOW_MIN' };
  if (D(existingRwinTotal).plus(amount).gt(cfg.planCap)) return { ok: false, reason: 'EXCEEDS_CAP' };
  return { ok: true };
}

export function maxInitialDeposit(existingRwinTotal: Decimal.Value): Decimal {
  return Decimal.max(0, D(cfg.planCap).minus(existingRwinTotal));
}

export function isApproachingCap(total: Decimal.Value): boolean {
  return D(total).gte(D(cfg.planCap).mul(cfg.capWarningPct).div(100));
}

/** Bullet maturity with auto-rollover OFF: principal + net interest to wallet. */
export function maturityPayout(principal: Decimal.Value, ratePct: Decimal.Value): Decimal {
  return D(principal).plus(cycleInterest(principal, ratePct).net);
}

/** Auto-rollover ON: principal + net interest rolls into a new tranche at the then-current rate. */
export function rolloverPrincipal(principal: Decimal.Value, ratePct: Decimal.Value): Decimal {
  return maturityPayout(principal, ratePct);
}

/** W5 default: partial roll up to the cap, remainder to wallet. */
export function rolloverSplit(rollingAmount: Decimal.Value, otherRwinTotal: Decimal.Value): { rolls: Decimal; toWallet: Decimal } {
  const headroom = Decimal.max(0, D(cfg.planCap).minus(otherRwinTotal));
  const rolls = Decimal.min(rollingAmount, headroom);
  return { rolls, toWallet: D(rollingAmount).minus(rolls) };
}
