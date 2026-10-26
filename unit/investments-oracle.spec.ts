import { test, expect } from '@playwright/test';
import { addDays } from '../shared/calc/money';
import * as rwin from '../shared/calc/rwin';
import * as reap from '../shared/calc/reap';
import * as rtn from '../shared/calc/rtn';

const day0 = new Date('2026-01-01T00:00:00Z');

test.describe('Oracle › RWIN 2.0', () => {
  test('W1 worked example: ₦1,000,000 @ 14% for 90 days (simple) = ₦34,520.55 gross', () => {
    const r = rwin.cycleInterest(1_000_000, 14);
    expect(r.gross.toFixed(2)).toBe('34520.55');
    expect(r.wht.toFixed(2)).toBe('3452.06');
    expect(r.net.toFixed(2)).toBe('31068.49');
    expect(rwin.maturityPayout(1_000_000, 14).toFixed(2)).toBe('1031068.49');
  });

  test('30-day hold: day 29 locked, day 30 first withdrawable (W10 default)', () => {
    const t = { principal: 100_000, ratePct: 14, fundedOn: day0 };
    expect(rwin.isWithdrawable(t, addDays(day0, 29))).toBe(false);
    expect(rwin.isWithdrawable(t, addDays(day0, 30))).toBe(true);
    expect(rwin.withdrawableFrom(t).toISOString().slice(0, 10)).toBe('2026-01-31');
  });

  test('withdrawal validation: hold, min retained ₦50k, full withdrawal allowed', () => {
    const asOf = addDays(day0, 40);
    const old = { principal: 300_000, ratePct: 14, fundedOn: day0 };
    const fresh = { principal: 200_000, ratePct: 12, fundedOn: addDays(day0, 35) };
    expect(rwin.withdrawableAmount([old, fresh], asOf).toNumber()).toBe(300_000);
    expect(rwin.validateWithdrawal([fresh], 10_000, asOf)).toEqual({ ok: false, reason: 'MIN_HOLDING' });
    expect(rwin.validateWithdrawal([old], 260_000, asOf)).toEqual({ ok: false, reason: 'BELOW_MIN_RETAINED' });
    expect(rwin.validateWithdrawal([old], 250_000, asOf)).toEqual({ ok: true });
    expect(rwin.validateWithdrawal([old], 300_000, asOf)).toEqual({ ok: true });
    expect(rwin.validateWithdrawal([old, fresh], 300_001, asOf)).toEqual({ ok: false, reason: 'EXCEEDS_WITHDRAWABLE' });
  });

  test('deposit validation: min ₦50k and ₦100M cap across RWIN holdings', () => {
    expect(rwin.validateDeposit(0, 49_999.99)).toEqual({ ok: false, reason: 'BELOW_MIN' });
    expect(rwin.validateDeposit(99_950_000, 50_000)).toEqual({ ok: true });
    expect(rwin.validateDeposit(99_950_000, 50_000.01)).toEqual({ ok: false, reason: 'EXCEEDS_CAP' });
    expect(rwin.maxInitialDeposit(99_000_000).toNumber()).toBe(1_000_000);
    expect(rwin.isApproachingCap(89_999_999)).toBe(false);
    expect(rwin.isApproachingCap(90_000_000)).toBe(true);
  });

  test('accrued interest counter stops at cycle end', () => {
    const t = { principal: 1_000_000, ratePct: 14, fundedOn: day0 };
    expect(rwin.accruedInterest(t, addDays(day0, 45)).toFixed(2)).toBe('17260.27');
    expect(rwin.accruedInterest(t, addDays(day0, 200)).toFixed(2)).toBe('34520.55');
  });

  test('rollover split at cap (W5 default)', () => {
    const s = rwin.rolloverSplit(1_200_000, 99_000_000);
    expect(s.rolls.toNumber()).toBe(1_000_000);
    expect(s.toWallet.toNumber()).toBe(200_000);
  });
});

