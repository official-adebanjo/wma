import Decimal from 'decimal.js';
import { driver, expect } from '@wdio/globals';
import { QaHooks } from '../../shared/api/qa-hooks';
import { D, formatNaira } from '../../shared/calc/money';
import { productConfig } from '../../shared/config/env';
import { links, openDeepLink } from './deeplink';
import { openTab } from './session';
import { BorrowHomeScreen } from '../screens/common/HomeScreens';
import { WalletScreen } from '../screens/common/WalletScreens';

/**
 * Loan-suite helpers (Nano / Payday / Personal / Public Sector Customer App Specs).
 *
 * Every loan rate, fee, threshold and wait period is config-driven (Admin → Product Management),
 * so specs seed known terms through `hooks.setProductConfig` using the fixtures below and compute
 * every expected money value with the oracle in shared/calc/loans.ts.
 *
 * ASSUMPTION (QA-hook contract, docs/TEST-HOOKS.md to be extended):
 *  - `setProductConfig({ product: 'NANO' | 'PAYDAY' | 'PERSONAL' | 'PUBLIC_SECTOR' | 'LOANS', patch })`
 *    accepts the keys used here; 'LOANS' holds cross-product rules (cross-loan block).
 *  - `seedLoan({ state, extra })` accepts the lifecycle states and `extra` keys documented on
 *    `LoanState` / each spec (termRatePct, dueInDays, instalmentsPaid, corridor, …).
 *  - Per-customer Nano pre-check eligibility is forced with `qaEligibilityOverride`.
 */

export type LoanProduct = 'NANO' | 'PAYDAY' | 'PERSONAL' | 'PUBLIC_SECTOR';
export type LoanModule = 'nano' | 'payday' | 'personal' | 'publicSector';
export type BorrowTile = LoanModule;

/** Lifecycle states accepted by hooks.seedLoan (union across the four products' §6). */
export type LoanState =
  | 'DRAFT' | 'PENDING' | 'UNDER_REVIEW' | 'DECLINED' | 'OFFER_RETURNED' | 'OFFER_EXPIRED' | 'ACCEPTED_ACTIVATING'
  | 'AWAITING_FIRST_PAYROLL' | 'ACTIVE' | 'DEBIT_FAILED' | 'OVERDUE' | 'RESTRUCTURED' | 'IN_COLLECTIONS'
  | 'WRITTEN_OFF' | 'REPAID' | 'PAYROLL_BATCH_LATE' | 'DEDUCTION_MISSED';

const linkSlug: Record<LoanProduct, 'nano' | 'payday' | 'personal' | 'public-sector'> = {
  NANO: 'nano', PAYDAY: 'payday', PERSONAL: 'personal', PUBLIC_SECTOR: 'public-sector',
};

export const productDisplayName: Record<LoanProduct, string> = {
  NANO: 'Nano', PAYDAY: 'Payday', PERSONAL: 'Personal', PUBLIC_SECTOR: 'Public Sector',
};

export const moduleOf: Record<LoanProduct, LoanModule> = {
  NANO: 'nano', PAYDAY: 'payday', PERSONAL: 'personal', PUBLIC_SECTOR: 'publicSector',
};

// ──────────────────────────────────────────────────────────────────────────────
// Seeded product terms (values are test fixtures, NOT production terms)
// ──────────────────────────────────────────────────────────────────────────────

/** Nano §4 step 2: fixed tenor set with a flat term rate per tenor. */
export const NANO_TERMS = {
  tenorsDays: [14, 30] as const,
  termRatePctByTenor: { 14: 5, 30: 9 } as Record<number, number>,
  reapplyWaitHours: 24,
  autoDebitRetries: 3, // Nano §9 "e.g., 3 retries over 3 days"
  partialRepaymentAllowed: false,
};

/** Payday §4: cap % of salary, 30-day flat term rate, referral matrix thresholds. */
export const PAYDAY_TERMS = {
  salaryCapPct: productConfig.payday.salaryCapPct,
  termDays: productConfig.payday.termDays,
  termRatePct: 10,
  referralThresholds: { mediumFrom: 100_000, highFrom: 200_000 },
  reviewHours: 4,
  debitRetries: 3,
};

/** Personal §4 / §7: indicative rate for the live estimate; confirmed rate comes with the offer. */
export const PERSONAL_TERMS = {
  indicativeRatePct: 30,
  minAmount: productConfig.personal.minAmount,
  maxAmount: 10_000_000,
  tenorsMonths: productConfig.personal.tenorsMonths,
  largerAmountDocsFrom: 2_000_000,
  offerExpiryDays: 7,
  reapplyWaitDays: 30,
  earlySettlementFeePct: 2,
  lateFeePerMissedInstalment: 5_000,
  reminderDaysBefore: productConfig.personal.reminderDaysBefore,
};

