import { APIRequestContext, request } from 'playwright-core';
import { Locator, Page, expect } from '@playwright/test';
import { ActionModal, DetailView, Sidebar } from './components';
import { C360Tab, Customer360Page } from './Customer360Page';
import { Persona } from '../fixtures/personas';
import { env, required } from '../../shared/config/env';

/**
 * Customer Management — Admin PRD "Customer Management" section
 * (Directory · Review Queues · Auto Grants · Screening · Account Controls) + Customer 360 extras.
 *
 * Locator strategy mirrors components.ts: role + PRD action name first ("Approve", "Request re-upload",
 * "Freeze account", "Lift"), `data-testid` for structural regions (listed per method below).
 */

export type CustomerTab = 'Directory' | 'Review Queues' | 'Auto Grants' | 'Screening' | 'Account Controls';
export type KycRequirement = 'BVN' | 'NIN' | 'ID document' | 'Proof of address' | 'Selfie / liveness';
export type RestrictionScope = 'Full freeze' | 'Withdrawal-only' | 'Debit-only' | 'Login-only';

/**
 * Personas named in the PRD that personas.ts does not define (yet). Mapped to the closest
 * existing persona so the specs compile and run; swap when the dedicated accounts exist.
 *  - "Screening reviewer" → kycReviewer (same review desk in the current RBAC matrix)
 *  - "Customer service rep" → supportAgent
 */
export const prdPersona = {
  screeningReviewer: 'kycReviewer' as Persona,
  customerServiceRep: 'supportAgent' as Persona,
};

export class CustomerManagementPage {
  readonly modal: ActionModal;
  readonly detail: DetailView;

  constructor(private readonly page: Page) {
    this.modal = new ActionModal(page);
    this.detail = new DetailView(page);
  }

  /** asPersona pages start on about:blank — land on the portal shell before using the sidebar. */
  private async ensureShell() {
    if (this.page.url() === 'about:blank') await this.page.goto('/');
    await expect(new Sidebar(this.page).root()).toBeVisible();
  }

