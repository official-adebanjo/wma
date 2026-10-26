import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (Number.isNaN(n)) throw new Error(`Env var ${name} must be numeric, got "${raw}"`);
  return n;
}

/** Fails loudly at the point of use, so suites that don't need a secret can still run. */
export function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}. See .env.example.`);
  return v;
}

const testEnv = optional('TEST_ENV', 'dev');
if (testEnv === 'production' || testEnv === 'prod') {
  // QA Strategy §28.2: live customer profiles are never used.
  throw new Error('TEST_ENV=production is not permitted for this suite.');
}

export const env = {
  testEnv,
  apiBaseUrl: optional('API_BASE_URL'),
  adminBaseUrl: optional('ADMIN_BASE_URL'),
  qaHooksBaseUrl: optional('QA_HOOKS_BASE_URL'),
  qaHooksToken: optional('QA_HOOKS_TOKEN'),
  testOtp: optional('TEST_OTP'),
};

/**
 * Product configuration defaults. These mirror Admin → Product Management and are
 * config-driven at runtime (Calculator Spec §2), so tests read them from env and the
 * catalog API rather than hard-coding them in assertions.
 */
export const productConfig = {
  whtRatePct: num('WHT_RATE_PCT', 10),
  rwin: {
    cycleDays: 90,
    minHoldingDays: 30,
    minDeposit: num('RWIN_MIN_DEPOSIT', 50_000),
    planCap: num('RWIN_PLAN_CAP', 100_000_000),
    capWarningPct: 90,
    minRetained: num('RWIN_MIN_RETAINED', 50_000),
  },
  reap: {
    minTarget: num('REAP_MIN_TARGET', 10_000),
    tenorsMonths: [3, 6, 12, 24],
    behindScheduleNoticeDays: [60, 30, 15],
    approachingMaturityDays: 30,
    autosaveRetryAttempts: 3,
  },
  rtn: {
    minIndividual: num('RTN_MIN_INDIVIDUAL', 1_000_000),
    minCorporate: num('RTN_MIN_CORPORATE', 10_000_000),
    tenorsDays: [30, 60, 90, 120, 180, 365],
    underfundedHoldHours: num('RTN_UNDERFUNDED_HOLD_HOURS', 24),
    maturityNoticeDays: 7,
  },
  payday: {
    salaryCapPct: num('PAYDAY_SALARY_CAP_PCT', 50),
    termDays: 30,
    reminderDaysBefore: 3,
  },
  nano: { reminderDaysBefore: 3 },
  personal: { tenorsMonths: [3, 6, 9, 12, 18, 24], reminderDaysBefore: 5, minAmount: 100_000 },
};

/** KYC tier limits — Account Tiering & KYC Spec V4 §1. */
export const tierLimits = {
  1: { singleTransfer: 300_000, dailyTransfer: 20_000 },
  2: { singleTransfer: 5_000_000, dailyTransfer: 20_000_000 },
  3: { singleTransfer: 5_000_000, dailyTransfer: 20_000_000 },
} as const;
export type Tier = keyof typeof tierLimits;
