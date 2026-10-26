import { test, expect } from '@playwright/test';
import { D } from '../shared/calc/money';
import * as loans from '../shared/calc/loans';
import * as tier from '../shared/calc/tier';
import { tierLimits } from '../shared/config/env';

/**
 * Loan oracle self-tests. Every expected figure below is copied from the worked examples in
 * "LOAN PRODUCT SPECIFICATIONS.docx" (§2.3, §3.3, §4.3, §4.4).
 */

test.describe('Oracle › Nano (LoanSpec §2) — I = P × r × d', () => {
  for (const [days, interest, total] of [[3, '180.00', '20180.00'], [7, '420.00', '20420.00'], [14, '840.00', '20840.00'], [30, '1800.00', '21800.00']] as const) {
    test(`₦20,000 @ 0.30%/day for ${days} days → interest ₦${interest}, repayable ₦${total} (§2.3)`, () => {
      const r = loans.proratedInterest(20_000, 0.3, days);
      expect(r.interest.toFixed(2)).toBe(interest);
      expect(r.totalRepayable.toFixed(2)).toBe(total);
    });
  }

  test('bounds: ₦5,000–₦50,000, 1–30 days, Tier 1+ (§2.1)', () => {
    expect(loans.checkBounds('NANO', 5_000, 1, 1)).toEqual({ ok: true });
    expect(loans.checkBounds('NANO', 50_000, 30, 1)).toEqual({ ok: true });
    expect(loans.checkBounds('NANO', 4_999.99, 7, 1)).toEqual({ ok: false, reason: 'AMOUNT_BELOW_MIN' });
    expect(loans.checkBounds('NANO', 50_000.01, 7, 1)).toEqual({ ok: false, reason: 'AMOUNT_ABOVE_MAX' });
    expect(loans.checkBounds('NANO', 20_000, 0, 1)).toEqual({ ok: false, reason: 'TENOR_BELOW_MIN' });
    expect(loans.checkBounds('NANO', 20_000, 31, 1)).toEqual({ ok: false, reason: 'TENOR_ABOVE_MAX' });
  });
});

test.describe('Oracle › Payday (LoanSpec §3) — prorated, early settlement on days used', () => {
  for (const [days, interest, total] of [[7, '4200.00', '204200.00'], [15, '9000.00', '209000.00'], [21, '12600.00', '212600.00'], [30, '18000.00', '218000.00']] as const) {
    test(`₦200,000 @ 0.30%/day for ${days} days → interest ₦${interest}, repayable ₦${total} (§3.3)`, () => {
      const r = loans.proratedInterest(200_000, 0.3, days);
      expect(r.interest.toFixed(2)).toBe(interest);
      expect(r.totalRepayable.toFixed(2)).toBe(total);
    });
  }

  test('early settlement recalculates interest on active days only (§3.2)', () => {
    const s = loans.paydayEarlySettlement(200_000, 0.3, 15, 30);
    expect(s.interest.toFixed(2)).toBe('9000.00');
    expect(s.totalRepayable.toFixed(2)).toBe('209000.00');
    expect(s.interestSaved.toFixed(2)).toBe('9000.00');
  });

  test('bounds: up to ₦500,000, 7–30 days, Tier 2 (§3.1)', () => {
    expect(loans.checkBounds('PAYDAY', 500_000, 7, 2)).toEqual({ ok: true });
    expect(loans.checkBounds('PAYDAY', 500_000.01, 7, 2)).toEqual({ ok: false, reason: 'AMOUNT_ABOVE_MAX' });
    expect(loans.checkBounds('PAYDAY', 100_000, 6, 2)).toEqual({ ok: false, reason: 'TENOR_BELOW_MIN' });
    expect(loans.checkBounds('PAYDAY', 100_000, 31, 2)).toEqual({ ok: false, reason: 'TENOR_ABOVE_MAX' });
    expect(loans.checkBounds('PAYDAY', 100_000, 14, 1)).toEqual({ ok: false, reason: 'TIER' });
  });

  test('salary cap is bounded by the ₦500,000 product maximum', () => {
    expect(loans.paydayCap(450_000, 50).toFixed(2)).toBe('225000.00');
    expect(loans.paydayCap(2_000_000, 50).toFixed(2)).toBe('500000.00');
  });
});

