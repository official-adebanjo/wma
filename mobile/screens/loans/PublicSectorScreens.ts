import { BaseScreen, driver } from '../BaseScreen';
import { DocUploadCard, LoanLandingScreen, LoanOnLoanScreen } from './BorrowCommon';

/** Public Sector (Group) Loan — Public_Sector_Loan_Customer_App_Spec §3–§10. Corridors shown by plain employer name only. */

export type CorridorGroup = 'federal' | 'state' | 'tertiary';
export type PublicSectorDocKey =
  | 'houseVisitation' | 'obligorCheques' | 'utilityBill' | 'employerConfirmation' | 'staffId' | 'payslip';

export class PublicSectorLandingScreen extends LoanLandingScreen {
  constructor() { super('publicSector'); }
  eligibilityExplanation() { return this.text('publicSector.landing.eligibility'); }
  findEmployer() { return this.tap('publicSector.landing.findEmployer'); }
  activeLoanCorridor() { return this.text('publicSector.landing.activeLoan.corridor'); }
}

/** Step 1 — corridor search + grouped browse + "My employer isn't here". */
export class CorridorSearchScreen extends BaseScreen {
  protected readonly root = 'publicSector.corridor.screen';
  search(q: string) { return this.type('publicSector.corridor.search.input', q); }
  placeholder() { return this.el('publicSector.corridor.search.input').getAttribute(driver.isIOS ? 'placeholderValue' : 'hint'); }
  suggestion(i: number) {
    const p = `publicSector.corridor.suggestion.${i}`;
    return {
      shown: () => this.exists(p, 3_000),
      name: () => this.text(`${p}.name`),
      subLabel: () => this.text(`${p}.subLabel`),
      pick: () => this.tap(p),
    };
  }
  async suggestionNames(max = 10): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < max; i++) {
      if (!(await this.exists(`publicSector.corridor.suggestion.${i}`, 800))) break;
      out.push(await this.text(`publicSector.corridor.suggestion.${i}.name`));
    }
    return out;
  }
  browseHeading() { return this.text('publicSector.corridor.browse.heading'); }
  groupLabel(g: CorridorGroup) { return this.text(`publicSector.corridor.group.${g}`); }
  openGroup(g: CorridorGroup) { return this.tap(`publicSector.corridor.group.${g}`); }
  async groupItems(g: CorridorGroup, max = 60): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < max; i++) {
      const id = `publicSector.corridor.group.${g}.item.${i}`;
      if (!(await this.exists(id, 800))) {
        // long lists: try one scroll before concluding the list ended
        try { await this.scrollTo(id, 2); } catch { break; }
      }
      out.push(await this.text(id));
    }
    return out;
  }
  pickGroupItem(g: CorridorGroup, i: number) { return this.tap(`publicSector.corridor.group.${g}.item.${i}`); }
  employerNotHere() { return this.tap('publicSector.corridor.notHere'); }
}

export class EmployerNotServedScreen extends BaseScreen {
  protected readonly root = 'publicSector.notServed.screen';
  message() { return this.text('publicSector.notServed.message'); }
  openPersonalLoan() { return this.tap('publicSector.notServed.personalLoan'); }
  notifyMe() { return this.tap('publicSector.notServed.notifyMe'); }
  notifyConfirmation() { return this.text('publicSector.notServed.notifyMe.confirmation'); }
}

/** Step 2 — corridor confirmation with terms preview. */
export class CorridorConfirmScreen extends BaseScreen {
  protected readonly root = 'publicSector.corridorConfirm.screen';
  summary() { return this.text('publicSector.corridorConfirm.summary'); }
  term(field: 'deductionMethod' | 'rate' | 'maxTenor' | 'salaryBasis') { return this.text(`publicSector.corridorConfirm.${field}`); }
  continue() { return this.tap('publicSector.corridorConfirm.continue'); }
  changeEmployer() { return this.tap('publicSector.corridorConfirm.change'); }
}

