import { expect } from '@wdio/globals';
import { D } from '../../../shared/calc/money';
import * as loans from '../../../shared/calc/loans';
import { Tag, title } from '../../../shared/support/tags';
import { reasons, testFiles } from '../../../shared/data/factories';
import { QaHooks } from '../../../shared/api/qa-hooks';
import { freshCustomer, requireHooks } from '../../helpers/session';
import {
  LoanProduct, PAYDAY_TERMS, moneyRe, nairaRe, notificationText, openBorrowTile, optionSlug, productDisplayName, seedPaydayTerms,
  setCrossLoanBlock, walletBalance,
} from '../../helpers/loans';
import { LoanDeclineScreen, LoanUnderReviewScreen, MandateConsentScreen } from '../../screens/loans/BorrowCommon';
import { PaydayBookingScreen, PaydayLandingScreen, PaydayOutcomeScreen } from '../../screens/loans/PaydayScreens';

/**
 * Payday — landing salary detection, booking, mandate, referral routing, outcomes
 * (Payday_Customer_App_Spec §3, §4, §8, §9, §11). Risk: cap / eligibility / disbursement = CRIT.
 */
describe('Payday › Application', () => {
  const SALARY = 450_000;
  const EMPLOYER = 'Access Bank Nigeria';
  const CAP = loans.paydayCap(SALARY, PAYDAY_TERMS.salaryCapPct);
  const T = PAYDAY_TERMS.referralThresholds;
  let hooks: QaHooks;
  let customerId: string;

  const landing = new PaydayLandingScreen();
  const booking = new PaydayBookingScreen();
  const mandate = new MandateConsentScreen('payday');
  const outcome = new PaydayOutcomeScreen();
  const review = new LoanUnderReviewScreen('payday');
  const decline = new LoanDeclineScreen('payday');

  async function setup(salaryDetected: boolean, salary: number = SALARY, tier: 1 | 2 = 2) {
    ({ hooks, customerId } = await freshCustomer({ tier, walletBalance: 10_000, salaryDetected, monthlySalary: salaryDetected ? salary : undefined, employer: salaryDetected ? EMPLOYER : undefined }));
    await seedPaydayTerms(hooks);
    await setCrossLoanBlock(hooks, false);
    await hooks.stubProvider({ provider: 'BUREAU', outcome: 'CLEAN', customerId });
    await hooks.stubProvider({ provider: 'REMITA', outcome: 'MANDATE_OK', customerId });
  }

  beforeEach(async function () {
    requireHooks(this);
    await setup(true);
  });

  afterEach(async () => {
    await hooks?.dispose();
  });

  async function openLanding() {
    await openBorrowTile('payday');
    await landing.waitForShown();
  }

  async function walkToAmount() {
    await openLanding();
    await landing.apply();
    await booking.waitForShown();
    await booking.confirmSalary();
  }

  async function walkToMandate(amount: number, days: number = PAYDAY_TERMS.termDays) {
    await walkToAmount();
    await booking.enterAmount(amount);
    await booking.enterTenorDays(days);
    await booking.continue(); // → purpose
    await booking.continue(); // purpose optional → mandate
    await mandate.waitForShown();
  }

  async function walkToReview(amount: number, days: number = PAYDAY_TERMS.termDays) {
    await walkToMandate(amount, days);
    await mandate.tickConsent();
    await booking.continue();
  }

  async function submit(amount: number) {
    await walkToReview(amount);
    await booking.submit();
  }

  describe('Landing & salary step (§3, §4 step 1)', () => {
    it(title('salary detected: landing shows detected salary + employer and Apply is enabled', Tag.crit, Tag.smoke, Tag.spec('Payday§3')), async () => {
      await openLanding();
      await expect(await landing.salaryStatus()).toMatch(/detected/i);
      await expect((await landing.detectedSalary()).toFixed(2)).toBe(D(SALARY).toFixed(2));
      await expect(await landing.detectedEmployer()).toContain(EMPLOYER);
      await expect(await landing.requirements()).toMatch(/salary/i);
      await expect(await landing.requirements()).toMatch(/mandate|authori[sz]e/i);
      await expect(await landing.applyEnabled()).toBe(true);
    });

    it(title('salary detected: booking asks "Is this your salary?" with amount and employer', Tag.high, Tag.spec('Payday§4')), async () => {
      await openLanding();
      await landing.apply();
      await booking.waitForShown();
      const text = await booking.salaryConfirmText();
      await expect(text).toMatch(/Is this your salary\?/i);
      await expect(text).toMatch(moneyRe(SALARY));
      await expect(text).toContain(EMPLOYER);
    });

    it(title('salary not detected: Apply disabled until manual verification is complete', Tag.crit, Tag.spec('Payday§3')), async () => {
      await hooks.dispose();
      await setup(false);
      await openLanding();
      await expect(await landing.salaryStatus()).toMatch(/need more info|not detected|verify/i);
      await expect(await landing.applyEnabled()).toBe(false);
      await expect(await landing.verifySalaryShown()).toBe(true);
    });

    it(title('manual entry: employer, salary account and payslip are each required', Tag.crit, Tag.spec('Payday§4')), async () => {
      await hooks.dispose();
      await setup(false);
      await openLanding();
      await landing.verifySalary();
      await booking.waitForShown();
      await expect(await booking.manualShown()).toBe(true);
      await booking.enterMonthlySalary(SALARY);
      await expect(await booking.continueEnabled()).toBe(false);
      await booking.pickEmployer('Access');
      await expect(await booking.continueEnabled()).toBe(false); // salary account missing
      await booking.pickSalaryAccount(0);
      await expect(await booking.continueEnabled()).toBe(false); // payslip missing
      await expect(await booking.payslip().state()).toBe('default');
      await booking.payslip().upload(testFiles.validPdf);
      await booking.payslip().waitForState('uploaded');
      await expect(await booking.continueEnabled()).toBe(true);
    });

    it(title('employer not in dropdown: free-text fallback accepted and flagged for manual review', Tag.high, Tag.spec('Payday§4'), Tag.spec('Payday§9')), async () => {
      await hooks.dispose();
      await setup(false);
      await openLanding();
      await landing.verifySalary();
      await booking.waitForShown();
      await booking.enterEmployerFreeText('Zzyzx Logistics Ltd');
      await expect(await booking.manualReviewNoticeShown()).toBe(true);
      await expect(await booking.manualReviewNotice()).toMatch(/review/i);
    });

    it(title('payslip rejected: "We couldn\'t verify your salary" blocks the application', Tag.crit, Tag.spec('Payday§9')), async () => {
      await hooks.dispose();
      await setup(false);
      await hooks.stubProvider({ provider: 'DOC_VERIFY', outcome: 'REJECTED', customerId });
      await openLanding();
      await landing.verifySalary();
      await booking.waitForShown();
      await booking.enterMonthlySalary(SALARY);
      await booking.pickEmployer('Access');
      await booking.pickSalaryAccount(0);
      await booking.payslip().upload(testFiles.validPdf);
      await booking.payslip().waitForState('error');
      await expect(await booking.payslip().errorText()).toMatch(/couldn't verify your salary.*(contact us|clearer payslip)/i);
      await expect(await booking.continueEnabled()).toBe(false);
    });
  });

  describe('Amount, fees and purpose (§4 steps 2–3)', () => {
    it(title(`cap indicator: "Maximum you can borrow: ₦225,000 (50% of your monthly salary)" for ₦450,000 salary`, Tag.crit, Tag.smoke, Tag.spec('Payday§4'), Tag.spec('Payday§10')), async () => {
      await walkToAmount();
      await expect(CAP.toFixed(2)).toBe('225000.00');
      await expect((await booking.capAmount()).toFixed(2)).toBe(CAP.toFixed(2));
      await expect(await booking.capIndicator()).toMatch(new RegExp(`Maximum you can borrow: ${nairaRe(CAP)} \\(${PAYDAY_TERMS.salaryCapPct}% of your monthly salary\\)`, 'i'));
    });

    it(title('amount above the salary cap is rejected; amount at the cap is accepted', Tag.crit, Tag.spec('Payday§4')), async () => {
      await walkToAmount();
      await booking.enterAmount(CAP.plus(1).toNumber());
      await expect(await booking.continueEnabled()).toBe(false);
      await expect(await booking.amountError()).toMatch(moneyRe(CAP));
      await booking.enterAmount(CAP.toNumber());
      await expect(await booking.continueEnabled()).toBe(true);
    });

    for (const amount of [50_000, 150_000, 225_000]) {
      it(title(`fees preview for ₦${amount.toLocaleString()}: prorated interest and total for 7/15/21/30 days match the oracle`, Tag.crit, Tag.spec('Payday§4'), Tag.spec('LoanSpec§3.2')), async () => {
        await walkToAmount();
        await booking.enterAmount(amount);
        for (const days of [7, 15, 21, 30]) {
          await booking.enterTenorDays(days);
          const { interest, totalRepayable } = loans.proratedInterest(amount, PAYDAY_TERMS.dailyRatePct, days);
          await expect((await booking.feesInterest()).toFixed(2)).toBe(interest.toFixed(2));
          await expect((await booking.feesTotal()).toFixed(2)).toBe(totalRepayable.toFixed(2));
        }
      });
    }

    it(title('worked example: ₦200,000 @ 0.30%/day → 7d ₦4,200, 15d ₦9,000, 21d ₦12,600, 30d ₦18,000', Tag.crit, Tag.spec('LoanSpec§3.3')), async () => {
      const worked: Array<[number, number]> = [[7, 4_200], [15, 9_000], [21, 12_600], [30, 18_000]];
      expect(PAYDAY_TERMS.dailyRatePct).toBe(0.3);
      for (const [days, interest] of worked) {
        expect(loans.proratedInterest(200_000, 0.3, days).interest.toFixed(2)).toBe(D(interest).toFixed(2));
      }
      expect(CAP.gte(200_000)).toBe(true);
      await walkToAmount();
      await booking.enterAmount(200_000);
      for (const [days, interest] of worked) {
        await booking.enterTenorDays(days);
        await expect((await booking.feesInterest()).toFixed(2)).toBe(D(interest).toFixed(2));
        await expect((await booking.feesTotal()).toFixed(2)).toBe(D(200_000 + interest).toFixed(2));
      }
    });

    for (const days of [PAYDAY_TERMS.minDays - 1, PAYDAY_TERMS.maxDays + 1]) {
      it(title(`tenor of ${days} days is rejected (allowed 7–30 days)`, Tag.crit, Tag.spec('LoanSpec§3.1')), async () => {
        const expected = loans.checkBounds('PAYDAY', 50_000, days, 2);
        expect(expected).toEqual({ ok: false, reason: days < PAYDAY_TERMS.minDays ? 'TENOR_BELOW_MIN' : 'TENOR_ABOVE_MAX' });
        await walkToAmount();
        await booking.enterAmount(50_000);
        await booking.enterTenorDays(days);
        await expect(await booking.continueEnabled()).toBe(false);
        await expect(await booking.tenorDaysError()).toMatch(days < PAYDAY_TERMS.minDays ? /7 days/i : /30 days/i);
      });
    }

    for (const days of [PAYDAY_TERMS.minDays, PAYDAY_TERMS.maxDays]) {
      it(title(`tenor boundary ${days} days is accepted`, Tag.high, Tag.spec('LoanSpec§3.1')), async () => {
        expect(loans.checkBounds('PAYDAY', 50_000, days, 2)).toEqual({ ok: true });
        await walkToAmount();
        await booking.enterAmount(50_000);
        await booking.enterTenorDays(days);
        await expect(await booking.continueEnabled()).toBe(true);
      });
    }

    it(title('amount above ₦500,000 is rejected even when 50% of salary is higher (cap = ₦500,000)', Tag.crit, Tag.spec('LoanSpec§3.1'), Tag.spec('Payday§4')), async () => {
      const salary = 1_200_000; // 50% = ₦600,000 > product max
      const cap = loans.paydayCap(salary, PAYDAY_TERMS.salaryCapPct);
      expect(cap.toFixed(2)).toBe(D(PAYDAY_TERMS.maxAmount).toFixed(2));
      expect(loans.checkBounds('PAYDAY', PAYDAY_TERMS.maxAmount + 1, 30, 2)).toEqual({ ok: false, reason: 'AMOUNT_ABOVE_MAX' });
      await hooks.dispose();
      await setup(true, salary);
      await walkToAmount();
      await expect((await booking.capAmount()).toFixed(2)).toBe(cap.toFixed(2));
      await booking.enterAmount(PAYDAY_TERMS.maxAmount + 1);
      await booking.enterTenorDays(30);
      await expect(await booking.continueEnabled()).toBe(false);
      await expect(await booking.amountError()).toMatch(moneyRe(PAYDAY_TERMS.maxAmount));
      await booking.enterAmount(PAYDAY_TERMS.maxAmount);
      await expect(await booking.continueEnabled()).toBe(true);
    });

    it(title('purpose is optional with categories Emergency / Bills / Rent / Medical / Other', Tag.low, Tag.spec('Payday§4')), async () => {
      await walkToAmount();
      await booking.enterAmount(50_000);
      await booking.continue();
      for (const p of reasons.paydayPurpose) await expect(await booking.purposeOptionShown(optionSlug(p))).toBe(true);
      await expect(await booking.continueEnabled()).toBe(true);
    });
  });

  describe('Mandate & review (§4 steps 4–5)', () => {
    it(title('mandate authorisation explains amount, bank, payday date and Remita; consent is required', Tag.crit, Tag.spec('Payday§4')), async () => {
      const amount = 100_000;
      await walkToMandate(amount);
      const { totalRepayable } = loans.proratedInterest(amount, PAYDAY_TERMS.dailyRatePct, PAYDAY_TERMS.termDays);
      const text = await mandate.explanation();
      await expect(text).toMatch(new RegExp(`authori[sz]e Rosabon to automatically debit ${nairaRe(totalRepayable)}`, 'i'));
      await expect(text).toMatch(/via Remita/i);
      await expect(await mandate.providerSelectorShown()).toBe(false); // provider selection is silent
      await expect(await mandate.consentTicked()).toBe(false);
      await expect(await booking.continueEnabled()).toBe(false);
      await mandate.tickConsent();
      await expect(await booking.continueEnabled()).toBe(true);
    });

    it(title('review shows amount, selected tenor (21 days), prorated interest, total, salary account, mandate provider and payday date', Tag.crit, Tag.spec('Payday§4'), Tag.spec('LoanSpec§3.2')), async () => {
      const amount = 120_000;
      const days = 21;
      await walkToReview(amount, days);
      const { interest, totalRepayable } = loans.proratedInterest(amount, PAYDAY_TERMS.dailyRatePct, days);
      await expect((await booking.reviewAmount('amount')).toFixed(2)).toBe(D(amount).toFixed(2));
      await expect(await booking.reviewValue('tenor')).toMatch(new RegExp(`${days} days`, 'i'));
      await expect((await booking.reviewAmount('interest')).toFixed(2)).toBe(interest.toFixed(2));
      await expect((await booking.reviewAmount('total')).toFixed(2)).toBe(totalRepayable.toFixed(2));
      await expect(await booking.reviewValue('salaryAccount')).toBeTruthy();
      await expect(await booking.reviewValue('mandateProvider')).toMatch(/Remita/i);
      await expect(await booking.reviewValue('paydayDate')).toBeTruthy();
    });

    it(title('mandate setup failure halts the application and no loan is created or disbursed', Tag.crit, Tag.spec('Payday§9')), async () => {
      await hooks.stubProvider({ provider: 'REMITA', outcome: 'MANDATE_FAILED', customerId });
      const before = await walletBalance();
      await submit(80_000);
      await expect(await outcome.mandateFailedShown()).toBe(true);
      await expect(await outcome.mandateFailedMessage()).toMatch(/couldn't set up the automatic debit\. Please try again or contact us/i);
      await expect((await walletBalance()).toFixed(2)).toBe(before.toFixed(2));
      await openLanding();
      await expect(await landing.activeLoanShown()).toBe(false);
      await expect(await landing.applyEnabled()).toBe(true);
    });
  });

  describe('Referral tier routing (§4 step 6) — thresholds seeded via config', () => {
    it(title('LOW tier auto-approves: "Approved! ₦X is in your wallet", mandate active, wallet credited exactly', Tag.crit, Tag.smoke, Tag.spec('Payday§4'), Tag.spec('Payday§8')), async () => {
      const amount = 80_000;
      expect(loans.referralTier(amount, T)).toBe('LOW');
      const before = await walletBalance();
      await submit(amount);
      await expect(await outcome.approvedShown()).toBe(true);
      await expect(await outcome.approvedHeadline()).toMatch(new RegExp(`Approved! ${nairaRe(amount)} is in your wallet`, 'i'));
      await expect(await outcome.mandateStatus()).toMatch(/active/i);
      await expect(await outcome.repaymentDate()).toBeTruthy();
      await expect((await walletBalance()).minus(before).toFixed(2)).toBe(D(amount).toFixed(2));
      await expect(await notificationText(hooks, customerId, 3)).toMatch(/Payday loan is approved/i);
    });

    for (const amount of [150_000, 220_000]) {
      const tier = loans.referralTier(amount, T);
      it(title(`${tier} tier (₦${amount.toLocaleString()}) goes to "under review" with expected time; no disbursement yet`, Tag.crit, Tag.spec('Payday§4'), Tag.spec('Payday§6')), async () => {
        expect(['MEDIUM', 'HIGH']).toContain(tier);
        const before = await walletBalance();
        await submit(amount);
        await review.waitForShown();
        await expect(await review.message()).toMatch(/under review\. This usually takes \d+ hours?\. We'll notify you/i);
        await expect(await review.submittedAt()).toBeTruthy();
        await expect(await review.expectedBy()).toBeTruthy();
        await expect((await walletBalance()).toFixed(2)).toBe(before.toFixed(2));
        await expect(await notificationText(hooks, customerId, 3)).toMatch(/Payday loan is under review/i);
      });
    }

    it(title('boundary: amount exactly at mediumFrom routes to review, ₦1 below auto-approves', Tag.crit, Tag.spec('Payday§4')), async () => {
      expect(loans.referralTier(T.mediumFrom, T)).toBe('MEDIUM');
      expect(loans.referralTier(T.mediumFrom - 1, T)).toBe('LOW');
      await submit(T.mediumFrom);
      await review.waitForShown();
    });
  });

  describe('Declines (§4 step 7b)', () => {
    const cases: Array<{ provider: 'BUREAU' | 'DOC_VERIFY'; outcome: string; reason: RegExp }> = [
      { provider: 'BUREAU', outcome: 'DSR_TOO_HIGH', reason: /DSR too high/i },
      { provider: 'BUREAU', outcome: 'SALARY_VERIFICATION_FAILED', reason: /Salary verification failed/i },
    ];
    for (const c of cases) {
      it(title(`declined with managed-vocab reason: ${c.outcome}`, Tag.crit, Tag.spec('Payday§4'), Tag.spec('Payday§8')), async () => {
        await hooks.stubProvider({ provider: c.provider, outcome: c.outcome, customerId });
        await submit(80_000);
        await decline.waitForShown();
        await expect(await decline.reason()).toMatch(c.reason);
        await expect(await decline.overrideActionExists()).toBe(false);
      });
    }
  });

  describe('Constraints (§3, §9, §11)', () => {
    it(title('one active Payday at a time: landing shows active loan and "One active Payday at a time"', Tag.crit, Tag.spec('Payday§3'), Tag.spec('Payday§9')), async () => {
      await hooks.seedLoan({ customerId, product: 'PAYDAY', state: 'ACTIVE', amount: 100_000, extra: { dailyRatePct: PAYDAY_TERMS.dailyRatePct, tenorDays: PAYDAY_TERMS.termDays, paydayInDays: 15 } });
      await openLanding();
      await expect(await landing.activeLoanShown()).toBe(true);
      await expect(await landing.constraint()).toMatch(/One active Payday at a time/i);
      await expect(await landing.applyShown()).toBe(false);
    });

    for (const other of ['NANO', 'PERSONAL', 'PUBLIC_SECTOR'] as LoanProduct[]) {
      it(title(`cross-loan block enabled: active ${productDisplayName[other]} loan blocks Payday`, Tag.crit, Tag.spec('Payday§9'), Tag.spec('Payday§11')), async () => {
        await setCrossLoanBlock(hooks, true);
        await hooks.seedLoan({ customerId, product: other, state: 'ACTIVE', amount: 50_000 });
        await openLanding();
        await expect(await landing.constraint()).toMatch(new RegExp(`Please close your active ${productDisplayName[other]} loan before applying for Payday`, 'i'));
        if (await landing.applyShown()) await expect(await landing.applyEnabled()).toBe(false);
      });
    }

    it(title('Tier 1 customer is blocked from Payday (Tier 2 required)', Tag.crit, Tag.spec('LoanSpec§3.1'), Tag.spec('KYC§1')), async () => {
      expect(loans.checkBounds('PAYDAY', 50_000, 30, 1)).toEqual({ ok: false, reason: 'TIER' });
      await hooks.dispose();
      await setup(true, SALARY, 1);
      await openLanding();
      if (await landing.applyShown()) await expect(await landing.applyEnabled()).toBe(false);
      await expect(await landing.constraint()).toMatch(/KYC|Tier 2|upgrade/i);
    });

    it(title('tenor is selectable within 7–30 days; review shows the selected days', Tag.med, Tag.spec('LoanSpec§3.1')), async () => {
      await walkToReview(50_000, 14);
      await expect(await booking.reviewValue('tenor')).toMatch(/14 days/i);
    });

    it(title('cap follows config: changing cap % to 40 caps ₦450,000 salary at the oracle value', Tag.crit, Tag.spec('Payday§4')), async () => {
      await seedPaydayTerms(hooks, { salaryCapPct: 40 });
      await walkToAmount();
      const cap = loans.paydayCap(SALARY, 40);
      await expect((await booking.capAmount()).toFixed(2)).toBe(cap.toFixed(2));
      await expect(await booking.capIndicator()).toMatch(/40% of your monthly salary/i);
    });
  });
});