test.describe('Oracle › Personal & Public Sector — Model A (monthly equal) vs Model B (monthly reducing)', () => {
  // LoanSpec §4.3: ₦6,000,000 over 6 months @ 2% per month.
  const A_INTEREST = ['120000.00', '120000.00', '120000.00', '120000.00', '120000.00', '120000.00'];
  const B_INTEREST = ['120000.00', '100000.00', '80000.00', '60000.00', '40000.00', '20000.00'];
  const A_DUE = ['1120000.00', '1120000.00', '1120000.00', '1120000.00', '1120000.00', '1120000.00'];
  const B_DUE = ['1120000.00', '1100000.00', '1080000.00', '1060000.00', '1040000.00', '1020000.00'];

  for (const [model, interest, due, totalInterest, totalRepayable] of [
    ['A', A_INTEREST, A_DUE, '720000.00', '6720000.00'],
    ['B', B_INTEREST, B_DUE, '420000.00', '6420000.00'],
  ] as const) {
    test(`Model ${model}: month-by-month schedule matches the §4.3 comparison table`, () => {
      const rows = loans.loanSchedule(6_000_000, 2, 6, model, new Date('2026-11-01'));
      expect(rows).toHaveLength(6);
      rows.forEach((r, i) => {
        expect(r.principal.toFixed(2), `month ${i + 1} principal`).toBe('1000000.00');
        expect(r.interest.toFixed(2), `month ${i + 1} interest`).toBe(interest[i]);
        expect(r.totalDue.toFixed(2), `month ${i + 1} total due`).toBe(due[i]);
      });
      expect(rows[5].balanceAfter.toFixed(2)).toBe('0.00');
      const t = loans.scheduleTotals(rows);
      expect(t.principal.toFixed(2)).toBe('6000000.00');
      expect(t.interest.toFixed(2)).toBe(totalInterest);
      expect(t.totalRepayable.toFixed(2)).toBe(totalRepayable);
    });
  }

  test('Model A interest is uniform; Model B interest strictly decreases', () => {
    const a = loans.loanSchedule(2_400_000, 3, 12, 'A').map((r) => r.interest.toNumber());
    const b = loans.loanSchedule(2_400_000, 3, 12, 'B').map((r) => r.interest.toNumber());
    expect(new Set(a).size).toBe(1);
    b.slice(1).forEach((v, i) => expect(v).toBeLessThan(b[i]));
  });

  for (const [model, interest, payoff, waived] of [['A', '120000.00', '4120000.00', '360000.00'], ['B', '80000.00', '4080000.00', '120000.00']] as const) {
    test(`Model ${model}: early payoff in month 3 = ₦4,000,000 + month-3 interest; future interest waived (§4.4)`, () => {
      const p = loans.earlyPayoff(6_000_000, 2, 6, model, 3);
      expect(p.outstandingPrincipal.toFixed(2)).toBe('4000000.00');
      expect(p.activeMonthInterest.toFixed(2)).toBe(interest);
      expect(p.payoff.toFixed(2)).toBe(payoff);
      expect(p.waivedInterest.toFixed(2)).toBe(waived);
    });
  }

  test('early payoff in month 1 and final month; out-of-range month rejected', () => {
    expect(loans.earlyPayoff(6_000_000, 2, 6, 'B', 1).payoff.toFixed(2)).toBe('6120000.00');
    expect(loans.earlyPayoff(6_000_000, 2, 6, 'B', 6).payoff.toFixed(2)).toBe('1020000.00');
    expect(loans.earlyPayoff(6_000_000, 2, 6, 'B', 6).waivedInterest.toFixed(2)).toBe('0.00');
    expect(() => loans.earlyPayoff(6_000_000, 2, 6, 'A', 7)).toThrow(/outside tenor/);
  });

  test('uneven principal: kobo remainder lands in the final month and the balance closes at ₦0.00', () => {
    for (const model of ['A', 'B'] as const) {
      const rows = loans.loanSchedule(1_000_000, 2.5, 7, model);
      expect(loans.scheduleTotals(rows).principal.toFixed(2)).toBe('1000000.00');
      expect(rows[6].balanceAfter.toFixed(2)).toBe('0.00');
    }
  });

  test('Personal bounds: up to ₦30,000,000, 3–24 months (§4.1)', () => {
    expect(loans.checkBounds('PERSONAL', 30_000_000, 24)).toEqual({ ok: true });
    expect(loans.checkBounds('PERSONAL', 30_000_000.01, 12)).toEqual({ ok: false, reason: 'AMOUNT_ABOVE_MAX' });
    expect(loans.checkBounds('PERSONAL', 1_000_000, 2)).toEqual({ ok: false, reason: 'TENOR_BELOW_MIN' });
    expect(loans.checkBounds('PERSONAL', 1_000_000, 25)).toEqual({ ok: false, reason: 'TENOR_ABOVE_MAX' });
  });

  test('affordability: month-1 instalment on the max principal fits DTI capacity (both models)', () => {
    const max = loans.maxAffordablePrincipal(400_000, 33.33, 20_000, 2, 24);
    const capacity = D(400_000).mul(33.33).div(100).minus(20_000);
    for (const model of ['A', 'B'] as const) {
      expect(loans.firstInstalment(max, 2, 24, model).lte(capacity.plus(0.01))).toBe(true);
    }
    expect(loans.maxAffordablePrincipal(100_000, 30, 40_000, 2, 12).toNumber()).toBe(0);
  });
});

