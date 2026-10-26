import { expect } from '@wdio/globals';
import { D } from '../../../shared/calc/money';
import * as loans from '../../../shared/calc/loans';
import { Tag, title } from '../../../shared/support/tags';
import { QaHooks } from '../../../shared/api/qa-hooks';
import { freshCustomer, requireHooks } from '../../helpers/session';
import {
  PAYDAY_TERMS, nairaRe, notificationText, openBorrowTile, openLoan, openSeededLoan, seedPaydayTerms, walletBalance,
} from '../../helpers/loans';
import { LoanScheduleScreen, RepayFromWalletScreen } from '../../screens/loans/BorrowCommon';
import { PaydayLandingScreen, PaydayLoanScreen } from '../../screens/loans/PaydayScreens';

/**
 * Payday — on-loan view, payday auto-debit via Remita, retries, wallet fallback, repay early,
 * collections (Payday_Customer_App_Spec §5–§9, §11). Risk: repayment / debit = CRIT.
 *
 * Seeded loan `extra` contract: dailyRatePct, tenorDays, daysElapsed (days since disbursement), paydayInDays, salaryBank, mandateProvider, mandateStatus, overdueDays.
 */
describe('Payday › Repayment & servicing', () => {
  const AMOUNT = 150_000;
  const BANK = 'GTBank';
  const TENOR = PAYDAY_TERMS.termDays; // days selected at booking (7–30)
  const { interest: INTEREST, totalRepayable: TOTAL } = loans.proratedInterest(AMOUNT, PAYDAY_TERMS.dailyRatePct, TENOR);
  let hooks: QaHooks;
  let customerId: string;

  const loan = new PaydayLoanScreen();
  const repay = new RepayFromWalletScreen('payday');

  beforeEach(async function () {
    requireHooks(this);
    ({ hooks, customerId } = await freshCustomer({ tier: 2, walletBalance: 0, salaryDetected: true, monthlySalary: 450_000, employer: 'Access Bank Nigeria' }));
    await seedPaydayTerms(hooks);
  });

  afterEach(async () => {
    await hooks?.resetClock().catch(() => undefined);
    await hooks?.dispose();
  });

  async function seedPayday(extra: Record<string, unknown> = {}, state: 'ACTIVE' | 'DEBIT_FAILED' | 'OVERDUE' | 'IN_COLLECTIONS' | 'WRITTEN_OFF' = 'ACTIVE') {
    const paydayInDays = (extra.paydayInDays as number | undefined) ?? 12;
    const id = await openSeededLoan(hooks, customerId, 'PAYDAY', state, AMOUNT, {
      dailyRatePct: PAYDAY_TERMS.dailyRatePct, tenorDays: TENOR, daysElapsed: Math.max(0, TENOR - paydayInDays), paydayInDays,
      salaryBank: BANK, mandateProvider: 'REMITA', mandateStatus: 'ACTIVE', ...extra,
    });
    await loan.waitForShown();
    return id;
  }

  async function reopen(id: string) {
    await openLoan('PAYDAY', id);
    await loan.waitForShown();
  }

  describe('On-loan view (§5)', () => {
    it(title('payday countdown hero: days to payday, outstanding and amount to be auto-debited match the prorated oracle', Tag.crit, Tag.smoke, Tag.spec('Payday§5'), Tag.spec('Payday§10'), Tag.spec('LoanSpec§3.2')), async () => {
      await seedPayday({ paydayInDays: 12 });
      await expect(await loan.countdown()).toMatch(/\b12\b.*payday|payday.*\b12\b/i);
      await expect((await loan.outstanding()).toFixed(2)).toBe(TOTAL.toFixed(2));
      await expect((await loan.autoDebitAmount()).toFixed(2)).toBe(TOTAL.toFixed(2));
      await expect(await loan.paydayDate()).toBeTruthy();
      await expect((await loan.detailAmount('amount')).toFixed(2)).toBe(D(AMOUNT).toFixed(2));
      await expect((await loan.detailAmount('interest')).toFixed(2)).toBe(INTEREST.toFixed(2));
      await expect(await loan.detail('salaryAccount')).toContain(BANK);
      await expect(await loan.detail('mandateProvider')).toMatch(/Remita/i);
      await expect(await loan.detail('mandateStatus')).toMatch(/active/i);
      await expect(await loan.actionExists('viewSchedule')).toBe(true);
      await expect(await loan.actionExists('repayEarly')).toBe(true);
    });

    it(title('schedule shows mandate status and payday due date', Tag.med, Tag.spec('Payday§7')), async () => {
      await seedPayday();
      await loan.action('viewSchedule');
      const schedule = new LoanScheduleScreen('payday');
      await schedule.waitForShown();
      await expect(await schedule.mandateStatus()).toMatch(/active/i);
      await expect((await schedule.row(0).instalment()).toFixed(2)).toBe(TOTAL.toFixed(2));
    });

    it(title('salary account cannot be changed and mandate cannot be cancelled after mandate setup', Tag.crit, Tag.spec('Payday§7'), Tag.spec('Payday§11')), async () => {
      await seedPayday();
      await expect(await loan.salaryAccountEditable()).toBe(false);
      await expect(await loan.actionExists('changeSalaryAccount')).toBe(false);
      await expect(await loan.actionExists('cancelMandate')).toBe(false);
      await loan.action('viewSchedule');
      const schedule = new LoanScheduleScreen('payday');
      await schedule.waitForShown();
      await expect(await schedule.supportNote()).toMatch(/contact (us|support)/i);
    });
  });

  describe('Payday auto-debit (§6, §8, §9)', () => {
    it(title('3 days before payday: banner + reminder notification with auto-debit amount', Tag.high, Tag.spec('Payday§6'), Tag.spec('Payday§8')), async () => {
      const id = await seedPayday({ paydayInDays: 4 });
      await hooks.advanceClock({ customerId, days: 1 });
      await reopen(id);
      await expect(await loan.banner()).toMatch(new RegExp(`auto-debit ${nairaRe(TOTAL)} from your salary account`, 'i'));
      await expect(await notificationText(hooks, customerId)).toMatch(new RegExp(`Payday reminder: ${nairaRe(TOTAL)} will be auto-debited`, 'i'));
    });

    it(title('payday debit succeeds via Remita → Repaid and mandate cancelled; notification names the bank', Tag.crit, Tag.smoke, Tag.spec('Payday§6'), Tag.spec('Payday§7'), Tag.spec('Payday§8')), async () => {
      const id = await seedPayday({ paydayInDays: 1 });
      await hooks.stubProvider({ provider: 'REMITA', outcome: 'DEBIT_SUCCESS', customerId });
      await hooks.advanceClock({ customerId, days: 1 });
      await reopen(id);
      await expect(await loan.stateLabel()).toMatch(/repaid/i);
      await expect(await loan.detail('mandateStatus')).toMatch(/cancel|closed|inactive/i);
      await expect(await notificationText(hooks, customerId)).toMatch(new RegExp(`Payday loan is fully repaid\\. Debit of ${nairaRe(TOTAL)} from your ${BANK} account successful`, 'i'));
    });

    it(title('salary lands late: retries notify each attempt, then loan becomes Overdue', Tag.crit, Tag.spec('Payday§6'), Tag.spec('Payday§9')), async () => {
      const id = await seedPayday({ paydayInDays: 1 });
      await hooks.stubProvider({ provider: 'REMITA', outcome: 'INSUFFICIENT_FUNDS', customerId });
      await hooks.advanceClock({ customerId, days: 1 });
      await reopen(id);
      await expect(await loan.banner()).toMatch(/Automatic debit didn't go through\. We'll try again on .* or you can pay from wallet/i);
      await expect(await notificationText(hooks, customerId)).toMatch(new RegExp(`couldn't debit ${nairaRe(TOTAL)} from your account\\. We'll try again in \\d+ days?`, 'i'));
      await hooks.advanceClock({ customerId, days: PAYDAY_TERMS.debitRetries + 1 });
      const notes = await hooks.latestNotifications(customerId, 10);
      expect(notes.filter((n) => /couldn't debit/i.test(n.body)).length).toBeGreaterThanOrEqual(2);
      await reopen(id);
      await expect(await loan.stateLabel()).toMatch(/overdue/i);
      await expect(await loan.banner()).toMatch(/Overdue by \d+ days?\. ₦[\d,.]+ outstanding/i);
      await expect(await loan.actionExists('repayNow')).toBe(true);
      await expect(await loan.actionExists('contact')).toBe(true);
    });

    it(title('mandate fails on payday: wallet fallback debits exactly the total and closes the loan', Tag.crit, Tag.spec('Payday§6')), async () => {
      const id = await seedPayday({ paydayInDays: 1 });
      await hooks.setWalletBalance(customerId, 500_000);
      await hooks.stubProvider({ provider: 'REMITA', outcome: 'MANDATE_FAILED', customerId });
      await hooks.advanceClock({ customerId, days: 1 });
      await expect((await walletBalance()).toFixed(2)).toBe(D(500_000).minus(TOTAL).toFixed(2));
      await reopen(id);
      await expect(await loan.stateLabel()).toMatch(/repaid/i);
    });

    it(title('mandate fails and wallet is empty: Debit failed state with wallet repay option', Tag.crit, Tag.spec('Payday§6')), async () => {
      const id = await seedPayday({ paydayInDays: 1 });
      await hooks.stubProvider({ provider: 'REMITA', outcome: 'MANDATE_FAILED', customerId });
      await hooks.advanceClock({ customerId, days: 1 });
      await reopen(id);
      await expect(await loan.stateLabel()).toMatch(/debit failed|overdue/i);
      await expect(await loan.banner()).toMatch(/pay from wallet/i);
    });
  });

  describe('Repay early (§7)', () => {
    it(title('repay early from wallet: interest prorated on days used only, loan closes, wallet debited exactly, mandate cancelled', Tag.crit, Tag.spec('Payday§7'), Tag.spec('LoanSpec§3.2')), async () => {
      await hooks.setWalletBalance(customerId, 300_000);
      const daysUsed = 10;
      const early = loans.paydayEarlySettlement(AMOUNT, PAYDAY_TERMS.dailyRatePct, daysUsed, TENOR);
      expect(early.interest.toFixed(2)).toBe(loans.proratedInterest(AMOUNT, PAYDAY_TERMS.dailyRatePct, daysUsed).interest.toFixed(2));
      expect(early.interestSaved.gt(0)).toBe(true);
      const id = await seedPayday({ daysElapsed: daysUsed, paydayInDays: TENOR - daysUsed });
      await loan.action('repayEarly');
      await repay.waitForShown();
      // LoanSpec §3.2: early settlement recalculates interest on the active days used, not the full selected tenor.
      await expect((await repay.repayAmount()).toFixed(2)).toBe(early.totalRepayable.toFixed(2));
      await expect(await repay.source()).toMatch(/wallet/i);
      await expect(await repay.amountEditable()).toBe(false);
      await repay.confirm();
      await expect(await repay.successText()).toMatch(/closed|repaid/i);
      await expect((await walletBalance()).toFixed(2)).toBe(D(300_000).minus(early.totalRepayable).toFixed(2));
      await reopen(id);
      await expect(await loan.stateLabel()).toMatch(/repaid/i);
      await expect(await loan.detail('mandateStatus')).toMatch(/cancel/i);
    });

    it(title('after early repayment, payday passes without any Remita debit', Tag.crit, Tag.spec('Payday§7')), async () => {
      await hooks.setWalletBalance(customerId, 300_000);
      await seedPayday({ paydayInDays: 2 });
      await loan.action('repayEarly');
      await repay.waitForShown();
      await repay.confirm();
      await repay.successText();
      await hooks.stubProvider({ provider: 'REMITA', outcome: 'DEBIT_SUCCESS', customerId });
      await hooks.advanceClock({ customerId, days: 2 });
      const notes = await hooks.latestNotifications(customerId, 5);
      expect(notes.some((n) => /Debit of .* from your .* account successful/i.test(n.body))).toBe(false);
    });

    it(title('repay early with insufficient wallet is blocked with fund-wallet prompt', Tag.high, Tag.spec('Payday§7')), async () => {
      await seedPayday();
      await loan.action('repayEarly');
      await repay.confirm();
      await expect(await repay.insufficientShown()).toBe(true);
    });
  });

  describe('Collections & written off (§6, §8)', () => {
    it(title('overdue notification copy includes days and outstanding', Tag.med, Tag.spec('Payday§8')), async () => {
      await seedPayday({ overdueDays: 3 }, 'OVERDUE');
      await hooks.advanceClock({ customerId, days: 1 });
      await expect(await notificationText(hooks, customerId)).toMatch(/Payday is overdue by \d+ days?\. Please pay ₦[\d,.]+ from your wallet or contact us/i);
    });

    it(title('in collections: "Contact us to resolve" with contact CTA and notification', Tag.high, Tag.spec('Payday§6'), Tag.spec('Payday§8')), async () => {
      await seedPayday({ overdueDays: 40 }, 'IN_COLLECTIONS');
      await expect(await loan.banner()).toMatch(/Contact us to resolve/i);
      await expect(await loan.actionExists('contact')).toBe(true);
      await expect(await notificationText(hooks, customerId)).toMatch(/Payday has been handed to collections/i);
    });

    it(title('written off: terminal and blocks new Payday applications', Tag.crit, Tag.spec('Payday§6')), async () => {
      await seedPayday({}, 'WRITTEN_OFF');
      await expect(await loan.stateLabel()).toMatch(/written off/i);
      await openBorrowTile('payday');
      const landing = new PaydayLandingScreen();
      await landing.waitForShown();
      await expect(await landing.constraint()).toMatch(/written off|contact us/i);
      if (await landing.applyShown()) await expect(await landing.applyEnabled()).toBe(false);
    });
  });
});
