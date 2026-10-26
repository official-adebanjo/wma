import { Page, expect } from '@playwright/test';
import { Sidebar } from './components';

/**
 * Pending Approvals (Approval Queue). Every Dual / Compliance action routes here.
 * Self-approval blocked; per-item .approve permission enforced.
 */
export class ApprovalQueuePage {
  constructor(private readonly page: Page) {}

  async goto() {
    await new Sidebar(this.page).open('pending-approvals');
    await expect(this.page.getByRole('heading', { name: /pending approvals/i })).toBeVisible();
  }

  rows() {
    return this.page.getByRole('table').getByRole('row').filter({ has: this.page.getByRole('cell') });
  }

  row(matching: string | RegExp) {
    return this.rows().filter({ hasText: matching }).first();
  }

  async open(matching: string | RegExp) {
    await this.row(matching).click();
    await expect(this.page.getByRole('dialog', { name: /approval review/i })).toBeVisible();
  }

  reviewModal() {
    return this.page.getByRole('dialog', { name: /approval review/i });
  }

  async approve(note?: string) {
    if (note) await this.reviewModal().getByLabel(/note/i).fill(note);
    await this.reviewModal().getByRole('button', { name: /^approve$/i }).click();
  }

  async reject(reason: string) {
    await this.reviewModal().getByRole('button', { name: /^reject$/i }).click();
    await this.page.getByLabel(/reason/i).fill(reason);
    await this.page.getByRole('button', { name: /submit|confirm/i }).click();
  }

  async withdraw(reason: string) {
    await this.reviewModal().getByRole('button', { name: /^withdraw$/i }).click();
    await this.page.getByLabel(/reason/i).fill(reason);
    await this.page.getByRole('button', { name: /submit|confirm/i }).click();
  }

  async expectSelfApprovalBlocked() {
    const approve = this.reviewModal().getByRole('button', { name: /^approve$/i });
    await expect(approve.or(this.reviewModal().getByText(/cannot approve your own/i)).first()).toBeVisible();
    if (await approve.isVisible()) await expect(approve).toBeDisabled();
  }

  async expectComplianceStepRequired() {
    await expect(this.reviewModal()).toContainText(/compliance sign-off/i);
  }

  async expectEvidenceVisible() {
    await expect(this.reviewModal().getByTestId('evidence-summary')).toBeVisible();
  }

  async expectInitiator(name: string | RegExp) {
    await expect(this.reviewModal().getByTestId('initiator')).toContainText(name);
  }
}
