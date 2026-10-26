import { Locator, Page, expect } from '@playwright/test';
import { ActionModal, DetailView, Sidebar } from './components';
import { AmountBand, RateMatrix } from '../../shared/calc/rtn';

export type ProductTab = 'Investment Products' | 'Loan Products';
export type InvestmentProduct = 'REAP' | 'RWIN 2.0' | 'RTN';
export type LoanProduct = 'Nano' | 'Payday' | 'Personal' | 'Public Sector' | 'RPAWA' | 'Study Loans';
export type PropagationClass = 'cosmetic' | 'new-positions-only' | 'judgement-required';

/**
 * RTN rate-matrix grid editor.
 * Contract: grid `rate-matrix`; one `rate-matrix-row` per amount band with data-band-min / data-band-max;
 * header cells `rate-matrix-tenor` with data-tenor; cells `rate-cell-<bandIndex>-<tenorDays>`.
 */
export class RateMatrixEditor {
  constructor(private readonly page: Page) {}
  grid() { return this.page.getByTestId('rate-matrix'); }
  cell(bandIndex: number, tenorDays: number) { return this.grid().getByTestId(`rate-cell-${bandIndex}-${tenorDays}`); }

  async editCell(bandIndex: number, tenorDays: number, ratePct: number) {
    const c = this.cell(bandIndex, tenorDays);
    await c.dblclick();
    const input = c.getByRole('spinbutton').or(c.getByRole('textbox')).first();
    await input.fill(String(ratePct));
    await input.press('Enter');
  }

  /** Cell-level propagation preview shown while a cell is dirty. */
  cellPreview() { return this.page.getByTestId('cell-propagation-preview'); }
  async toggleBulkEdit() { await this.page.getByRole('button', { name: /bulk edit/i }).click(); }
  /** Bulk edit: select a range of cells then apply a delta / value. */
  async bulkApply(cells: Array<[number, number]>, value: number) {
    for (const [b, t] of cells) await this.cell(b, t).click({ modifiers: ['Shift'] });
    await this.page.getByLabel(/bulk value|set rate/i).fill(String(value));
    await this.page.getByRole('button', { name: /apply/i }).click();
  }
  async openHistoricalView() { await this.page.getByRole('button', { name: /historical view|history/i }).first().click(); }
  historicalVersions() { return this.page.getByTestId('rate-matrix-history').getByRole('row').filter({ has: this.page.getByRole('cell') }); }
  invariantError() { return this.page.getByTestId('matrix-invariant-error'); }

  /** Reads the grid into the oracle's RateMatrix shape (so lookupRate can be used against it). */
  async read(): Promise<RateMatrix> {
    const tenorsDays = (await this.grid().getByTestId('rate-matrix-tenor').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-tenor')))));
    const rowEls = this.grid().getByTestId('rate-matrix-row');
    const n = await rowEls.count();
    const bands: AmountBand[] = [];
    const rates: number[][] = [];
    for (let i = 0; i < n; i++) {
      const row = rowEls.nth(i);
      const min = Number(await row.getAttribute('data-band-min'));
      const maxAttr = await row.getAttribute('data-band-max');
      bands.push(maxAttr ? { min, max: Number(maxAttr) } : { min });
      const r: number[] = [];
      for (const t of tenorsDays) r.push(Number((await this.cell(i, t).innerText()).replace(/[^0-9.\-]/g, '')));
      rates.push(r);
    }
    return { bands, tenorsDays, rates };
  }
}

/** Generic per-row config table (Personal variant table, Public Sector corridor table). */
export class ConfigTableEditor {
  constructor(private readonly page: Page, private readonly testId: 'variant-table' | 'corridor-table') {}
  table() { return this.page.getByTestId(this.testId); }
  row(name: string) { return this.table().getByRole('row').filter({ hasText: name }).first(); }
  dataRows() { return this.table().getByRole('row').filter({ has: this.page.getByRole('cell') }); }
  /** Variant / corridor names (first column). */
  async rowNames(): Promise<string[]> { return (await this.dataRows().locator('td:first-child').allInnerTexts()).map((t) => t.trim()); }
  async cellValue(rowName: string, column: string): Promise<string> {
    const headers = await this.table().getByRole('columnheader').allInnerTexts();
    const idx = headers.findIndex((h) => h.trim().toLowerCase().startsWith(column.toLowerCase()));
    if (idx < 0) throw new Error(`Column ${column} not found in ${headers.join(', ')}`);
    return (await this.row(rowName).getByRole('cell').nth(idx).innerText()).trim();
  }
  async editCell(rowName: string, column: string, value: string | number) {
    const headers = await this.table().getByRole('columnheader').allInnerTexts();
    const idx = headers.findIndex((h) => h.trim().toLowerCase().startsWith(column.toLowerCase()));
    if (idx < 0) throw new Error(`Column ${column} not found in ${headers.join(', ')}`);
    const cell = this.row(rowName).getByRole('cell').nth(idx);
    await cell.dblclick();
    const input = cell.getByRole('spinbutton').or(cell.getByRole('textbox')).or(cell.getByRole('combobox')).first();
    await input.fill(String(value));
    await input.press('Enter');
  }
  async openComparison() { await this.page.getByRole('button', { name: /compare|bulk comparison/i }).click(); }
  comparison() { return this.page.getByTestId('variant-comparison'); }
  async newFromTemplate() { await this.page.getByRole('button', { name: /new corridor from template|use template/i }).click(); }
}

/** Product Management — Admin PRD "Product Management" (Investment Products + Loan Products tabs). */
export class ProductManagementPage {
  readonly detail: DetailView;
  readonly modal: ActionModal;
  readonly rateMatrix: RateMatrixEditor;
  readonly variantTable: ConfigTableEditor;
  readonly corridorTable: ConfigTableEditor;

