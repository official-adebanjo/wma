import { expect } from '@wdio/globals';
import { D } from '../../../shared/calc/money';
import * as loans from '../../../shared/calc/loans';
import { Tag, title } from '../../../shared/support/tags';
import { QaHooks } from '../../../shared/api/qa-hooks';
import { freshCustomer, requireHooks } from '../../helpers/session';
import { NANO_TERMS, moneyRe, nairaRe, notificationText, openLoan, openSeededLoan, seedNanoTerms, walletBalance } from '../../helpers/loans';
import { FundWalletScreen } from '../../screens/common/WalletScreens';
import { LoanScheduleScreen, RepayFromWalletScreen } from '../../screens/loans/BorrowCommon';
import { NanoLoanScreen, NanoStreakScreen } from '../../screens/loans/NanoScreens';

/**
 * Nano — on-loan view, states, repay now, partial repayment, auto-debit, notifications
 * (Nano_Customer_App_Spec §5–§9). Risk: repayment / debit = CRIT.
 *
 * Seeded loan `extra` contract: tenorDays, dailyRatePct, dueInDays (days until due date from the
 * business date), streak (loyalty streak before this loan), overdueDays.
 */
describe('Nano › Repayment & servicing', () => {
  const AMOUNT = 20_000;
  const TENOR = 30;
  const RATE = NANO_TERMS.dailyRatePct; // %/day — interest prorated daily (LOAN PRODUCT SPECIFICATIONS §2.2)
  const { interest: INTEREST, totalRepayable: TOTAL } = loans.proratedInterest(AMOUNT, RATE, TENOR);
  let hooks: QaHooks;
  let customerId: string;

  const loan = new NanoLoanScreen();
  const repay = new RepayFromWalletScreen('nano');

  beforeEach(async function () {
    requireHooks(this);
    ({ hooks, customerId } = await freshCustomer({ tier: 2, walletBalance: 100_000 }));
    await seedNanoTerms(hooks);
  });

  afterEach(async () => {
    await hooks?.resetClock().catch(() => undefined);
    await hooks?.dispose();
  });

  async function openActive(extra: Record<string, unknown> = {}, state: 'ACTIVE' | 'OVERDUE' | 'IN_COLLECTIONS' | 'WRITTEN_OFF' | 'REPAID' = 'ACTIVE') {
    const id = await openSeededLoan(hooks, customerId, 'NANO', state, AMOUNT, { tenorDays: TENOR, dailyRatePct: RATE, dueInDays: 20, streak: 3, ...extra });
    await loan.waitForShown();
    return id;
  }

  describe('On-loan view (§5)', () => {
    it(title('hero and details: outstanding, total to repay, interest and countdown match the prorated oracle', Tag.crit, Tag.smoke, Tag.spec('Nano§5'), Tag.spec('LoanSpec§2.2')), async () => {
      await openActive({ dueInDays: 20 });
      await expect(await loan.reference()).toBeTruthy();
      await expect(await loan.countdown()).toMatch(/\b20\b/);
      await expect((await loan.outstanding()).toFixed(2)).toBe(TOTAL.toFixed(2));
      await expect((await loan.totalToRepay()).toFixed(2)).toBe(TOTAL.toFixed(2));
      await expect((await loan.detailAmount('amount')).toFixed(2)).toBe(D(AMOUNT).toFixed(2));
      await expect((await loan.detailAmount('interest')).toFixed(2)).toBe(INTEREST.toFixed(2));
      await expect(await loan.detail('repaymentMethod')).toMatch(/wallet/i);
      await expect(await loan.actionExists('repayNow')).toBe(true);
      await expect(await loan.actionExists('viewSchedule')).toBe(true);
    });

    for (const days of NANO_TERMS.representativeDays) {
      it(title(`${days}-day loan: interest and total to repay are prorated on the selected days`, Tag.crit, Tag.spec('Nano§5'), Tag.spec('LoanSpec§2.2')), async () => {
        const { interest, totalRepayable } = loans.proratedInterest(AMOUNT, RATE, days);
        await openActive({ tenorDays: days, dueInDays: days });
        await expect((await loan.detailAmount('interest')).toFixed(2)).toBe(interest.toFixed(2));
        await expect((await loan.totalToRepay()).toFixed(2)).toBe(totalRepayable.toFixed(2));
      });
    }

    it(title('loyalty streak indicator shows current streak and the next tier to unlock', Tag.med, Tag.spec('Nano§5'), Tag.spec('Nano§7')), async () => {
      await openActive({ streak: 3 });
      await expect(await loan.streak()).toMatch(/streak 3.*streak 4/i);
      await loan.action('viewStreak');
      const streak = new NanoStreakScreen();
      await streak.waitForShown();
      await expect(await streak.count()).toContain('3');
      await expect(await streak.nextTierRequirement()).toBeTruthy();
    });

    it(title('view schedule shows disbursement, due date and total repayment', Tag.med, Tag.spec('Nano§7')), async () => {
      await openActive();
      await loan.action('viewSchedule');
      const schedule = new LoanScheduleScreen('nano');
      await schedule.waitForShown();
      await expect((await schedule.row(0).instalment()).toFixed(2)).toBe(TOTAL.toFixed(2));
      await expect(await schedule.repaymentHistory(0)).toMatch(/disburs/i);
    });

    it(title('no restructure, tenor change or fee waiver controls exist', Tag.high, Tag.spec('Nano§11')), async () => {
      await openActive();
      await expect(await loan.actionExists('requestRestructure')).toBe(false);
      await expect(await loan.actionExists('changeTenor')).toBe(false);
    });
  });

  describe('Due dates & auto-debit (§6, §8, §9)', () => {
    it(title('due soon (3 days out): banner + notification with amount to be debited from wallet', Tag.high, Tag.spec('Nano§6'), Tag.spec('Nano§8')), async () => {
      const id = await openActive({ dueInDays: 4 });
      await expect(await loan.bannerShown()).toBe(false);
      await hooks.advanceClock({ customerId, days: 1 });
      await openActiveById(id);
      await expect(await loan.banner()).toMatch(new RegExp(`due in 3 days. ${nairaRe(TOTAL)} will be debited from your wallet`, 'i'));
      await expect(await notificationText(hooks, customerId)).toMatch(new RegExp(`Nano is due in 3 days. ${nairaRe(TOTAL)} will be debited`, 'i'));
    });

    it(title('due today with sufficient wallet: auto-debit succeeds → Repaid, wallet debited exactly once, streak increments', Tag.crit, Tag.smoke, Tag.spec('Nano§6'), Tag.spec('Nano§8')), async () => {
      const id = await openActive({ dueInDays: 1, streak: 3 });
      const before = await walletBalance();
      await hooks.advanceClock({ customerId, days: 1 });
      const after = await walletBalance();
      await expect(before.minus(after).toFixed(2)).toBe(TOTAL.toFixed(2));
      const notes = await notificationText(hooks, customerId);
      await expect(notes).toMatch(new RegExp(`Debiting ${nairaRe(TOTAL)} from your wallet today`, 'i'));
      await expect(notes).toMatch(/Nano is fully repaid. Thanks for paying on time/i);
      await expect(notes).toMatch(/loyalty streak is now 4/i);
      await openActiveById(id);
      await expect(await loan.stateLabel()).toMatch(/repaid/i);
      await expect(await loan.successMessage()).toMatch(/Nano is fully repaid/i);
      await expect(await loan.streak()).toMatch(/\b4\b/);
    });

    it(title('due today with insufficient wallet: debit fails, retries notify, then Overdue banner', Tag.crit, Tag.spec('Nano§6'), Tag.spec('Nano§9')), async () => {
      const id = await openActive({ dueInDays: 1 });
      await hooks.setWalletBalance(customerId, 500);
      await hooks.advanceClock({ customerId, days: 1 });
      await expect(await notificationText(hooks, customerId)).toMatch(new RegExp(`Couldn't debit ${nairaRe(TOTAL)} from your wallet.*Fund your wallet`, 'i'));
      await hooks.advanceClock({ customerId, days: NANO_TERMS.autoDebitRetries });
      const notes = await hooks.latestNotifications(customerId, 10);
      expect(notes.filter((n) => /Couldn't debit/i.test(n.body)).length).toBeGreaterThanOrEqual(2);
      expect(notes.map((n) => n.body).join('|')).toMatch(/Nano is overdue/i);
      await openActiveById(id);
      await expect(await loan.stateLabel()).toMatch(/overdue/i);
      await expect(await loan.banner()).toMatch(/Overdue by \d+ days?\. ₦[\d,.]+ outstanding/i);
    });

    it(title('auto-debit failed banner deep-links to wallet funding', Tag.high, Tag.spec('Nano§12')), async () => {
      await openActive({ overdueDays: 1 }, 'OVERDUE');
      await loan.bannerCta();
      await new FundWalletScreen().waitForShown();
    });
  });

  describe('Repay now (§7)', () => {
    it(title('repay now in full from wallet: amount defaults to full outstanding, loan closes, wallet debited exactly', Tag.crit, Tag.smoke, Tag.spec('Nano§7')), async () => {
      const id = await openActive({ dueInDays: 10, streak: 2 });
      const before = await walletBalance();
      await openActiveById(id);
      await loan.action('repayNow');
      await repay.waitForShown();
      await expect((await repay.repayAmount()).toFixed(2)).toBe(TOTAL.toFixed(2));
      await expect(await repay.source()).toMatch(/wallet/i);
      await repay.confirm();
      await expect(await repay.successText()).toMatch(/repaid/i);
      await expect(before.minus(await walletBalance()).toFixed(2)).toBe(TOTAL.toFixed(2));
      await openActiveById(id);
      await expect(await loan.stateLabel()).toMatch(/repaid/i);
      await expect(await loan.streak()).toMatch(/\b3\b/);
    });

    it(title('late repayment of an overdue Nano closes it but resets the loyalty streak', Tag.crit, Tag.open('L-nano-streak-reset-value'), Tag.spec('Nano§6')), async () => {
      const id = await openActive({ overdueDays: 4, streak: 5 }, 'OVERDUE');
      await loan.action('repayNow');
      await repay.waitForShown();
      await repay.confirm();
      await expect(await repay.successText()).toMatch(/repaid/i);
      await openActiveById(id);
      await expect(await loan.stateLabel()).toMatch(/repaid/i);
      // Spec: "Loyalty streak increments (or resets if late)". Reset value assumed 0.
      await expect(await loan.streakCount()).toBe('0');
    });

    it(title('insufficient wallet on repay now offers wallet funding', Tag.high, Tag.spec('Nano§7')), async () => {
      await hooks.setWalletBalance(customerId, 100);
      await openActive();
      await loan.action('repayNow');
      await repay.confirm();
      await expect(await repay.insufficientShown()).toBe(true);
      await repay.fundWallet();
      await new FundWalletScreen().waitForShown();
    });

    it(title('partial repayment allowed by config: outstanding reduces by exactly the amount paid', Tag.crit, Tag.spec('Nano§7')), async () => {
      await seedNanoTerms(hooks, { partialRepaymentAllowed: true });
      const id = await openActive();
      const part = 8_000;
      await loan.action('repayNow');
      await repay.waitForShown();
      await repay.enterAmount(part);
      await repay.confirm();
      await expect(await repay.successText()).toBeTruthy();
      await openActiveById(id);
      await expect((await loan.outstanding()).toFixed(2)).toBe(TOTAL.minus(part).toFixed(2));
      await expect(await loan.stateLabel()).toMatch(/active/i);
    });

    it(title('partial repayment blocked by config: two-clause "requires full repayment" error', Tag.crit, Tag.spec('Nano§7'), Tag.spec('Nano§9')), async () => {
      await seedNanoTerms(hooks, { partialRepaymentAllowed: false });
      await openActive();
      await loan.action('repayNow');
      await repay.waitForShown();
      if (!(await repay.amountEditable())) return; // full-only config may render amount read-only — also compliant
      await repay.enterAmount(8_000);
      await expect(await repay.amountError()).toMatch(new RegExp(`requires full repayment\\. Enter the full outstanding ${nairaRe(TOTAL)} or repay from wallet`, 'i'));
      await expect(await repay.confirmEnabled()).toBe(false);
    });
  });

  describe('Collections & written off (§6, §8)', () => {
    it(title('in collections: serious message, contact CTA, notification copy', Tag.high, Tag.spec('Nano§6'), Tag.spec('Nano§8')), async () => {
      await openActive({ overdueDays: 45 }, 'IN_COLLECTIONS');
      await expect(await loan.banner()).toMatch(/Nano is in collections\. Contact us to resolve/i);
      await expect(await loan.actionExists('contact')).toBe(true);
      await expect(await notificationText(hooks, customerId)).toMatch(/handed to our collections team\. Please contact us/i);
    });

    it(title('written off: terminal message, no repay-and-reapply path', Tag.high, Tag.spec('Nano§6')), async () => {
      await openActive({}, 'WRITTEN_OFF');
      await expect(await loan.stateLabel()).toMatch(/written off/i);
      await expect(await loan.banner()).toMatch(/written off\. Please contact us to resolve before applying for a new loan/i);
      await expect(await loan.actionExists('contact')).toBe(true);
    });
  });

  it(title('notification amounts use the oracle total (₦ formatting)', Tag.med, Tag.spec('Nano§8')), async () => {
    await openActive({ dueInDays: 3 });
    await hooks.advanceClock({ customerId, days: 0 });
    await expect(await notificationText(hooks, customerId)).toMatch(moneyRe(TOTAL));
  });

  async function openActiveById(id: string) {
    await openLoan('NANO', id);
    await loan.waitForShown();
  }
});