test.describe('Oracle › Loan servicing & routing', () => {
  test('catch-up amount = missed instalments + late fees', () => {
    expect(loans.catchUpAmount([1_100_000, 1_080_000], 5_000).toFixed(2)).toBe('2185000.00');
  });

  test('Public Sector: tenor capped by whole months to retirement', () => {
    expect(loans.maxTenorByRetirement(new Date('2026-10-16'), new Date('2028-04-15'))).toBe(17);
    expect(loans.maxTenorByRetirement(new Date('2026-10-16'), new Date('2028-04-16'))).toBe(18);
    expect(loans.maxTenorByRetirement(new Date('2026-10-16'), new Date('2026-09-01'))).toBe(0);
  });

  test('Payday referral tiers and Personal approval bands', () => {
    const t = { mediumFrom: 200_000, highFrom: 500_000 };
    expect(loans.referralTier(199_999.99, t)).toBe('LOW');
    expect(loans.referralTier(200_000, t)).toBe('MEDIUM');
    expect(loans.referralTier(500_000, t)).toBe('HIGH');
    const bands: [number, number, number] = [1_000_000, 5_000_000, 20_000_000];
    expect(loans.approvalBand(1_000_000, bands)).toBe('TEAM_LEAD');
    expect(loans.approvalBand(1_000_000.01, bands)).toBe('CRM');
    expect(loans.approvalBand(20_000_001, bands)).toBe('EXECUTIVE');
  });
});

test.describe('Oracle › KYC tiers', () => {
  test('Tier 2/3 transfer limits', () => {
    expect(tier.checkTransfer(2, 5_000_000)).toEqual({ ok: true });
    expect(tier.checkTransfer(2, 5_000_000.01)).toEqual({ ok: false, reason: 'SINGLE_LIMIT' });
    expect(tier.checkTransfer(3, 1_000_000, 19_500_000)).toEqual({ ok: false, reason: 'DAILY_LIMIT' });
  });

  test('Tier 1 limits as published: single ₦300,000 but daily ₦20,000 @open:TIER1-LIMITS', () => {
    expect(tierLimits[1].singleTransfer).toBeGreaterThan(tierLimits[1].dailyTransfer);
    expect(tier.checkTransfer(1, 20_000)).toEqual({ ok: true });
    expect(tier.checkTransfer(1, 20_000.01)).toEqual({ ok: false, reason: 'DAILY_LIMIT' });
  });

  test('investment gating: Tier 2 for REAP/RWIN; RTN individual Tier 1, corporate Tier 2 (open conflict)', () => {
    expect(tier.canBookInvestment(1, 'RWIN')).toBe(false);
    expect(tier.canBookInvestment(2, 'REAP')).toBe(true);
    expect(tier.canBookInvestment(1, 'RTN')).toBe(true);
    expect(tier.canBookInvestment(1, 'RTN', 'CORPORATE')).toBe(false);
  });

  test('BVN/NIN must be exactly 11 digits', () => {
    expect(tier.isValidBvnOrNin('22222222222')).toBe(true);
    expect(tier.isValidBvnOrNin('2222222222')).toBe(false);
    expect(tier.isValidBvnOrNin('2222222222A')).toBe(false);
  });
});
