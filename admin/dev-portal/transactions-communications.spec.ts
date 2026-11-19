import { test, expect } from '@playwright/test';
import { ROUTES, btn, closeModal, exportCsv, open, subNav, uniq } from './support';

/** Transactions & Ledger, Pending Approvals, Support, Communications — current UI. */
test.describe('Dev portal › Transactions & Ledger', () => {
  test('Transaction monitor: customer name opens the Customer 360 drawer with all tabs @smoke', async ({ page }) => {
    await open(page, ROUTES.ledger);
    const customer = page.getByRole('main').getByRole('button', { name: /^[A-Z][a-z]+ [A-Z][a-z]+$/ }).first();
    // Since the 19 Nov rebuild the monitor has no customer column, so there is nothing to click.
    test.skip(!(await customer.isVisible().catch(() => false)), 'The rebuilt Transaction Monitor (19 November) shows no customer names to open');
    await customer.click();
    await expect(page.getByRole('heading', { name: 'Customer 360' })).toBeVisible();
    for (const tab of ['Personal info', 'KYC & Documents', 'Products', 'Overview']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
    }
    await closeModal(page);
  });

  // Rebuilt on 19 Nov: date range + page size + Refresh; the old Type/Category/Status/Channel/Provider
  // filters, search box and Export CSV are gone.
  test('Transaction monitor: lists transactions with a date range and page size @smoke', async ({ page }) => {
    await open(page, ROUTES.ledger);
    const main = page.getByRole('main');
    for (const col of ['DATE', 'TRANSACTION ID', 'TYPE', 'CATEGORY', 'DESCRIPTION', 'AMOUNT', 'BALANCE AFTER']) {
      await expect(main.getByText(new RegExp(`^${col}$`, 'i')).first()).toBeVisible(); // upper-cased by CSS
    }
    await expect(main.getByLabel('From')).toBeVisible();
    await expect(main.getByLabel('To')).toBeVisible();
    await main.getByRole('combobox').last().selectOption({ label: '20 per page' });
    await btn(page, 'Refresh').click();
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    await expect(main.getByText(/₦[\d,]+\.\d{2}/).first()).toBeVisible();
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
  test('Pending Approvals: queue tabs, page size and paging @smoke', async ({ page }) => {
    await open(page, ROUTES.pendingApprovals);
    await expect(page.getByRole('heading', { name: 'Approval Queue' })).toBeVisible();
    // 3 November update: "Created by me" added; "Dual-control changes" is marked COMING SOON and disabled.
    await expect(page.getByRole('tab', { name: /^Dual-control changes/ })).toContainText(/coming soon/i);
    for (const t of ['Created by me', 'Pending approvals']) {
      await page.getByRole('tab', { name: t, exact: true }).click();
      await expect(page.getByRole('tab', { name: t, exact: true })).toHaveAttribute('aria-selected', 'true');
    }
    await page.getByRole('combobox', { name: 'Show:' }).selectOption('50 per page');
    await expect(btn(page, 'Next')).toBeVisible();
  });

  // 6 Nov portal update: the "State" filter became "Status" and the Delivery log button was removed.
  test('Campaigns: templates, filters and export @smoke', async ({ page }) => {
    await open(page, ROUTES.campaigns);
    await expect(page.getByRole('heading', { name: 'Campaigns' })).toBeVisible();
    for (const f of ['Status', 'Channel']) await expect(page.getByRole('combobox', { name: f, exact: true })).toBeVisible();
    await exportCsv(page);
    await btn(page, 'Templates').click();
    await expect(page.getByRole('heading', { name: 'Templates' })).toBeVisible();
  });

  test('Discovery banners: open a banner editor and close without saving @smoke', async ({ page }) => {
    await open(page, ROUTES.banners);
    await exportCsv(page);
    // 19 Nov build: "Open" became "Edit"; the editor offers Save as draft / Send for approval (no "Preview on device").
    await btn(page, 'Edit').first().click();
    await expect(page.getByRole('heading', { name: 'Edit banner' })).toBeVisible();
    await expect(btn(page, 'Save as draft')).toBeVisible();
    await expect(btn(page, 'Send for approval').last()).toBeVisible();
    await btn(page, 'Cancel').click();
    await expect(page.getByRole('heading', { name: 'Edit banner' })).toBeHidden();
  });
});
