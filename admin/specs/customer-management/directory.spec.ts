import { test, expect } from '../../fixtures/fixtures';
import { CustomerHooks, CustomerManagementPage } from '../../pages/CustomerManagementPage';
import { expectCsvExport } from '../../pages/components';
import { Tag, title } from '../../../shared/support/tags';

/**
 * Admin PRD › Customer Management › Directory tab.
 * View (permission-scoped), search by name / phone / BVN / NIN / customer ID, open Customer 360
 * full page (audit: profile viewed), export CSV with current filter (audit: export with filter params).
 */
test.describe('Customer Management › Directory', () => {
  let ch: CustomerHooks;
  // Requesting `hooks` here skips the file cleanly when QA hooks aren't configured.
  test.beforeEach(async ({ hooks }) => { void hooks; ch = await CustomerHooks.create(); });
  test.afterEach(async () => { await ch?.dispose(); });

  test(title('View customer directory renders the list for an admin with view scope', Tag.high, Tag.smoke, Tag.spec('AdminPRD:CustomerMgmt:Directory')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 1 });
    const page = await asPersona('supportAgent');
    const cm = new CustomerManagementPage(page);
    await cm.goto('Directory');
    await expect(cm.table()).toBeVisible();
    await cm.search(customerId);
    await expect(cm.rows()).toHaveCount(1);
  });

  for (const by of ['name', 'phone', 'BVN', 'NIN', 'customer ID'] as const) {
    test(title(`Search customer by ${by} filters the directory to the match`, Tag.med, Tag.spec('AdminPRD:CustomerMgmt:Directory')), async ({ asPersona, hooks }) => {
      const { customerId } = await hooks.seedCustomer({ tier: 2 });
      const c = await ch.customer(customerId);
      const term = { name: c.fullName, phone: c.phone, BVN: c.bvn, NIN: c.nin, 'customer ID': c.customerId }[by];
      test.skip(!term, `Seeded customer has no ${by}`);
      const page = await asPersona('supportAgent');
      const cm = new CustomerManagementPage(page);
      await cm.goto('Directory');
      await cm.search(term!);
      await expect(cm.row(c.fullName)).toBeVisible();
      for (const text of await cm.rows().allInnerTexts()) expect(text).toContain(c.fullName.split(' ')[0]);
    });
  }

  test(title('Search with no match shows an empty state, not stale rows', Tag.low, Tag.spec('AdminPRD:CustomerMgmt:Directory')), async ({ asPersona }) => {
    const page = await asPersona('supportAgent');
    const cm = new CustomerManagementPage(page);
    await cm.goto('Directory');
    await cm.search(`no-such-customer-${Date.now()}`);
    await expect(cm.rows()).toHaveCount(0);
  });

  test(title('Open Customer 360 full page from Directory navigates to /customer/{id} and audits "profile viewed"', Tag.high, Tag.smoke, Tag.spec('AdminPRD:CustomerMgmt:Directory'), Tag.spec('AdminPRD:Customer360')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 1 });
    const c = await ch.customer(customerId);
    const page = await asPersona('supportAgent');
    const cm = new CustomerManagementPage(page);
    await cm.goto('Directory');
    await cm.search(customerId);
    await cm.openCustomerFullPage(c.fullName);
    await expect(page).toHaveURL(new RegExp(`/customer/${customerId}$`));
    const audit = await hooks.auditEntries({ targetId: customerId, limit: 1 });
    expect(audit[0].action).toMatch(/profile.?viewed/i);
  });

  test(title('Export customer directory: CSV honours the current filter and is audited with filter params', Tag.crit, Tag.spec('AdminPRD:CustomerMgmt:Directory')), async ({ asPersona, hooks }) => {
    await hooks.seedCustomer({ tier: 3 }); // guarantees at least one row in the filtered export
    const page = await asPersona('superAdmin');
    const cm = new CustomerManagementPage(page);
    await cm.goto('Directory');
    await cm.filter(/tier/i, 'Tier 3');
    await expectCsvExport(page, () => cm.exportCsv(), /customer id/i);
    const audit = await hooks.auditEntries({ action: 'customer.directory.export', limit: 1 });
    expect(audit[0]).toBeTruthy();
    expect(JSON.stringify(audit[0])).toMatch(/tier/i);
  });

  test(title('Persona without export permission has no Export CSV on the Directory', Tag.crit, Tag.spec('AdminPRD:CustomerMgmt:Directory')), async ({ asPersona }) => {
    const page = await asPersona('readOnly');
    const cm = new CustomerManagementPage(page);
    await cm.goto('Directory');
    await expect(cm.table()).toBeVisible();
    await expect(cm.exportButton()).toHaveCount(0);
  });
});
