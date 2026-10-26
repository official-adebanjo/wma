import Decimal from 'decimal.js';

/**
 * Money primitives for the independent expected-value oracle (QA Strategy §21, §32).
 *
 * Rounding rule follows the suggested default in Calculation Clarity Questions X3:
 * round half-up to kobo (2 dp) per payment at posting. Intermediate maths stays at
 * full precision; only values that would be posted/displayed are rounded.
 */
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type Naira = Decimal;
export const D = (v: Decimal.Value): Decimal => new Decimal(v);

export function toKobo(v: Decimal.Value): Decimal {
  return new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** "₦1,234,567.89" — matches the ₦-prefixed display used across the app specs. */
export function formatNaira(v: Decimal.Value, opts: { kobo?: boolean } = { kobo: true }): string {
  const d = toKobo(v);
  const [whole, frac] = d.toFixed(2).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return opts.kobo === false && frac === '00' ? `₦${grouped}` : `₦${grouped}.${frac}`;
}

/** Parses "₦1,234.50", "N1,234.50", "1234.5" → Decimal. Used to read values off screens. */
export function parseNaira(text: string): Decimal {
  const cleaned = text.replace(/[₦N,\s]/g, '').replace(/[^\d.-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') {
    throw new Error(`Cannot parse naira amount from "${text}"`);
  }
  return new Decimal(cleaned);
}

export const DAYS_IN_YEAR = 365; // Actual/365 — Calculator Spec §3, Clarity X2

export function addDays(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

export function daysBetween(from: Date, to: Date): number {
  const ms = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()) -
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  return Math.round(ms / 86_400_000);
}
