import { expect } from '@wdio/globals';
import { D } from '../../../shared/calc/money';
import * as loans from '../../../shared/calc/loans';
import { Tag, title } from '../../../shared/support/tags';
import { QaHooks } from '../../../shared/api/qa-hooks';
import { freshCustomer, requireHooks } from '../../helpers/session';
import {
  INTEREST_MODELS, PERSONAL_TERMS, modelTitle, nairaRe, notificationText, openBorrowTile, openLoan, openSeededLoan, seedPersonalTerms, walletBalance,
} from '../../helpers/loans';
import { EarlySettlementScreen, LoanScheduleScreen, RepayFromWalletScreen } from '../../screens/loans/BorrowCommon';
import { PersonalLandingScreen, PersonalLoanScreen, PersonalRestructureRequestScreen } from '../../screens/loans/PersonalLoanScreens';

/**
 * Personal Loan — on-loan view, schedule, repay next early, early settlement, reminders, debit
 * failure, overdue catch-up, restructure, terminal states (Personal_Loan_Customer_App_Spec §3, §5–§9, §11).
 * Risk: schedule / settlement / catch-up maths and repayment = CRIT.
 *
 * Interest engine (LOAN PRODUCT SPECIFICATIONS §4.2): admin-configurable per product — Model A
 * "Monthly equal" (flat) or Model B "Monthly reducing" — so every money assertion runs under both,
 * with the model seeded on the product via setProductConfig({ interestModel }).
 *
 * Seeded loan `extra` contract: monthlyRatePct, interestModel, tenorMonths, instalmentsPaid, nextDueInDays,
 * daysSinceLastDue, missedInstalments, overdueDays, restructure { remainingMonths, monthlyRatePct }.
 *
 * ASSUMPTION: hero "Outstanding" = outstanding principal (balance after the last paid instalment).
 */
