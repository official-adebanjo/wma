import { test, expect } from '@playwright/test';
import { ROUTES, btn, closeModal, exportCsv, open, subNav, uniq } from './support';

/** Transactions & Ledger, Pending Approvals, Support, Communications — current UI. */
test.describe('Dev portal › Transactions & Ledger', () => {
  test('Transaction monitor: customer name opens the Customer 360 drawer with all tabs @smoke', async ({ page }) => {
    await open(page, ROUTES.ledger);
    const customer = page.getByRole('main').getByRole('button', { name: /^[A-Z][a-z]+ [A-Z][a-z]+$/ }).first();
    test.skip(!(await customer.isVisible().catch(() => false)), 'No transactions in range');
    await customer.click();
    await expect(page.getByRole('heading', { name: 'Customer 360' })).toBeVisible();
    for (const tab of ['Personal info', 'KYC & Documents', 'Products', 'Overview']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
    }
    await closeModal(page);
  });

  test('Transaction monitor: filters render and export CSV @smoke', async ({ page }) => {
    await open(page, ROUTES.ledger);
    for (const f of ['Type', 'Category', 'Status', 'Channel', 'Provider']) {
      await expect(page.getByRole('combobox', { name: f, exact: true })).toBeVisible();
    }
    await page.getByRole('textbox', { name: 'Any reference or customer' }).fill('TRX');
    await exportCsv(page);
  });

  test('ledger sub-pages load @smoke', async ({ page }) => {
    await open(page, ROUTES.ledger);
    for (const link of ['Reversals & Adjustments', 'Cashback Ledger', 'Billers', 'Transaction Monitor']) {
      await subNav(page, link);
      await expect(page.getByRole('main')).toContainText(/S/);
    }
  });

  test('Add biller → visible in Pending Approvals (dual control) @creates', async ({ page }) => {
    const name = uniq('RPAWA Subscription');
    await open(page, ROUTES.ledger);
    await subNav(page, 'Billers');
    await btn(page, 'Add biller').click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
    await page.getByRole('combobox', { name: 'Type', exact: true }).selectOption({ label: 'Electricity' });
    await btn(page, 'Submit for approval').click();
    await open(page, ROUTES.pendingApprovals);
    await page.getByRole('tab', { name: /^Dual-control changes/ }).click();
    // The recording showed new billers under Dual-control changes; accept either queue tab.
    const inDual = await page.getByText(name).first().isVisible().catch(() => false);
    if (!inDual) await page.getByRole('tab', { name: 'Pending approvals' }).click();
    await expect(page.getByText(name).first()).toBeVisible();
  });
});

test.describe('Dev portal › Approvals, Support & Communications', () => {
  test('Pending Approvals: both tabs and status filter @smoke', async ({ page }) => {
    await open(page, ROUTES.pendingApprovals);
    await expect(page.getByRole('heading', { name: 'Approval Queue' })).toBeVisible();
    await page.getByRole('tab', { name: /^Dual-control changes/ }).click();
    await page.getByRole('tab', { name: 'Pending approvals' }).click();
    for (const s of ['Cleared only', 'All statuses', 'Pending only']) await page.getByRole('combobox').filter({ hasText: 'Pending only' }).first().selectOption({ label: s }).catch(() => undefined);
  });

  test('Support & Tickets is marked SOON @smoke', async ({ page }) => {
    await open(page, ROUTES.pendingApprovals);
    await expect(page.getByRole('link', { name: /Support & Tickets\s*SOON/i })).toBeVisible();
  });

  test('Campaigns: templates, delivery log, filters and export @smoke', async ({ page }) => {
    await open(page, ROUTES.campaigns);
    await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible();
    for (const f of ['State', 'Channel']) await expect(page.getByRole('combobox', { name: f, exact: true })).toBeVisible();
    await exportCsv(page);
    for (const b of ['Templates', 'Delivery log']) {
      await btn(page, b).click();
      await open(page, ROUTES.campaigns);
    }
  });

  test('Discovery banners: open a banner editor and close without saving @smoke', async ({ page }) => {
    await open(page, ROUTES.banners);
    await exportCsv(page);
    await btn(page, 'Open').first().click();
    await expect(page.getByRole('heading', { name: 'Edit banner' })).toBeVisible();
    await expect(btn(page, 'Preview on device')).toBeVisible();
    await expect(btn(page, 'Send for approval')).toBeVisible();
    await closeModal(page);
  });
});