export class PublicSectorBookingScreen extends BaseScreen {
  protected readonly root = 'publicSector.booking.screen';
  // Step 3 — corridor-specific inputs
  ippisShown() { return this.exists('publicSector.booking.ippis.input', 2_000); }
  staffNumberShown() { return this.exists('publicSector.booking.staffNumber.input', 2_000); }
  enterIppis(v: string) { return this.type('publicSector.booking.ippis.input', v); }
  enterStaffNumber(v: string) { return this.type('publicSector.booking.staffNumber.input', v); }
  enterGross(v: number) { return this.type('publicSector.booking.salary.gross.input', v); }
  enterAllowances(v: number) { return this.type('publicSector.booking.salary.allowances.input', v); }
  salaryBasisFetched() { return this.exists('publicSector.booking.salary.fetched', 3_000); }
  async pickSalaryAccount(i = 0) {
    await this.tap('publicSector.booking.salaryAccount.input');
    await this.tap(`publicSector.booking.salaryAccount.input.option.${i}`);
  }
  enterRetirementDate(iso: string) { return this.type('publicSector.booking.retirementDate.input', iso); }
  yearsToRetirement() { return this.text('publicSector.booking.retirementDate.remaining'); }
  // Step 4 — amount, tenor, purpose
  enterAmount(v: number | string) { return this.type('publicSector.booking.amount.input', v); }
  capText() { return this.text('publicSector.booking.amount.cap'); }
  capAmount() { return this.amount('publicSector.booking.amount.cap.amount'); }
  pickTenor(months: number) { return this.tap(`publicSector.booking.tenor.input.option.${months}`); }
  tenorOptionShown(months: number) { return this.exists(`publicSector.booking.tenor.input.option.${months}`, 1_500); }
  tenorOptionEnabled(months: number) { return this.isEnabled(`publicSector.booking.tenor.input.option.${months}`); }
  monthlyEstimateText() { return this.text('publicSector.booking.estimate'); }
  monthlyEstimate() { return this.amount('publicSector.booking.estimate.amount'); }
  pickPurpose(slug: string) { return this.tap(`publicSector.booking.purpose.option.${slug}`); }
  // Step 5 — documents
  docsHeading() { return this.text('publicSector.booking.docs.heading'); }
  async docLabels(): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < 10; i++) {
      if (!(await this.exists(`publicSector.booking.docs.item.${i}.label`, 500))) break;
      out.push(await this.text(`publicSector.booking.docs.item.${i}.label`));
    }
    return out;
  }
  doc(key: PublicSectorDocKey) { return new DocUploadCard(`publicSector.booking.docs.${key}`); }
  docShown(key: PublicSectorDocKey) { return this.exists(`publicSector.booking.docs.${key}`, 1_500); }
  // Step 6 — consent letter
  consentLetterExplanation() { return this.text('publicSector.booking.consentLetter.explanation'); }
  consentLetterShown() { return this.exists('publicSector.booking.consentLetter.explanation', 2_000); }
  downloadConsentLetter() { return this.tap('publicSector.booking.consentLetter.download'); }
  consentLetterDownloaded() { return this.text('publicSector.booking.consentLetter.downloaded'); }
  consentLetterUpload() { return new DocUploadCard('publicSector.booking.consentLetter.upload'); }
  // Step 7 — review
  reviewValue(field: 'corridor' | 'amount' | 'tenor' | 'monthly' | 'salaryBasis' | 'idNumber' | 'deductionMethod' | 'documents') {
    return this.text(`publicSector.booking.review.${field}`);
  }
  reviewAmount(field: 'amount' | 'monthly') { return this.amount(`publicSector.booking.review.${field}`); }
  submit() { return this.tap('publicSector.booking.review.submit'); }
  // Navigation
  continue() { return this.tap('publicSector.booking.continue'); }
  continueEnabled() { return this.isEnabled('publicSector.booking.continue'); }
}

export class PublicSectorOfferScreen extends BaseScreen {
  protected readonly root = 'publicSector.offer.screen';
  approvedAmount() { return this.amount('publicSector.offer.amount'); }
  tenor() { return this.text('publicSector.offer.tenor'); }
  rate() { return this.text('publicSector.offer.rate'); }
  monthly() { return this.amount('publicSector.offer.monthly'); }
  firstDeductionDate() { return this.text('publicSector.offer.firstDeductionDate'); }
  corridorContext() { return this.text('publicSector.offer.corridorContext'); }
  fee(kind: 'interest' | 'admin' | 'insurance') { return this.amount(`publicSector.offer.fees.${kind}`); }
  accept() { return this.tap('publicSector.offer.accept'); }
  decline() { return this.tap('publicSector.offer.decline'); }
  confirmDecline() { return this.tap('publicSector.offer.decline.confirm'); }
  declinedText() { return this.text('publicSector.offer.declined.text'); }
}

export class PublicSectorActivationScreen extends BaseScreen {
  protected readonly root = 'publicSector.activation.screen';
  successShown(timeout = 20_000) { return this.exists('publicSector.activation.success', timeout); }
  successHeadline() { return this.text('publicSector.activation.success.headline'); }
  firstDeductionAmount() { return this.amount('publicSector.activation.success.firstDeduction'); }
  cyclesNote() { return this.text('publicSector.activation.success.cyclesNote'); }
  viewLoan() { return this.tap('publicSector.activation.success.viewLoan'); }
}

export class PublicSectorLoanScreen extends LoanOnLoanScreen {
  constructor() { super('publicSector'); }
  corridor() { return this.text('publicSector.loan.header.corridor'); }
  monthsRemaining() { return this.text('publicSector.loan.header.monthsRemaining'); }
  payrollStatus() { return this.text('publicSector.loan.payrollStatus'); }
}
