import { test, expect } from '@playwright/test';
import { D } from '../shared/calc/money';
import * as loans from '../shared/calc/loans';
import * as tier from '../shared/calc/tier';
import { tierLimits } from '../shared/config/env';

test.describe('Oracle › Loans', () => {
  test('Payday cap: 50% of ₦450,000 salary = ₦225,000 (Payday spec §4 example)', () => {
    expect(loans.paydayCap(450_000, 50).toFixed(2)).toBe('225000.00');
  });

  test('flat interest for single-repayment loans', () => {
    const r = loans.flatInterest(225_000, 5);
    expect(r.interest.toFixed(2)).toBe('11250.00');
    expect(r.totalRepayment.toFixed(2)).toBe('236250.00');
  });

  test('annuity benchmark: ₦100,000 @ 12% p.a. over 12 months = ₦8,884.88/month', () => {
    expect(loans.monthlyInstalment(100_000, 12, 12).toFixed(2)).toBe('8884.88');
    expect(loans.monthlyInstalment(120_000, 0, 12).toFixed(2)).toBe('10000.00');
  });

  test('amortisation schedule closes to exactly zero and principal sums to the loan', () => {
    const rows = loans.amortisationSchedule(1_200_000, 24, 12, new Date('2026-11-25'));
    expect(rows).toHaveLength(12);
    expect(rows[0].interest.toFixed(2)).toBe('24000.00');
    expect(rows[11].balanceAfter.toFixed(2)).toBe('0.00');
    const principalSum = rows.reduce((s, r) => s.plus(r.principal), D(0));
    expect(principalSum.toFixed(2)).toBe('1200000.00');
    expect(rows[1].dueDate.toISOString().slice(0, 10)).toBe('2026-12-25');
  });

  test('early settlement and catch-up amounts', () => {
    expect(loans.earlySettlementAmount(500_000, 4_250.5, 2).toFixed(2)).toBe('514250.50');
    expect(loans.catchUpAmount([113_471.11, 113_471.11], 5_000).toFixed(2)).toBe('231942.22');
  });

  test('Public Sector: tenor capped by whole months to retirement', () => {
    expect(loans.maxTenorByRetirement(new Date('2026-10-16'), new Date('2028-04-15'))).toBe(17);
    expect(loans.maxTenorByRetirement(new Date('2026-10-16'), new Date('2028-04-16'))).toBe(18);
    expect(loans.maxTenorByRetirement(new Date('2026-10-16'), new Date('2026-09-01'))).toBe(0);
  });

  test('affordability: instalment on max principal fits DTI capacity', () => {
    const max = loans.maxAffordablePrincipal(400_000, 33.33, 20_000, 24, 24);
    const pmt = loans.monthlyInstalment(max, 24, 24);
    expect(pmt.lte(D(400_000).mul(33.33).div(100).minus(20_000).plus(0.01))).toBe(true);
    expect(loans.maxAffordablePrincipal(100_000, 30, 40_000, 24, 12).toNumber()).toBe(0);
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
    // KYC Spec V4 §1 lists Tier 1 single-transfer ₦300,000 above its ₦20,000 daily limit, so the
    // single limit can never bind. Likely transposed — raise with Compliance. Assert as published.
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
    expect(tier.isValidBvnOrNin('222222222222')).toBe(false);
  });
});
