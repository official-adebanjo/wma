import Decimal from 'decimal.js';
import { D, toKobo } from './money';
import { productConfig } from '../config/env';

export interface InterestBreakdown {
  gross: Decimal;
  wht: Decimal;
  net: Decimal;
}

/**
 * WHT on gross interest (Calculator Spec §2). Rate defaults to 10% per the product specs;
 * the RTN admin form says 9% — open item X1, so the rate is injectable.
 * Per X1/T6 default, WHT is charged on interest *after* any interest penalty.
 */
export function applyWht(grossInterest: Decimal.Value, whtRatePct = productConfig.whtRatePct): InterestBreakdown {
  const gross = toKobo(grossInterest);
  const wht = toKobo(gross.mul(whtRatePct).div(100));
  return { gross, wht, net: gross.minus(wht) };
}

/** Invariant every summary screen must satisfy (Clarity X3): gross − WHT − penalty = net. */
export function assertLinesReconcile(lines: { gross: Decimal; wht: Decimal; penalty?: Decimal; net: Decimal }): void {
  const expected = lines.gross.minus(lines.wht).minus(lines.penalty ?? D(0));
  if (!expected.eq(lines.net)) {
    throw new Error(
      `Summary lines do not reconcile: gross ${lines.gross} − WHT ${lines.wht} − penalty ${lines.penalty ?? 0} = ${expected}, but net shown is ${lines.net}`,
    );
  }
}
