import { test, expect } from '../../fixtures/fixtures';
import { LoanManagementPage, LOAN_STATES } from '../../pages/LoanManagementPage';
import { Sidebar } from '../../pages/components';
import { parseNaira } from '../../../shared/calc/money';
import { Tag, title } from '../../../shared/support/tags';

/**
 * Admin PRD › Loan Management › Portfolio view (state side rail).
 * Side rail: Applications / Underwriting / Ready to disburse / Live servicing / Collections / Written off.
 * 5-card metric strip responds to the selected state; state selection and sort are saved per user.
 * Opening a loan writes an audit entry "loan viewed".
 *
 * Seeding assumption: hooks.seedLoan `state` accepts the rail states in UPPER_SNAKE form
 * (APPLICATION, UNDERWRITING, READY_TO_DISBURSE, LIVE_SERVICING, COLLECTIONS, WRITTEN_OFF);
 * `extra.dpd` back-dates arrears and `extra.source` sets record_source.
 */
test.describe('Loan Management › Portfolio', () => {
  test(title('View loan portfolio: side rail lists all six states with a 5-card metric strip', Tag.high, Tag.smoke, Tag.spec('AdminPRD:LoanPortfolio')), async ({ asPersona }) => {
    const page = await asPersona('loanAccountOfficer');
    const lm = new LoanManagementPage(page);
    await lm.goto();
    for (const state of LOAN_STATES) {
      await expect(lm.portfolio.rail().getByRole('button', { name: new RegExp(`^${state}`, 'i') })).toBeVisible();
    }
    await expect(lm.portfolio.metricCards()).toHaveCount(5);
  });

  test(title('Filter by state: each side-rail state swaps the metric strip', Tag.med, Tag.spec('AdminPRD:LoanPortfolio')), async ({ asPersona }) => {
    const page = await asPersona('loanAccountOfficer');
    const lm = new LoanManagementPage(page);
    await lm.goto();
    const seen = new Set<string>();
    for (const state of LOAN_STATES) {
      await lm.portfolio.selectState(state);
      await lm.portfolio.expectSelectedState(state);
      await expect(lm.portfolio.metricCards()).toHaveCount(5);
      seen.add((await lm.portfolio.metricCards().allInnerTexts()).map((t) => t.split('\n')[0].trim()).join('|'));
    }
    // Metric labels differ per state (e.g. Applications → conversion; Collections → DPD buckets).
    expect(seen.size).toBeGreaterThan(1);
  });

  test(title('Selected state is saved per user and does not leak to another admin', Tag.med, Tag.spec('AdminPRD:LoanPortfolio')), async ({ asPersona }) => {
    const officer = await asPersona('loanAccountOfficer');
    const lm = new LoanManagementPage(officer);
    await lm.goto();
    await lm.portfolio.selectState('Collections');
    await officer.reload();
    await lm.portfolio.expectSelectedState('Collections');

    const other = await asPersona('collectionsOfficer');
    const lm2 = new LoanManagementPage(other);
    await lm2.goto();
    await lm2.portfolio.selectState('Underwriting');
    await officer.reload();
    await lm.portfolio.expectSelectedState('Collections');
  });

  test(title('Filter row: product filter narrows the table to that product', Tag.med, Tag.spec('AdminPRD:LoanPortfolio')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    await hooks.seedLoan({ customerId, product: 'NANO', state: 'LIVE_SERVICING', amount: 20_000 });
    await hooks.seedLoan({ customerId, product: 'PERSONAL', state: 'LIVE_SERVICING', amount: 500_000 });
    const page = await asPersona('loanAccountOfficer');
    const lm = new LoanManagementPage(page);
    await lm.goto();
    await lm.portfolio.selectState('Live servicing');
    await lm.portfolio.filter('Product', 'Nano');
    const products = await lm.portfolio.columnValues('Product');
    expect(products.length).toBeGreaterThan(0);
    for (const p of products) expect(p).toMatch(/nano/i);
  });

  test(title('Filter row: amount range filter returns only loans inside the range', Tag.med, Tag.spec('AdminPRD:LoanPortfolio')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    await hooks.seedLoan({ customerId, product: 'PERSONAL', state: 'LIVE_SERVICING', amount: 750_000 });
    const page = await asPersona('loanAccountOfficer');
    const lm = new LoanManagementPage(page);
    await lm.goto();
    await lm.portfolio.selectState('Live servicing');
    await lm.portfolio.filter('Amount from', '500000');
    await lm.portfolio.filter('Amount to', '1000000');
    const amounts = await lm.portfolio.columnValues('Amount');
    expect(amounts.length).toBeGreaterThan(0);
    for (const a of amounts) {
      const v = parseNaira(a);
      expect(v.gte(500_000) && v.lte(1_000_000)).toBe(true);
    }
  });

  test(title('Filter row: DPD and date filters combine on the Collections state', Tag.med, Tag.spec('AdminPRD:LoanPortfolio')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    await hooks.seedLoan({ customerId, product: 'PAYDAY', state: 'COLLECTIONS', amount: 100_000, extra: { dpd: 45 } });
    const page = await asPersona('collectionsOfficer');
    const lm = new LoanManagementPage(page);
    await lm.goto();
    await lm.portfolio.selectState('Collections');
    await lm.portfolio.filter('DPD', '31-60');
    const today = new Date().toISOString().slice(0, 10);
    await lm.portfolio.filter('Date to', today);
    const dpd = await lm.portfolio.columnValues('DPD');
    expect(dpd.length).toBeGreaterThan(0);
    for (const d of dpd) {
      const n = Number(d.replace(/\D/g, ''));
      expect(n).toBeGreaterThanOrEqual(31);
      expect(n).toBeLessThanOrEqual(60);
    }
  });

  test(title('Filter row: source filter and search by reference find an admin-booked loan', Tag.med, Tag.spec('AdminPRD:LoanPortfolio')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const { reference } = await hooks.seedLoan({ customerId, product: 'PERSONAL', state: 'UNDERWRITING', amount: 400_000, extra: { source: 'admin_action' } });
    const page = await asPersona('loanAccountOfficer');
    const lm = new LoanManagementPage(page);
    await lm.goto();
    await lm.portfolio.selectState('Underwriting');
    await lm.portfolio.filter('Source', 'admin_action');
    await lm.portfolio.search(reference);
    await expect(lm.portfolio.rows()).toHaveCount(1);
    await expect(lm.portfolio.rows().first()).toContainText(reference);
    await lm.portfolio.search('NO-SUCH-LOAN-REF-000');
    await expect(lm.portfolio.rows()).toHaveCount(0);
  });

  test(title('Sort by amount is applied and persisted per user across reloads', Tag.low, Tag.spec('AdminPRD:LoanPortfolio')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    await hooks.seedLoan({ customerId, product: 'PERSONAL', state: 'LIVE_SERVICING', amount: 300_000 });
    await hooks.seedLoan({ customerId, product: 'PERSONAL', state: 'LIVE_SERVICING', amount: 900_000 });
    const page = await asPersona('loanAccountOfficer');
    const lm = new LoanManagementPage(page);
    await lm.goto();
    await lm.portfolio.selectState('Live servicing');
    await lm.portfolio.sortBy('Amount');
    const header = lm.portfolio.table().getByRole('columnheader', { name: 'Amount' });
    await expect(header).toHaveAttribute('aria-sort', /ascending|descending/);
    const direction = await header.getAttribute('aria-sort');
    const isSorted = async () => {
      const values = (await lm.portfolio.columnValues('Amount')).map((a) => parseNaira(a).toNumber());
      const sorted = [...values].sort((a, b) => (direction === 'ascending' ? a - b : b - a));
      expect(values).toEqual(sorted);
    };
    await isSorted();
    await page.reload();
    await expect(lm.portfolio.table().getByRole('columnheader', { name: 'Amount' })).toHaveAttribute('aria-sort', direction!);
    await isSorted();
  });

  test(title('Open loan detail shows repayment history, decisioning, documents and audit trail; writes "loan viewed" audit', Tag.high, Tag.smoke, Tag.spec('AdminPRD:LoanPortfolio')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const { loanId, reference } = await hooks.seedLoan({ customerId, product: 'PERSONAL', state: 'LIVE_SERVICING', amount: 600_000 });
    const page = await asPersona('loanAccountOfficer');
    const lm = new LoanManagementPage(page);
    await lm.goto();
    await lm.portfolio.selectState('Live servicing');
    await lm.portfolio.search(reference);
    await lm.portfolio.openRow(reference);
    await expect(lm.detail.state()).toBeVisible();
    for (const t of ['Repayment history', 'Decisioning', 'Documents', 'Audit trail'] as const) {
      await expect(lm.tabLocator(t)).toBeVisible();
    }
    await lm.tab('Repayment history');
    await expect(page.getByTestId('repayment-history')).toBeVisible();
    await lm.tab('Decisioning');
    await expect(page.getByTestId('decisioning-panel')).toBeVisible();
    await lm.tab('Documents');
    await expect(page.getByTestId('loan-documents')).toBeVisible();
    await lm.tab('Audit trail');
    await expect(lm.detail.auditRows().filter({ hasText: /loan viewed/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /actions|admin action/i })).toBeVisible();

    const audit = await hooks.auditEntries({ targetId: loanId, limit: 1 });
    expect(audit[0].action).toMatch(/loan[._ ]?viewed/i);
  });

  test(title('Admins without loan view permission cannot reach Loan Management', Tag.high, Tag.spec('AdminPRD:LoanPortfolio')), async ({ asPersona, hooks }) => {
    const { customerId } = await hooks.seedCustomer({ tier: 2, walletBalance: 0 });
    const { loanId } = await hooks.seedLoan({ customerId, product: 'NANO', state: 'LIVE_SERVICING', amount: 20_000 });
    const page = await asPersona('marketing');
    await page.goto('/');
    await expect(new Sidebar(page).root()).toBeVisible();
    await expect(new Sidebar(page).item('loan-management')).toHaveCount(0);
    await page.goto(`/loans/${loanId}`);
    await expect(page.getByText(/not authori[sz]ed|access denied|permission/i).first()).toBeVisible();
  });
});
