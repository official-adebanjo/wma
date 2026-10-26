import { test, expect } from '@playwright/test';
import { exportCsv, firstRowButton, home, nav, uniq } from './support';

/** Recorded on the dev Admin Portal — Transactions & Ledger, Pending Approvals, Support, Communications. */
test.describe('Dev portal › Transactions & Ledger', () => {
  test.beforeEach(async ({ page }) => {
    await home(page);
    await nav(page, 'Transactions & Ledger');
  });

  test('Transaction monitor: open customer drawer from a transaction @smoke', async ({ page }) => {
    await firstRowButton(page).click();
    for (const tab of ['Personal info', 'KYC & Documents', 'Products']) {
      await page.getByRole('tab', { name: tab }).click();
    }
    await page.getByLabel('Close').click();
  });

  test('Transaction monitor: filter by type @smoke', async ({ page }) => {
    await page.getByRole('main').locator('svg').nth(1).click();
    await page.getByRole('option', { name: 'Inbound transfer' }).click();
    await expect(page.getByRole('main')).toBeVisible();
  });

  test('ledger sub-pages load @smoke', async ({ page }) => {
    for (const link of ['Reversals & Adjustments', 'Cashback Ledger', 'Billers', 'Transaction Monitor']) {
      await nav(page, link);
      await expect(page.getByRole('main')).toBeVisible();
    }
  });

  test('Add biller → appears in Pending Approvals (dual control) @creates', async ({ page }) => {
    const name = uniq('RPAWA Subscription');
    await nav(page, 'Billers');
    await page.getByRole('button', { name: 'Add biller' }).click();
    await page.getByLabel('Name').fill(name);
    await page.getByLabel('TypeCableElectricityWaterInternetOther').selectOption('Electricity');
    await page.getByRole('button', { name: 'Submit for approval' }).click();
    await nav(page, 'Pending Approvals');
    await page.getByRole('tab', { name: 'Dual-control changes' }).click();
    await expect(page.getByRole('cell', { name: new RegExp(`Add biller "${name}`) })).toBeVisible();
  });
});

test.describe('Dev portal › Support & Communications', () => {
  test.beforeEach(async ({ page }) => {
    await home(page);
  });

  test('Support & Tickets is marked Soon @smoke', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Support & Tickets Soon' })).toBeVisible();
  });

  test('Campaigns export and discovery banner detail @smoke', async ({ page }) => {
    await nav(page, 'Campaigns', { group: 'Communications' });
    await exportCsv(page);
    await nav(page, 'Discovery banners');
    await firstRowButton(page).click();
    await page.getByText('Close').click();
  });
});
