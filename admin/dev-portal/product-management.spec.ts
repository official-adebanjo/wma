import { test, expect } from '@playwright/test';
import { home, nav, uniq } from './support';

/** Recorded on the dev Admin Portal — Product Management and loan/investment configuration. */
test.describe('Dev portal › Product Management', () => {
  test.beforeEach(async ({ page }) => {
    await home(page);
    await nav(page, 'All products');
  });

  test('New investment product wizard (RWIN template): fill and cancel @smoke', async ({ page }) => {
    await page.getByRole('button', { name: 'New investment product' }).click();
    await page.getByText(/^Rosabon Wealth Investment \(RWIN 2\.0\)/).click();
    await page.getByPlaceholder('Rosabon Wealth Investment').fill(uniq('Adebanjo-automate'));
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByPlaceholder('Guaranteed 14% p.a., pays').fill('A test investment creation to automate investment configuration');
    await page.getByLabel('Remove 30 days').click();
    await page.getByLabel('Remove 60 days').click();
    for (const d of ['120', '150']) {
      await page.getByLabel('Allowed tenors (days)').fill(d);
      await page.getByRole('option', { name: `Add ${d} days` }).click();
    }
    await page.locator('section').filter({ hasText: 'Yield & cycleInterest rate (' }).getByLabel('%').fill('15');
    await page.getByLabel('DailyMonthlyPer cycleRollover').selectOption('monthly');
    await page.getByRole('button', { name: 'Cancel' }).nth(1).click();
  });

  test('New loan product (Nano) with a new fee structure @creates', async ({ page }) => {
    await page.getByRole('button', { name: 'Loan products' }).click();
    await page.getByRole('button', { name: 'New loan product' }).click();
    await page.getByLabel('Loan product type*— select —').selectOption('nano');
    await page.getByPlaceholder('Personal Loan').fill(uniq('auto-nano'));
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Available tenors (days)*').fill('30');
    await page.getByRole('option', { name: 'Add 30 days' }).click();
    await page.getByLabel('Repayment schedule*— select —').selectOption('DAILY_DIRECT');
    await page.getByLabel('Automatic disbursement').check();
    await page.getByRole('button', { name: '+ New fee structure' }).click();
    await page.getByPlaceholder('e.g. Standard personal loan').fill(uniq('auto-nano fee'));
    await page.getByLabel('Collection mode— select —').selectOption('UPFRONT_DEDUCTED');
    await page.getByLabel('Management fee%').fill('1');
    await page.getByLabel('VAT%Statutory — 7.5% unless').fill('7.5');
    await page.getByLabel('WHT%Statutory withholding tax.').fill('1');
    await page.getByRole('button', { name: 'Create fee structure' }).click();
    await page.getByRole('button', { name: 'Create product' }).click();
    await page.getByRole('button', { name: 'Open product' }).click();
    await page.getByRole('button', { name: 'Back to catalogue' }).click();
  });

  test('Loan purpose: create → edit → delete (self-cleaning) @creates', async ({ page }) => {
    const name = uniq('Mortgage');
    await nav(page, 'Loan purpose');
    await page.getByRole('button', { name: 'New purpose' }).click();
    await page.getByPlaceholder('e.g. Business expansion').fill(name);
    await page.getByRole('button', { name: 'Create purpose' }).click();
    await page.getByRole('row', { name: new RegExp(`^${name}`) }).getByRole('button').first().click();
    await page.getByPlaceholder('e.g. Business expansion').fill(`${name}s`);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.getByRole('row', { name: new RegExp(`^${name}s`) }).getByRole('button').nth(1).click();
    await page.getByRole('button', { name: 'Delete purpose' }).click();
    await expect(page.getByRole('row', { name: new RegExp(`^${name}s`) })).toHaveCount(0);
  });

  test('Loan variant: create @creates', async ({ page }) => {
    await nav(page, 'Loan variants');
    await page.getByRole('button', { name: 'Add variant' }).click();
    await page.getByPlaceholder('e.g. PL3-E').fill(uniq('loan-auto'));
    await page.locator('.rounded-md > .flex > div:nth-child(2)').first().click();
    await page.getByRole('option', { name: 'Repeat — poor performing' }).click();
    await page.getByPlaceholder('e.g. 5.5').fill('2.5');
    await page.getByPlaceholder('e.g. 5', { exact: true }).fill('5');
    await page.getByPlaceholder('e.g. 4.5').fill('5.5');
    await page.getByPlaceholder('e.g. 1', { exact: true }).fill('1');
    await page.getByText('Top-up allowed').click();
    await page.getByRole('button', { name: 'Create variant' }).click();
  });

  test('Loan pre-eligibility: create @creates', async ({ page }) => {
    await nav(page, 'Loan pre-eligibility');
    await page.getByRole('button', { name: 'New pre-eligibility' }).click();
    await page.getByPlaceholder('e.g. Public-sector standard').fill(uniq('Public sector Auto'));
    await page.getByPlaceholder('e.g. 60').fill('65');
    await page.getByPlaceholder('e.g. 420').fill('12');
    await page.getByPlaceholder('e.g. 12').fill('3');
    await page.getByPlaceholder('e.g. 50000').fill('500000');
    await page.getByPlaceholder('e.g. 0.8').fill('0.65');
    await page.getByRole('button', { name: 'Create pre-eligibility' }).click();
  });

  test('Investment penalty ladder: create (new positions only) @creates', async ({ page }) => {
    await nav(page, 'Investment penalty ladders');
    await page.getByRole('button', { name: 'New ladder' }).click();
    await page.getByPlaceholder('REAP early exit').fill(uniq('Reap early exit'));
    await page.getByRole('button', { name: 'Review & create' }).click();
    await page.getByRole('button', { name: 'Submit (new positions only)' }).click();
  });

  test('configuration pages load: WHT, rate & fee tables, approval threshold, corridors, MDA lists @smoke', async ({ page }) => {
    for (const link of ['Investment tax (WHT)', 'Rate & fee tables', 'Approval threshold', 'Corridors & partners', 'MDA lists']) {
      await nav(page, link);
      await expect(page.getByRole('main')).toBeVisible();
    }
  });

  test('Served states: add a state for approval @creates', async ({ page }) => {
    await nav(page, 'Served states');
    await page.getByRole('button', { name: 'Add state' }).click();
    await page.getByLabel('State— select a state —').selectOption('Cross River');
    await page.getByRole('button', { name: 'Submit for approval' }).click();
  });

  test('Integration partners: add partner for approval @creates', async ({ page }) => {
    await nav(page, 'Integration partners');
    await page.getByRole('button', { name: 'Add partner' }).click();
    await page.getByLabel('Type— select —').selectOption('Payments');
    await page.getByLabel('Partner name').fill(uniq('Adebanjo Auto'));
    await page.getByRole('button', { name: 'Submit for approval' }).click();
  });

  test('Document setup: create → edit → delete (self-cleaning) @creates', async ({ page }) => {
    const name = uniq('qa-doc');
    await nav(page, 'Document setup');
    await page.getByRole('button', { name: 'New document' }).click();
    await page.getByPlaceholder('e.g. Most recent payslip').fill(name);
    await page.getByRole('button', { name: 'Create document' }).click();
    await page.getByRole('row', { name: new RegExp(`^${name}`) }).getByRole('button').first().click();
    await page.getByPlaceholder('e.g. Most recent payslip').fill(`${name}-edited`);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await page.getByRole('row', { name: new RegExp(`^${name}-edited`) }).getByRole('button').nth(1).click();
    await page.getByRole('button', { name: 'Delete document' }).click();
    await expect(page.getByRole('row', { name: new RegExp(`^${name}-edited`) })).toHaveCount(0);
  });
});