export interface CorridorFixture {
  key: 'federal' | 'lagos' | 'unibadan';
  name: string;
  subLabel: string;
  group: 'federal' | 'state' | 'tertiary';
  idField: 'ippis' | 'staffNumber';
  deductionMethod: string;
  ratePct: number;
  dtiPct: number;
  salaryBasis: 'GROSS' | 'NET' | 'GROSS_EXCL_TRANSPORT';
  maxTenorMonths: number;
  tenorsMonths: number[];
  consentLetterRequired: boolean;
  mandateRequired: boolean;
  controlGateFrom: number;
  earlySettlementFeePct: number;
  bankTransferSettlementFrom: number;
  outOfCycleRepayment: boolean;
}

/** Public Sector corridors seeded for tests — plain employer names only (PSL "note on corridors"). */
export const CORRIDORS: Record<CorridorFixture['key'], CorridorFixture> = {
  federal: {
    key: 'federal', name: 'Federal IPPIS', subLabel: 'federal government via IPPIS', group: 'federal', idField: 'ippis',
    deductionMethod: 'IPPIS', ratePct: 22, dtiPct: 33, salaryBasis: 'NET', maxTenorMonths: 48, tenorsMonths: [6, 12, 18, 24, 36, 48],
    consentLetterRequired: true, mandateRequired: false, controlGateFrom: 3_000_000, earlySettlementFeePct: 1,
    bankTransferSettlementFrom: 5_000_000, outOfCycleRepayment: false,
  },
  lagos: {
    key: 'lagos', name: 'Lagos State', subLabel: 'Lagos State Government', group: 'state', idField: 'staffNumber',
    deductionMethod: 'Lagos State payroll', ratePct: 24, dtiPct: 40, salaryBasis: 'GROSS_EXCL_TRANSPORT', maxTenorMonths: 36,
    tenorsMonths: [6, 12, 18, 24, 36], consentLetterRequired: false, mandateRequired: true, controlGateFrom: 2_000_000,
    earlySettlementFeePct: 1.5, bankTransferSettlementFrom: 5_000_000, outOfCycleRepayment: true,
  },
  unibadan: {
    key: 'unibadan', name: 'University of Ibadan', subLabel: 'University of Ibadan staff', group: 'tertiary', idField: 'staffNumber',
    deductionMethod: 'University of Ibadan payroll', ratePct: 25, dtiPct: 33, salaryBasis: 'GROSS', maxTenorMonths: 24,
    tenorsMonths: [6, 12, 18, 24], consentLetterRequired: false, mandateRequired: true, controlGateFrom: 1_500_000,
    earlySettlementFeePct: 1, bankTransferSettlementFrom: 5_000_000, outOfCycleRepayment: false,
  },
};

export async function seedNanoTerms(hooks: QaHooks, patch: Partial<typeof NANO_TERMS> = {}) {
  await hooks.setProductConfig({ product: 'NANO', patch: { ...NANO_TERMS, ...patch } });
}

export type NanoIneligibleReason = 'KYC_INCOMPLETE' | 'INSUFFICIENT_HISTORY' | 'DTI_TOO_HIGH' | 'BUREAU_ISSUE';

/** Nano §3: forces the soft pre-check result for one customer (eligible range + rate, or reason). */
export async function seedNanoEligibility(
  hooks: QaHooks,
  customerId: string,
  e: { eligible: true; min: number; max: number; termRatePct?: number; streak?: number } | { eligible: false; reason: NanoIneligibleReason },
) {
  await hooks.setProductConfig({ product: 'NANO', patch: { qaEligibilityOverride: { customerId, ...e } } });
}

export async function seedPaydayTerms(hooks: QaHooks, patch: Partial<typeof PAYDAY_TERMS> = {}) {
  await hooks.setProductConfig({ product: 'PAYDAY', patch: { ...PAYDAY_TERMS, ...patch } });
}

export async function seedPersonalTerms(hooks: QaHooks, patch: Partial<typeof PERSONAL_TERMS> = {}) {
  await hooks.setProductConfig({ product: 'PERSONAL', patch: { ...PERSONAL_TERMS, ...patch } });
}

export async function seedCorridors(hooks: QaHooks, overrides: Partial<Record<CorridorFixture['key'], Partial<CorridorFixture>>> = {}) {
  const corridors = Object.values(CORRIDORS).map((c) => ({ ...c, ...(overrides[c.key] ?? {}) }));
  await hooks.setProductConfig({ product: 'PUBLIC_SECTOR', patch: { corridors } });
}

