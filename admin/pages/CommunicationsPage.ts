import { Locator, Page, expect } from '@playwright/test';
import { ActionModal, DetailView, Portfolio, Sidebar } from './components';

export type CampaignState = 'Drafts' | 'Awaiting approval' | 'Scheduled' | 'Sending' | 'Sent' | 'Failed' | 'Cancelled';
export type BannerState = 'Drafts' | 'Awaiting approval' | 'Scheduled' | 'Live' | 'Ended';
export type CampaignChannel = 'Email' | 'Push';
export type BannerType = 'Content-only' | 'Image';

async function choose(page: Page, field: Locator, option: string) {
  if ((await field.evaluate((el) => el.tagName)) === 'SELECT') await field.selectOption({ label: option });
  else { await field.click(); await page.getByRole('option', { name: option }).click(); }
}

/**
 * Communications — Admin PRD "Communications" (Campaigns, Templates, Delivery log, Discovery Banners).
 * Campaign / banner editors are full-page forms (`campaign-editor`, `banner-editor`).
 */
export class CommunicationsPage {
  readonly portfolio: Portfolio;
  readonly detail: DetailView;
  readonly modal: ActionModal;

  constructor(private readonly page: Page) {
    this.portfolio = new Portfolio(page);
    this.detail = new DetailView(page);
    this.modal = new ActionModal(page);
  }

  async goto(tab: 'Campaigns' | 'Discovery Banners' = 'Campaigns') {
    await new Sidebar(this.page).open('communications', tab);
    await expect(this.page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
  }

  /** The list's state filter dropdown. */
  stateFilter() { return this.page.getByRole('combobox', { name: /state/i }); }
  async filterState(state: CampaignState | BannerState) { await choose(this.page, this.stateFilter(), state); }
  row(name: string) { return this.portfolio.rows().filter({ hasText: name }).first(); }
  async open(name: string) {
    await this.row(name).click();
    await expect(this.detail.state()).toBeVisible();
  }

  // ── Campaign editor ───────────────────────────────────────────────────────
  editor() { return this.page.getByTestId('campaign-editor'); }

  async newCampaign(opts: { name: string; channel: CampaignChannel; segment: string; subject?: string; body?: string; scheduleAt?: string }) {
    await this.page.getByRole('button', { name: /new campaign/i }).click();
    await expect(this.editor()).toBeVisible();
    await this.editor().getByLabel(/^name|campaign name/i).fill(opts.name);
    await this.editor().getByRole('radio', { name: opts.channel }).check();
    await choose(this.page, this.editor().getByLabel(/segment/i), opts.segment);
    if (opts.subject !== undefined) await this.editor().getByLabel(/subject|title/i).fill(opts.subject);
    if (opts.body !== undefined) await this.editor().getByLabel(/body|message/i).fill(opts.body);
    if (opts.scheduleAt) {
      await this.editor().getByRole('radio', { name: /schedule/i }).check();
      await this.editor().getByLabel(/send at|schedule date/i).fill(opts.scheduleAt);
    }
  }

  async useTemplate(name: string) {
    await this.editor().getByRole('button', { name: /use template/i }).click();
    await this.page.getByRole('dialog').getByRole('option', { name }).or(this.page.getByRole('dialog').getByText(name)).first().click();
    await this.page.getByRole('dialog').getByRole('button', { name: /confirm|use/i }).click();
  }

  async preview() { await this.page.getByRole('button', { name: /^preview/i }).click(); }
  previewPane() { return this.page.getByTestId('preview-pane'); }
  emailInboxPreview() { return this.previewPane().getByTestId('preview-email-inbox'); }
  iosPreview() { return this.previewPane().getByTestId('preview-ios'); }
  androidPreview() { return this.previewPane().getByTestId('preview-android'); }

  async saveDraft() { await this.page.getByRole('button', { name: /save as draft/i }).click(); }
  async sendForApproval() { await this.page.getByRole('button', { name: /send for approval/i }).click(); }

  async cancelScheduled(reason: string) {
    await this.detail.action(/^cancel/i);
    await this.modal.expectOpen();
    await this.modal.fill(/reason/i, reason);
    await this.modal.submit();
  }

  rejectReason() { return this.page.getByTestId('reject-reason'); }

  // ── Delivery log / retry ──────────────────────────────────────────────────
  async openDeliveryLog() { await this.page.getByRole('button', { name: /delivery log/i }).click(); }
  deliveryLog() { return this.page.getByTestId('delivery-log'); }
  deliveryRows(status?: RegExp) {
    const rows = this.deliveryLog().getByRole('row').filter({ has: this.page.getByRole('cell') });
    return status ? rows.filter({ hasText: status }) : rows;
  }
  retryFailedButton() { return this.page.getByRole('button', { name: /retry failed/i }); }
  /** Opens the retry confirmation; returns the dialog so callers can check the recipient count before confirming. */
  async startRetryFailed() {
    await this.retryFailedButton().click();
    await expect(this.page.getByRole('dialog')).toBeVisible();
    return this.page.getByRole('dialog');
  }
  async confirmRetry() { await this.page.getByRole('dialog').getByRole('button', { name: /confirm/i }).click(); }

  // ── Templates ─────────────────────────────────────────────────────────────
  async openTemplates() { await this.page.getByRole('button', { name: /^templates/i }).or(this.page.getByRole('tab', { name: /templates/i })).first().click(); }
  async editTemplate(name: string, body: string) {
    await this.portfolio.rows().filter({ hasText: name }).first().click();
    await this.page.getByRole('button', { name: /^edit/i }).click();
    await this.modal.expectOpen();
    await this.modal.fill(/body|content/i, body);
    await this.modal.submit();
  }
  templateVersions() { return this.page.getByTestId('template-versions').getByRole('row').filter({ has: this.page.getByRole('cell') }); }

  // ── Discovery banners ─────────────────────────────────────────────────────
  bannerEditor() { return this.page.getByTestId('banner-editor'); }

  async newBanner(opts: { title: string; type: BannerType; segment: string; priority: number; startDate: string; endDate: string; body?: string; image?: string }) {
    await this.page.getByRole('button', { name: /new banner/i }).click();
    const e = this.bannerEditor();
    await expect(e).toBeVisible();
    await e.getByRole('radio', { name: opts.type }).check();
    await e.getByLabel(/title|headline/i).first().fill(opts.title);
    if (opts.body !== undefined) await e.getByLabel(/body|content/i).fill(opts.body);
    if (opts.image) await e.locator('input[type=file]').setInputFiles(opts.image);
    await choose(this.page, e.getByLabel(/segment/i), opts.segment);
    await e.getByLabel(/priority/i).fill(String(opts.priority));
    await e.getByLabel(/start date|active from/i).fill(opts.startDate);
    await e.getByLabel(/end date|active to|active until/i).fill(opts.endDate);
  }

  async previewOnDevice() { await this.page.getByRole('button', { name: /preview on device/i }).click(); }

  async endEarly(reason: string) {
    await this.detail.action(/end early/i);
    await this.modal.expectOpen();
    await this.modal.fill(/reason/i, reason);
    await this.modal.submit();
  }

  analytics() { return this.page.getByTestId('banner-analytics'); }
}
