import { Page, expect } from '@playwright/test';
import { InvestmentManagementPage, InvestmentState } from './InvestmentManagementPage';
import { RateMatrix, PenaltyBand } from '../../shared/calc/rtn';

/**
 * Investment Management additions for Portfolio, REAP, RTN and cross-product actions
 * (Admin PRD "Investment Management"). Extends the RWIN-era page object without changing it.
 *
 * testids used (selector contract):
 *   metric-strip / metric-card / metric-label · plan-summary-<line> (liquidation & break preview)
 *   placement-state · tranche-row · duplicate-flag · request-detail
 */
export class InvestmentActionsPage extends InvestmentManagementPage {
  constructor(private readonly pg: Page) { super(pg); }

  /** asPersona pages start on about:blank — land on the portal shell before using the sidebar. */
  async goto() {
    if (this.pg.url() === 'about:blank') await this.pg.goto('/');
    await super.goto();
  }

  /* ───────────── Portfolio ───────────── */
  async gotoState(state: InvestmentState) {
    await this.goto();
    await this.portfolio.selectState(state);
    await this.portfolio.expectSelectedState(state);
  }
  async metricLabels(): Promise<string[]> {
    return (await this.portfolio.metricCards().getByTestId('metric-label').allInnerTexts()).map((t) => t.trim());
  }
  columnHeader(column: string) { return this.portfolio.table().getByRole('columnheader', { name: column }); }
  async expectSorted(column: string, dir: 'ascending' | 'descending') {
    await expect(this.columnHeader(column)).toHaveAttribute('aria-sort', dir);
  }
  async openPlanFromRow(text: string) {
    await this.portfolio.openRow(text);
    await expect(this.detail.state()).toBeVisible();
  }
  transactionHistory() { return this.pg.getByTestId('transaction-history'); }

  /* ───────────── action modal summary lines (break / liquidation / withdrawal preview) ───────────── */
  summaryLine(line: 'principal' | 'accrued-interest' | 'penalty' | 'wht' | 'interest-forfeited' | 'net-to-wallet' | 'rate' | 'rollover-amount') {
    return this.modal.root().getByTestId(`plan-summary-${line}`);
  }

  /* ───────────── RTN ───────────── */
  trancheRows() { return this.pg.getByTestId('tranche-row'); }
  duplicateFlag() { return this.pg.getByTestId('duplicate-flag'); }

  /* ───────────── Cross-product request queues (Withdrawals / Break requests rails) ───────────── */
  requestDetail() { return this.pg.getByTestId('request-detail'); }
  async openRequest(matching: string) {
    await this.portfolio.search(matching);
    await this.portfolio.openRow(matching);
    await expect(this.requestDetail()).toBeVisible();
  }
  requestButton(name: 'Approve' | 'Reject') { return this.requestDetail().getByRole('button', { name: new RegExp(`^${name}`, 'i') }); }
  async startRequestAction(name: 'Approve' | 'Reject') {
    await this.requestButton(name).click();
    await this.modal.expectOpen();
    return this.modal;
  }
  requestState() { return this.requestDetail().getByTestId('request-state'); }
}

/**
 * Test RTN configuration seeded via hooks.setProductConfig so expected values come from the
 * oracle with a known matrix and ladder (production values live in Product Management).
 */
export const rtnTestConfig: { matrix: RateMatrix; ladder: PenaltyBand[] } = {
  matrix: {
    bands: [{ min: 1_000_000, max: 10_000_000 }, { min: 10_000_000, max: 50_000_000 }, { min: 50_000_000 }],
    tenorsDays: [30, 60, 90, 120, 180, 365],
    rates: [
      [12, 13, 14, 14.5, 15, 16],
      [13, 14, 15, 15.5, 16, 17],
      [14, 15, 16, 16.5, 17, 18],
    ],
  },
  ladder: [
    { fromPctElapsed: 0, toPctElapsed: 25, basis: 'PCT_ACCRUED_INTEREST', value: 100 },
    { fromPctElapsed: 25, toPctElapsed: 50, basis: 'PCT_ACCRUED_INTEREST', value: 50 },
    { fromPctElapsed: 50, toPctElapsed: 100, basis: 'PCT_ACCRUED_INTEREST', value: 25 },
  ],
};