  async goto(tab: CustomerTab = 'Directory') {
    await this.ensureShell();
    await new Sidebar(this.page).open('customer-management', tab);
    await expect(this.page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
  }

  /** Opens the module on its default tab (used to assert which sub-tabs a persona can see). */
  async openModule() {
    await this.ensureShell();
    await new Sidebar(this.page).open('customer-management');
  }

  subTab(tab: CustomerTab) { return this.page.getByRole('tab', { name: tab }); }

  /* ───────────── shared list helpers ───────────── */
  table() { return this.page.getByRole('tabpanel').getByRole('table'); }
  rows() { return this.table().getByRole('row').filter({ has: this.page.getByRole('cell') }); }
  row(matching: string | RegExp) { return this.rows().filter({ hasText: matching }).first(); }
  toast() { return this.page.getByRole('status').or(this.page.getByTestId('toast')).first(); }

  /* ───────────── Directory ───────────── */
  searchBox() { return this.page.getByTestId('customer-directory-search').or(this.page.getByRole('searchbox')).first(); }
  async search(text: string) { await this.searchBox().fill(text); }
  async filter(label: string | RegExp, value: string) {
    const f = this.page.getByTestId('filter-row').getByLabel(label);
    if ((await f.evaluate((el) => el.tagName)) === 'SELECT') await f.selectOption({ label: value });
    else { await f.click(); await this.page.getByRole('option', { name: value }).click(); }
  }
  exportButton() { return this.page.getByRole('button', { name: /export csv/i }); }
  async exportCsv() { await this.exportButton().click(); }
  /** Clicking the customer name navigates to the full-page Customer 360. */
  async openCustomerFullPage(name: string | RegExp) {
    await this.row(name).getByRole('link', { name }).click();
    await expect(this.page).toHaveURL(/\/customer\/[^/]+$/);
    await expect(this.page.getByTestId('customer-360')).toBeVisible();
  }
  /** Row quick-view opens the Customer 360 drawer instead of the full page. */
  async openCustomerDrawer(name: string | RegExp) {
    await this.row(name).getByRole('button', { name: /quick view|preview/i }).click();
    await expect(this.drawer()).toBeVisible();
  }
  drawer() { return this.page.getByTestId('customer-360-drawer'); }

  /* ───────────── Review Queues (KYC) ───────────── */
  async filterRequirement(type: KycRequirement) { await this.filter(/requirement/i, type); }
  async openKycCase(matching: string | RegExp) {
    await this.row(matching).click();
    await expect(this.kycCase()).toBeVisible();
  }
  kycCase() { return this.page.getByTestId('kyc-review-detail'); }
  kycDocuments() { return this.kycCase().getByTestId('kyc-document'); }
  kycStatus() { return this.kycCase().getByTestId('kyc-status'); }
  approveKycButton() { return this.kycCase().getByRole('button', { name: /^approve/i }); }
  async approveKyc() {
    await this.approveKycButton().click();
    await this.modal.expectOpen(/approve/i);
    await this.modal.submit();
  }
  async declineKyc(reason: string, notes = 'Automated test — decline') {
    await this.kycCase().getByRole('button', { name: /^decline/i }).click();
    await this.modal.expectOpen(/decline/i);
    await this.modal.reasonCode(reason);
    await this.modal.fill(/notes/i, notes);
    await this.modal.submit();
  }
  async requestReupload(document: string, note = 'Automated test — please re-upload a clear copy') {
    await this.kycCase().getByRole('button', { name: /request re-upload/i }).click();
    await this.modal.expectOpen(/re-upload/i);
    await this.modal.select(/document/i, document);
    await this.modal.fill(/note/i, note);
    await this.modal.submit();
  }

  /* ───────────── Auto Grants ───────────── */
  grantDetail() { return this.page.getByTestId('auto-grant-detail'); }
  async openGrant(matching: string | RegExp) {
    await this.row(matching).click();
    await expect(this.grantDetail()).toBeVisible();
  }
  /** The feed is read-only — no mutating controls anywhere on the tab. */
  async expectReadOnlyFeed() {
    await expect(this.page.getByRole('tabpanel').getByRole('button', { name: /approve|revoke|edit|delete|decline/i })).toHaveCount(0);
  }

  /* ───────────── Screening ───────────── */
  hitDetail() { return this.page.getByTestId('screening-hit-detail'); }
  confidenceCell(row: Locator) { return row.getByTestId('confidence-score'); }
  async openHit(matching: string | RegExp) {
    await this.row(matching).click();
    await expect(this.hitDetail()).toBeVisible();
  }
  hitState() { return this.hitDetail().getByTestId('hit-state'); }
  hitAction(name: 'Clear' | 'Escalate' | 'Freeze account') {
    return this.hitDetail().getByRole('button', { name: new RegExp(`^${name}`, 'i') });
  }
  async startHitAction(name: 'Clear' | 'Escalate' | 'Freeze account') {
    await this.hitAction(name).click();
    await this.modal.expectOpen();
    return this.modal;
  }

  /* ───────────── Account Controls ───────────── */
  restrictionDetail() { return this.page.getByTestId('restriction-detail'); }
  async openRestriction(matching: string | RegExp) {
    await this.row(matching).click();
    await expect(this.restrictionDetail()).toBeVisible();
  }
  restrictionScope() { return this.restrictionDetail().getByTestId('restriction-scope'); }
  restrictionAction(name: 'Lift' | 'Update restriction') {
    return this.restrictionDetail().getByRole('button', { name: new RegExp(`^${name}`, 'i') });
  }
  async startRestrictionAction(name: 'Lift' | 'Update restriction') {
    await this.restrictionAction(name).click();
    await this.modal.expectOpen();
    return this.modal;
  }
  restrictionHistoryRows() { return this.page.getByTestId('restriction-history').getByRole('row').filter({ has: this.page.getByRole('cell') }); }
}

/** Customer 360 additions needed by the Customer Management specs (drawer parity, PII, edit with old/new). */
export class Customer360Ext extends Customer360Page {
  constructor(private readonly pg: Page) { super(pg); }

  static readonly tabs: C360Tab[] = ['Overview', 'Personal info', 'KYC & Documents', 'Products', 'Transactions', 'Screening', 'Support', 'Audit'];

