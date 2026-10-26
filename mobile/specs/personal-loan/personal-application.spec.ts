import { expect } from '@wdio/globals';
import { D } from '../../../shared/calc/money';
import * as loans from '../../../shared/calc/loans';
import { Tag, title } from '../../../shared/support/tags';
import { reasons, testFiles } from '../../../shared/data/factories';
import { QaHooks } from '../../../shared/api/qa-hooks';
import { freshCustomer, requireHooks } from '../../helpers/session';
import {
  PERSONAL_TERMS, VARIANT_LANGUAGE, expectNoVisibleText, moneyRe, nairaRe, notificationText, openBorrowTile, openLoan,
  optionSlug, seedPersonalTerms, setCrossLoanBlock, walletBalance,
} from '../../helpers/loans';
import { relaunchApp } from '../../screens/common/AuthScreens';
import { LoanDeclineScreen, LoanKycGateScreen, LoanUnderReviewScreen, MandateConsentScreen } from '../../screens/loans/BorrowCommon';
import {
  PersonalActivationScreen, PersonalBookingScreen, PersonalDocKey, PersonalLandingScreen, PersonalOfferScreen,
} from '../../screens/loans/PersonalLoanScreens';

/**
 * Personal Loan (Private Sector) — landing, booking, documents, review, offer, activation
 * (Personal_Loan_Customer_App_Spec §3, §4, §6, §8, §9). One product, one flow: PL1–PL5 never visible.
 * Risk: estimate / offer maths, disbursement, eligibility gating = CRIT.
 */
