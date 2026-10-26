import { Locator, Page, expect } from '@playwright/test';
import { abs } from '../../shared/data/files';
import { testFiles } from '../../shared/data/factories';

/**
 * Cross-cutting Admin Portal components (Admin PRD "Cross-cutting" + "Conventions").
 *
 * Locator strategy: accessible roles/names taken from the PRD's action names first
 * (e.g. button "Approve", "Force-liquidate"), `data-testid` for structural regions.
 * The testid contract is listed in docs/SELECTOR-CONTRACT.md.
 */

export type Module =
  | 'customer-management' | 'investment-management' | 'loan-management' | 'wallet-management'
  | 'transactions-ledger' | 'support-tickets' | 'communications' | 'product-management'
  | 'rewards-referrals' | 'tiering-kyc' | 'reports-analytics' | 'team-management'
  | 'pending-approvals' | 'audit-log' | 'settings';

export class Sidebar {
  constructor(private readonly page: Page) {}
  root() { return this.page.getByTestId('sidebar'); }
  item(module: Module) { return this.root().getByTestId(`nav-${module}`); }
  async open(module: Module, subTab?: string) {
    await this.item(module).click();
    if (subTab) await this.page.getByRole('tab', { name: subTab }).click();
  }
  async expectSoonBadge(module: Module) {
    await expect(this.item(module)).toContainText(/soon/i);
  }
}

export type EvidenceType = 'Ticket reference' | 'Email upload' | 'WhatsApp screenshot' | 'Signed doc' | 'Written instruction';

/**
 * EvidencePanel — required in every money-touching action modal.
 * File types: PDF, PNG, JPG, JPEG. Max 10MB per file. Written instruction needs "why not one of the above".
 */
export class EvidencePanel {
  constructor(private readonly scope: Locator) {}
  root() { return this.scope.getByTestId('evidence-panel'); }
  async pick(type: EvidenceType) { await this.root().getByRole('radio', { name: type }).check(); }
  async ticketRef(ref: string) { await this.root().getByLabel(/ticket reference/i).fill(ref); }
  async upload(relPath: string = testFiles.validPdf) { await this.root().locator('input[type=file]').setInputFiles(abs(relPath)); }
  async whyNotOther(text: string) { await this.root().getByLabel(/why not one of the above/i).fill(text); }
  async reasonOnBehalf(text: string) { await this.root().getByLabel(/reason for acting on behalf/i).fill(text); }
  async fileError() { return this.root().getByTestId('evidence-file-error'); }

  /** Happy-path evidence: ticket ref + supporting PDF + reason. */
  async fillDefault(ticket = `TKT-${Date.now()}`) {
    await this.pick('Ticket reference');
    await this.ticketRef(ticket);
    await this.reasonOnBehalf('Automated test — customer instruction on file');
  }
}

/** AdminActionModal — the shared modal every admin action opens (reason, amount, evidence, submit). */
export class ActionModal {
  readonly evidence: EvidencePanel;
  constructor(private readonly page: Page) {
    this.evidence = new EvidencePanel(this.root());
  }
  root() { return this.page.getByRole('dialog'); }
  async expectOpen(titleText?: string | RegExp) {
    await expect(this.root()).toBeVisible();
    if (titleText) await expect(this.root().getByRole('heading').first()).toContainText(titleText);
  }
  field(label: string | RegExp) { return this.root().getByLabel(label); }
  async fill(label: string | RegExp, value: string | number) { await this.field(label).fill(String(value)); }
  async select(label: string | RegExp, option: string) {
    const f = this.field(label);
    if ((await f.evaluate((el) => el.tagName)) === 'SELECT') await f.selectOption({ label: option });
    else { await f.click(); await this.page.getByRole('option', { name: option }).click(); }
  }
  async reasonCode(option: string) { await this.select(/reason/i, option); }
  submitButton() { return this.root().getByRole('button', { name: /submit|confirm|send for approval/i }); }
  async submit() { await this.submitButton().click(); }
  async cancel() { await this.root().getByRole('button', { name: /cancel/i }).click(); }
  /** Propagation-check modal shown before saving product config changes. */
  async confirmPropagation() { await this.page.getByTestId('propagation-check').getByRole('button', { name: /confirm|apply/i }).click(); }
  async expectValidationError(text: string | RegExp) { await expect(this.root().getByRole('alert').or(this.root().getByTestId('field-error')).first()).toContainText(text); }
  async expectRoutedToApproval() { await expect(this.page.getByRole('status').or(this.page.getByTestId('toast')).first()).toContainText(/pending approval|sent for approval|awaiting approval/i); }
  async expectApplied() { await expect(this.page.getByRole('status').or(this.page.getByTestId('toast')).first()).toContainText(/success|applied|completed|saved/i); }
}

