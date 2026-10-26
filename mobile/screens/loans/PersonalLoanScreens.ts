import { BaseScreen } from '../BaseScreen';
import { DocUploadCard, LoanLandingScreen, LoanOnLoanScreen } from './BorrowCommon';

/** Personal Loan (Private Sector) — Personal_Loan_Customer_App_Spec §3–§10. One product, one flow: no PL1–PL5. */

export type PersonalDocKey = 'statement3m' | 'statement6m' | 'validId' | 'employerLetter' | 'utilityBill';

export class PersonalLandingScreen extends LoanLandingScreen {
  constructor() { super('personal'); }
  rateRange() { return this.text('personal.landing.rateRange'); }
  resumeDraftShown() { return this.exists('personal.landing.resumeDraft', 3_000); }
  resumeDraft() { return this.tap('personal.landing.resumeDraft'); }
}

export class PersonalBookingScreen extends BaseScreen {
  protected readonly root = 'personal.booking.screen';
  currentStep() { return this.text('personal.booking.step'); }
  saveAndExit() { return this.tap('personal.booking.saveExit'); }
  // Step 1 — amount + tenor + live estimate
  enterAmount(v: number | string) { return this.type('personal.booking.amount.input', v); }
  amountValue() { return this.amount('personal.booking.amount.input'); }
  amountError() { return this.text('personal.booking.amount.input.error'); }
  pickTenor(months: number) { return this.tap(`personal.booking.tenor.input.option.${months}`); }
  tenorOptionShown(months: number) { return this.exists(`personal.booking.tenor.input.option.${months}`, 1_500); }
  estimateText() { return this.text('personal.booking.estimate'); }
  estimateAmount() { return this.amount('personal.booking.estimate.amount'); }
  // Step 2 — purpose
  pickPurpose(slug: string) { return this.tap(`personal.booking.purpose.option.${slug}`); }
  purposeOptionShown(slug: string) { return this.exists(`personal.booking.purpose.option.${slug}`, 1_500); }
  enterPurposeDetail(v: string) { return this.type('personal.booking.purpose.detail.input', v); }
  // Step 3 — employment
  detectedEmploymentShown() { return this.exists('personal.booking.employment.detected', 3_000); }
  detectedEmploymentText() { return this.text('personal.booking.employment.detected'); }
  confirmDetected() { return this.tap('personal.booking.employment.detected.confirm'); }
  ambiguousShown() { return this.exists('personal.booking.employment.ambiguous', 3_000); }
  ambiguousPrompt() { return this.text('personal.booking.employment.ambiguous'); }
  pickAmbiguousCredit(i: number) { return this.tap(`personal.booking.employment.ambiguous.option.${i}`); }
  enterManually() { return this.tap('personal.booking.employment.ambiguous.manual'); }
  manualShown() { return this.exists('personal.booking.employment.employer.input', 3_000); }
  async pickEmployer(name: string) {
    await this.type('personal.booking.employment.employer.input', name);
    await this.tap('personal.booking.employment.employer.option.0');
  }
  async enterEmployerFreeText(name: string) {
    await this.type('personal.booking.employment.employer.input', name);
    await this.tap('personal.booking.employment.employer.other');
  }
  pickEmploymentStatus(s: 'confirmed' | 'contract' | 'probation') { return this.tap(`personal.booking.employment.status.${s}`); }
  enterEmployerAddress(v: string) { return this.type('personal.booking.employment.address.input', v); }
  enterWorkEmail(v: string) { return this.type('personal.booking.employment.workEmail.input', v); }
  async pickSalaryAccount(i = 0) {
    await this.tap('personal.booking.employment.salaryAccount.input');
    await this.tap(`personal.booking.employment.salaryAccount.input.option.${i}`);
  }
  manualReviewNotice() { return this.text('personal.booking.employment.manualReviewNotice'); }
  // Step 4 — contextual documents
  docsHeading() { return this.text('personal.booking.docs.heading'); }
  async docLabels(): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < 10; i++) {
      if (!(await this.exists(`personal.booking.docs.item.${i}.label`, 500))) break;
      out.push(await this.text(`personal.booking.docs.item.${i}.label`));
    }
    return out;
  }
  doc(key: PersonalDocKey) { return new DocUploadCard(`personal.booking.docs.${key}`); }
  docShown(key: PersonalDocKey) { return this.exists(`personal.booking.docs.${key}`, 1_500); }
  connectBank() { return this.tap('personal.booking.docs.connectBank'); }
  connectBankShown() { return this.exists('personal.booking.docs.connectBank', 1_500); }
  // Step 6 — review
  reviewValue(field: 'amount' | 'tenor' | 'monthly' | 'rate' | 'employer' | 'salaryAccount' | 'documents' | 'mandate' | 'purpose') {
    return this.text(`personal.booking.review.${field}`);
  }
  reviewAmount(field: 'amount' | 'monthly') { return this.amount(`personal.booking.review.${field}`); }
  reviewNote() { return this.text('personal.booking.review.note'); }
  submit() { return this.tap('personal.booking.review.submit'); }
  // Navigation
  continue() { return this.tap('personal.booking.continue'); }
  continueEnabled() { return this.isEnabled('personal.booking.continue'); }
}

