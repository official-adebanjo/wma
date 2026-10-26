import { test, expect } from '../../fixtures/fixtures';
import { InvestmentActionsPage } from '../../pages/InvestmentActionsPage';
import { InvestmentState } from '../../pages/InvestmentManagementPage';
import { Sidebar } from '../../pages/components';
import { Tag, title } from '../../../shared/support/tags';

/**
 * Admin PRD › Investment Management › Portfolio view (state side rail).
 * State rail swaps the 5-card metric strip and persists per user; filter row (product / amount / date /
 * source / search); sortable columns with per-user persisted preference; plan detail audited "plan viewed".
 */
test.describe('Investment Management › Portfolio', () => {
  const STATES: InvestmentState[] = ['Active plans', 'Maturing', 'Rollovers', 'Withdrawals', 'Break requests', 'Under review'];

  test(title('View investment portfolio renders the state rail and a 5-card metric strip', Tag.high, Tag.smoke, Tag.spec('AdminPRD:InvMgmt:Portfolio')), async ({ asPersona }) => {
    const page = await asPersona('treasuryOfficer');
    const im = new InvestmentActionsPage(page);
    await im.goto();
    for (const s of STATES) await expect(im.portfolio.rail().getByRole('button', { name: new RegExp(`^${s}`, 'i') })).toBeVisible();
    await expect(im.portfolio.metricCards()).toHaveCount(5);
  });

  test(title('Selecting each state filters the table and swaps the metric strip', Tag.high, Tag.spec('AdminPRD:InvMgmt:Portfolio')), async ({ asPersona }) => {
    const page = await asPersona('treasuryOfficer');
    const im = new InvestmentActionsPage(page);
    await im.goto();
    const seen = new Set<string>();
    for (const s of STATES) {
      await im.portfolio.selectState(s);
      await im.portfolio.expectSelectedState(s);
      await expect(im.portfolio.metricCards()).toHaveCount(5);
      seen.add((await im.metricLabels()).join('|'));
    }
    expect(seen.size).toBeGreaterThan(1); // metrics respond to state rather than staying static
  });

  test(title('Selected state is saved per user and survives reload', Tag.med, Tag.spec('AdminPRD:InvMgmt:Portfolio')), async ({ asPersona }) => {
    const page = await asPersona('headOfCrm');
    const im = new InvestmentActionsPage(page);
    await im.gotoState('Maturing');
    await page.reload();
    await im.portfolio.expectSelectedState('Maturing');
    await im.portfolio.selectState('Active plans'); // restore default for other tests
  });

  test(title('Filter by product, amount, date, source and search narrows the table', Tag.med, Tag.spec('AdminPRD:InvMgmt:Portfolio')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const reap = await hooks.seedInvestment({ customerId, product: 'REAP', state: 'ACTIVE', principal: 120_000, ratePct: 12, fundedDaysAgo: 3, extra: { source: 'admin_action' } });
    const page = await asPersona('treasuryOfficer');
    const im = new InvestmentActionsPage(page);
    await im.gotoState('Active plans');
    await im.portfolio.filter('Product', 'REAP');
    for (const v of await im.portfolio.columnValues('Product')) expect(v).toMatch(/REAP/);
    await im.portfolio.filter('Source', 'admin_action');
    for (const v of await im.portfolio.columnValues('Source')) expect(v).toMatch(/admin/i);
    await im.portfolio.filter('Min amount', '100000');
    await im.portfolio.filter('Max amount', '150000');
    await im.portfolio.filter('From date', new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10));
    await im.portfolio.search(reap.reference);
    await expect(im.portfolio.rows()).toHaveCount(1);
    await expect(im.portfolio.rows().first()).toContainText(reap.reference);
  });

  test(title('Sort portfolio by column; preference is saved per user and survives reload', Tag.med, Tag.spec('AdminPRD:InvMgmt:Portfolio')), async ({ asPersona }) => {
    const page = await asPersona('treasuryOfficer');
    const im = new InvestmentActionsPage(page);
    await im.gotoState('Active plans');
    await im.portfolio.sortBy('Amount');
    await im.expectSorted('Amount', 'ascending');
    await im.portfolio.sortBy('Amount');
    await im.expectSorted('Amount', 'descending');
    const amounts = (await im.portfolio.columnValues('Amount')).map((t) => Number(t.replace(/[^\d.]/g, '')));
    expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
    await page.reload();
    await im.expectSorted('Amount', 'descending');

    // Preference is per user: another persona does not inherit it.
    const other = new InvestmentActionsPage(await asPersona('headOfCrm'));
    await other.gotoState('Active plans');
    await expect(other.columnHeader('Amount')).not.toHaveAttribute('aria-sort', 'descending');
  });

  test(title('Open plan detail shows fields, transaction history, audit trail, action menu; audits plan viewed', Tag.high, Tag.smoke, Tag.spec('AdminPRD:InvMgmt:Portfolio')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const { investmentId, reference } = await hooks.seedInvestment({ customerId, product: 'RWIN', state: 'ACTIVE', principal: 300_000, ratePct: 14, fundedDaysAgo: 10 });
    const page = await asPersona('treasuryOfficer');
    const im = new InvestmentActionsPage(page);
    await im.gotoState('Active plans');
    await im.portfolio.search(reference);
    await im.openPlanFromRow(reference);
    await expect(page.getByTestId('detail-fields')).toBeVisible();
    await expect(im.transactionHistory()).toBeVisible();
    await im.detail.tab('Audit trail');
    await expect(im.detail.auditRows().first()).toBeVisible();
    await expect(page.getByRole('button', { name: /actions|admin action/i })).toBeVisible();
    const audit = await hooks.auditEntries({ targetId: investmentId, limit: 1 });
    expect(audit[0].action).toMatch(/plan.?viewed/i);
  });

  test(title('Persona without investment view permission has no Investment Management nav', Tag.high, Tag.spec('AdminPRD:InvMgmt:Portfolio')), async ({ asPersona }) => {
    const page = await asPersona('collectionsOfficer');
    await page.goto('/');
    await expect(new Sidebar(page).root()).toBeVisible();
    await expect(new Sidebar(page).item('investment-management')).toHaveCount(0);
  });
});