test.describe('Oracle › REAP', () => {
  test('daily accrual on running balance from the day after funding (X2 default)', () => {
    const c = [{ amount: 100_000, on: day0 }];
    expect(reap.accruedInterest(c, 10, addDays(day0, 1)).toFixed(2)).toBe('0.00');
    expect(reap.accruedInterest(c, 10, addDays(day0, 31)).toFixed(2)).toBe('821.92');
  });

  test('target met → principal + net interest; missed → principal only, interest forfeited', () => {
    const maturity = addDays(day0, 365);
    const contributions = [{ amount: 600_000, on: day0 }, { amount: 400_000, on: addDays(day0, 100) }];
    const met = reap.maturityOutcome(contributions, 1_000_000, 12, maturity);
    expect(met.targetMet).toBe(true);
    expect(met.payout.toFixed(2)).toBe(met.principal.plus(met.netInterest).toFixed(2));
    expect(met.forfeitedInterest.toNumber()).toBe(0);

    const missed = reap.maturityOutcome(contributions, 1_000_000.01, 12, maturity);
    expect(missed.targetMet).toBe(false);
    expect(missed.payout.toFixed(2)).toBe('1000000.00');
    expect(missed.forfeitedInterest.gt(0)).toBe(true);
  });

  test('break request returns principal only and reports forfeited interest', () => {
    const r = reap.breakOutcome([{ amount: 200_000, on: day0 }], 12, addDays(day0, 61));
    expect(r.principalReturned.toNumber()).toBe(200_000);
    expect(r.interestForfeited.toFixed(2)).toBe('3945.21');
  });

  test('schedules: monthly over 6 months = 6 debits; on-demand = none', () => {
    const maturity = reap.maturityDate(day0, 6);
    expect(reap.scheduleDates(day0, maturity, 'MONTHLY')).toHaveLength(6);
    expect(reap.scheduleDates(day0, maturity, 'WEEKLY')).toHaveLength(26);
    expect(reap.scheduleDates(day0, maturity, 'ON_DEMAND')).toHaveLength(0);
    expect(reap.projectedPrincipal(day0, 6, 'MONTHLY', 50_000).toNumber()).toBe(300_000);
  });

  test('pace status with one-contribution tolerance (E5 default)', () => {
    const args = { start: day0, maturity: addDays(day0, 100), asOf: addDays(day0, 50), target: 1_000_000, contributionAmount: 50_000 };
    expect(reap.paceStatus({ ...args, balance: 500_000 })).toBe('ON_TRACK');
    expect(reap.paceStatus({ ...args, balance: 449_999 })).toBe('BEHIND');
    expect(reap.paceStatus({ ...args, balance: 550_001 })).toBe('AHEAD');
  });

  test('progress % and periods-to-target', () => {
    expect(reap.progressPct(850_000, 2_000_000).toNumber()).toBe(42);
    expect(reap.periodsToTarget(1_000_000, 75_000)).toBe(14);
    expect(reap.periodsToTarget(1_000_000, 75_000, 1_000_000)).toBe(0);
  });
});

