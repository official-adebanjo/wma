import { expect } from '@wdio/globals';
import { D, addMonths } from '../../../shared/calc/money';
import * as loans from '../../../shared/calc/loans';
import { Tag, title } from '../../../shared/support/tags';
import { testFiles } from '../../../shared/data/factories';
import { QaHooks } from '../../../shared/api/qa-hooks';
import { freshCustomer, requireHooks } from '../../helpers/session';
import {
  CORRIDORS, CorridorFixture, INTEREST_MODELS, PUBLIC_SECTOR_DEFAULT_MODEL, SYSTEM_CODE_OR_JARGON, daysFromNow, expectNoVisibleText, isoDate,
  modelTitle, nairaRe, notificationText,
  openBorrowTile, openLoan, seedCorridors, setCrossLoanBlock,
} from '../../helpers/loans';
import { expectInlineError } from '../../screens/BaseScreen';
import { LoanUnderReviewScreen, MandateConsentScreen } from '../../screens/loans/BorrowCommon';
import { PersonalLandingScreen } from '../../screens/loans/PersonalLoanScreens';
import {
  CorridorConfirmScreen, CorridorSearchScreen, EmployerNotServedScreen, PublicSectorActivationScreen, PublicSectorBookingScreen,
  PublicSectorLandingScreen, PublicSectorLoanScreen, PublicSectorOfferScreen,
} from '../../screens/loans/PublicSectorScreens';

/**
 * Public Sector (Group) Loan — corridor selection, corridor inputs, caps, documents, consent letter,
 * review, offer, activation (Public_Sector_Loan_Customer_App_Spec §3, §4, §6, §8, §9, §10).
 * Risk: corridor eligibility gate, tenor / affordability caps, disbursement = CRIT.
 */
