import { Page, expect } from '@playwright/test';
import { Portfolio, Sidebar } from './components';

export type AuditFilter = 'Admin' | 'Module' | 'Action type' | 'Date from' | 'Date to' | 'Customer' | 'Amount min' | 'Amount max';

/** Audit Log — Admin PRD "Audit Log". Append-only; entries cannot be edited or deleted. */
export class AuditLogPage {
  readonly portfolio: Portfolio;

  constructor(private readonly page: Page) {
    this.portfolio = new Portfolio(page);
  }

  async goto() {
    await new Sidebar(this.page).open('audit-log');
    await expect(this.page.getByRole('heading', { name: /audit log/i })).toBeVisible();
  }

  async filter(label: AuditFilter, value: string) { await this.portfolio.filter(label, value); }
  rows() { return this.portfolio.rows(); }
  async openEntry(index = 0) {
    await this.rows().nth(index).click();
    await expect(this.entryDetail()).toBeVisible();
  }
  entryDetail() { return this.page.getByTestId('audit-entry-detail'); }
  entryField(name: 'actor' | 'timestamp' | 'action' | 'target' | 'amount' | 'evidence' | 'approvers') { return this.entryDetail().getByTestId(`field-${name}`); }
  exportCsvButton() { return this.page.getByRole('button', { name: /export csv/i }); }
  /** Any control that would mutate an entry. Must never exist. */
  mutatingControls() { return this.page.getByRole('button', { name: /^(edit|delete|remove|modify)\b/i }).or(this.page.getByRole('menuitem', { name: /^(edit|delete|remove|modify)\b/i })); }
}
