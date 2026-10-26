import { Page, expect } from '@playwright/test';
import { ActionModal, DetailView, Portfolio, Sidebar } from './components';

export type ReportsTab = 'Dashboards' | 'Reports' | 'Regulatory';
export type FilingState = 'All' | 'Upcoming' | 'Ready for sign-off' | 'Signed off' | 'Submitted' | 'Overdue';

/** Reports & Analytics — Admin PRD (Dashboards tab, Reports placeholder, Regulatory tab). */
export class ReportsAnalyticsPage {
  readonly portfolio: Portfolio;
  readonly detail: DetailView;
  readonly modal: ActionModal;

  constructor(private readonly page: Page) {
    this.portfolio = new Portfolio(page);
    this.detail = new DetailView(page);
    this.modal = new ActionModal(page);
  }

  async goto(tab: ReportsTab = 'Dashboards') {
    await new Sidebar(this.page).open('reports-analytics', tab);
    await expect(this.page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
  }

  // ── Dashboards ────────────────────────────────────────────────────────────
  dashboardGrid() { return this.page.getByTestId('dashboard-grid'); }
  dashboardCards() { return this.dashboardGrid().getByTestId('dashboard-card'); }
  dashboardCard(name: string) { return this.dashboardCards().filter({ hasText: name }).first(); }
  async cardTitles(): Promise<string[]> {
    return (await this.dashboardCards().getByRole('heading').allInnerTexts()).map((t) => t.trim());
  }
  async openDashboard(name: string) {
    await this.dashboardCard(name).click();
    await expect(this.page.getByTestId('dashboard-view')).toBeVisible();
  }
  filterBar() { return this.page.getByTestId('dashboard-filter-bar'); }
  async filterDashboard(label: string | RegExp, option: string) {
    const f = this.filterBar().getByLabel(label);
    if ((await f.evaluate((el) => el.tagName)) === 'SELECT') await f.selectOption({ label: option });
    else { await f.click(); await this.page.getByRole('option', { name: option }).click(); }
  }
  metricValues() { return this.page.getByTestId('dashboard-view').getByTestId('metric-value'); }
  chartElements() { return this.page.getByTestId('dashboard-view').getByTestId('chart-element'); }
  async exportView(format: 'PDF' | 'CSV') {
    await this.page.getByRole('button', { name: /export view/i }).click();
    await this.page.getByRole('menuitem', { name: new RegExp(format, 'i') }).click();
  }
  async moveCard(from: string, to: string) { await this.dashboardCard(from).dragTo(this.dashboardCard(to)); }
  comingSoon() { return this.page.getByRole('tabpanel').getByText(/coming soon/i); }

  // ── Regulatory ────────────────────────────────────────────────────────────
  async openFiling(nameOrIndex: string | number) {
    const rows = this.portfolio.rows();
    await (typeof nameOrIndex === 'number' ? rows.nth(nameOrIndex) : rows.filter({ hasText: nameOrIndex }).first()).click();
    await expect(this.page.getByTestId('filing-detail')).toBeVisible();
  }
  filingName() { return this.page.getByTestId('filing-detail').getByRole('heading').first(); }
  filingState() { return this.page.getByTestId('filing-detail').getByTestId('filing-state'); }
  filingContent() { return this.page.getByTestId('filing-content'); }
  async saveDraft() { await this.page.getByRole('button', { name: /save draft/i }).click(); }
  async submitForSignOff() { await this.page.getByRole('button', { name: /submit for sign-off/i }).click(); }
  signOffButton() { return this.page.getByRole('button', { name: /^sign off/i }); }
  async signOff(note: string) {
    await this.signOffButton().click();
    await this.modal.expectOpen();
    await this.modal.fill(/note/i, note);
    await this.modal.submit();
  }
  async markSubmitted(reference: string, channel?: string) {
    await this.page.getByRole('button', { name: /mark as submitted/i }).click();
    await this.modal.expectOpen();
    await this.modal.fill(/submission reference|reference/i, reference);
    if (channel) await this.modal.select(/channel/i, channel);
    await this.modal.submit();
  }
  async openRegulatorCommunications() { await this.page.getByRole('button', { name: /regulator communications/i }).or(this.page.getByRole('tab', { name: /regulator communications/i })).first().click(); }
  communicationsLog() { return this.page.getByTestId('regulator-communications').getByRole('row').filter({ has: this.page.getByRole('cell') }); }
  async addCommunication(regulator: string, message: string) {
    await this.page.getByRole('button', { name: /add entry/i }).click();
    await this.modal.expectOpen();
    await this.modal.select(/regulator/i, regulator);
    await this.modal.fill(/message|response/i, message);
    await this.modal.submit();
  }
}