describe('Public Sector Loan › Application', () => {
  const FED = CORRIDORS.federal;
  const LAG = CORRIDORS.lagos;
  const IPPIS_NO = '123456';
  const STAFF_NO = 'LAS/2019/04411';
  let hooks: QaHooks;
  let customerId: string;

  const landing = new PublicSectorLandingScreen();
  const search = new CorridorSearchScreen();
  const confirm = new CorridorConfirmScreen();
  const booking = new PublicSectorBookingScreen();
  const mandate = new MandateConsentScreen('publicSector');
  const underReview = new LoanUnderReviewScreen('publicSector');
  const offer = new PublicSectorOfferScreen();
  const activation = new PublicSectorActivationScreen();

  beforeEach(async function () {
    requireHooks(this);
    ({ hooks, customerId } = await freshCustomer({ tier: 2, walletBalance: 10_000 }));
    await seedCorridors(hooks);
    await setCrossLoanBlock(hooks, false);
    await hooks.stubProvider({ provider: 'IPPIS', outcome: 'MATCH', customerId });
    await hooks.stubProvider({ provider: 'DOC_VERIFY', outcome: 'OK', customerId });
    await hooks.stubProvider({ provider: 'REMITA', outcome: 'MANDATE_OK', customerId });
  });

  afterEach(async () => {
    await hooks?.resetClock().catch(() => undefined);
    await hooks?.dispose();
  });

  async function openSearch() {
    await openBorrowTile('publicSector');
    await landing.waitForShown();
    await landing.findEmployer();
    await search.waitForShown();
  }

  async function pickCorridor(c: CorridorFixture) {
    await openSearch();
    await search.search(c.name);
    await search.suggestion(0).pick();
    await confirm.waitForShown();
  }

  /** Step 3 inputs. Retirement defaults to 20 years out so it never caps tenor unless asked. */
  async function toAmountStep(c: CorridorFixture, o: { retirement?: Date; gross?: number } = {}) {
    await pickCorridor(c);
    await confirm.continue();
    await booking.waitForShown();
    if (c.idField === 'ippis') await booking.enterIppis(IPPIS_NO);
    else await booking.enterStaffNumber(STAFF_NO);
    if (!(await booking.salaryBasisFetched())) {
      await booking.enterGross(o.gross ?? 400_000);
      await booking.enterAllowances(0);
    }
    await booking.pickSalaryAccount(0);
    await booking.enterRetirementDate(isoDate(o.retirement ?? addMonths(daysFromNow(0), 240)));
    await booking.continue();
  }

  async function toDocuments(c: CorridorFixture, amount: number, tenor: number) {
    await toAmountStep(c);
    await booking.pickTenor(tenor);
    await booking.enterAmount(amount);
    await booking.pickPurpose('education');
    await booking.continue();
  }

  async function toReview(c: CorridorFixture, amount: number, tenor: number) {
    await toDocuments(c, amount, tenor);
    await booking.continue(); // below control gate: no extra docs
    if (c.consentLetterRequired) {
      await booking.downloadConsentLetter();
      const card = booking.consentLetterUpload();
      await card.upload(testFiles.validPdf);
      await card.waitForState('uploaded');
    } else if (c.mandateRequired) {
      await mandate.waitForShown();
      await mandate.tickConsent();
    }
    await booking.continue();
  }

  /** Monthly rate the engine applies for a corridor's quoted p.a. rate. */
  const monthlyRate = (c: CorridorFixture) => loans.monthlyFromAnnual(c.ratePct);

  async function seedOffer(c: CorridorFixture, amount: number, tenorMonths: number, model: loans.InterestModel = PUBLIC_SECTOR_DEFAULT_MODEL) {
    await seedCorridors(hooks, {}, model);
    const { loanId } = await hooks.seedLoan({
      customerId, product: 'PUBLIC_SECTOR', state: 'OFFER_RETURNED', amount,
      extra: { corridor: c.name, ratePct: c.ratePct, monthlyRatePct: monthlyRate(c).toNumber(), interestModel: model, tenorMonths, approvedAmount: amount },
    });
    await openLoan('PUBLIC_SECTOR', loanId);
    await offer.waitForShown();
    return loanId;
  }

  describe('Landing & corridor selection (§3, §4 step 1)', () => {
    it(title('landing explains the employer eligibility gate with "Find your employer" CTA', Tag.high, Tag.spec('PublicSector§3')), async () => {
      await openBorrowTile('publicSector');
      await landing.waitForShown();
      await expect(await landing.eligibilityExplanation()).toMatch(/your employer needs to be one Rosabon serves/i);
      await landing.findEmployer();
      await search.waitForShown();
    });

    it(title('search placeholder guides with examples', Tag.low, Tag.spec('PublicSector§4')), async () => {
      await openSearch();
      await expect(await search.placeholder()).toMatch(/Type your employer name/i);
    });

    const queries: Array<{ q: string; c: CorridorFixture }> = [
      { q: 'Lag', c: LAG }, { q: 'IPPIS', c: FED }, { q: 'Ibadan', c: CORRIDORS.unibadan },
    ];
    for (const { q, c } of queries) {
      it(title(`real-time suggestions: "${q}" surfaces ${c.name} with a helpful sub-label`, Tag.crit, Tag.spec('PublicSector§4')), async () => {
        await openSearch();
        await search.search(q);
        const names = await search.suggestionNames();
        const i = names.findIndex((n) => n.includes(c.name));
        expect(i).toBeGreaterThanOrEqual(0);
        await expect(await search.suggestion(i).subLabel()).toMatch(new RegExp(c.subLabel, 'i'));
        await expectNoVisibleText(SYSTEM_CODE_OR_JARGON);
      });
    }

    it(title('grouped browse: Federal MDAs / State Governments / Tertiary Institutions, alphabetical within groups', Tag.high, Tag.spec('PublicSector§4'), Tag.spec('PublicSector§10')), async () => {
      await openSearch();
      await expect(await search.browseHeading()).toMatch(/Or browse by group/i);
      await expect(await search.groupLabel('federal')).toMatch(/Federal MDAs/i);
      await expect(await search.groupLabel('state')).toMatch(/State Governments/i);
      await expect(await search.groupLabel('tertiary')).toMatch(/Tertiary Institutions/i);
      await search.openGroup('federal');
      await expect((await search.groupItems('federal')).join('|')).toContain(FED.name);
      await search.openGroup('state');
      const states = await search.groupItems('state');
      expect(states).toContain(LAG.name);
      expect(states).toEqual([...states].sort((a, b) => a.localeCompare(b)));
      await search.openGroup('tertiary');
      const tertiary = await search.groupItems('tertiary');
      expect(tertiary).toContain(CORRIDORS.unibadan.name);
      expect(tertiary).toEqual([...tertiary].sort((a, b) => a.localeCompare(b)));
      await expectNoVisibleText(SYSTEM_CODE_OR_JARGON);
    });

    it(title('"My employer isn\'t here": Personal Loan alternative opens Personal Loan landing', Tag.crit, Tag.spec('PublicSector§4'), Tag.spec('PublicSector§9')), async () => {
      await openSearch();
      await search.search('Imaginary Ministry of Nothing');
      await expect(await search.suggestion(0).shown()).toBe(false);
      await search.employerNotHere();
      const notServed = new EmployerNotServedScreen();
      await notServed.waitForShown();
      await expect(await notServed.message()).toMatch(/don't currently serve your employer.*Personal Loan.*notify you/i);
      await notServed.openPersonalLoan();
      await new PersonalLandingScreen().waitForShown();
    });

    it(title('"Notify me" opt-in confirms the customer will be told when their employer is added', Tag.med, Tag.spec('PublicSector§4')), async () => {
      await openSearch();
      await search.employerNotHere();
      const notServed = new EmployerNotServedScreen();
      await notServed.waitForShown();
      await notServed.notifyMe();
      await expect(await notServed.notifyConfirmation()).toMatch(/notify/i);
    });

    it(title('corridor confirmation previews corridor terms (deduction method, rate, max tenor, salary basis)', Tag.high, Tag.spec('PublicSector§4')), async () => {
      await pickCorridor(LAG);
      await expect(await confirm.summary()).toMatch(/You're applying as a Lagos State Government employee/i);
      await expect(await confirm.term('deductionMethod')).toMatch(/payroll/i);
      await expect(await confirm.term('rate')).toContain(`${LAG.ratePct}%`);
      await expect(await confirm.term('maxTenor')).toMatch(new RegExp(`${LAG.maxTenorMonths} months`, 'i'));
      await expect(await confirm.term('salaryBasis')).toMatch(/gross|net|allowance/i);
      await expectNoVisibleText(SYSTEM_CODE_OR_JARGON);
    });
  });

  describe('Corridor-specific inputs & caps (§4 steps 3–4, §9)', () => {
    it(title('Federal IPPIS asks for IPPIS number (not staff number)', Tag.crit, Tag.spec('PublicSector§4')), async () => {
      await pickCorridor(FED);
      await confirm.continue();
      await booking.waitForShown();
      await expect(await booking.ippisShown()).toBe(true);
      await expect(await booking.staffNumberShown()).toBe(false);
    });

    it(title('Lagos State asks for staff number (not IPPIS)', Tag.crit, Tag.spec('PublicSector§4')), async () => {
      await pickCorridor(LAG);
      await confirm.continue();
      await booking.waitForShown();
      await expect(await booking.staffNumberShown()).toBe(true);
      await expect(await booking.ippisShown()).toBe(false);
    });

    it(title('IPPIS mismatch: two-clause "couldn\'t be verified… check the number, or contact us" error blocks progress', Tag.crit, Tag.spec('PublicSector§9'), Tag.spec('PublicSector§8')), async () => {
      await hooks.stubProvider({ provider: 'IPPIS', outcome: 'MISMATCH', customerId });
      await pickCorridor(FED);
      await confirm.continue();
      await booking.waitForShown();
      await booking.enterIppis('999999');
      await booking.pickSalaryAccount(0);
      await booking.enterRetirementDate(isoDate(addMonths(daysFromNow(0), 240)));
      await booking.continue();
      await expectInlineError('publicSector.booking.ippis.input', /IPPIS number couldn't be verified\. Please check the number, or contact us for help/i);
      await expect(await booking.ippisShown()).toBe(true); // still on the corridor-inputs step
    });

    it(title('retirement date caps tenor at whole months to retirement (oracle); longer tenor gives two-clause error', Tag.crit, Tag.spec('PublicSector§4'), Tag.spec('PublicSector§9')), async () => {
      const today = daysFromNow(0);
      const retirement = addMonths(today, 14);
      const max = loans.maxTenorByRetirement(today, retirement);
      expect(max).toBe(14);
      await toAmountStep(FED, { retirement });
      await booking.enterAmount(500_000);
      const over = FED.tenorsMonths.find((m) => m > max)!;
      const ok = [...FED.tenorsMonths].reverse().find((m) => m <= max)!;
      await booking.pickTenor(over);
      await expectInlineError('publicSector.booking.tenor.input', new RegExp(`tenor extends beyond your retirement date\\. Please reduce tenor to ${max} months or less`, 'i'));
      await expect(await booking.continueEnabled()).toBe(false);
      await booking.pickTenor(ok);
      await expect(await booking.continueEnabled()).toBe(true);
    });

    it(title('years-to-retirement is displayed once a retirement date is entered', Tag.med, Tag.spec('PublicSector§10')), async () => {
      await pickCorridor(FED);
      await confirm.continue();
      await booking.waitForShown();
      await booking.enterRetirementDate(isoDate(addMonths(daysFromNow(0), 60)));
      await expect(await booking.yearsToRetirement()).toMatch(/\b5\b.*year|60 months/i);
    });

    for (const model of INTEREST_MODELS) {
      it(title(`${modelTitle(model)}: live affordability cap = salary basis × DTI − existing deductions over month-1 instalment (oracle); over-cap gives two-clause error`, Tag.crit, Tag.spec('PublicSector§4'), Tag.spec('PublicSector§9'), Tag.spec('LoanSpec§4.2')), async () => {
        const gross = 300_000;
        const tenor = 12;
        await seedCorridors(hooks, {}, model);
        await toAmountStep(LAG, { gross });
        await booking.pickTenor(tenor);
        // Month-1 instalment is P/N + P×r under both models, so the cap is model-independent — asserted under each.
        const cap = loans.maxAffordablePrincipal(gross, LAG.dtiPct, 0, monthlyRate(LAG), tenor);
        expect(loans.firstInstalment(cap, monthlyRate(LAG), tenor, model).lte(D(gross).mul(LAG.dtiPct).div(100).plus(0.01))).toBe(true);
        await expect((await booking.capAmount()).toFixed(2)).toBe(cap.toFixed(2));
        await expect(await booking.capText()).toMatch(/calculated from your salary basis, DTI, and any existing deductions/i);
        await booking.enterAmount(cap.plus(1).toFixed(0));
        await expectInlineError('publicSector.booking.amount.input', new RegExp(`exceeds your affordability under ${LAG.name} rules\\. Try up to ${nairaRe(cap)}`, 'i'));
        await expect(await booking.continueEnabled()).toBe(false);
        await booking.enterAmount(cap.floor().toFixed(0));
        await expect(await booking.continueEnabled()).toBe(true);
      });

      for (const tenor of [12, 24]) {
        it(title(`${modelTitle(model)}: live monthly repayment for ₦1,000,000 over ${tenor} months at the corridor rate = month-1 instalment from the oracle`, Tag.crit, Tag.spec('PublicSector§4'), Tag.spec('LoanSpec§4.2')), async () => {
          await seedCorridors(hooks, {}, model);
          await toAmountStep(FED, { gross: 1_500_000 });
          await booking.pickTenor(tenor);
          await booking.enterAmount(1_000_000);
          const expected = loans.firstInstalment(1_000_000, monthlyRate(FED), tenor, model);
          await expect((await booking.monthlyEstimate()).toFixed(2)).toBe(expected.toFixed(2));
          await expect(await booking.monthlyEstimateText()).toMatch(new RegExp(`Approximately ${nairaRe(expected)}/month at ~${FED.ratePct}% p\\.a\\.`, 'i'));
        });
      }
    }
  });

  describe('Documents & consent letter (§4 steps 5–6, §9)', () => {
    it(title('above the corridor threshold: "For this amount, we need:" house visit, cheques, utility bill — no control-gate jargon', Tag.crit, Tag.spec('PublicSector§4')), async () => {
      const amount = LAG.controlGateFrom + 500_000;
      await toAmountStep(LAG, { gross: 2_000_000 });
      await booking.pickTenor(36);
      await booking.enterAmount(amount);
      await booking.pickPurpose('education');
      await booking.continue();
      await expect(await booking.docsHeading()).toMatch(/For this amount, we need/i);
      const labels = (await booking.docLabels()).join(' | ');
      await expect(labels).toMatch(/house visit/i);
      await expect(labels).toMatch(/cheque/i);
      await expect(labels).toMatch(/utility bill/i);
      await expectNoVisibleText(SYSTEM_CODE_OR_JARGON);
    });

    it(title('below the corridor threshold: no house visit / cheque requirements', Tag.high, Tag.spec('PublicSector§4')), async () => {
      await toDocuments(LAG, LAG.controlGateFrom - 100_000, 36);
      await expect(await booking.docShown('houseVisitation')).toBe(false);
      await expect(await booking.docShown('obligorCheques')).toBe(false);
    });

    it(title('consent-letter corridor: explanation, pre-filled download, signed upload reaches Uploaded', Tag.crit, Tag.spec('PublicSector§4')), async () => {
      await toDocuments(FED, 1_000_000, 24);
      await booking.continue();
      await expect(await booking.consentLetterExplanation()).toMatch(/requires you to sign a consent letter authori[sz]ing payroll deduction\. Download the pre-filled letter, sign it, and upload/i);
      await expect(await booking.continueEnabled()).toBe(false);
      await booking.downloadConsentLetter();
      await expect(await booking.consentLetterDownloaded()).toMatch(/download/i);
      const card = booking.consentLetterUpload();
      await card.upload(testFiles.validPdf);
      await card.waitForState('uploaded');
      await expect(await booking.continueEnabled()).toBe(true);
    });

    const rejections: Array<{ outcome: string; reason: RegExp }> = [
      { outcome: 'NOT_SIGNED', reason: /not signed/i },
      { outcome: 'ILLEGIBLE', reason: /illegible/i },
      { outcome: 'WRONG_TEMPLATE', reason: /wrong template/i },
    ];
    for (const r of rejections) {
      it(title(`consent letter rejected (${r.outcome}): two-clause error with reason and Retry`, Tag.high, Tag.spec('PublicSector§9')), async () => {
        await hooks.stubProvider({ provider: 'DOC_VERIFY', outcome: r.outcome, customerId });
        await toDocuments(FED, 1_000_000, 24);
        await booking.continue();
        await booking.downloadConsentLetter();
        const card = booking.consentLetterUpload();
        await card.upload(testFiles.validPdf);
        await card.waitForState('error');
        const err = await card.errorText();
        await expect(err).toMatch(/Consent letter can't be accepted — reason:/i);
        await expect(err).toMatch(r.reason);
        await expect(err).toMatch(/re-download and try again/i);
        await expect(await booking.continueEnabled()).toBe(false);
      });
    }

    it(title('mandate corridor (Lagos State): mandate consent is required instead of a consent letter', Tag.high, Tag.spec('PublicSector§4')), async () => {
      await toDocuments(LAG, 800_000, 24);
      await booking.continue();
      await mandate.waitForShown();
      await expect(await booking.consentLetterShown()).toBe(false);
      await expect(await booking.continueEnabled()).toBe(false);
      await mandate.tickConsent();
      await expect(await booking.continueEnabled()).toBe(true);
    });
  });

  describe('Review, under review, offer, activation (§4 steps 7–10, §6, §8)', () => {
    for (const model of INTEREST_MODELS) {
      it(title(`${modelTitle(model)}: review shows corridor (employer name), amount, tenor, oracle monthly, salary basis, IPPIS, deduction method, documents`, Tag.crit, Tag.spec('PublicSector§4'), Tag.spec('LoanSpec§4.2')), async () => {
        await seedCorridors(hooks, {}, model);
        await toReview(FED, 1_000_000, 24);
        await expect(await booking.reviewValue('corridor')).toContain(FED.name);
        await expect((await booking.reviewAmount('amount')).toFixed(2)).toBe('1000000.00');
        await expect(await booking.reviewValue('tenor')).toMatch(/24 months/i);
        await expect((await booking.reviewAmount('monthly')).toFixed(2)).toBe(loans.firstInstalment(1_000_000, monthlyRate(FED), 24, model).toFixed(2));
        await expect(await booking.reviewValue('salaryBasis')).toBeTruthy();
        await expect(await booking.reviewValue('idNumber')).toContain(IPPIS_NO);
        await expect(await booking.reviewValue('deductionMethod')).toMatch(/IPPIS|payroll/i);
        await expect(await booking.reviewValue('documents')).toMatch(/consent letter/i);
        await expectNoVisibleText(SYSTEM_CODE_OR_JARGON);
      });
    }

    it(title('submit → under review with "Validating IPPIS number…" then Underwriting and Authority steps', Tag.crit, Tag.smoke, Tag.spec('PublicSector§4'), Tag.spec('PublicSector§8')), async () => {
      await toReview(FED, 1_000_000, 24);
      await booking.submit();
      await underReview.waitForShown();
      await expect(await underReview.stepLabel('ippis')).toMatch(/Validating IPPIS number/i);
      await expect(await underReview.stepShown('underwriting')).toBe(true);
      await expect(await underReview.stepShown('authority')).toBe(true);
      await expectNoVisibleText(SYSTEM_CODE_OR_JARGON);
      await expect(await notificationText(hooks, customerId, 3)).toMatch(/Public Sector Loan application is under review\. Response typically within 48 hours/i);
    });

    for (const model of INTEREST_MODELS) it(title(`${modelTitle(model)}: offer shows amount, tenor, rate, oracle monthly and first payroll deduction date for the corridor`, Tag.crit, Tag.spec('PublicSector§4'), Tag.spec('LoanSpec§4.2')), async () => {
      await seedOffer(FED, 2_000_000, 24, model);
      await expect((await offer.approvedAmount()).toFixed(2)).toBe('2000000.00');
      await expect(await offer.tenor()).toMatch(/24 months/i);
      await expect(await offer.rate()).toContain(`${FED.ratePct}%`);
      await expect((await offer.monthly()).toFixed(2)).toBe(loans.firstInstalment(2_000_000, monthlyRate(FED), 24, model).toFixed(2));
      await expect(await offer.firstDeductionDate()).toBeTruthy();
      await expect(await offer.corridorContext()).toMatch(/Your first payroll deduction will happen on/i);
      await expect(await notificationText(hooks, customerId, 3)).toMatch(/Public Sector Loan offer is ready/i);
      await expectNoVisibleText(SYSTEM_CODE_OR_JARGON);
    });

    for (const model of INTEREST_MODELS) it(title(`${modelTitle(model)}: accept → active, awaiting first payroll cycle state with 1–2 cycle note and notification`, Tag.crit, Tag.smoke, Tag.spec('PublicSector§4'), Tag.spec('PublicSector§6'), Tag.spec('PublicSector§8'), Tag.spec('LoanSpec§4.2')), async () => {
      const id = await seedOffer(FED, 2_000_000, 24, model);
      const monthly = loans.firstInstalment(2_000_000, monthlyRate(FED), 24, model);
      await offer.accept();
      await activation.waitForShown();
      await expect(await activation.successShown()).toBe(true);
      await expect(await activation.successHeadline()).toMatch(new RegExp(`Your Public Sector Loan is active\\. First deduction ${nairaRe(monthly)} on`, 'i'));
      await expect((await activation.firstDeductionAmount()).toFixed(2)).toBe(monthly.toFixed(2));
      await expect(await activation.cyclesNote()).toMatch(/1-2 payroll cycles/i);
      await openLoan('PUBLIC_SECTOR', id);
      const loan = new PublicSectorLoanScreen();
      await loan.waitForShown();
      await expect(await loan.stateLabel()).toMatch(/awaiting first payroll/i);
      await expect(await loan.corridor()).toContain(FED.name);
      await expect(await notificationText(hooks, customerId, 3)).toMatch(new RegExp(`First payroll deduction of ${nairaRe(monthly)} on .* may take 1-2 payroll cycles`, 'i'));
    });

    it(title('decline offer → "Offer declined. You can apply again after N days"', Tag.high, Tag.spec('PublicSector§4')), async () => {
      await seedOffer(FED, 2_000_000, 24);
      await offer.decline();
      await offer.confirmDecline();
      await expect(await offer.declinedText()).toMatch(/Offer declined\. You can apply again after \d+ days/i);
    });

    it(title('no system codes or internal jargon on any booking screen (search → review)', Tag.high, Tag.spec('PublicSector§10'), Tag.spec('PublicSector§12')), async () => {
      await openSearch();
      await expectNoVisibleText(SYSTEM_CODE_OR_JARGON);
      await search.search(FED.name);
      await expectNoVisibleText(SYSTEM_CODE_OR_JARGON);
      await search.suggestion(0).pick();
      await confirm.waitForShown();
      await expectNoVisibleText(SYSTEM_CODE_OR_JARGON);
      await confirm.continue();
      await booking.waitForShown();
      await expectNoVisibleText(SYSTEM_CODE_OR_JARGON);
      await booking.enterIppis(IPPIS_NO);
      await booking.pickSalaryAccount(0);
      await booking.enterRetirementDate(isoDate(addMonths(daysFromNow(0), 240)));
      await booking.continue();
      await expectNoVisibleText(SYSTEM_CODE_OR_JARGON);
      await booking.pickTenor(24);
      await booking.enterAmount(FED.controlGateFrom + 100_000);
      await booking.pickPurpose('education');
      await booking.continue();
      await expectNoVisibleText(SYSTEM_CODE_OR_JARGON);
    });
  });
});
