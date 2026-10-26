import { test, expect } from '../../fixtures/fixtures';
import { Customer360Ext, CustomerHooks, CustomerManagementPage } from '../../pages/CustomerManagementPage';
import { Tag, title } from '../../../shared/support/tags';

/**
 * Admin PRD › Customer Management › Customer 360 (opens from any customer name link).
 * Each tab renders, tab-level audits (profile / PII / KYC / screening viewed), role gates on
 * KYC & Documents, Screening and Audit, edit personal info with old + new value, drawer vs full page parity.
 */
test.describe('Customer Management › Customer 360', () => {
  let ch: CustomerHooks;
  // Requesting `hooks` here skips the file cleanly when QA hooks aren't configured.
  test.beforeEach(async ({ hooks }) => { void hooks; ch = await CustomerHooks.create(); });
  test.afterEach(async () => { await ch?.dispose(); });

  test(title('Overview tab renders summary, active products and recent activity; audits profile viewed', Tag.high, Tag.smoke, Tag.spec('AdminPRD:Customer360')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 500_000 });
    await hooks.seedInvestment({ customerId, product: 'RWIN', state: 'ACTIVE', principal: 200_000, ratePct: 14, fundedDaysAgo: 5 });
    const page = await asPersona('supportAgent');
    const c360 = new Customer360Ext(page);
    await c360.goto(customerId);
    await c360.tab('Overview');
    await expect(c360.overviewSummary()).toBeVisible();
    await expect(c360.activeProducts()).toContainText(/RWIN/i);
    await expect(c360.recentActivity()).toBeVisible();
    const audit = await hooks.auditEntries({ targetId: customerId, limit: 1 });
    expect(audit[0].action).toMatch(/profile.?viewed/i);
  });

  test(title('Personal info tab renders identity fields and writes a PII access audit entry', Tag.crit, Tag.spec('AdminPRD:Customer360')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2 });
    const page = await asPersona('headOfCrm');
    const c360 = new Customer360Ext(page);
    await c360.goto(customerId);
    await c360.tab('Personal info');
    for (const f of ['name', 'dob', 'phone', 'email', 'address', 'occupation', 'employer']) {
      await expect(c360.personalField(f)).toBeVisible();
    }
    const audit = await hooks.auditEntries({ targetId: customerId, limit: 1 });
    expect(audit[0].action).toMatch(/personal.?info.?viewed|pii/i);
  });

  test(title('Sensitive personal attributes are masked for a persona without the extra permission', Tag.crit, Tag.spec('AdminPRD:Customer360')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2 });
    const page = await asPersona('readOnly');
    const c360 = new Customer360Ext(page);
    await c360.goto(customerId);
    await c360.tab('Personal info');
    await expect(c360.maskedValue('dob')).toBeVisible();
  });

  test(title('KYC & Documents tab renders status, documents and verification history; audits KYC viewed', Tag.high, Tag.spec('AdminPRD:Customer360')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 3 });
    const page = await asPersona('kycReviewer');
    const c360 = new Customer360Ext(page);
    await c360.goto(customerId);
    await c360.tab('KYC & Documents');
    await expect(c360.panel().getByTestId('kyc-status')).toContainText(/verified|tier\s*3/i);
    await expect(c360.documentRows().first()).toBeVisible();
    await expect(c360.panel().getByTestId('verification-history')).toBeVisible();
    const audit = await hooks.auditEntries({ targetId: customerId, limit: 1 });
    expect(audit[0].action).toMatch(/kyc.?viewed/i);
  });

  test(title('Products tab lists every plan, placement and loan, each opening its detail', Tag.med, Tag.spec('AdminPRD:Customer360')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const reap = await hooks.seedInvestment({ customerId, product: 'REAP', state: 'ACTIVE', principal: 50_000, ratePct: 12, fundedDaysAgo: 30 });
    await hooks.seedInvestment({ customerId, product: 'RTN', state: 'ACTIVE', principal: 1_000_000, ratePct: 14, fundedDaysAgo: 10 });
    await hooks.seedLoan({ customerId, product: 'NANO', state: 'ACTIVE', amount: 20_000 });
    const page = await asPersona('supportAgent');
    const c360 = new Customer360Ext(page);
    await c360.goto(customerId);
    await c360.tab('Products');
    await expect(c360.productRows()).toHaveCount(3);
    await c360.productRows().filter({ hasText: reap.reference }).click();
    await expect(page.getByTestId('detail-state')).toBeVisible();
  });

  test(title('Transactions tab renders the customer\'s canonical transaction history', Tag.med, Tag.spec('AdminPRD:Customer360')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 75_000 });
    const page = await asPersona('treasuryOfficer');
    const c360 = new Customer360Ext(page);
    await c360.goto(customerId);
    await c360.tab('Transactions');
    await expect(c360.transactionRows().first()).toBeVisible();
  });

  test(title('Screening tab renders history for Compliance and audits screening viewed', Tag.crit, Tag.spec('AdminPRD:Customer360')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2 });
    await ch.seedScreeningHit({ customerId, list: 'PEP', confidencePct: 55 });
    const page = await asPersona('compliance');
    const c360 = new Customer360Ext(page);
    await c360.goto(customerId);
    await c360.tab('Screening');
    await expect(c360.screeningRows().first()).toContainText(/PEP/);
    const audit = await hooks.auditEntries({ targetId: customerId, limit: 1 });
    expect(audit[0].action).toMatch(/screening.?viewed/i);
  });

  test(title('Support tab renders the customer\'s ticket history', Tag.med, Tag.spec('AdminPRD:Customer360')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 1 });
    const { reference } = await ch.seedSupportTicket({ customerId, subject: 'Cannot fund wallet' });
    const page = await asPersona('supportAgent');
    const c360 = new Customer360Ext(page);
    await c360.goto(customerId);
    await c360.tab('Support');
    await expect(c360.ticketRows().filter({ hasText: reference })).toHaveCount(1);
  });

  for (const persona of ['compliance', 'headOfOps', 'superAdmin'] as const) {
    test(title(`Audit tab renders chronological audit entries for ${persona}`, Tag.high, Tag.spec('AdminPRD:Customer360')), async ({ asPersona, hooks }) => {
      const { customerId } = await hooks.seedCustomer({ tier: 2 });
      const page = await asPersona(persona);
      const c360 = new Customer360Ext(page);
      await c360.goto(customerId);
      await c360.tab('Audit');
      await expect(c360.auditRows().first()).toContainText(/profile viewed/i);
    });
  }

  test(title('Role gates: support agent has no KYC & Documents, Screening or Audit tab', Tag.crit, Tag.spec('AdminPRD:Customer360')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2 });
    const page = await asPersona('supportAgent');
    const c360 = new Customer360Ext(page);
    await c360.goto(customerId);
    await expect(c360.tabLocator('Overview')).toBeVisible();
    for (const t of ['KYC & Documents', 'Screening', 'Audit'] as const) await expect(c360.tabLocator(t)).toHaveCount(0);
  });

  test(title('Edit personal info (Head of CRM): record updated, audit captures old + new value', Tag.crit, Tag.spec('AdminPRD:Customer360')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2 });
    const page = await asPersona('headOfCrm');
    const c360 = new Customer360Ext(page);
    await c360.goto(customerId);
    await c360.tab('Personal info');
    const before = (await c360.personalField('occupation').innerText()).replace(/edit/i, '').trim();
    const after = `QA Engineer ${Date.now() % 10_000}`;
    await c360.editPersonalField('occupation', after);
    const m = await c360.saveEdit();
    await m.expectApplied();
    await expect(c360.personalField('occupation')).toContainText(after);
    const audit = await hooks.auditEntries({ targetId: customerId, limit: 1 });
    const entry = JSON.stringify(audit[0]);
    expect(entry).toContain(after);
    if (before) expect(entry).toContain(before);
  });

  test(title('Read-only persona cannot edit personal info', Tag.crit, Tag.spec('AdminPRD:Customer360')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2 });
    const page = await asPersona('readOnly');
    const c360 = new Customer360Ext(page);
    await c360.goto(customerId);
    await c360.tab('Personal info');
    await expect(c360.panel().getByRole('button', { name: /edit/i })).toHaveCount(0);
  });

  test(title('Drawer and full page expose the same tabs and actions', Tag.med, Tag.spec('AdminPRD:Customer360')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2 });
    const page = await asPersona('superAdmin');
    const cm = new CustomerManagementPage(page);
    await cm.goto('Directory');
    await cm.search(customerId);
    const c = await ch.customer(customerId);
    await cm.openCustomerDrawer(c.fullName);
    const c360 = new Customer360Ext(page);
    const drawerTabs = await cm.drawer().getByRole('tab').allInnerTexts();
    const drawerActions = await c360.headerActionNames();
    await c360.openFullPageFromDrawer();
    const fullTabs = await page.getByTestId('customer-360').getByRole('tab').allInnerTexts();
    const fullActions = await c360.headerActionNames();
    expect(fullTabs.map((t) => t.trim())).toEqual(drawerTabs.map((t) => t.trim()));
    expect(fullActions).toEqual(drawerActions);
    expect(fullTabs.map((t) => t.trim())).toEqual(Customer360Ext.tabs);
  });
});
