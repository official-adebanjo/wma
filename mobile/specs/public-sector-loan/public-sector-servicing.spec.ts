import { expect } from '@wdio/globals';
import { D } from '../../../shared/calc/money';
import * as loans from '../../../shared/calc/loans';
import { Tag, title } from '../../../shared/support/tags';
import { QaHooks } from '../../../shared/api/qa-hooks';
import { freshCustomer, requireHooks } from '../../helpers/session';
import {
  CORRIDORS, CorridorFixture, INTEREST_MODELS, PUBLIC_SECTOR_DEFAULT_MODEL, SYSTEM_CODE_OR_JARGON, expectNoVisibleText, modelTitle, nairaRe,
  notificationText, openLoan, openSeededLoan, seedCorridors, walletBalance,
} from '../../helpers/loans';
import { EarlySettlementScreen, LoanScheduleScreen, RepayFromWalletScreen } from '../../screens/loans/BorrowCommon';
import { PublicSectorLoanScreen } from '../../screens/loans/PublicSectorScreens';

/**
 * Public Sector Loan — on-loan view, payroll deduction events, batch-late / deduction-missed states,
 * early settlement (wallet + bank transfer), out-of-cycle repayment, restructure, fully repaid
 * (Public_Sector_Loan_Customer_App_Spec §5–§9). Risk: settlement maths & repayment = CRIT.
 *
 * Interest engine: same admin-configurable Model A "Monthly equal" / Model B "Monthly reducing" as
 * Personal (LOAN PRODUCT SPECIFICATIONS §4.2), seeded via setProductConfig({ interestModel }); every
 * money assertion runs under both. Corridor rates are quoted p.a.; the engine applies rate ÷ 12 monthly.
 * Early payoff (§4.4): outstanding principal + active-month interest, later interest waived, no fee.
 *
 * Seeded loan `extra` contract: corridor (employer name), ratePct (p.a.), monthlyRatePct, interestModel,
 * tenorMonths, instalmentsPaid, nextDeductionInDays, daysSinceLastDue, restructure { remainingMonths, monthlyRatePct }.
 * ASSUMPTION: hero "Outstanding" = outstanding principal.
 */
