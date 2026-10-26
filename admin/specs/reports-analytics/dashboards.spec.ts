import { test, expect } from '../../fixtures/fixtures';
import { ReportsAnalyticsPage } from '../../pages/ReportsAnalyticsPage';
import { expectCsvExport } from '../../pages/components';
import { Tag, title } from '../../../shared/support/tags';

/**
 * Admin PRD › Reports & Analytics › Dashboards (+ Reports tab placeholder).
 * 8-dashboard card grid, permission-filtered. Opening, drilling in and exporting are audited.
 */
const DASHBOARD_COUNT = 8;

test.describe('Reports & Analytics › Dashboards', () => {
  test(title('Dashboards landing renders the 8-card grid for a full-access admin', Tag.med, Tag.smoke, Tag.spec('AdminPRD:ReportsAnalytics')), async ({ asPersona }) => {
    const page = await asPersona('superAdmin');
    const ra = new ReportsAnalyticsPage(page);
    await ra.goto('Dashboards');
    await expect(ra.dashboardCards()).toHaveCount(DASHBOARD_COUNT);
    await expect(ra.portfolio.metricCards().first()).toBeVisible();
  });

  test(title('Card grid is permission-filtered: a narrower role sees a strict subset', Tag.crit, Tag.spec('AdminPRD:ReportsAnalytics')), async ({ asPersona }) => {
    const full = new ReportsAnalyticsPage(await asPersona('superAdmin'));
    await full.goto('Dashboards');
    const all = await full.cardTitles();
    const narrowPage = await asPersona('marketing');
    const narrow = new ReportsAnalyticsPage(narrowPage);
    await narrow.goto('Dashboards');
    const mine = await narrow.cardTitles();
    expect(mine.length).toBeLessThan(all.length);
    for (const t of mine) expect(all).toContain(t);
  });

  test(title('Open dashboard is audited ("dashboard viewed")', Tag.high, Tag.spec('AdminPRD:ReportsAnalytics')), async ({ asPersona, hooks }) => {
    const page = await asPersona('headOfOps');
    const ra = new ReportsAnalyticsPage(page);
    await ra.goto('Dashboards');
    const [first] = await ra.cardTitles();
    await ra.openDashboard(first);
    const audit = await hooks.auditEntries({ action: 'dashboard.viewed', limit: 1 });
    expect(audit[0]).toBeTruthy();
  });

  test(title('Filter bar recomputes dashboard metrics for the selection', Tag.med, Tag.spec('AdminPRD:ReportsAnalytics')), async ({ asPersona }) => {
    const page = await asPersona('headOfOps');
    const ra = new ReportsAnalyticsPage(page);
    await ra.goto('Dashboards');
    const [first] = await ra.cardTitles();
    await ra.openDashboard(first);
    await ra.filterDashboard(/date range|period/i, 'Last 7 days');
    await expect(ra.filterBar()).toContainText(/last 7 days/i);
    await expect(ra.metricValues().first()).toBeVisible();
  });

  test(title('Drill into chart navigates to source module with the filter applied (audited)', Tag.high, Tag.spec('AdminPRD:ReportsAnalytics')), async ({ asPersona, hooks }) => {
    const page = await asPersona('superAdmin');
    const ra = new ReportsAnalyticsPage(page);
    await ra.goto('Dashboards');
    const [first] = await ra.cardTitles();
    await ra.openDashboard(first);
    const before = page.url();
    await ra.chartElements().first().click();
    await expect(page).not.toHaveURL(before);
    await expect(page.getByTestId('dashboard-view')).toHaveCount(0);
    await expect(ra.portfolio.filterRow().getByTestId('active-filter').first()).toBeVisible();
    const audit = await hooks.auditEntries({ action: 'dashboard.drill', limit: 1 });
    expect(audit[0]).toBeTruthy();
  });

  test(title('Export dashboard view as CSV is audited', Tag.high, Tag.spec('AdminPRD:ReportsAnalytics')), async ({ asPersona, hooks }) => {
    const page = await asPersona('headOfOps');
    const ra = new ReportsAnalyticsPage(page);
    await ra.goto('Dashboards');
    const [first] = await ra.cardTitles();
    await ra.openDashboard(first);
    await expectCsvExport(page, () => ra.exportView('CSV'), /./);
    const audit = await hooks.auditEntries({ action: 'dashboard.export', limit: 1 });
    expect(audit[0]).toBeTruthy();
  });

  test(title('Export dashboard view as PDF downloads a PDF', Tag.med, Tag.spec('AdminPRD:ReportsAnalytics')), async ({ asPersona }) => {
    const page = await asPersona('headOfOps');
    const ra = new ReportsAnalyticsPage(page);
    await ra.goto('Dashboards');
    const [first] = await ra.cardTitles();
    await ra.openDashboard(first);
    const [download] = await Promise.all([page.waitForEvent('download'), ra.exportView('PDF')]);
    expect(download.suggestedFilename()).toMatch(/\.pdf$/i);
  });

  test(title('Roles without export permission do not get Export view', Tag.high, Tag.spec('AdminPRD:ReportsAnalytics')), async ({ asPersona }) => {
    const page = await asPersona('readOnly');
    const ra = new ReportsAnalyticsPage(page);
    await ra.goto('Dashboards');
    const titles = await ra.cardTitles();
    test.skip(titles.length === 0, 'Read-only persona has no dashboards');
    await ra.openDashboard(titles[0]);
    await expect(page.getByRole('button', { name: /export view/i })).toHaveCount(0);
  });

  test(title('Reorder dashboard cards persists across reload', Tag.low, Tag.spec('AdminPRD:ReportsAnalytics')), async ({ asPersona }) => {
    const page = await asPersona('headOfOps');
    const ra = new ReportsAnalyticsPage(page);
    await ra.goto('Dashboards');
    const before = await ra.cardTitles();
    test.skip(before.length < 2, 'Need at least two dashboards to reorder');
    await ra.moveCard(before[1], before[0]);
    const moved = await ra.cardTitles();
    expect(moved[0]).toBe(before[1]);
    await page.reload();
    await ra.goto('Dashboards');
    expect(await ra.cardTitles()).toEqual(moved);
    await ra.moveCard(before[0], moved[0]); // restore
  });

  test(title('Reports tab shows "Coming soon" placeholder', Tag.low, Tag.spec('AdminPRD:ReportsAnalytics')), async ({ asPersona }) => {
    const page = await asPersona('headOfOps');
    const ra = new ReportsAnalyticsPage(page);
    await ra.goto('Reports');
    await expect(ra.comingSoon()).toBeVisible();
  });
});