  constructor(private readonly page: Page) {
    this.detail = new DetailView(page);
    this.modal = new ActionModal(page);
    this.rateMatrix = new RateMatrixEditor(page);
    this.variantTable = new ConfigTableEditor(page, 'variant-table');
    this.corridorTable = new ConfigTableEditor(page, 'corridor-table');
  }

  async goto(tab: ProductTab = 'Investment Products') {
    await new Sidebar(this.page).open('product-management', tab);
    await expect(this.page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
  }

  productCards() { return this.page.getByTestId('product-card'); }
  productCard(name: InvestmentProduct | LoanProduct | string) { return this.productCards().filter({ hasText: name }).first(); }
  productStatus(name: string) { return this.productCard(name).getByTestId('product-status'); }

  async openProduct(name: InvestmentProduct | LoanProduct | string) {
    await this.productCard(name).click();
    await expect(this.page.getByRole('heading', { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }).first()).toBeVisible();
  }

  // ── Config form ───────────────────────────────────────────────────────────
  async startConfigure() {
    await this.page.getByRole('button', { name: /^configure|edit config/i }).click();
    await expect(this.configForm()).toBeVisible();
  }
  configForm() { return this.page.getByTestId('product-config-form'); }
  configField(label: string | RegExp): Locator { return this.configForm().getByLabel(label); }
  async setField(label: string | RegExp, value: string | number) { await this.configField(label).fill(String(value)); }
  async submitConfig() { await this.configForm().getByRole('button', { name: /submit|save|send for approval/i }).click(); }

  /** Propagation-check modal shown on submit; each changed field lists its propagation class. */
  propagationCheck() { return this.page.getByTestId('propagation-check'); }
  async expectPropagationClass(field: string | RegExp, cls: PropagationClass) {
    await expect(this.propagationCheck().getByTestId('propagation-row').filter({ hasText: field })).toContainText(new RegExp(cls.replace(/-/g, '[- ]'), 'i'));
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  seededCards() { return this.productCards().filter({ hasText: /seeded\s*[-–]\s*pending activation/i }); }

  async startAction(name: string | RegExp) {
    await this.detail.action(name);
    await this.modal.expectOpen();
    return this.modal;
  }

  /** Opens the origination modal for a customer and returns the product's option (to assert bookable / blocked). */
  async bookingOption(customerId: string, product: string, kind: 'investment' | 'loan' = 'investment') {
    await this.page.goto(`/customer/${customerId}`);
    await expect(this.page.getByTestId('customer-360')).toBeVisible();
    await this.page.getByRole('button', { name: kind === 'investment' ? /create investment/i : /book loan/i }).click();
    return this.page.getByRole('dialog').getByRole('radio', { name: product });
  }

  async openChangeHistory() { await this.detail.tab('Change history'); }
  changeHistoryRows() { return this.page.getByTestId('change-history').getByRole('row').filter({ has: this.page.getByRole('cell') }); }
}
