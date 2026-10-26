import { Page, expect } from '@playwright/test';
import { ActionModal, DetailView, Portfolio, Sidebar } from './components';

export type WalletTab = 'Live board' | 'Settlement' | 'Manual ledger' | 'Providers';
export type PaymentProvider = 'Paystack' | 'Providus' | 'Wema' | 'Interswitch' | 'NIP';
export type TransferAction = 'Match to customer' | 'Match to intent' | 'Escalate';

/** Wallet Management — Admin PRD "Wallet Management" (Live board, Settlement, Manual ledger, Providers). */
export class WalletManagementPage {
  readonly portfolio: Portfolio;
  readonly detail: DetailView;
  readonly modal: ActionModal;

  constructor(private readonly page: Page) {
    this.portfolio = new Portfolio(page);
    this.detail = new DetailView(page);
    this.modal = new ActionModal(page);
  }

  async goto(tab: WalletTab = 'Live board') {
    await new Sidebar(this.page).open('wallet-management', tab);
    await expect(this.page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
  }

  // ── Live board ────────────────────────────────────────────────────────────
  liveBoard() { return this.page.getByTestId('live-board'); }
  transferRow(reference: string) { return this.liveBoard().getByRole('row').filter({ hasText: reference }).first(); }

  /** Opens an inbound transfer row and runs one of its actions; returns the open modal. */
  async startTransferAction(reference: string, action: TransferAction) {
    await this.transferRow(reference).click();
    await this.page.getByRole('button', { name: action }).click();
    await this.modal.expectOpen();
    return this.modal;
  }

  /** Inside "Match to customer": search and pick the customer. */
  async pickCustomer(query: string) {
    await this.modal.root().getByRole('searchbox').fill(query);
    await this.modal.root().getByRole('option').filter({ hasText: query }).first().click();
  }

  /** Inside "Match to intent": pick a pre-recorded intent (e.g. "REAP contribution"). */
  async pickIntent(intent: string | RegExp) {
    await this.modal.root().getByRole('radio', { name: intent }).first().check();
  }

  /** Opens a transaction (from the live board) in detail view and runs an action on it. */
  async openTransaction(reference: string) {
    await this.transferRow(reference).click();
    await expect(this.detail.state()).toBeVisible();
  }

  async startTransactionAction(name: string | RegExp) {
    await this.detail.action(name);
    await this.modal.expectOpen();
    return this.modal;
  }

  // ── Settlement ────────────────────────────────────────────────────────────
  async selectSettlementProvider(provider: PaymentProvider) {
    await this.page.getByTestId('settlement-provider-picker').getByRole('tab', { name: provider }).click();
  }
  settlementSummary() { return this.page.getByTestId('settlement-summary'); }
  ledgerTotal() { return this.settlementSummary().getByTestId('ledger-total'); }
  providerTotal() { return this.settlementSummary().getByTestId('provider-total'); }
  varianceTotal() { return this.settlementSummary().getByTestId('variance-total'); }
  varianceRows() { return this.page.getByTestId('variance-table').getByRole('row').filter({ has: this.page.getByRole('cell') }); }

  async investigateVariance(index = 0) {
    await this.varianceRows().nth(index).click();
    await expect(this.page.getByTestId('variance-detail')).toBeVisible();
    await this.page.getByRole('button', { name: /investigate|resolve/i }).click();
    await this.modal.expectOpen();
    return this.modal;
  }

  // ── Manual ledger ─────────────────────────────────────────────────────────
  async createManualEntry() {
    await this.page.getByRole('button', { name: /create entry/i }).click();
    await this.modal.expectOpen(/manual ledger|entry/i);
    return this.modal;
  }
  /** Fills the manual-entry form (customer typeahead, product, amount, category, external ref). Evidence is left to the caller. */
  async fillManualEntry(e: { customer: string; product: string; amount: number; category: string; externalRef: string }) {
    await this.modal.fill(/customer/i, e.customer);
    await this.page.getByRole('option').filter({ hasText: e.customer }).first().click();
    await this.modal.select(/product/i, e.product);
    await this.modal.fill(/amount/i, e.amount);
    await this.modal.select(/category/i, e.category);
    await this.modal.fill(/external ref/i, e.externalRef);
  }
  manualLedgerRow(externalRef: string) { return this.portfolio.rows().filter({ hasText: externalRef }).first(); }

  // ── Providers ─────────────────────────────────────────────────────────────
  providerCatalog() { return this.page.getByTestId('provider-catalog'); }
  providerCard(provider: PaymentProvider) { return this.providerCatalog().getByTestId('provider-card').filter({ hasText: provider }); }
  providerHealth(provider: PaymentProvider) { return this.providerCard(provider).getByTestId('health-status'); }

  async configureProvider(provider: PaymentProvider) {
    await this.providerCard(provider).click();
    await this.page.getByRole('button', { name: /configure/i }).click();
    await this.modal.expectOpen();
    return this.modal;
  }
}
