import { BaseScreen } from '../BaseScreen';
import { DocUploadCard, LoanLandingScreen, LoanOnLoanScreen } from './BorrowCommon';

/** Payday — Payday_Customer_App_Spec §3–§10. */

export class PaydayLandingScreen extends LoanLandingScreen {
  constructor() { super('payday'); }
  salaryStatus() { return this.text('payday.landing.salary.status'); }
  detectedSalary() { return this.amount('payday.landing.salary.amount'); }
  detectedSalaryShown() { return this.exists('payday.landing.salary.amount', 2_000); }
  detectedEmployer() { return this.text('payday.landing.salary.employer'); }
  verifySalary() { return this.tap('payday.landing.salary.verify'); }
  verifySalaryShown() { return this.exists('payday.landing.salary.verify', 2_000); }
}

export class PaydayBookingScreen extends BaseScreen {
  protected readonly root = 'payday.booking.screen';
  // Step 1 — salary confirmation (detected)
  salaryConfirmText() { return this.text('payday.booking.salary.confirm.text'); }
  salaryConfirmShown() { return this.exists('payday.booking.salary.confirm.text', 3_000); }
  confirmSalary() { return this.tap('payday.booking.salary.confirm.yes'); }
  updateSalaryDetails() { return this.tap('payday.booking.salary.confirm.update'); }
  // Step 1 — manual entry
  manualShown() { return this.exists('payday.booking.salary.employer.input', 3_000); }
  async pickEmployer(name: string) {
    await this.type('payday.booking.salary.employer.input', name);
    await this.tap('payday.booking.salary.employer.option.0');
  }
  async enterEmployerFreeText(name: string) {
    await this.type('payday.booking.salary.employer.input', name);
    await this.tap('payday.booking.salary.employer.other');
  }
  employerOptionShown(i = 0) { return this.exists(`payday.booking.salary.employer.option.${i}`, 2_000); }
  employerError() { return this.text('payday.booking.salary.employer.input.error'); }
  enterMonthlySalary(v: number) { return this.type('payday.booking.salary.monthly.input', v); }
  async pickSalaryAccount(i = 0) {
    await this.tap('payday.booking.salary.account.input');
    await this.tap(`payday.booking.salary.account.input.option.${i}`);
  }
  salaryAccountError() { return this.text('payday.booking.salary.account.input.error'); }
  payslip() { return new DocUploadCard('payday.booking.salary.payslip'); }
  payslipRequiredError() { return this.text('payday.booking.salary.payslip.error'); }
  manualReviewNotice() { return this.text('payday.booking.salary.manualReviewNotice'); }
  manualReviewNoticeShown() { return this.exists('payday.booking.salary.manualReviewNotice', 2_000); }
  salaryVerificationError() { return this.text('payday.booking.salary.verifyError'); }
  // Step 2 — amount
  enterAmount(v: number | string) { return this.type('payday.booking.amount.input', v); }
  amountValue() { return this.amount('payday.booking.amount.input'); }
  amountError() { return this.text('payday.booking.amount.input.error'); }
  capIndicator() { return this.text('payday.booking.amount.capIndicator'); }
  capAmount() { return this.amount('payday.booking.amount.capIndicator.amount'); }
  feesInterest() { return this.amount('payday.booking.amount.fees.interest'); }
  feesTotal() { return this.amount('payday.booking.amount.fees.total'); }
  // Step 3 — purpose (optional)
  pickPurpose(slug: string) { return this.tap(`payday.booking.purpose.option.${slug}`); }
  purposeOptionShown(slug: string) { return this.exists(`payday.booking.purpose.option.${slug}`, 1_500); }
  // Step 5 — review
  reviewValue(field: 'amount' | 'tenor' | 'interest' | 'total' | 'salaryAccount' | 'mandateProvider' | 'paydayDate' | 'purpose') {
    return this.text(`payday.booking.review.${field}`);
  }
  reviewAmount(field: 'amount' | 'interest' | 'total') { return this.amount(`payday.booking.review.${field}`); }
  submit() { return this.tap('payday.booking.review.submit'); }
  // Navigation
  continue() { return this.tap('payday.booking.continue'); }
  continueEnabled() { return this.isEnabled('payday.booking.continue'); }
}

/** Step 7a approved / mandate-failure halt (7b decline + 7c review use the shared widgets). */
export class PaydayOutcomeScreen extends BaseScreen {
  protected readonly root = 'payday.outcome.screen';
  approvedShown(timeout = 20_000) { return this.exists('payday.outcome.approved', timeout); }
  approvedHeadline() { return this.text('payday.outcome.approved.headline'); }
  approvedAmount() { return this.amount('payday.outcome.approved.amount'); }
  mandateStatus() { return this.text('payday.outcome.approved.mandateStatus'); }
  repaymentDate() { return this.text('payday.outcome.approved.repaymentDate'); }
  mandateFailedShown(timeout = 20_000) { return this.exists('payday.outcome.mandateFailed', timeout); }
  mandateFailedMessage() { return this.text('payday.outcome.mandateFailed.message'); }
  retryMandate() { return this.tap('payday.outcome.mandateFailed.retry'); }
  contactUs() { return this.tap('payday.outcome.mandateFailed.contact'); }
}

export class PaydayLoanScreen extends LoanOnLoanScreen {
  constructor() { super('payday'); }
  autoDebitAmount() { return this.amount('payday.loan.hero.autoDebitAmount'); }
  paydayDate() { return this.text('payday.loan.hero.paydayDate'); }
  salaryAccountEditable() { return this.exists('payday.loan.details.salaryAccount.edit', 1_000); }
}