describe('Personal Loan › Servicing', () => {
  const PRINCIPAL = 1_200_000;
  const RATE = PERSONAL_TERMS.monthlyRatePct; // % per month
  const TENOR = 12;
  const PAID = 3;
  /** Outstanding principal after PAID instalments — identical under both models (equal principal P/N). */
  const OUTSTANDING = loans.loanSchedule(PRINCIPAL, RATE, TENOR, 'B')[PAID - 1].balanceAfter;
  let hooks: QaHooks;
  let customerId: string;

  const loan = new PersonalLoanScreen();
  const repay = new RepayFromWalletScreen('personal');
  const settlement = new EarlySettlementScreen('personal');

  beforeEach(async function () {
    requireHooks(this);
    ({ hooks, customerId } = await freshCustomer({ tier: 2, walletBalance: 3_000_000, salaryDetected: true, monthlySalary: 600_000, employer: 'Dangote Cement' }));
    await seedPersonalTerms(hooks);
  });

  afterEach(async () => {
    await hooks?.resetClock().catch(() => undefined);
    await hooks?.dispose();
  });

  async function seed(
    state: 'ACTIVE' | 'DEBIT_FAILED' | 'OVERDUE' | 'RESTRUCTURED' | 'IN_COLLECTIONS' | 'WRITTEN_OFF' | 'REPAID' = 'ACTIVE',
    extra: Record<string, unknown> = {},
    model: loans.InterestModel = PERSONAL_TERMS.interestModel,
  ) {
    await seedPersonalTerms(hooks, { interestModel: model });
    const id = await openSeededLoan(hooks, customerId, 'PERSONAL', state, PRINCIPAL, {
      monthlyRatePct: RATE, interestModel: model, tenorMonths: TENOR, instalmentsPaid: PAID, nextDueInDays: 20, daysSinceLastDue: 10, ...extra,
    });
    await loan.waitForShown();
    return id;
  }

  async function reopen(id: string) {
    await openLoan('PERSONAL', id);
    await loan.waitForShown();
  }

  for (const model of INTEREST_MODELS) {
    const M = modelTitle(model);
    const schedule = loans.loanSchedule(PRINCIPAL, RATE, TENOR, model);

    describe(`${M} — on-loan view & schedule (§5, §7)`, () => {
      it(title(`${M}: hero — outstanding, next repayment amount, progress bar (paid / total) match the schedule oracle`, Tag.crit, Tag.smoke, Tag.spec('Personal§5'), Tag.spec('LoanSpec§4.2')), async () => {
        await seed('ACTIVE', {}, model);
        await expect((await loan.outstanding()).toFixed(2)).toBe(OUTSTANDING.toFixed(2));
        await expect((await loan.nextAmount()).toFixed(2)).toBe(schedule[PAID].totalDue.toFixed(2));
        await expect(await loan.progress()).toMatch(new RegExp(`\\b${PAID}\\b.*\\b${TENOR}\\b`));
        await expect(await loan.monthsRemaining()).toMatch(new RegExp(`\\b${TENOR - PAID}\\b`));
        await expect((await loan.detailAmount('amount')).toFixed(2)).toBe(D(PRINCIPAL).toFixed(2));
        await expect(await loan.detail('rate')).toContain(`${RATE}%`);
        // ASSUMPTION: "monthly" detail = month-1 instalment (highest; equal to all months under Model A).
        await expect((await loan.detailAmount('monthly')).toFixed(2)).toBe(schedule[0].totalDue.toFixed(2));
        await expect((await loan.detailAmount('totalInterest')).toFixed(2)).toBe(loans.scheduleTotals(schedule).interest.toFixed(2));
        await expect(await loan.detail('mandateStatus')).toMatch(/active/i);
      });

      it(title(`${M}: schedule preview shows the next 3–6 instalments with oracle amounts`, Tag.crit, Tag.spec('Personal§5'), Tag.spec('LoanSpec§4.2')), async () => {
        await seed('ACTIVE', {}, model);
        let shown = 0;
        for (let i = 0; i < 6 && PAID + i < TENOR; i++) {
          const row = loan.schedulePreviewRow(i);
          if (!(await row.shown())) break;
          await expect((await row.amount()).toFixed(2)).toBe(schedule[PAID + i].totalDue.toFixed(2));
          shown++;
        }
        expect(shown).toBeGreaterThanOrEqual(3);
      });

      it(title(`${M}: full schedule — every row (instalment, interest, principal, balance) matches loanSchedule and closes at zero`, Tag.crit, Tag.spec('Personal§7'), Tag.spec('Personal§10'), Tag.spec('LoanSpec§4.2'), Tag.spec('LoanSpec§4.3')), async () => {
        await seed('ACTIVE', {}, model);
        await loan.action('viewSchedule');
        const s = new LoanScheduleScreen('personal');
        await s.waitForShown();
        for (let i = 0; i < TENOR; i++) {
          await s.scrollTo(`personal.schedule.row.${i}`);
          const row = s.row(i);
          await expect((await row.instalment()).toFixed(2)).toBe(schedule[i].totalDue.toFixed(2));
          await expect((await row.interest()).toFixed(2)).toBe(schedule[i].interest.toFixed(2));
          await expect((await row.principal()).toFixed(2)).toBe(schedule[i].principal.toFixed(2));
          await expect((await row.balance()).toFixed(2)).toBe(schedule[i].balanceAfter.toFixed(2));
          await expect(await row.status()).toMatch(i < PAID ? /paid/i : /upcoming|due/i);
        }
        expect(schedule[TENOR - 1].balanceAfter.toFixed(2)).toBe('0.00');
        await expect(await s.mandateStatus()).toMatch(/active/i);
        await expect(await s.nextDebitDate()).toBeTruthy();
      });
    });

    describe(`${M} — customer-initiated repayments (§7)`, () => {
      it(title(`${M}: repay next instalment early — wallet debited by exactly one instalment, progress advances, schedule shifts by one`, Tag.crit, Tag.spec('Personal§7'), Tag.spec('LoanSpec§4.2')), async () => {
        const id = await seed('ACTIVE', {}, model);
        const before = await walletBalance();
        await reopen(id);
        await loan.action('repayNext');
        await repay.waitForShown();
        await expect((await repay.repayAmount()).toFixed(2)).toBe(schedule[PAID].totalDue.toFixed(2));
        await expect(await repay.source()).toMatch(/wallet/i);
        await repay.confirm();
        await expect(await repay.successText()).toMatch(/paid/i);
        await expect(before.minus(await walletBalance()).toFixed(2)).toBe(schedule[PAID].totalDue.toFixed(2));
        await reopen(id);
        await expect(await loan.progress()).toMatch(new RegExp(`\\b${PAID + 1}\\b.*\\b${TENOR}\\b`));
        await expect((await loan.schedulePreviewRow(0).amount()).toFixed(2)).toBe(schedule[PAID + 1].totalDue.toFixed(2));
      });

      for (const k of [1, PAID + 1, TENOR]) {
        it(title(`${M}: early payoff in month ${k} = outstanding principal + month-${k} interest; later interest waived; no fee`, Tag.crit, Tag.spec('Personal§7'), Tag.spec('Personal§10'), Tag.spec('LoanSpec§4.4')), async () => {
          const expected = loans.earlyPayoff(PRINCIPAL, RATE, TENOR, model, k);
          await seed('ACTIVE', { instalmentsPaid: k - 1 }, model);
          await loan.action('earlySettlement');
          await settlement.waitForShown();
          await expect((await settlement.principal()).toFixed(2)).toBe(expected.outstandingPrincipal.toFixed(2));
          await expect((await settlement.accruedInterest()).toFixed(2)).toBe(expected.activeMonthInterest.toFixed(2));
          await expect((await settlement.total()).toFixed(2)).toBe(expected.payoff.toFixed(2));
          // LoanSpec §4.4: no penalty / fee on early repayment.
          if (await settlement.feeShown()) await expect((await settlement.fee()).toFixed(2)).toBe('0.00');
          if (await settlement.waivedInterestShown()) await expect((await settlement.waivedInterest()).toFixed(2)).toBe(expected.waivedInterest.toFixed(2));
        });
      }

      it(title(`${M}: early settlement confirm — "closes your loan in full", wallet debited exactly the payoff, loan closed, mandate cancelled`, Tag.crit, Tag.smoke, Tag.spec('Personal§7'), Tag.spec('LoanSpec§4.4')), async () => {
        const id = await seed('ACTIVE', {}, model);
        const expected = loans.earlyPayoff(PRINCIPAL, RATE, TENOR, model, PAID + 1).payoff;
        const before = await walletBalance();
        await reopen(id);
        await loan.action('earlySettlement');
        await settlement.waitForShown();
        await settlement.continue();
        await settlement.chooseSource('wallet');
        await expect(await settlement.confirmNote()).toMatch(/This closes your loan in full/i);
        await expect((await settlement.confirmAmount()).toFixed(2)).toBe(expected.toFixed(2));
        await settlement.confirm();
        await expect(await settlement.successText()).toMatch(/closed/i);
        await expect(before.minus(await walletBalance()).toFixed(2)).toBe(expected.toFixed(2));
        await reopen(id);
        await expect(await loan.stateLabel()).toMatch(/repaid|closed/i);
        await expect(await loan.detail('mandateStatus')).toMatch(/cancel/i);
      });
    });

    describe(`${M} — reminders, debits and overdue (§6, §8)`, () => {
      it(title(`${M}: ${PERSONAL_TERMS.reminderDaysBefore}-day reminder — banner + notification with instalment amount`, Tag.high, Tag.spec('Personal§6'), Tag.spec('Personal§8'), Tag.spec('LoanSpec§4.2')), async () => {
        const id = await seed('ACTIVE', { nextDueInDays: PERSONAL_TERMS.reminderDaysBefore + 1 }, model);
        await hooks.advanceClock({ customerId, days: 1 });
        await reopen(id);
        const amt = nairaRe(schedule[PAID].totalDue);
        await expect(await loan.banner()).toMatch(new RegExp(`${amt} due on .* via automatic debit`, 'i'));
        await expect(await notificationText(hooks, customerId)).toMatch(new RegExp(`Reminder: ${amt} will be auto-debited on`, 'i'));
      });

      it(title(`${M}: auto-debit success — "Repayment of ₦X received. N payments remaining."`, Tag.crit, Tag.spec('Personal§6'), Tag.spec('Personal§8'), Tag.spec('LoanSpec§4.2')), async () => {
        const id = await seed('ACTIVE', { nextDueInDays: 1 }, model);
        await hooks.stubProvider({ provider: 'REMITA', outcome: 'DEBIT_SUCCESS', customerId });
        await hooks.advanceClock({ customerId, days: 1 });
        await expect(await notificationText(hooks, customerId)).toMatch(new RegExp(`Repayment of ${nairaRe(schedule[PAID].totalDue)} received\\. ${TENOR - PAID - 1} payments remaining`, 'i'));
        await reopen(id);
        await expect(await loan.progress()).toMatch(new RegExp(`\\b${PAID + 1}\\b`));
      });

      it(title(`${M}: debit failed — amber "Missed repayment. We'll retry on [date]" with wallet option + notification`, Tag.crit, Tag.spec('Personal§6'), Tag.spec('Personal§8')), async () => {
        const id = await seed('ACTIVE', { nextDueInDays: 1 }, model);
        await hooks.stubProvider({ provider: 'REMITA', outcome: 'INSUFFICIENT_FUNDS', customerId });
        await hooks.advanceClock({ customerId, days: 1 });
        await reopen(id);
        await expect(await loan.banner()).toMatch(/Missed repayment\. We'll retry on/i);
        await expect(await loan.actionExists('repayNow') || await loan.actionExists('catchUp')).toBe(true);
        await expect(await notificationText(hooks, customerId)).toMatch(new RegExp(`couldn't debit ${nairaRe(schedule[PAID].totalDue)} from your account\\. We'll retry in \\d+ days?`, 'i'));
      });

      it(title(`${M}: overdue — catch-up amount = missed instalments + late fees (oracle) and catch-up clears arrears`, Tag.crit, Tag.spec('Personal§6'), Tag.spec('Personal§7')), async () => {
        const missed = 2;
        const lateFees = PERSONAL_TERMS.lateFeePerMissedInstalment * missed;
        const id = await seed('OVERDUE', { missedInstalments: missed, overdueDays: 35, lateFees }, model);
        const expected = loans.catchUpAmount([schedule[PAID].totalDue, schedule[PAID + 1].totalDue], lateFees);
        await expect(await loan.banner()).toMatch(/overdue/i);
        await loan.bannerCta(); // "Catch up now"
        await repay.waitForShown();
        await expect((await repay.repayAmount()).toFixed(2)).toBe(expected.toFixed(2));
        await repay.confirm();
        await expect(await repay.successText()).toBeTruthy();
        await reopen(id);
        await expect(await loan.stateLabel()).toMatch(/active/i);
        await expect(await loan.bannerShown()).toBe(false);
      });
    });

    describe(`${M} — restructure (§6, §7)`, () => {
      it(title(`${M}: restructured by admin — notification + on-loan view and schedule reflect new terms (oracle)`, Tag.crit, Tag.spec('Personal§6'), Tag.spec('Personal§8'), Tag.spec('LoanSpec§4.2')), async () => {
        const remainingMonths = 15;
        await seed('RESTRUCTURED', { restructure: { remainingMonths, monthlyRatePct: RATE } }, model);
        const newSchedule = loans.loanSchedule(OUTSTANDING, RATE, remainingMonths, model);
        await expect(await notificationText(hooks, customerId)).toMatch(/Personal Loan has been restructured\. New terms:/i);
        await expect((await loan.nextAmount()).toFixed(2)).toBe(newSchedule[0].totalDue.toFixed(2));
        await expect((await loan.schedulePreviewRow(0).amount()).toFixed(2)).toBe(newSchedule[0].totalDue.toFixed(2));
        await expect(await loan.monthsRemaining()).toMatch(new RegExp(`\\b${remainingMonths}\\b`));
      });
    });
  }

  describe('Reminders, debits and overdue (§6, §8)', () => {
    it(title('overdue notification: days overdue + outstanding + "Catch up now"', Tag.med, Tag.spec('Personal§8')), async () => {
      await seed('OVERDUE', { missedInstalments: 1, overdueDays: 5 });
      await hooks.advanceClock({ customerId, days: 1 });
      await expect(await notificationText(hooks, customerId)).toMatch(/Personal Loan is overdue by \d+ days?\. ₦[\d,.]+ outstanding\. Catch up now/i);
    });
  });

  describe('Restructure (§6, §7, §11)', () => {
    it(title('request restructure is support-only: explanation + reason, no self-service term editor', Tag.high, Tag.spec('Personal§7'), Tag.spec('Personal§11')), async () => {
      await seed();
      await expect(await loan.actionExists('changeTenor')).toBe(false);
      await expect(await loan.actionExists('changeRepaymentDay')).toBe(false);
      await expect(await loan.actionExists('changeSalaryAccount')).toBe(false);
      await loan.action('support');
      await loan.action('requestRestructure');
      const req = new PersonalRestructureRequestScreen();
      await req.waitForShown();
      await expect(await req.explanation()).toMatch(/manual|review/i);
      await expect(await req.termEditorShown()).toBe(false);
      await req.pickReason('salaryReduction');
      await req.submit();
      await expect(await req.confirmation()).toMatch(/review/i);
    });
  });

  describe('Terminal states & constraints (§3, §6, §9)', () => {
    it(title('in collections: handed-to-collections copy and contact CTA', Tag.high, Tag.spec('Personal§6'), Tag.spec('Personal§8')), async () => {
      await seed('IN_COLLECTIONS', { overdueDays: 90 });
      await expect(await loan.stateLabel()).toMatch(/collections/i);
      await expect(await loan.actionExists('contact')).toBe(true);
      await expect(await notificationText(hooks, customerId)).toMatch(/Personal Loan has been handed to our collections team/i);
    });

    it(title('written off: terminal and blocks future loans until resolved', Tag.crit, Tag.spec('Personal§6')), async () => {
      await seed('WRITTEN_OFF');
      await expect(await loan.stateLabel()).toMatch(/written off/i);
      await openBorrowTile('personal');
      const landing = new PersonalLandingScreen();
      await landing.waitForShown();
      await expect(await landing.constraint()).toMatch(/written off|contact us/i);
      if (await landing.applyShown()) await expect(await landing.applyEnabled()).toBe(false);
    });

    it(title('fully repaid: success copy, record accessible, eligible for next loan', Tag.high, Tag.spec('Personal§6'), Tag.spec('Personal§8')), async () => {
      await seed('REPAID', { instalmentsPaid: TENOR });
      await expect(await loan.successMessage()).toMatch(/Your Personal Loan is fully repaid/i);
      await openBorrowTile('personal');
      const landing = new PersonalLandingScreen();
      await landing.waitForShown();
      await expect(await landing.applyEnabled()).toBe(true);
    });

    it(title('one active Personal Loan at a time: landing shows loan card + "closes on [date]" and no Apply', Tag.crit, Tag.spec('Personal§3'), Tag.spec('Personal§9')), async () => {
      await seed();
      await openBorrowTile('personal');
      const landing = new PersonalLandingScreen();
      await landing.waitForShown();
      await expect(await landing.activeLoanShown()).toBe(true);
      await expect((await landing.activeLoan().outstanding()).toFixed(2)).toBe(OUTSTANDING.toFixed(2));
      await expect(await landing.activeLoan().remaining()).toMatch(new RegExp(`\\b${TENOR - PAID}\\b`));
      await expect(await landing.constraint()).toMatch(/one active Personal Loan/i);
      await expect(await landing.applyShown()).toBe(false);
    });
  });
});
