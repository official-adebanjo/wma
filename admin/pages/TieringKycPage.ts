import { Page, expect } from '@playwright/test';
import { ActionModal, DetailView, Sidebar } from './components';

export type TieringTab = 'Tiers' | 'KYC Requirements' | 'Providers';
export type KycProvider = 'NIBSS' | 'NIMC' | 'Mono' | 'Doc verify';

/** Tiering & KYC — Admin PRD "Tiering & KYC" (Tiers, KYC Requirements, Providers, manual tier grant). */
export class TieringKycPage {
  readonly detail: DetailView;
  readonly modal: ActionModal;

  constructor(private readonly page: Page) {
    this.detail = new DetailView(page);
    this.modal = new ActionModal(page);
  }

  async goto(tab: TieringTab = 'Tiers') {
    await new Sidebar(this.page).open('tiering-kyc', tab);
    await expect(this.page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
  }

  item(name: string | RegExp) { return this.page.getByRole('tabpanel').getByRole('row').or(this.page.getByTestId('config-card')).filter({ hasText: name }).first(); }

  /** Opens a tier / requirement / provider and starts editing; returns the open modal. */
  async edit(name: string | RegExp) {
    await this.item(name).click();
    await this.page.getByRole('button', { name: /^edit|configure/i }).first().click();
    await this.modal.expectOpen();
    return this.modal;
  }

  // ── Tiers ─────────────────────────────────────────────────────────────────
  tierLimit(tier: 1 | 2 | 3, limit: 'single' | 'daily') { return this.item(`Tier ${tier}`).getByTestId(`limit-${limit}`); }
  eligibilityToggle(product: string) { return this.modal.root().getByRole('checkbox', { name: product }); }

  // ── KYC requirements ──────────────────────────────────────────────────────
  autoVerifiable() { return this.modal.root().getByRole('checkbox', { name: /auto-verifiable/i }); }

  // ── Manual tier grant (from the customer record) ──────────────────────────
  async startGrantTier(customerId: string) {
    await this.page.goto(`/customer/${customerId}`);
    await expect(this.page.getByTestId('customer-360')).toBeVisible();
    await this.page.getByRole('button', { name: /grant tier/i }).click();
    await this.modal.expectOpen();
    return this.modal;
  }
  manualOverrideFlag() { return this.page.getByTestId('tier-badge').getByTestId('manual-override-flag').or(this.page.getByTestId('manual-override-flag')).first(); }
}