/** Cross-loan constraint (Payday §9, Personal §9) — config-driven, off by default. */
export async function setCrossLoanBlock(hooks: QaHooks, enabled: boolean) {
  await hooks.setProductConfig({ product: 'LOANS', patch: { crossLoanBlockEnabled: enabled } });
}

// ──────────────────────────────────────────────────────────────────────────────
// Navigation / state
// ──────────────────────────────────────────────────────────────────────────────

export async function openBorrowTile(tile: BorrowTile): Promise<void> {
  await openTab('borrow');
  const home = new BorrowHomeScreen();
  await home.waitForShown();
  await home.openTile(tile);
}

/** Seeds a loan in a lifecycle state and deep-links to its on-loan view. */
export async function openSeededLoan(
  hooks: QaHooks, customerId: string, product: LoanProduct, state: LoanState, amount: number, extra: Record<string, unknown> = {},
): Promise<string> {
  const { loanId } = await hooks.seedLoan({ customerId, product, state, amount, extra });
  await openLoan(product, loanId);
  return loanId;
}

export async function openLoan(product: LoanProduct, loanId: string): Promise<void> {
  await openDeepLink(links.loan(linkSlug[product], loanId));
}

export async function walletBalance(): Promise<Decimal> {
  await openTab('wallet');
  const w = new WalletScreen();
  await w.waitForShown();
  return w.balance();
}

/** Concatenated title + body of the latest N notifications, for regex copy assertions. */
export async function notificationText(hooks: QaHooks, customerId: string, n = 5): Promise<string> {
  const notes = await hooks.latestNotifications(customerId, n);
  return notes.map((x) => `${x.title} ${x.body}`).join(' | ');
}

// ──────────────────────────────────────────────────────────────────────────────
// Copy helpers
// ──────────────────────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Matches ₦X in copy whether or not the app renders ".00" (copy is EXAMPLE COPY (NOT FINAL)). */
export function nairaRe(v: Decimal.Value): string {
  const full = formatNaira(v);
  return full.endsWith('.00') ? `${esc(full.slice(0, -3))}(?:\\.00)?(?![\\d])` : `${esc(full)}(?![\\d])`;
}

export function moneyRe(v: Decimal.Value, flags = 'i'): RegExp {
  return new RegExp(nairaRe(v), flags);
}

/** Internal variant / threshold language that must never reach the customer (Personal "note on scope", §4 step 4, checklist). */
export const VARIANT_LANGUAGE = /\bPL\s?-?[1-5]\b|\bvariant\b|\bthreshold\b|\breferral matrix\b|\bincome basis\b/i;

/** Public Sector: corridors by plain employer name only — never system codes or jargon (PSL note on corridors, §4 step 5). */
export const SYSTEM_CODE_OR_JARGON = /\b[A-Z][A-Z0-9]+_[A-Z0-9_]+\b|\bcorridor[_-]?(?:id|code)\b|\bcontrol[- ]?gate\b|\bCORR-?\d+\b/i;

/**
 * Visible texts on the current screen, read from the page source. Android exposes copy via
 * `text`, iOS via `label`/`value`. Accessibility ids (our test IDs) are excluded on purpose so
 * the jargon checks only see what the customer sees.
 */
export async function visibleTexts(): Promise<string[]> {
  const src = await driver.getPageSource();
  const re = driver.isAndroid ? /\stext="([^"]*)"/g : /\s(?:label|value)="([^"]*)"/g;
  const out: string[] = [];
  for (const m of src.matchAll(re)) {
    const t = m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#10;/g, '\n').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    if (t) out.push(t);
  }
  return out;
}

export async function expectNoVisibleText(pattern: RegExp): Promise<void> {
  const re = new RegExp(pattern.source, pattern.flags.replace('g', ''));
  const hits = (await visibleTexts()).filter((t) => re.test(t));
  expect(hits).toEqual([]);
}

// ──────────────────────────────────────────────────────────────────────────────
// Date helpers
// ──────────────────────────────────────────────────────────────────────────────

export function daysFromNow(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Interest accrued since the last instalment date, simple Actual/365 on the outstanding principal.
 * ASSUMPTION — loan accrual basis not stated in the loan specs; Actual/365 follows the Calculator
 * Spec §3 / Clarity X2 convention used for investments. Personal §7 / Public Sector §7.
 */
export function accruedSinceLastDue(outstanding: Decimal.Value, annualRatePct: Decimal.Value, days: number): Decimal {
  return D(outstanding).mul(annualRatePct).div(100).mul(days).div(365).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** "Airtime & Data" → "airtime-and-data" — option test-ID suffix for purpose / category chips. */
export function optionSlug(label: string): string {
  return label.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
