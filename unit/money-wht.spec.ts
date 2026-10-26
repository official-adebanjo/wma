import { test, expect } from '@playwright/test';
import { D, addMonths, daysBetween, formatNaira, parseNaira, toKobo } from '../shared/calc/money';
import { applyWht, assertLinesReconcile } from '../shared/calc/wht';

test.describe('Oracle › money primitives', () => {
  test('rounds half-up to kobo (Clarity X3 default)', () => {
    expect(toKobo('0.005').toFixed(2)).toBe('0.01');
    expect(toKobo('0.004999').toFixed(2)).toBe('0.00');
    expect(toKobo('3452.055').toFixed(2)).toBe('3452.06');
    expect(toKobo('-1.005').toFixed(2)).toBe('-1.01');
  });

  test('formats naira with thousands separators and kobo', () => {
    expect(formatNaira(1234567.891)).toBe('₦1,234,567.89');
    expect(formatNaira(50000, { kobo: false })).toBe('₦50,000');
    expect(formatNaira(0)).toBe('₦0.00');
  });

  test('parses naira strings read off screens', () => {
    expect(parseNaira('₦1,234.50').toFixed(2)).toBe('1234.50');
    expect(parseNaira('N 100,000,000').toFixed(2)).toBe('100000000.00');
    expect(parseNaira('Balance: ₦850,000').toFixed(0)).toBe('850000');
    expect(() => parseNaira('—')).toThrow();
  });

  test('date helpers: daysBetween and month-end clamping', () => {
    expect(daysBetween(new Date('2026-01-01'), new Date('2026-04-01'))).toBe(90);
    expect(addMonths(new Date('2026-01-31'), 1).toISOString().slice(0, 10)).toBe('2026-02-28');
    expect(addMonths(new Date('2028-01-31'), 1).toISOString().slice(0, 10)).toBe('2028-02-29');
  });
});

test.describe('Oracle › WHT', () => {
  test('10% WHT on gross interest, net = gross − WHT', () => {
    const r = applyWht('34520.547945');
    expect(r.gross.toFixed(2)).toBe('34520.55');
    expect(r.wht.toFixed(2)).toBe('3452.06');
    expect(r.net.toFixed(2)).toBe('31068.49');
  });

  test('injectable rate covers the 9% RTN-form variant (open X1)', () => {
    expect(applyWht(1000, 9).wht.toFixed(2)).toBe('90.00');
  });

  test('summary-line reconciliation guard catches mismatches', () => {
    expect(() => assertLinesReconcile({ gross: D(100), wht: D(10), penalty: D(5), net: D(85) })).not.toThrow();
    expect(() => assertLinesReconcile({ gross: D(100), wht: D(10), net: D(91) })).toThrow(/do not reconcile/);
  });
});