/** Portfolio pages (Investment / Loan Management): state side rail + 5-card metric strip + filter row + table. */
export class Portfolio {
  constructor(private readonly page: Page) {}
  rail() { return this.page.getByTestId('state-rail'); }
  async selectState(state: string) { await this.rail().getByRole('button', { name: new RegExp(`^${state}`, 'i') }).click(); }
  async expectSelectedState(state: string) { await expect(this.rail().getByRole('button', { name: new RegExp(`^${state}`, 'i') })).toHaveAttribute('aria-pressed', 'true'); }
  metricCards() { return this.page.getByTestId('metric-strip').getByTestId('metric-card'); }
  filterRow() { return this.page.getByTestId('filter-row'); }
  async filter(label: string, value: string) {
    const f = this.filterRow().getByLabel(label);
    if ((await f.evaluate((el) => el.tagName)) === 'SELECT') await f.selectOption({ label: value });
    else await f.fill(value);
  }
  async search(text: string) { await this.filterRow().getByRole('searchbox').fill(text); }
  table() { return this.page.getByRole('table'); }
  rows() { return this.table().getByRole('row').filter({ has: this.page.getByRole('cell') }); }
  async sortBy(column: string) { await this.table().getByRole('columnheader', { name: column }).click(); }
  async openRow(textInRow: string) { await this.rows().filter({ hasText: textInRow }).first().click(); }
  async columnValues(column: string): Promise<string[]> {
    const headers = await this.table().getByRole('columnheader').allInnerTexts();
    const idx = headers.findIndex((h) => h.trim().toLowerCase().startsWith(column.toLowerCase()));
    if (idx < 0) throw new Error(`Column ${column} not found in ${headers.join(', ')}`);
    return this.rows().locator(`td:nth-child(${idx + 1})`).allInnerTexts();
  }
}

/** Detail view: fields, history, audit trail tab and the "admin action" menu. */
export class DetailView {
  constructor(private readonly page: Page) {}
  async openActionMenu() { await this.page.getByRole('button', { name: /actions|admin action/i }).click(); }
  async action(name: string | RegExp) {
    await this.openActionMenu();
    await this.page.getByRole('menuitem', { name }).click();
  }
  async expectActionAbsent(name: string | RegExp) {
    await this.openActionMenu();
    await expect(this.page.getByRole('menuitem', { name })).toHaveCount(0);
    await this.page.keyboard.press('Escape');
  }
  async expectActionDisabled(name: string | RegExp) {
    await this.openActionMenu();
    await expect(this.page.getByRole('menuitem', { name })).toBeDisabled();
    await this.page.keyboard.press('Escape');
  }
  field(label: string) { return this.page.getByTestId('detail-fields').getByTestId(`field-${label}`); }
  state() { return this.page.getByTestId('detail-state'); }
  async tab(name: string) { await this.page.getByRole('tab', { name }).click(); }
  auditRows() { return this.page.getByTestId('audit-trail').getByRole('row'); }
  sourcePill() { return this.page.getByTestId('source-pill'); }
}

/** CSV export helper — asserts a download is produced with the expected header. */
export async function expectCsvExport(page: Page, trigger: () => Promise<void>, mustContainHeader: RegExp) {
  const [download] = await Promise.all([page.waitForEvent('download'), trigger()]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/i);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const firstLine = Buffer.concat(chunks).toString('utf8').split(/\r?\n/)[0];
  expect(firstLine).toMatch(mustContainHeader);
}
