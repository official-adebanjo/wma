import { Locator, Page, expect } from '@playwright/test';
import { ActionModal, Portfolio, Sidebar } from './components';

export type SettingsTab = 'Change Rules' | 'Reason Codes' | 'Approval Thresholds' | 'Communications Providers' | 'Metric Definitions';

async function choose(page: Page, field: Locator, option: string) {
  if ((await field.evaluate((el) => el.tagName)) === 'SELECT') await field.selectOption({ label: option });
  else { await field.click(); await page.getByRole('option', { name: option }).click(); }
}

/** Settings — Admin PRD "Settings". */
export class SettingsPage {
  readonly portfolio: Portfolio;
  readonly modal: ActionModal;

  constructor(private readonly page: Page) {
    this.portfolio = new Portfolio(page);
    this.modal = new ActionModal(page);
  }

  async goto(tab: SettingsTab) {
    await new Sidebar(this.page).open('settings', tab);
    await expect(this.page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
  }

  row(text: string | RegExp) { return this.portfolio.rows().filter({ hasText: text }).first(); }

  /** Opens a row (field / vocabulary value / provider / metric) and clicks its edit-style action. */
  async openAndEdit(rowText: string | RegExp, action: RegExp = /^edit|configure/i) {
    await this.row(rowText).click();
    await this.page.getByRole('button', { name: action }).first().click();
    await this.modal.expectOpen();
    return this.modal;
  }

  // ── Change Rules ──────────────────────────────────────────────────────────
  classification(fieldName: string) { return this.row(fieldName).getByTestId('propagation-class'); }

  // ── Reason Codes ──────────────────────────────────────────────────────────
  async openVocabulary(name: string) {
    await this.page.getByTestId('vocabulary-list').getByRole('button', { name: new RegExp(name, 'i') }).or(this.row(name)).first().click();
  }
  vocabularyValues() { return this.page.getByTestId('vocabulary-values').getByRole('row').filter({ has: this.page.getByRole('cell') }); }
  async addValue(value: string) {
    await this.page.getByRole('button', { name: /add value/i }).click();
    await this.modal.expectOpen();
    await this.modal.fill(/value|label/i, value);
    await this.modal.submit();
  }
  async retireValue(value: string) {
    await this.vocabularyValues().filter({ hasText: value }).first().getByRole('button', { name: /retire/i }).click();
    await this.modal.expectOpen();
    await this.modal.submit();
  }

  // ── Approval Thresholds ───────────────────────────────────────────────────
  thresholdRow(name: string | RegExp) { return this.row(name); }
  thresholdValue(name: string | RegExp) { return this.thresholdRow(name).getByTestId('threshold-value'); }
  async editThreshold(name: string | RegExp, option: string, custom?: number) {
    const r = this.thresholdRow(name);
    await choose(this.page, r.getByRole('combobox'), option);
    if (custom !== undefined) await r.getByRole('spinbutton').or(r.getByRole('textbox')).first().fill(String(custom));
    await r.getByRole('button', { name: /^save/i }).click();
  }
  pendingChangeBadge(name: string | RegExp) { return this.thresholdRow(name).getByTestId('pending-change'); }
}