test.describe('Oracle › RTN', () => {
  const matrix: rtn.RateMatrix = {
    bands: [{ min: 1_000_000, max: 5_000_000 }, { min: 5_000_000, max: 25_000_000 }, { min: 25_000_000 }],
    tenorsDays: [30, 60, 90, 120, 180, 365],
    rates: [
      [10, 11, 12, 12.5, 13, 14],
      [11, 12, 13, 13.5, 14, 15],
      [12, 13, 14, 14.5, 15, 16],
    ],
  };

  test('matrix lookup: whole-amount rate, lower-inclusive band edges (T1 default)', () => {
    expect(rtn.lookupRate(matrix, 4_999_999.99, 90)).toBe(12);
    expect(rtn.lookupRate(matrix, 5_000_000, 90)).toBe(13);
    expect(rtn.lookupRate(matrix, 25_000_000, 365)).toBe(16);
    expect(() => rtn.lookupRate(matrix, 999_999, 90)).toThrow(/outside/);
    expect(() => rtn.lookupRate(matrix, 2_000_000, 45)).toThrow(/not offered/);
  });

  test('at-maturity vs upfront projections', () => {
    const atMat = rtn.bookingProjection(10_000_000, 18, 180, 'AT_MATURITY', day0);
    expect(atMat.gross.toFixed(2)).toBe('887671.23');
    expect(atMat.wht.toFixed(2)).toBe('88767.12');
    expect(atMat.paidAtBooking.toNumber()).toBe(0);
    expect(atMat.paidAtMaturity.toFixed(2)).toBe('10798904.11');
    const upfront = rtn.bookingProjection(10_000_000, 18, 180, 'UPFRONT', day0);
    expect(upfront.paidAtBooking.toFixed(2)).toBe('798904.11');
    expect(upfront.paidAtMaturity.toFixed(2)).toBe('10000000.00');
    expect(upfront.maturityDate.toISOString().slice(0, 10)).toBe('2026-06-30');
  });

  test('force liquidation: amount + accrued − penalty − WHT = net (T6 default)', () => {
    const ladder: rtn.PenaltyBand[] = [
      { fromPctElapsed: 0, toPctElapsed: 50, basis: 'PCT_ACCRUED_INTEREST', value: 50 },
      { fromPctElapsed: 50, toPctElapsed: 101, basis: 'PCT_ACCRUED_INTEREST', value: 25 },
    ];
    const s = rtn.forceLiquidation({ amount: 10_000_000, ratePct: 18, tenorDays: 180, activatedOn: day0, asOf: addDays(day0, 90), timing: 'AT_MATURITY', ladder });
    expect(s.accruedInterest.toFixed(2)).toBe('443835.62');
    expect(s.penalty.toFixed(2)).toBe('110958.91');
    expect(s.wht.toFixed(2)).toBe('33287.67');
    expect(s.netToWallet.toFixed(2)).toBe('10299589.04');
    expect(s.principal.plus(s.accruedInterest).minus(s.penalty).minus(s.wht).toFixed(2)).toBe(s.netToWallet.toFixed(2));
  });

  test('force liquidation of an UPFRONT placement claws back unearned interest (T4 default — unconfirmed)', () => {
    const ladder: rtn.PenaltyBand[] = [{ fromPctElapsed: 0, toPctElapsed: 101, basis: 'PCT_ACCRUED_INTEREST', value: 0 }];
    const s = rtn.forceLiquidation({ amount: 10_000_000, ratePct: 18, tenorDays: 180, activatedOn: day0, asOf: addDays(day0, 90), timing: 'UPFRONT', ladder });
    // paid upfront net 798,904.11; earned net on 90 days = 443,835.62 − 44,383.56 = 399,452.06
    expect(s.upfrontRecovery.toFixed(2)).toBe('399452.05');
    expect(s.netToWallet.toFixed(2)).toBe('9600547.95');
  });

  test('principal-basis penalty larger than accrued interest reduces principal', () => {
    const ladder: rtn.PenaltyBand[] = [{ fromPctElapsed: 0, toPctElapsed: 101, basis: 'PCT_PRINCIPAL', value: 1 }];
    const s = rtn.forceLiquidation({ amount: 1_000_000, ratePct: 12, tenorDays: 90, activatedOn: day0, asOf: addDays(day0, 5), timing: 'AT_MATURITY', ladder });
    expect(s.penalty.toFixed(2)).toBe('10000.00');
    expect(s.netToWallet.lt(1_000_000)).toBe(true);
  });

  test('bank-transfer outcomes: exact, partial, excess, late', () => {
    expect(rtn.bankTransferOutcome(5_000_000, 5_000_000, true)).toMatchObject({ state: 'ACTIVE' });
    const partial = rtn.bankTransferOutcome(5_000_000, 3_000_000, true);
    expect(partial.state).toBe('UNDERFUNDED');
    if (partial.state === 'UNDERFUNDED') expect(partial.shortfall.toNumber()).toBe(2_000_000);
    const excess = rtn.bankTransferOutcome(5_000_000, 5_250_000, true);
    if (excess.state === 'ACTIVE') expect(excess.excessToWallet.toNumber()).toBe(250_000);
    expect(rtn.bankTransferOutcome(5_000_000, 5_000_000, false)).toMatchObject({ state: 'CANCELLED' });
  });

  test('rollover amount carries principal + net interest for at-maturity placements (T10 default)', () => {
    expect(rtn.rolloverAmount(10_000_000, 18, 180, 'AT_MATURITY').toFixed(2)).toBe('10798904.11');
    expect(rtn.rolloverAmount(10_000_000, 18, 180, 'UPFRONT').toFixed(2)).toBe('10000000.00');
  });
});