describe('Public Sector Loan › Servicing', () => {
  const FED = CORRIDORS.federal;
  const LAG = CORRIDORS.lagos;
  const PRINCIPAL = 2_000_000;
  const TENOR = 24;
  const PAID = 4;
  let hooks: QaHooks;
  let customerId: string;

  const loan = new PublicSectorLoanScreen();
  const settlement = new EarlySettlementScreen('publicSector');
  const repay = new RepayFromWalletScreen('publicSector');

  const monthlyRate = (c: CorridorFixture) => loans.monthlyFromAnnual(c.ratePct);
  const scheduleFor = (c: CorridorFixture, model: loans.InterestModel, principal = PRINCIPAL, tenor = TENOR) =>
    loans.loanSchedule(principal, monthlyRate(c), tenor, model);

  beforeEach(async function () {
    requireHooks(this);
    ({ hooks, customerId } = await freshCustomer({ tier: 2, walletBalance: 5_000_000 }));
    await seedCorridors(hooks);
  });

  afterEach(async () => {
    await hooks?.resetClock().catch(() => undefined);
    await hooks?.dispose();
  });

  async function seed(
    c: CorridorFixture,
    state: 'ACTIVE' | 'PAYROLL_BATCH_LATE' | 'DEDUCTION_MISSED' | 'RESTRUCTURED' | 'REPAID' | 'IN_COLLECTIONS' = 'ACTIVE',
    extra: Record<string, unknown> = {},
    principal = PRINCIPAL,
    model: loans.InterestModel = PUBLIC_SECTOR_DEFAULT_MODEL,
  ) {
    await seedCorridors(hooks, {}, model);
    const id = await openSeededLoan(hooks, customerId, 'PUBLIC_SECTOR', state, principal, {
      corridor: c.name, ratePct: c.ratePct, monthlyRatePct: monthlyRate(c).toNumber(), interestModel: model,
      tenorMonths: TENOR, instalmentsPaid: PAID, nextDeductionInDays: 15, daysSinceLastDue: 10, ...extra,
    });
    await loan.waitForShown();
    return id;
  }

  async function reopen(id: string) {
    await openLoan('PUBLIC_SECTOR', id);
    await loan.waitForShown();
  }

  for (const model of INTEREST_MODELS) {
    const M = modelTitle(model);

    describe(`${M} — on-loan view (§5)`, () => {
      it(title(`${M}: corridor employer name prominent; hero outstanding, next deduction and progress match the schedule oracle`, Tag.crit, Tag.smoke, Tag.spec('PublicSector§5'), Tag.spec('PublicSector§10'), Tag.spec('LoanSpec§4.2')), async () => {
        await seed(LAG, 'ACTIVE', {}, PRINCIPAL, model);
        const s = scheduleFor(LAG, model);
        await expect(await loan.corridor()).toContain(LAG.name);
        await expect((await loan.outstanding()).toFixed(2)).toBe(s[PAID - 1].balanceAfter.toFixed(2));
        await expect((await loan.nextAmount()).toFixed(2)).toBe(s[PAID].totalDue.toFixed(2));
        await expect(await loan.progress()).toMatch(new RegExp(`\\b${PAID}\\b.*\\b${TENOR}\\b`));
        await expect(await loan.payrollStatus()).toMatch(/Repayment via Lagos State payroll — next deduction/i);
        for (let i = 0; i < 3; i++) {
          await expect((await loan.schedulePreviewRow(i).amount()).toFixed(2)).toBe(s[PAID + i].totalDue.toFixed(2));
        }
        await expect(await loan.actionExists('earlySettlement')).toBe(true);
        await expect(await loan.actionExists('viewSchedule')).toBe(true);
        await expect(await loan.actionExists('support')).toBe(true);
        await expectNoVisibleText(SYSTEM_CODE_OR_JARGON);
      });

      it(title(`${M}: schedule shows past and upcoming deductions (instalment, interest, principal, balance) with corridor payroll status`, Tag.high, Tag.spec('PublicSector§7'), Tag.spec('LoanSpec§4.2'), Tag.spec('LoanSpec§4.3')), async () => {
        await seed(FED, 'ACTIVE', {}, PRINCIPAL, model);
        const s = scheduleFor(FED, model);
        await loan.action('viewSchedule');
        const sched = new LoanScheduleScreen('publicSector');
        await sched.waitForShown();
        await expect(await sched.row(0).status()).toMatch(/paid|received/i);
        for (const i of [0, PAID, TENOR - 1]) {
          await sched.scrollTo(`publicSector.schedule.row.${i}`);
          const row = sched.row(i);
          await expect((await row.instalment()).toFixed(2)).toBe(s[i].totalDue.toFixed(2));
          await expect((await row.interest()).toFixed(2)).toBe(s[i].interest.toFixed(2));
          await expect((await row.principal()).toFixed(2)).toBe(s[i].principal.toFixed(2));
          await expect((await row.balance()).toFixed(2)).toBe(s[i].balanceAfter.toFixed(2));
        }
        expect(s[TENOR - 1].balanceAfter.toFixed(2)).toBe('0.00');
      });
    });

    describe(`${M} — payroll events (§6, §8)`, () => {
      it(title(`${M}: payroll deduction received — notification with amount and payments remaining; progress advances`, Tag.crit, Tag.spec('PublicSector§8'), Tag.spec('LoanSpec§4.2')), async () => {
        const id = await seed(FED, 'ACTIVE', { nextDeductionInDays: 1 }, PRINCIPAL, model);
        const s = scheduleFor(FED, model);
        await hooks.stubProvider({ provider: 'IPPIS', outcome: 'DEDUCTION_RECEIVED', customerId });
        await hooks.advanceClock({ customerId, days: 1 });
        await expect(await notificationText(hooks, customerId)).toMatch(new RegExp(`Payroll deduction of ${nairaRe(s[PAID].totalDue)} received\\. ${TENOR - PAID - 1} payments remaining`, 'i'));
        await reopen(id);
        await expect(await loan.progress()).toMatch(new RegExp(`\\b${PAID + 1}\\b.*\\b${TENOR}\\b`));
      });
    });

    describe(`${M} — early settlement (§7)`, () => {
      it(title(`${M}: wallet path — payoff = outstanding principal + active-month interest, no fee (oracle); closes loan and cancels payroll deduction`, Tag.crit, Tag.spec('PublicSector§7'), Tag.spec('LoanSpec§4.4')), async () => {
        const expected = loans.earlyPayoff(PRINCIPAL, monthlyRate(LAG), TENOR, model, PAID + 1);
        expect(expected.payoff.lt(LAG.bankTransferSettlementFrom)).toBe(true);
        const id = await seed(LAG, 'ACTIVE', {}, PRINCIPAL, model);
        const before = await walletBalance();
        await reopen(id);
        await loan.action('earlySettlement');
        await settlement.waitForShown();
        await expect((await settlement.principal()).toFixed(2)).toBe(expected.outstandingPrincipal.toFixed(2));
        await expect((await settlement.accruedInterest()).toFixed(2)).toBe(expected.activeMonthInterest.toFixed(2));
        await expect((await settlement.total()).toFixed(2)).toBe(expected.payoff.toFixed(2));
        if (await settlement.feeShown()) await expect((await settlement.fee()).toFixed(2)).toBe('0.00');
        if (await settlement.waivedInterestShown()) await expect((await settlement.waivedInterest()).toFixed(2)).toBe(expected.waivedInterest.toFixed(2));
        await settlement.continue();
        await settlement.chooseSource('wallet');
        await settlement.confirm();
        await expect(await settlement.successText()).toMatch(/settled|closed|repaid/i);
        await expect(before.minus(await walletBalance()).toFixed(2)).toBe(expected.payoff.toFixed(2));
        await expect(await notificationText(hooks, customerId)).toMatch(/payroll deduction.*(cancel|stop)/i);
        await reopen(id);
        await expect(await loan.stateLabel()).toMatch(/repaid|closed/i);
      });

      it(title(`${M}: large amount — bank-transfer path with account details + reference; inbound transfer of the payoff settles the loan`, Tag.crit, Tag.spec('PublicSector§7'), Tag.spec('LoanSpec§4.4')), async () => {
        const principal = 8_000_000;
        const expected = loans.earlyPayoff(principal, monthlyRate(FED), TENOR, model, PAID + 1).payoff;
        expect(expected.gte(FED.bankTransferSettlementFrom)).toBe(true);
        const id = await seed(FED, 'ACTIVE', {}, principal, model);
        await loan.action('earlySettlement');
        await settlement.waitForShown();
        await expect((await settlement.total()).toFixed(2)).toBe(expected.toFixed(2));
        await settlement.continue();
        await expect(await settlement.sourceAvailable('bankTransfer')).toBe(true);
        await settlement.chooseSource('bankTransfer');
        const bt = settlement.bankTransfer();
        await expect(await bt.accountNumber()).toMatch(/^\d{10}$/);
        await expect((await bt.amount()).toFixed(2)).toBe(expected.toFixed(2));
        const reference = await bt.reference();
        expect(reference).toBeTruthy();
        await hooks.simulateInboundTransfer({ reference, amount: expected.toNumber(), customerId });
        await reopen(id);
        await expect(await loan.stateLabel()).toMatch(/repaid|closed/i);
        await expect(await notificationText(hooks, customerId)).toMatch(/payroll deduction.*(cancel|stop)/i);
      });
    });

    describe(`${M} — out-of-cycle repayment & restructure (§6, §7)`, () => {
      it(title(`${M}: permitted corridor (Lagos State) — pay from wallet reduces outstanding principal by exactly the amount`, Tag.crit, Tag.spec('PublicSector§7')), async () => {
        const outstanding = scheduleFor(LAG, model)[PAID - 1].balanceAfter;
        const id = await seed(LAG, 'ACTIVE', {}, PRINCIPAL, model);
        await expect(await loan.actionExists('outOfCycle')).toBe(true);
        await loan.action('outOfCycle');
        await repay.waitForShown();
        await repay.enterAmount(50_000);
        await repay.confirm();
        await expect(await repay.successText()).toBeTruthy();
        await reopen(id);
        await expect((await loan.outstanding()).toFixed(2)).toBe(outstanding.minus(50_000).toFixed(2));
      });

      it(title(`${M}: restructured — notification and updated next deduction from the new schedule (oracle)`, Tag.crit, Tag.spec('PublicSector§6'), Tag.spec('PublicSector§8'), Tag.spec('LoanSpec§4.2')), async () => {
        const remainingMonths = 30;
        const outstanding = scheduleFor(FED, model)[PAID - 1].balanceAfter;
        await seed(FED, 'RESTRUCTURED', { restructure: { remainingMonths, monthlyRatePct: monthlyRate(FED).toNumber() } }, PRINCIPAL, model);
        const newSchedule = loans.loanSchedule(outstanding, monthlyRate(FED), remainingMonths, model);
        await expect(await notificationText(hooks, customerId)).toMatch(/loan has been restructured\. New terms:/i);
        await expect((await loan.nextAmount()).toFixed(2)).toBe(newSchedule[0].totalDue.toFixed(2));
        await expect(await loan.monthsRemaining()).toMatch(new RegExp(`\\b${remainingMonths}\\b`));
      });
    });
  }

  describe('Payroll events (§6, §8, §9)', () => {
    it(title('payroll batch late: amber banner says employer batch delayed (not the customer\'s fault), no late-fee language', Tag.high, Tag.spec('PublicSector§6'), Tag.spec('PublicSector§9')), async () => {
      const id = await seed(FED, 'ACTIVE', { nextDeductionInDays: 1 });
      await hooks.stubProvider({ provider: 'IPPIS', outcome: 'BATCH_LATE', customerId });
      await hooks.advanceClock({ customerId, days: 1 });
      await reopen(id);
      const banner = await loan.banner();
      await expect(banner).toMatch(/employer's payroll batch is delayed\. Deductions will resume when received/i);
      await expect(banner).not.toMatch(/overdue|late fee|missed/i);
      await expect(await loan.stateLabel()).not.toMatch(/overdue/i);
      await expect(await notificationText(hooks, customerId)).toMatch(/payroll batch is delayed.*No action needed/i);
    });

    it(title('deduction missed (left employer): serious banner + notification + contact CTA', Tag.crit, Tag.spec('PublicSector§6'), Tag.spec('PublicSector§8')), async () => {
      const id = await seed(FED, 'ACTIVE', { nextDeductionInDays: 1 });
      await hooks.stubProvider({ provider: 'IPPIS', outcome: 'EMPLOYEE_NOT_FOUND', customerId });
      await hooks.advanceClock({ customerId, days: 1 });
      await reopen(id);
      await expect(await loan.banner()).toMatch(/didn't receive your payroll deduction|contact us/i);
      await expect(await loan.actionExists('contact')).toBe(true);
      await expect(await notificationText(hooks, customerId)).toMatch(/We didn't receive your payroll deduction\. Please contact us to update your employment details/i);
    });
  });

  describe('Out-of-cycle repayment (§7) — corridor dependent', () => {
    it(title('non-permitted corridor (Federal IPPIS): no out-of-cycle repayment action', Tag.high, Tag.spec('PublicSector§7')), async () => {
      await seed(FED);
      await expect(await loan.actionExists('outOfCycle')).toBe(false);
    });
  });

  describe('Terminal states, cannot-do (§6, §8, §11)', () => {
    it(title('fully repaid: success state and notification', Tag.high, Tag.spec('PublicSector§6'), Tag.spec('PublicSector§8')), async () => {
      await seed(LAG, 'REPAID', { instalmentsPaid: TENOR });
      await expect(await loan.stateLabel()).toMatch(/repaid/i);
      await expect(await loan.successMessage()).toMatch(/Public Sector Loan is fully repaid/i);
      await expect((await loan.outstanding()).toFixed(2)).toBe(D(0).toFixed(2));
    });

    it(title('in collections: contact CTA shown', Tag.med, Tag.spec('PublicSector§6')), async () => {
      await seed(FED, 'IN_COLLECTIONS');
      await expect(await loan.stateLabel()).toMatch(/collections/i);
      await expect(await loan.actionExists('contact')).toBe(true);
    });

    it(title('cannot change corridor, deduction amount or retirement date from the app', Tag.high, Tag.spec('PublicSector§11')), async () => {
      await seed(FED);
      await expect(await loan.actionExists('changeTenor')).toBe(false);
      await expect(await loan.actionExists('changeSalaryAccount')).toBe(false);
      await expect(await loan.actionExists('requestRestructure') || await loan.actionExists('support')).toBe(true);
    });
  });
});
