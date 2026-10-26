import { test, expect } from '@playwright/test';
import { ROUTES, btn, closeModal, open } from './support';

/** Loan Management — current UI: applications list with status filter, book-on-behalf modal, repayments drawer. */
test.describe('Dev portal › Loan Management', () => {
  test('applications: status filter options apply @smoke', async ({ page }) => {
    await open(page, ROUTES.loanApplications);
    const filter = page.getByRole('combobox', { name: 'Filter by status' });
    for (const s of ['Active', 'Approved', 'Pending', 'Overdue', 'Repaid', 'All statuses']) {
      await filter.selectOption({ label: s });
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    }
    await page.getByRole('combobox', { name: 'Show:' }).selectOption('50 per page');
  });

  test('applications: search and refresh @smoke', async ({ page }) => {
    await open(page, ROUTES.loanApplications);
    await page.getByRole('textbox', { name: 'Search', exact: true }).fill('IBRAHIM');
    await page.keyboard.press('Enter');
    await btn(page, 'Refresh').click();
    await expect(page.getByRole('heading', { name: 'Loan applications' })).toBeVisible();
  });

  test('Book loan on behalf: product list, quote fields, cancel without booking @smoke', async ({ page }) => {
    await open(page, ROUTES.loanApplications);
    await btn(page, 'Book loan on behalf').click();
    await expect(page.getByRole('heading', { name: 'Book a loan on behalf' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Customer', exact: true }).fill('ibrahim');
    await page.getByRole('button').filter({ hasText: /IBRAHIM PETER/ }).first().click();
    const product = page.getByRole('combobox', { name: 'Loan product' });
    expect(await product.locator('option').count()).toBeGreaterThan(1);
    await product.selectOption({ index: 1 });
    await page.getByRole('textbox', { name: /^Amount/ }).fill('500000');
    await page.getByRole('spinbutton', { name: /^Duration/ }).fill('6');
    await expect(page.getByRole('spinbutton', { name: /^Interest rate/ })).toBeVisible();
    await expect(page.getByRole('spinbutton', { name: /^Penalty interest rate/ })).toBeVisible();
    // Deliberately not clicking "Book loan" — a re-run must never book a real loan.
    await btn(page, 'Cancel').click();
    await expect(page.getByRole('heading', { name: 'Book a loan on behalf' })).toBeHidden();
  });

  test('Loan repayments: open repayment history drawers @smoke', async ({ page }) => {
    await open(page, ROUTES.loanRepayments);
    const open1 = btn(page, 'Repayments');
    test.skip((await open1.count()) === 0, 'No loans with repayments');
    for (const i of [0, 1]) {
      if (i >= (await open1.count())) break;
      await open1.nth(i).click();
      await expect(page.getByRole('heading', { name: /^Repayments — .*Loan #\d+$/ })).toBeVisible();
      await closeModal(page);
    }
  });

  test('Payroll reconciliation page loads @smoke', async ({ page }) => {
    await open(page, ROUTES.payroll);
    await expect(page.getByRole('heading').nth(1)).toBeVisible();
  });
});
