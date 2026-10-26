import { Page, expect } from '@playwright/test';

export type C360Tab = 'Overview' | 'Personal info' | 'KYC & Documents' | 'Products' | 'Transactions' | 'Screening' | 'Support' | 'Audit';

/** Customer 360 — full page (/customer/{id}) or drawer; same actions in both. */
export class Customer360Page {
  constructor(private readonly page: Page) {}

  async goto(customerId: string) {
    await this.page.goto(`/customer/${customerId}`);
    await expect(this.page.getByTestId('customer-360')).toBeVisible();
  }

  async tab(name: C360Tab) {
    await this.page.getByRole('tab', { name }).click();
    await expect(this.page.getByRole('tabpanel')).toBeVisible();
  }

  tabLocator(name: C360Tab) {
    return this.page.getByRole('tab', { name });
  }

  panel() {
    return this.page.getByRole('tabpanel');
  }

  tierBadge() {
    return this.page.getByTestId('tier-badge');
  }

  async createInvestment(product: 'REAP' | 'RWIN 2.0' | 'RTN') {
    await this.page.getByRole('button', { name: /create investment/i }).click();
    await this.page.getByRole('dialog').getByRole('radio', { name: product }).check();
  }

  async bookLoan(product: 'Nano' | 'Payday' | 'Personal' | 'Public Sector') {
    await this.page.getByRole('button', { name: /book loan/i }).click();
    await this.page.getByRole('dialog').getByRole('radio', { name: product }).check();
  }

  async editPersonalField(field: string, value: string) {
    await this.tab('Personal info');
    await this.panel().getByTestId(`field-${field}`).getByRole('button', { name: /edit/i }).click();
    await this.page.getByRole('dialog').getByLabel(new RegExp(field, 'i')).fill(value);
  }
}
