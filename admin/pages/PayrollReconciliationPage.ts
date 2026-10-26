import { Page, expect } from '@playwright/test';
import { ActionModal, DetailView, Sidebar } from './components';

export type BatchState = 'Expected' | 'Partially received' | 'Fully received' | 'Late' | 'Missing';
export type BatchSection = 'matched' | 'unmatched' | 'missing' | 'partial';

/** Loan Management → Payroll Reconciliation — Admin PRD "Payroll Reconciliation" section. */
export class PayrollReconciliationPage {
  readonly detail: DetailView;
  readonly modal: ActionModal;

  constructor(private readonly page: Page) {
    this.detail = new DetailView(page);
    this.modal = new ActionModal(page);
  }

  async goto() {
    await new Sidebar(this.page).open('loan-management', 'Payroll Reconciliation');
    await expect(this.batchTable()).toBeVisible();
  }

  batchTable() { return this.page.getByTestId('payroll-batches').getByRole('table'); }
  batchRows() { return this.batchTable().getByRole('row').filter({ has: this.page.getByRole('cell') }); }
  batchRow(matching: string | RegExp) { return this.batchRows().filter({ hasText: matching }).first(); }

  async filterCorridor(corridor: string) {
    const f = this.page.getByTestId('filter-row').getByLabel(/corridor/i);
    if ((await f.evaluate((el) => el.tagName)) === 'SELECT') await f.selectOption({ label: corridor });
    else { await f.click(); await this.page.getByRole('option', { name: corridor }).click(); }
  }

  async expectBatchState(matching: string | RegExp, state: BatchState) {
    await expect(this.batchRow(matching).getByTestId('batch-state')).toHaveText(new RegExp(`^${state}$`, 'i'));
  }

  async openBatch(matching: string | RegExp) {
    await this.batchRow(matching).click();
    await expect(this.summary()).toBeVisible();
  }

  async gotoBatch(batchRef: string) {
    await this.page.goto(`/loans/payroll-reconciliation/${batchRef}`);
    await expect(this.summary()).toBeVisible();
  }

  summary() { return this.page.getByTestId('batch-summary'); }
  summaryField(label: string) { return this.summary().getByTestId(`field-${label}`); }
  batchState() { return this.summary().getByTestId('batch-state'); }
  section(kind: BatchSection) { return this.page.getByTestId(`batch-${kind}`); }
  sectionRows(kind: BatchSection) { return this.section(kind).getByRole('row').filter({ has: this.page.getByRole('cell') }); }
  communicationLog() { return this.page.getByTestId('communication-log').getByTestId('communication-entry'); }

  /** Batch-level action (Approve batch, Flag for corridor, Reverse, Suspend accrual, Reactivate accrual). */
  async startAction(name: string | RegExp) {
    await this.detail.action(name);
    await this.modal.expectOpen();
    return this.modal;
  }

  /** Item-level investigation: clicks an unmatched credit / missing / partial repayment row. */
  async openItem(kind: BatchSection, matching: string | RegExp) {
    await this.sectionRows(kind).filter({ hasText: matching }).first().click();
    await this.modal.expectOpen();
    return this.modal;
  }
}