  root() { return this.pg.getByTestId('customer-360').or(this.pg.getByTestId('customer-360-drawer')).first(); }
  overviewSummary() { return this.panel().getByTestId('customer-summary'); }
  activeProducts() { return this.panel().getByTestId('active-products'); }
  recentActivity() { return this.panel().getByTestId('recent-activity'); }
  personalField(field: string) { return this.panel().getByTestId(`field-${field}`); }
  productRows() { return this.panel().getByTestId('product-row'); }
  transactionRows() { return this.panel().getByRole('table').getByRole('row').filter({ has: this.pg.getByRole('cell') }); }
  documentRows() { return this.panel().getByTestId('kyc-document'); }
  screeningRows() { return this.panel().getByTestId('screening-history-row'); }
  ticketRows() { return this.panel().getByTestId('ticket-row'); }
  auditRows() { return this.panel().getByTestId('audit-trail').getByRole('row').filter({ has: this.pg.getByRole('cell') }); }
  /** Masked sensitive attributes show a lock / masked value for personas without the extra permission. */
  maskedValue(field: string) { return this.personalField(field).getByTestId('masked-value'); }
  /** Action names visible in the 360 header (used for drawer vs full-page parity). */
  async headerActionNames(): Promise<string[]> {
    const names = await this.root().getByTestId('c360-actions').getByRole('button').allInnerTexts();
    return names.map((n) => n.trim()).filter(Boolean).sort();
  }
  async openFullPageFromDrawer() {
    await this.pg.getByTestId('customer-360-drawer').getByRole('link', { name: /open full page/i }).click();
    await expect(this.pg).toHaveURL(/\/customer\/[^/]+$/);
  }
  async saveEdit() {
    const m = new ActionModal(this.pg);
    await m.submit();
    return m;
  }
}

/* ───────────── QA hooks for customer-management state ─────────────
 * The shared QaHooks client has no customer-state endpoints yet; these follow the same
 * contract (POST, X-QA-Token) under /seed/* and /inspect/*. Dev/staging only.
 */
export interface CustomerSnapshot {
  customerId: string;
  fullName: string;
  phone: string;
  email?: string;
  bvn?: string;
  nin?: string;
  tier: 1 | 2 | 3;
  kycState: 'VERIFIED' | 'PENDING_REVIEW' | 'AWAITING_RE_UPLOAD' | 'DECLINED';
  accountState: 'ACTIVE' | 'FROZEN' | 'RESTRICTED';
  loginBlocked: boolean;
  restrictions: Array<{ id: string; scope: string; state: 'ACTIVE' | 'LIFTED' }>;
}

export class CustomerHooks {
  private constructor(private readonly ctx: APIRequestContext) {}

  static async create(): Promise<CustomerHooks> {
    const ctx = await request.newContext({
      baseURL: env.qaHooksBaseUrl || required('QA_HOOKS_BASE_URL'),
      extraHTTPHeaders: { 'X-QA-Token': required('QA_HOOKS_TOKEN'), Accept: 'application/json' },
    });
    return new CustomerHooks(ctx);
  }

  private async call<T>(path: string, data: unknown): Promise<T> {
    const res = await this.ctx.post(path, { data });
    if (!res.ok()) throw new Error(`QA hook ${path} failed: ${res.status()} ${await res.text()}`);
    return (await res.json()) as T;
  }

  /** Puts a pending tier-upgrade submission in the KYC review queue. */
  seedKycSubmission(opts: { customerId: string; targetTier: 2 | 3; requirement?: KycRequirement }) {
    return this.call<{ submissionId: string }>('/seed/kyc-submission', opts);
  }

  seedAutoGrant(opts: { customerId: string; tier: 2 | 3; systems?: string[] }) {
    return this.call<{ grantId: string }>('/seed/auto-grant', opts);
  }

  seedScreeningHit(opts: { customerId: string; list: 'SANCTIONS' | 'PEP'; confidencePct: number; matchedName?: string }) {
    return this.call<{ hitId: string }>('/seed/screening-hit', opts);
  }

  seedRestriction(opts: { customerId: string; scope: 'FULL_FREEZE' | 'WITHDRAWAL_ONLY' | 'DEBIT_ONLY'; reason?: string; history?: number }) {
    return this.call<{ restrictionId: string }>('/seed/restriction', opts);
  }

  seedSupportTicket(opts: { customerId: string; subject?: string }) {
    return this.call<{ ticketId: string; reference: string }>('/seed/support-ticket', opts);
  }

  customer(customerId: string) {
    return this.call<CustomerSnapshot>('/inspect/customer', { customerId });
  }

  tierChanges(customerId: string) {
    return this.call<Array<{ from: number; to: number; source: string; actor: string; createdAt: string }>>('/inspect/tier-changes', { customerId });
  }

  screeningHit(hitId: string) {
    return this.call<{ hitId: string; state: 'OPEN' | 'CLEARED' | 'ESCALATED' | 'FROZEN'; resolution?: { reason: string; actor: string } }>('/inspect/screening-hit', { hitId });
  }

  async dispose(): Promise<void> {
    await this.ctx.dispose();
  }
}
