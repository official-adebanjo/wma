import { test, expect } from '@playwright/test';
import { exportCsv, home, nav } from './support';

/** Recorded on the dev Admin Portal — Loan Management. */
test.describe('Dev portal › Loan Management', () => {
  test.beforeEach(async ({ page }) => {
    await home(page);
    await nav(page, 'Loan Management');
  });

  test('loan portfolio exports CSV @smoke', async ({ page }) => {
    await exportCsv(page);
  });

  test('Book loan on behalf: form shows amount bounds per product, then cancel @smoke', async ({ page }) => {
    // Recording clicked "Book loan" with an out-of-range amount; we stop short of submitting
    // so a re-run can never book a real loan if the input happens to be valid.
    await page.getByRole('button', { name: 'Book loan on behalf' }).click();
    await page.getByPlaceholder('Search by name, customer id,').fill('ibrahim');
    await page.getByRole('button', { name: /IBRAHIM PETER 366985/ }).click();
    const product = page.getByLabel('Loan product*Select a loan');
    await product.selectOption('26');
    await page.getByLabel('PurposeSelect a').selectOption('Medical Expenses');
    await page.getByLabel('Amount₦Leave blank to let the').fill('6000000');
    await page.getByLabel('Duration (months)Leave blank').fill('34');
    await page.getByLabel('Interest rate%Quoted for this customer, amount and tenor. Override if you must.', { exact: true }).fill('5');
    await page.getByLabel('Penalty interest rate%Quoted').fill('2');
    await page.getByLabel('Start dateOptional. Blank').fill('2026-10-22');
    await product.selectOption('24');
    await expect(page.getByLabel('Amount₦Must be between 10000 and')).toBeVisible();
    await page.getByLabel('Amount₦Must be between 10000 and').fill('5,000,000');
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  test('Loan repayments: open repayment history drawers @smoke', async ({ page }) => {
    await nav(page, 'Loan repayments');
    const rows = page.getByRole('main').getByRole('row').filter({ has: page.getByRole('cell') });
    for (const i of [0, 1]) {
      await rows.nth(i).getByRole('button').first().click();
      await expect(page.getByText(/Repayments — .*Loan #\d+/)).toBeVisible();
      await page.getByLabel('Close').click();
    }
  });

  test('Payroll reconciliation page loads @smoke', async ({ page }) => {
    await nav(page, 'Payroll reconciliation');
    await expect(page.getByRole('main')).toBeVisible();
  });
});
