import { Page, expect } from '@playwright/test';
import { ActionModal, DetailView, Portfolio, Sidebar } from './components';

export type InvestmentState = 'Active plans' | 'Maturing' | 'Rollovers' | 'Withdrawals' | 'Break requests' | 'Under review';

/** Investment Management — Admin PRD "Investment Management" section. */
export class InvestmentManagementPage {
  readonly portfolio: Portfolio;
  readonly detail: DetailView;
  readonly modal: ActionModal;

  constructor(private readonly page: Page) {
    this.portfolio = new Portfolio(page);
    this.detail = new DetailView(page);
    this.modal = new ActionModal(page);
  }

  async goto() {
    await new Sidebar(this.page).open('investment-management');
    await expect(this.portfolio.rail()).toBeVisible();
  }

  async openPlan(planIdOrRef: string) {
    await this.page.goto(`/investments/${planIdOrRef}`);
    await expect(this.detail.state()).toBeVisible();
  }

  /** Runs an action from the plan's admin action menu and returns the open modal. */
  async startAction(name: string | RegExp) {
    await this.detail.action(name);
    await this.modal.expectOpen();
    return this.modal;
  }
}
