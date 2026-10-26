import { test, expect } from '@playwright/test';
import { clickStates, destructive, exportCsv, firstRowButton, home, nav } from './support';

/** Recorded on the dev Admin Portal — investment approvals, requests, alerts, carry-across and tax configuration. */
test.describe('Dev portal › Investment operations', () => {
  test.beforeEach(async ({ page }) => {
    await home(page);
    await nav(page, 'Investment Management', { group: 'Investment Management' });
  });

  test('Audit Log: entries open in detail on both tabs @smoke', async ({ page }) => {
    await nav(page, 'Audit Log');
    await firstRowButton(page).click();
    await page.getByText('Close').click();
    await page.getByRole('tab', { name: 'Investments' }).click();
    await firstRowButton(page).click();
    await page.getByText('Close', { exact: true }).click();
  });

  test('Approval queue: state filters and export @smoke', async ({ page }) => {
    await nav(page, 'Approval queue');
    await exportCsv(page);
    await clickStates(page, ['Pending approval', 'Approved', 'Rejected', 'Returned']);
  });

  test('On-behalf requests: detail, export, filters @smoke', async ({ page }) => {
    await nav(page, 'On-behalf requests');
    await firstRowButton(page).click();
    await page.getByRole('button', { name: 'Back to requests' }).click();
    await exportCsv(page);
    await clickStates(page, ['Approved', 'Pending approval']);
    await page.getByRole('button', { name: 'Refresh' }).click();
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await page.getByRole('main').locator('svg').nth(1).click();
    await page.getByRole('option', { name: 'Wallet' }).click();
  });

  test('Break requests, on-behalf withdrawals and rollovers lists load @smoke', async ({ page }) => {
    await nav(page, 'Break requests');
    await exportCsv(page);
    await page.getByRole('button', { name: 'Pending', exact: true }).click();
    for (const link of ['On-behalf withdrawals', 'On-behalf rollovers', 'System alerts']) {
      await nav(page, link);
      await expect(page.getByRole('main')).toBeVisible();
    }
  });

  test('System alerts: acknowledge and resolve @destructive', async ({ page }) => {
    destructive();
    await nav(page, 'System alerts');
    await page.getByRole('button', { name: 'Acknowledge', exact: true }).nth(1).click();
    await page.locator('div').filter({ hasText: /^CancelAcknowledge$/ }).getByRole('button').nth(1).click();
    await page.getByRole('button', { name: 'Resolve', exact: true }).first().click();
    await page.getByRole('button', { name: 'Resolve alert' }).click();
  });

  test('Auto-rollover carry-across dialog validates and cancels @smoke', async ({ page }) => {
    await nav(page, 'Auto-rollover carry-across');
    await page.getByRole('button', { name: 'Carry a default across' }).click();
    const product = page.getByLabel('Product*Select a productrwin-');
    await product.selectOption('rwin-2-0');
    await product.selectOption('rtn-v03');
    await page.getByPlaceholder('Board approval of 12 March to').fill('test test test');
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  test('Statutory tax carry-across and investment tax rates: add-rate dialog cancels @smoke', async ({ page }) => {
    await nav(page, 'Statutory tax carry-across');
    await nav(page, 'Investment tax rates');
    await page.getByRole('button', { name: 'Add rate' }).click();
    await page.getByLabel('Rate%As a percentage — 10 for 10%').fill('7');
    await page.getByRole('button', { name: 'Cancel' }).click();
  });
});
