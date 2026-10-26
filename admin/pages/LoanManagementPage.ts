import { Page, expect } from '@playwright/test';
import { ActionModal, DetailView, Portfolio, Sidebar } from './components';
import { Customer360Page } from './Customer360Page';
import { abs } from '../../shared/data/files';
import { testFiles } from '../../shared/data/factories';

export type LoanState = 'Applications' | 'Underwriting' | 'Ready to disburse' | 'Live servicing' | 'Collections' | 'Written off';
export const LOAN_STATES: LoanState[] = ['Applications', 'Underwriting', 'Ready to disburse', 'Live servicing', 'Collections', 'Written off'];

export type LoanProduct = 'Nano' | 'Payday' | 'Personal' | 'Public Sector';

export type LoanDetailTab =
  | 'Overview' | 'Repayment history' | 'Schedule' | 'Decisioning' | 'Documents' | 'Transactions'
  | 'Control-gate docs' | 'Consent letter' | 'Collections' | 'Audit trail';

/** Loan Management — Admin PRD "Loan Management" section (portfolio, loan detail, product + cross-product actions). */
export class LoanManagementPage {
  readonly portfolio: Portfolio;
  readonly detail: DetailView;
  readonly modal: ActionModal;

  constructor(private readonly page: Page) {
    this.portfolio = new Portfolio(page);
    this.detail = new DetailView(page);
    this.modal = new ActionModal(page);
  }

  async goto() {
    await new Sidebar(this.page).open('loan-management', 'Loans');
    await expect(this.portfolio.rail()).toBeVisible();
  }

  async openLoan(loanIdOrRef: string) {
    await this.page.goto(`/loans/${loanIdOrRef}`);
    await expect(this.detail.state()).toBeVisible();
  }

  /** Runs an action from the loan's admin action menu and returns the open modal. */
  async startAction(name: string | RegExp) {
    await this.detail.action(name);
    await this.modal.expectOpen();
    return this.modal;
  }

  /** Origination flow from Customer 360 → Book loan → product. Returns the booking modal. */
  async bookOnBehalf(customerId: string, product: LoanProduct) {
    const c360 = new Customer360Page(this.page);
    await c360.goto(customerId);
    await c360.bookLoan(product);
    await this.modal.expectOpen();
    return this.modal;
  }

  async expectState(state: string | RegExp) {
    await expect(this.detail.state()).toContainText(state);
  }

  async tab(name: LoanDetailTab) {
    await this.detail.tab(name);
    await expect(this.page.getByRole('tabpanel')).toBeVisible();
  }

  tabLocator(name: LoanDetailTab) {
    return this.page.getByRole('tab', { name });
  }

  /** Decisioning tab: engine output (DTI, bureau score, loyalty streak, decision reason, variant/tier). */
  decisioning(field: 'dti' | 'bureau-score' | 'loyalty-streak' | 'decision-reason' | 'variant' | 'referral-tier' | 'approval-band' | 'corridor') {
    return this.page.getByTestId('decisioning-panel').getByTestId(`decisioning-${field}`);
  }

  scheduleRows() { return this.page.getByTestId('schedule-row'); }
  scheduleHistory() { return this.page.getByTestId('schedule-history').getByTestId('schedule-version'); }
  repaymentRows() { return this.page.getByTestId('repayment-history').getByRole('row').filter({ has: this.page.getByRole('cell') }); }
  transactionRows() { return this.page.getByTestId('loan-transactions').getByRole('row').filter({ has: this.page.getByRole('cell') }); }
  documentRows() { return this.page.getByTestId('loan-documents').getByRole('row').filter({ has: this.page.getByRole('cell') }); }
  contactAttempts() { return this.page.getByTestId('contact-attempt'); }
  followUps() { return this.page.getByTestId('follow-up-task'); }
  reminders() { return this.page.getByTestId('reminder-record'); }
  flagBanner() { return this.page.getByTestId('loan-flag-banner'); }
  requiredDocs() { return this.modal.root().getByTestId('required-docs'); }

  /** Uploads a file into every required-document slot of the booking modal. */
  async uploadRequiredDocs(relPath: string = testFiles.validPdf) {
    const inputs = this.requiredDocs().locator('input[type=file]');
    const n = await inputs.count();
    for (let i = 0; i < n; i++) await inputs.nth(i).setInputFiles(abs(relPath));
  }

  /** Uploads a file into one named required-document slot (e.g. "Consent letter", "Utility bill"). */
  async uploadRequiredDoc(name: string | RegExp, relPath: string = testFiles.validPdf) {
    await this.requiredDocs().getByTestId('required-doc').filter({ hasText: name }).locator('input[type=file]').setInputFiles(abs(relPath));
  }

  // ── Public Sector: control-gate documents + consent letter ─────────────────────────
  controlGateDoc(name: string | RegExp) {
    return this.page.getByTestId('control-gate-docs').getByRole('row').filter({ hasText: name });
  }

  async reviewControlGateDoc(name: string | RegExp, decision: 'Approve' | 'Request re-upload', note?: string) {
    await this.controlGateDoc(name).getByRole('button', { name: decision }).click();
    if (decision === 'Request re-upload') {
      await this.modal.expectOpen();
      await this.modal.fill(/note|reason/i, note ?? 'Document failed review');
      await this.modal.submit();
    }
  }

  consentLetter() { return this.page.getByTestId('consent-letter'); }

  async verifyConsentLetter() {
    await this.consentLetter().getByRole('button', { name: /^verify$/i }).click();
  }

  async rejectConsentLetter(reason: string) {
    await this.consentLetter().getByRole('button', { name: /^reject$/i }).click();
    await this.modal.expectOpen();
    await this.modal.reasonCode(reason);
    await this.modal.submit();
  }

  /**
   * Authority enforcement: an approver outside their band/tier is blocked either by the
   * action being absent/disabled in the menu, or by a server-side authority error on submit.
   */
  async expectAuthorityBlocked(action: string | RegExp) {
    await this.detail.openActionMenu();
    const item = this.page.getByRole('menuitem', { name: action });
    if ((await item.count()) === 0) { await this.page.keyboard.press('Escape'); return; }
    if (await item.isDisabled()) { await this.page.keyboard.press('Escape'); return; }
    await item.click();
    await this.modal.expectOpen();
    await this.modal.evidence.fillDefault();
    await this.modal.submit();
    await this.modal.expectValidationError(/authority|not authori[sz]ed|band|tier/i);
    await this.modal.cancel();
  }
}