describe('Personal Loan › Application', () => {
  const SALARY = 600_000;
  const EMPLOYER = 'Dangote Cement';
  const R = PERSONAL_TERMS.indicativeRatePct;
  const SMALL = 500_000;
  const LARGE = 5_000_000;
  let hooks: QaHooks;
  let customerId: string;

  const landing = new PersonalLandingScreen();
  const booking = new PersonalBookingScreen();
  const mandate = new MandateConsentScreen('personal');
  const underReview = new LoanUnderReviewScreen('personal');
  const offer = new PersonalOfferScreen();
  const activation = new PersonalActivationScreen();

  async function setup(o: { tier?: 1 | 2 | 3; salaryDetected?: boolean } = {}) {
    ({ hooks, customerId } = await freshCustomer({
      tier: o.tier ?? 2, walletBalance: 10_000, salaryDetected: o.salaryDetected ?? true,
      monthlySalary: o.salaryDetected === false ? undefined : SALARY, employer: o.salaryDetected === false ? undefined : EMPLOYER,
    }));
    await seedPersonalTerms(hooks);
    await setCrossLoanBlock(hooks, false);
    await hooks.stubProvider({ provider: 'DOC_VERIFY', outcome: 'OK', customerId });
    await hooks.stubProvider({ provider: 'REMITA', outcome: 'MANDATE_OK', customerId });
  }

  beforeEach(async function () {
    requireHooks(this);
    await setup();
  });

  afterEach(async () => {
    await hooks?.resetClock().catch(() => undefined);
    await hooks?.dispose();
  });

  async function openLanding() {
    await openBorrowTile('personal');
    await landing.waitForShown();
  }

  async function step1(amount: number, tenor: number) {
    await openLanding();
    await landing.apply();
    await booking.waitForShown();
    await booking.enterAmount(amount);
    await booking.pickTenor(tenor);
  }

  async function toEmployment(amount: number, tenor: number) {
    await step1(amount, tenor);
    await booking.continue();
    await booking.pickPurpose(optionSlug('Education'));
    await booking.continue();
  }

  async function toDocuments(amount: number, tenor: number) {
    await toEmployment(amount, tenor);
    await booking.confirmDetected();
    await booking.pickSalaryAccount(0);
    await booking.continue();
  }

  async function uploadAll(keys: PersonalDocKey[]) {
    for (const k of keys) {
      if (!(await booking.docShown(k))) continue;
      const card = booking.doc(k);
      await card.upload(testFiles.validPdf);
      await card.waitForState('uploaded');
    }
  }

  async function toMandate(amount: number, tenor: number) {
    await toDocuments(amount, tenor);
    await uploadAll(['statement3m', 'statement6m', 'validId', 'employerLetter', 'utilityBill']);
    await booking.continue();
    await mandate.waitForShown();
  }

  async function toReview(amount: number, tenor: number) {
    await toMandate(amount, tenor);
    await mandate.tickConsent();
    await booking.continue();
  }

  /** Offer seeded as returned by underwriting. */
  async function seedOffer(o: { requested: number; approved: number; ratePct: number; tenorMonths: number; adminFee?: number; reducedReason?: string; activationSteps?: string[] }) {
    const { loanId } = await hooks.seedLoan({
      customerId, product: 'PERSONAL', state: 'OFFER_RETURNED', amount: o.approved,
      extra: { requestedAmount: o.requested, approvedAmount: o.approved, ratePct: o.ratePct, tenorMonths: o.tenorMonths, adminFee: o.adminFee ?? 0, reducedReason: o.reducedReason, activationSteps: o.activationSteps ?? [] },
    });
    await openLoan('PERSONAL', loanId);
    await offer.waitForShown();
    return loanId;
  }

  describe('Landing (§3)', () => {
    it(title('landing shows rate range, value props, requirements and Apply now', Tag.high, Tag.spec('Personal§3')), async () => {
      await openLanding();
      await expect(await landing.rateRange()).toMatch(/Rates from \d+(\.\d+)?% to \d+(\.\d+)?% p\.a\./i);
      await expect(await landing.valueProps()).toMatch(/3 to 24 months/i);
      await expect(await landing.requirements()).toMatch(/salary account/i);
      await expect(await landing.requirements()).toMatch(/ID/);
      await expect(await landing.applyEnabled()).toBe(true);
    });

    it(title('missing KYC (Tier 1) blocks the application with "complete your KYC upgrade"', Tag.crit, Tag.open('L-personal-min-tier'), Tag.spec('Personal§9'), Tag.spec('KYC§1')), async () => {
      await hooks.dispose();
      await setup({ tier: 1 });
      await openLanding();
      await landing.apply();
      const gate = new LoanKycGateScreen();
      await gate.waitForShown();
      await expect(await gate.message()).toMatch(/Please complete your (KYC upgrade|ID renewal) to continue/i);
      await expect(await booking.isShown()).toBe(false);
    });
  });

  describe('Step 1 — amount, tenor, live estimate (§4)', () => {
    it(title('tenor picker offers exactly the configured set 3, 6, 9, 12, 18, 24 months', Tag.high, Tag.spec('Personal§4')), async () => {
      await step1(1_000_000, 12);
      for (const m of PERSONAL_TERMS.tenorsMonths) await expect(await booking.tenorOptionShown(m)).toBe(true);
      for (const m of [1, 2, 15, 36]) await expect(await booking.tenorOptionShown(m)).toBe(false);
    });

    for (const tenor of PERSONAL_TERMS.tenorsMonths) {
      it(title(`live estimated monthly repayment for ₦1,200,000 over ${tenor} months matches the annuity oracle`, Tag.crit, Tag.spec('Personal§4'), Tag.spec('Personal§10')), async () => {
        await step1(1_200_000, tenor);
        const expected = loans.monthlyInstalment(1_200_000, R, tenor);
        await expect((await booking.estimateAmount()).toFixed(2)).toBe(expected.toFixed(2));
        await expect(await booking.estimateText()).toMatch(new RegExp(`Estimated monthly repayment ${nairaRe(expected)} at approximately ${R}% p\\.a\\..*Final rate confirmed after review`, 'i'));
      });
    }

    it(title('amount below minimum / above maximum is rejected with the bound in the error', Tag.crit, Tag.spec('Personal§4')), async () => {
      await step1(PERSONAL_TERMS.minAmount - 1, 6);
      await expect(await booking.continueEnabled()).toBe(false);
      await expect(await booking.amountError()).toMatch(moneyRe(PERSONAL_TERMS.minAmount));
      await booking.enterAmount(PERSONAL_TERMS.maxAmount + 1);
      await expect(await booking.continueEnabled()).toBe(false);
      await expect(await booking.amountError()).toMatch(moneyRe(PERSONAL_TERMS.maxAmount));
      await booking.enterAmount(PERSONAL_TERMS.minAmount);
      await expect(await booking.continueEnabled()).toBe(true);
    });
  });

  describe('Steps 2–3 — purpose and employment (§4, §9)', () => {
    it(title('purpose step lists all categories plus optional free-text detail', Tag.med, Tag.spec('Personal§4'), Tag.spec('Personal§10')), async () => {
      await step1(1_000_000, 12);
      await booking.continue();
      for (const p of reasons.loanPurpose) await expect(await booking.purposeOptionShown(optionSlug(p))).toBe(true);
      await expect(await booking.continueEnabled()).toBe(false); // category required for Personal (used in offer generation)
      await booking.pickPurpose(optionSlug('Home improvement'));
      await expect(await booking.continueEnabled()).toBe(true);
      await booking.enterPurposeDetail('Roof repairs');
    });

    it(title('employment detected: "We\'ve seen ₦X/month salary into your [Bank] account · Employer" confirmation', Tag.high, Tag.spec('Personal§4')), async () => {
      await toEmployment(1_000_000, 12);
      await expect(await booking.detectedEmploymentShown()).toBe(true);
      const text = await booking.detectedEmploymentText();
      await expect(text).toMatch(new RegExp(`seen ${nairaRe(SALARY)}/month salary`, 'i'));
      await expect(text).toContain(EMPLOYER);
    });

    it(title('employment not detected: manual entry (employer, status, address, optional work email, salary account)', Tag.high, Tag.spec('Personal§4')), async () => {
      await hooks.dispose();
      await setup({ salaryDetected: false });
      await toEmployment(1_000_000, 12);
      await expect(await booking.manualShown()).toBe(true);
      await booking.pickEmployer('Dangote');
      await booking.pickEmploymentStatus('confirmed');
      await expect(await booking.continueEnabled()).toBe(false);
      await booking.enterEmployerAddress('1 Alfred Rewane Rd, Ikoyi, Lagos');
      await booking.pickSalaryAccount(0);
      await expect(await booking.continueEnabled()).toBe(true); // work email optional
    });

    it(title('employer not in dropdown: free-text fallback flags application for manual review', Tag.med, Tag.spec('Personal§9')), async () => {
      await hooks.dispose();
      await setup({ salaryDetected: false });
      await toEmployment(1_000_000, 12);
      await booking.enterEmployerFreeText('Qwerty Widgets Nigeria Ltd');
      await expect(await booking.manualReviewNotice()).toMatch(/review/i);
    });

    it(title('ambiguous salary (multiple recurring credits): customer picks one or enters manually', Tag.high, Tag.spec('Personal§9')), async () => {
      await hooks.stubProvider({ provider: 'MONO', outcome: 'MULTIPLE_SALARY_CREDITS', customerId });
      await toEmployment(1_000_000, 12);
      await expect(await booking.ambiguousShown()).toBe(true);
      await expect(await booking.ambiguousPrompt()).toMatch(/multiple recurring credits\. Which is your salary\?/i);
      await booking.pickAmbiguousCredit(0);
      await booking.pickSalaryAccount(0);
      await expect(await booking.continueEnabled()).toBe(true);
    });
  });

  describe('Step 4 — contextual documents (§4, §9, KYC §4 upload card)', () => {
    it(title('smaller amount: "For this amount, we need:" baseline list (3-month statements + ID), no variant language', Tag.crit, Tag.spec('Personal§4')), async () => {
      await toDocuments(SMALL, 6);
      await expect(await booking.docsHeading()).toMatch(/For this amount, we need/i);
      const labels = (await booking.docLabels()).join(' | ');
      await expect(labels).toMatch(/3 months/i);
      await expect(labels).not.toMatch(/6 months/i);
      await expect(labels).not.toMatch(/employer letter/i);
      await expect(labels).not.toMatch(/utility bill/i);
      await expectNoVisibleText(VARIANT_LANGUAGE);
    });

    it(title('larger amount: 6-month statements, employer letter (with template) and utility bill; no variant language', Tag.crit, Tag.spec('Personal§4')), async () => {
      expect(LARGE).toBeGreaterThanOrEqual(PERSONAL_TERMS.largerAmountDocsFrom);
      await toDocuments(LARGE, 24);
      await expect(await booking.docsHeading()).toMatch(/For this amount, we need/i);
      const labels = (await booking.docLabels()).join(' | ');
      await expect(labels).toMatch(/6 months/i);
      await expect(labels).toMatch(/employer letter/i);
      await expect(labels).toMatch(/utility bill/i);
      await expect(await booking.doc('employerLetter').templateShown()).toBe(true);
      await expect(await booking.doc('statement6m').acceptedFormats()).toMatch(/PDF/i);
      await expectNoVisibleText(VARIANT_LANGUAGE);
    });

    it(title('upload card walks Default → Uploading → Uploaded with file metadata', Tag.med, Tag.spec('KYC§4'), Tag.spec('Personal§4')), async () => {
      await hooks.stubProvider({ provider: 'DOC_VERIFY', outcome: 'DELAY_5S', customerId });
      await toDocuments(SMALL, 6);
      const card = booking.doc('statement3m');
      await expect(await card.state()).toBe('default');
      await card.upload(testFiles.validPdf);
      await card.waitForState('uploading', 10_000);
      await card.waitForState('uploaded');
      await expect(await card.fileMeta()).toMatch(/sample-statement\.pdf/i);
    });

    it(title('statement unreadable: two-clause error with Retry; connect-bank alternative offered; retry succeeds', Tag.high, Tag.spec('Personal§9'), Tag.spec('KYC§4')), async () => {
      await hooks.stubProvider({ provider: 'DOC_VERIFY', outcome: 'UNREADABLE', customerId });
      await toDocuments(SMALL, 6);
      const card = booking.doc('statement3m');
      await card.upload(testFiles.validPdf);
      await card.waitForState('error');
      await expect(await card.errorText()).toMatch(/Statement couldn't be read\. Upload a clearer file or connect your bank account directly/i);
      await expect(await booking.connectBankShown()).toBe(true);
      await expect(await booking.continueEnabled()).toBe(false);
      await hooks.stubProvider({ provider: 'DOC_VERIFY', outcome: 'OK', customerId });
      await card.retry();
      await card.waitForState('uploaded');
    });
  });

  describe('Steps 5–7 — mandate, review, submit, under review (§4, §8)', () => {
    it(title('mandate consent explains monthly debit via Remita with late-fee warning and is required', Tag.crit, Tag.spec('Personal§4')), async () => {
      await toMandate(1_200_000, 12);
      const monthly = loans.monthlyInstalment(1_200_000, R, 12);
      const text = await mandate.explanation();
      await expect(text).toMatch(new RegExp(`debit ${nairaRe(monthly)} from your .* account monthly`, 'i'));
      await expect(text).toMatch(/via Remita/i);
      await expect(text).toMatch(/late fees/i);
      await expect(await booking.continueEnabled()).toBe(false);
      await mandate.tickConsent();
      await expect(await booking.continueEnabled()).toBe(true);
    });

    it(title('review shows every field with oracle estimate and "final rate confirmed in the offer" note', Tag.crit, Tag.spec('Personal§4')), async () => {
      await toReview(1_200_000, 12);
      await expect((await booking.reviewAmount('amount')).toFixed(2)).toBe('1200000.00');
      await expect(await booking.reviewValue('tenor')).toMatch(/12 months/i);
      await expect((await booking.reviewAmount('monthly')).toFixed(2)).toBe(loans.monthlyInstalment(1_200_000, R, 12).toFixed(2));
      await expect(await booking.reviewValue('rate')).toContain(`${R}%`);
      await expect(await booking.reviewValue('employer')).toContain(EMPLOYER);
      await expect(await booking.reviewValue('salaryAccount')).toBeTruthy();
      await expect(await booking.reviewValue('documents')).toBeTruthy();
      await expect(await booking.reviewValue('mandate')).toMatch(/authori[sz]ed|consent/i);
      await expect(await booking.reviewNote()).toMatch(/Final rate and terms confirmed in the offer.*24-48 hours/i);
    });

    it(title('submit → under review with Bureau → Underwriting → Authority progress and notification', Tag.crit, Tag.smoke, Tag.spec('Personal§4'), Tag.spec('Personal§8'), Tag.spec('Personal§10')), async () => {
      await toReview(1_200_000, 12);
      await booking.submit();
      await underReview.waitForShown();
      await expect(await underReview.submittedAt()).toBeTruthy();
      await expect(await underReview.expectedBy()).toBeTruthy();
      const order = await underReview.stepOrder();
      await expect(order.join(' → ')).toMatch(/Bureau.*Underwrit.*(Authority|approval)/i);
      await expectNoVisibleText(VARIANT_LANGUAGE);
      await expect(await notificationText(hooks, customerId, 3)).toMatch(/Personal Loan application is under review\. We'll respond within 24-48 hours/i);
    });

    it(title('under-review progress reflects backend stage (Bureau done, Underwriter reviewing, Authority pending)', Tag.high, Tag.spec('Personal§4')), async () => {
      const { loanId } = await hooks.seedLoan({ customerId, product: 'PERSONAL', state: 'UNDER_REVIEW', amount: 1_200_000, extra: { reviewStage: 'UNDERWRITING' } });
      await openLoan('PERSONAL', loanId);
      await underReview.waitForShown();
      await expect(await underReview.stepState('bureau')).toBe('done');
      await expect(await underReview.stepState('underwriting')).toBe('active');
      await expect(await underReview.stepState('authority')).toBe('pending');
    });

    it(title('no PL1–PL5 / variant language on any booking step', Tag.high, Tag.spec('Personal§1'), Tag.spec('Personal§12')), async () => {
      await step1(LARGE, 24);
      await expectNoVisibleText(VARIANT_LANGUAGE);
      await booking.continue();
      await expectNoVisibleText(VARIANT_LANGUAGE);
      await booking.pickPurpose(optionSlug('Business'));
      await booking.continue();
      await expectNoVisibleText(VARIANT_LANGUAGE);
      await booking.confirmDetected();
      await booking.pickSalaryAccount(0);
      await booking.continue();
      await expectNoVisibleText(VARIANT_LANGUAGE);
      await uploadAll(['statement6m', 'validId', 'employerLetter', 'utilityBill']);
      await booking.continue();
      await expectNoVisibleText(VARIANT_LANGUAGE);
      await mandate.tickConsent();
      await booking.continue();
      await expectNoVisibleText(VARIANT_LANGUAGE);
    });

    it(title('draft is saved and resumes at the step the customer left', Tag.high, Tag.spec('Personal§6')), async () => {
      await toEmployment(1_000_000, 12);
      await booking.saveAndExit();
      await relaunchApp();
      await openLanding();
      await expect(await landing.resumeDraftShown()).toBe(true);
      await landing.resumeDraft();
      await booking.waitForShown();
      await expect(await booking.currentStep()).toMatch(/employment/i);
    });
  });

  describe('Step 8 — offer (§4, §6, §8)', () => {
    it(title('standard offer: amount, tenor, confirmed rate, monthly repayment and fee breakdown match the oracle', Tag.crit, Tag.spec('Personal§4')), async () => {
      const ratePct = 28;
      await seedOffer({ requested: 1_000_000, approved: 1_000_000, ratePct, tenorMonths: 12, adminFee: 10_000 });
      const schedule = loans.amortisationSchedule(1_000_000, ratePct, 12, new Date());
      const totalInterest = schedule.reduce((s, r) => s.plus(r.interest), D(0));
      await expect((await offer.approvedAmount()).toFixed(2)).toBe('1000000.00');
      await expect(await offer.tenor()).toMatch(/12 months/i);
      await expect(await offer.rate()).toContain(`${ratePct}%`);
      await expect((await offer.monthly()).toFixed(2)).toBe(loans.monthlyInstalment(1_000_000, ratePct, 12).toFixed(2));
      await expect((await offer.fee('interest')).toFixed(2)).toBe(totalInterest.toFixed(2));
      await expect((await offer.fee('admin')).toFixed(2)).toBe('10000.00');
      await expect(await offer.firstRepaymentDate()).toBeTruthy();
      await expect(await offer.reducedShown()).toBe(false);
      await expect(await notificationText(hooks, customerId, 3)).toMatch(/Personal Loan offer is ready/i);
    });

    it(title('reduced offer explains approved vs requested amount and the reason', Tag.crit, Tag.spec('Personal§4'), Tag.spec('Personal§9')), async () => {
      const reason = 'Affordability based on your verified income';
      await seedOffer({ requested: 1_000_000, approved: 700_000, ratePct: 28, tenorMonths: 12, reducedReason: reason });
      await expect(await offer.reducedShown()).toBe(true);
      const msg = await offer.reducedMessage();
      await expect(msg).toMatch(new RegExp(`offering ${nairaRe(700_000)} \\(less than your ${nairaRe(1_000_000)} request\\) over 12 months`, 'i'));
      await expect(await offer.reducedReason()).toContain(reason);
      await expect((await offer.monthly()).toFixed(2)).toBe(loans.monthlyInstalment(700_000, 28, 12).toFixed(2));
      await expect(await offer.acceptShown()).toBe(true);
    });

    it(title('accept → "One more step" activation → active; wallet credited with the approved amount', Tag.crit, Tag.smoke, Tag.open('L-personal-fee-deduction'), Tag.spec('Personal§4'), Tag.spec('Personal§8')), async () => {
      const before = await walletBalance();
      await seedOffer({ requested: 1_000_000, approved: 1_000_000, ratePct: 28, tenorMonths: 12, activationSteps: ['MANDATE_CONFIRMATION'] });
      await offer.accept();
      await activation.waitForShown();
      await expect(await activation.title()).toMatch(/One more step/i);
      await expectNoVisibleText(VARIANT_LANGUAGE);
      await expect(await activation.stepShown('mandate')).toBe(true);
      await activation.confirmMandate();
      await activation.finish();
      await expect(await activation.successShown()).toBe(true);
      await expect(await activation.successHeadline()).toMatch(/Your Personal Loan is active/i);
      const monthly = loans.monthlyInstalment(1_000_000, 28, 12);
      await expect((await activation.successAmount()).toFixed(2)).toBe('1000000.00');
      await expect((await activation.successMonthly()).toFixed(2)).toBe(monthly.toFixed(2));
      await expect(await activation.successFirstDate()).toBeTruthy();
      // ASSUMPTION: admin fee is 0 in this seed, so the full approved amount reaches the wallet.
      await expect((await walletBalance()).minus(before).toFixed(2)).toBe('1000000.00');
      await expect(await notificationText(hooks, customerId, 3)).toMatch(new RegExp(`Personal Loan of ${nairaRe(1_000_000)} is active\\. First repayment ${nairaRe(monthly)} due`, 'i'));
    });

    it(title('decline offer → "Offer declined. You can apply again after N days" and Apply is blocked', Tag.crit, Tag.spec('Personal§4')), async () => {
      await seedOffer({ requested: 1_000_000, approved: 1_000_000, ratePct: 28, tenorMonths: 12 });
      await offer.decline();
      await offer.confirmDecline();
      await expect(await offer.declinedText()).toMatch(new RegExp(`Offer declined\\. You can apply again after ${PERSONAL_TERMS.reapplyWaitDays} days`, 'i'));
      await openLanding();
      await expect(await landing.applyEnabled()).toBe(false);
    });

    it(title('offer expires after the configured window: expired state, notification, re-apply allowed', Tag.crit, Tag.spec('Personal§6'), Tag.spec('Personal§8')), async () => {
      const id = await seedOffer({ requested: 1_000_000, approved: 1_000_000, ratePct: 28, tenorMonths: 12 });
      await expect(await offer.expiresIn()).toMatch(new RegExp(`${PERSONAL_TERMS.offerExpiryDays} days`, 'i'));
      await hooks.advanceClock({ customerId, days: PERSONAL_TERMS.offerExpiryDays + 1 });
      await expect(await notificationText(hooks, customerId)).toMatch(/Personal Loan offer expired\. You can re-apply anytime/i);
      await openLoan('PERSONAL', id);
      await expect(await offer.expiredShown()).toBe(true);
      await expect(await offer.acceptShown()).toBe(false);
      await openLanding();
      await expect(await landing.applyEnabled()).toBe(true);
    });

    it(title('activation fails (mandate setup): error copy, offer preserved, retry succeeds; no disbursement on failure', Tag.crit, Tag.spec('Personal§9')), async () => {
      const before = await walletBalance();
      const id = await seedOffer({ requested: 1_000_000, approved: 1_000_000, ratePct: 28, tenorMonths: 12, activationSteps: ['MANDATE_CONFIRMATION'] });
      await hooks.stubProvider({ provider: 'REMITA', outcome: 'MANDATE_FAILED', customerId });
      await offer.accept();
      await activation.waitForShown();
      await activation.confirmMandate();
      await expect(await activation.errorShown()).toBe(true);
      await expect(await activation.errorText()).toMatch(/couldn't set up your automatic debit — please try again or update your bank details/i);
      await expect((await walletBalance()).toFixed(2)).toBe(before.toFixed(2));
      await openLoan('PERSONAL', id);
      await expect(await offer.acceptShown()).toBe(true); // offer preserved
      await hooks.stubProvider({ provider: 'REMITA', outcome: 'MANDATE_OK', customerId });
      await offer.accept();
      await activation.confirmMandate();
      await activation.finish();
      await expect(await activation.successShown()).toBe(true);
    });

    it(title('application declined after review: notification with reason; no override from app', Tag.high, Tag.spec('Personal§8'), Tag.spec('Personal§11')), async () => {
      const { loanId } = await hooks.seedLoan({ customerId, product: 'PERSONAL', state: 'DECLINED', amount: 1_000_000, extra: { declineReason: 'DTI too high' } });
      await openLoan('PERSONAL', loanId);
      const decline = new LoanDeclineScreen('personal');
      await decline.waitForShown();
      await expect(await decline.reason()).toMatch(/DTI too high/i);
      await expect(await decline.overrideActionExists()).toBe(false);
      await expect(await notificationText(hooks, customerId)).toMatch(/Personal Loan application wasn't approved this time — reason:/i);
    });
  });
});