/** Step 8 — offer (standard + reduced), 9b decline, expiry. */
export class PersonalOfferScreen extends BaseScreen {
  protected readonly root = 'personal.offer.screen';
  approvedAmount() { return this.amount('personal.offer.amount'); }
  tenor() { return this.text('personal.offer.tenor'); }
  rate() { return this.text('personal.offer.rate'); }
  monthly() { return this.amount('personal.offer.monthly'); }
  firstRepaymentDate() { return this.text('personal.offer.firstRepaymentDate'); }
  fee(kind: 'interest' | 'admin' | 'insurance') { return this.amount(`personal.offer.fees.${kind}`); }
  feeShown(kind: 'interest' | 'admin' | 'insurance') { return this.exists(`personal.offer.fees.${kind}`, 1_500); }
  reducedShown() { return this.exists('personal.offer.reduced', 2_000); }
  reducedMessage() { return this.text('personal.offer.reduced'); }
  reducedReason() { return this.text('personal.offer.reduced.reason'); }
  expiresIn() { return this.text('personal.offer.expiresIn'); }
  accept() { return this.tap('personal.offer.accept'); }
  acceptShown() { return this.exists('personal.offer.accept', 2_000); }
  decline() { return this.tap('personal.offer.decline'); }
  confirmDecline() { return this.tap('personal.offer.decline.confirm'); }
  declinedText() { return this.text('personal.offer.declined.text'); }
  expiredShown() { return this.exists('personal.offer.expired', 3_000); }
  expiredText() { return this.text('personal.offer.expired'); }
}

/** Step 9a — "One more step" activation → active. */
export class PersonalActivationScreen extends BaseScreen {
  protected readonly root = 'personal.activation.screen';
  title() { return this.text('personal.activation.title'); }
  stepShown(step: 'mandate' | 'consentPdf' | 'salaryAccount' | 'insurance') { return this.exists(`personal.activation.step.${step}`, 2_000); }
  confirmMandate() { return this.tap('personal.activation.step.mandate.confirm'); }
  signConsentPdf() { return this.tap('personal.activation.step.consentPdf.sign'); }
  finish() { return this.tap('personal.activation.finish'); }
  errorShown(timeout = 15_000) { return this.exists('personal.activation.error', timeout); }
  errorText() { return this.text('personal.activation.error'); }
  retry() { return this.tap('personal.activation.error.retry'); }
  updateBankDetails() { return this.tap('personal.activation.error.updateBank'); }
  successShown(timeout = 20_000) { return this.exists('personal.activation.success', timeout); }
  successHeadline() { return this.text('personal.activation.success.headline'); }
  successAmount() { return this.amount('personal.activation.success.amount'); }
  successFirstDate() { return this.text('personal.activation.success.firstDate'); }
  successMonthly() { return this.amount('personal.activation.success.monthly'); }
}

export class PersonalLoanScreen extends LoanOnLoanScreen {
  constructor() { super('personal'); }
  monthsRemaining() { return this.text('personal.loan.header.monthsRemaining'); }
}

/** §7 "Request restructure" — support link, explanation only, not self-service. */
export class PersonalRestructureRequestScreen extends BaseScreen {
  protected readonly root = 'personal.restructureRequest.screen';
  explanation() { return this.text('personal.restructureRequest.explanation'); }
  pickReason(slug: 'jobLoss' | 'salaryReduction' | 'medical' | 'other') { return this.tap(`personal.restructureRequest.reason.${slug}`); }
  enterDetail(v: string) { return this.type('personal.restructureRequest.detail.input', v); }
  submit() { return this.tap('personal.restructureRequest.submit'); }
  confirmation() { return this.text('personal.restructureRequest.confirmation'); }
  termEditorShown() { return this.exists('personal.restructureRequest.newTenor.input', 1_000); }
}
