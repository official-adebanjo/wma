import { Page, expect } from '@playwright/test';
import { ActionModal, DetailView, Portfolio, Sidebar } from './components';

export type LedgerTab = 'Transaction Monitor' | 'Reversals & Adjustments' | 'Cashback Ledger' | 'Billers';

/** Reference IDs every transaction detail must render (Admin PRD › Drill into transaction detail). */
export const transactionReferenceFields = {
  'Transaction ID': 'transaction-id',
  'Provider ref': 'provider-ref',
  'NIP session': 'nip-session',
  RRN: 'rrn',
  STAN: 'stan',
  Narration: 'narration',
  'Reversal chain': 'reversal-chain',
  'Batch ref': 'batch-ref',
} as const;
export type TransactionReference = keyof typeof transactionReferenceFields;

/** Transactions & Ledger — Admin PRD "Transactions & Ledger". */
export class TransactionsLedgerPage {
  readonly portfolio: Portfolio;
  readonly detail: DetailView;
  readonly modal: ActionModal;

  constructor(private readonly page: Page) {
    this.portfolio = new Portfolio(page);
    this.detail = new DetailView(page);
    this.modal = new ActionModal(page);
  }

  async goto(tab: LedgerTab = 'Transaction Monitor') {
    await new Sidebar(this.page).open('transactions-ledger', tab);
    await expect(this.page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
  }

  /** Search for a transaction in the monitor and open its detail. */
  async openTransaction(idOrRef: string) {
    await this.portfolio.search(idOrRef);
    await this.portfolio.openRow(idOrRef);
    await expect(this.transactionDetail()).toBeVisible();
  }

  transactionDetail() { return this.page.getByTestId('transaction-detail'); }
  reference(name: TransactionReference) { return this.transactionDetail().getByTestId(`ref-${transactionReferenceFields[name]}`); }

  exportCsvButton() { return this.page.getByRole('button', { name: /export csv/i }); }

  async startAction(name: string | RegExp) {
    await this.detail.action(name);
    await this.modal.expectOpen();
    return this.modal;
  }

  // ── Billers ───────────────────────────────────────────────────────────────
  billerRow(name: string) { return this.portfolio.rows().filter({ hasText: name }).first(); }

  async addBiller() {
    await this.page.getByRole('button', { name: /add biller/i }).click();
    await this.modal.expectOpen();
    return this.modal;
  }

  async configureBiller(name: string) {
    await this.billerRow(name).click();
    await this.page.getByRole('button', { name: /configure/i }).click();
    await this.modal.expectOpen();
    return this.modal;
  }
}
