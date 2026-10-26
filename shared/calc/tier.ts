import Decimal from 'decimal.js';
import { D } from './money';
import { Tier, tierLimits } from '../config/env';

/** Transfer-limit checks — Account Tiering & KYC Spec V4 §1. */
export type LimitCheck = { ok: true } | { ok: false; reason: 'SINGLE_LIMIT' | 'DAILY_LIMIT' };

export function checkTransfer(tier: Tier, amount: Decimal.Value, alreadySentToday: Decimal.Value = 0): LimitCheck {
  const l = tierLimits[tier];
  if (D(amount).gt(l.singleTransfer)) return { ok: false, reason: 'SINGLE_LIMIT' };
  if (D(alreadySentToday).plus(amount).gt(l.dailyTransfer)) return { ok: false, reason: 'DAILY_LIMIT' };
  return { ok: true };
}

/**
 * Investment booking requires Tier 2+ per Calculator Spec §2, but the RTN spec allows
 * individual RTN at Tier 1 (open conflict — see Unified Calculator Spec Coverage, "Shared").
 */
export function canBookInvestment(tier: Tier, product: 'REAP' | 'RWIN' | 'RTN', account: 'INDIVIDUAL' | 'CORPORATE' = 'INDIVIDUAL'): boolean {
  if (product === 'RTN' && account === 'CORPORATE') return tier >= 2;
  if (product === 'RTN') return tier >= 1;
  return tier >= 2;
}

export function isValidBvnOrNin(value: string): boolean {
  return /^\d{11}$/.test(value);
}
