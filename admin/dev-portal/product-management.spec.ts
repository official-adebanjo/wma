import { test, expect, Page } from '@playwright/test';
import { ROUTES, btn, open, uniq } from './support';

/** Product Management and loan/investment configuration — current UI. */
async function addCreatableOption(page: Page, comboName: string, value: string) {
  const combo = page.getByRole('combobox', { name: comboName });
  await combo.fill(value);
  await page.getByRole('option', { name: new RegExp(`^(Add |Create )?"?${value}`) }).first().click();
}

function row(page: Page, text: string) {
  return page.getByRole('row').filter({ hasText: text }).first();
}

test.describe('Dev portal › Product Management', () => {
  test('catalogue: investment/loan tabs, type and status filters, export @smoke', async ({ page }) => {
    await open(page, ROUTES.products);
    for (const t of ['Goal savings', 'Investment note', 'Treasury note', 'All types']) {
      await page.getByRole('combobox', { name: 'Filter by type' }).selectOption({ label: t });
    }
    for (const s of ['Draft', 'Active', 'Retired', 'All statuses']) {
      await page.getByRole('combobox', { name: 'Filter by status' }).selectOption({ label: s });
    }
    await btn(page, 'Loan products').click();
    await expect(btn(page, 'New loan product')).toBeVisible();
    await btn(page, 'Investment products').click();
  });

  test('New investment product (RWIN 2.0 template): full form renders; cancel @smoke', async ({ page }) => {
    await open(page, ROUTES.products);
    await btn(page, 'New investment product').click();
    await expect(page.getByRole('heading', { name: 'Add investment product' })).toBeVisible();
    await page.getByRole('radio', { name: /RWIN 2\.0/ }).check();
    await page.getByRole('textbox', { name: /^Product name/ }).fill(uniq('Adebanjo-automate'));
    await btn(page, 'Continue').click();
    await expect(page.getByRole('heading', { name: 'New Rosabon Wealth Investment' })).toBeVisible();
    for (const h of ['Identity', 'Status & availability', 'Tenors', 'Rollover', 'Yield & cycle', 'Amounts', 'Behaviour & tax', 'Early-exit penalty ladder', 'Interest & payout', 'Product behaviour']) {
      await expect(page.getByRole('heading', { name: h, exact: true })).toBeVisible();
    }
    await page.getByRole('textbox', { name: /^One-liner/ }).fill('A test investment to automate configuration');
    await btn(page, 'Remove 30 days').click();
    await addCreatableOption(page, 'Allowed tenors (days)', '120');
    await page.locator('section').filter({ hasText: 'Yield & cycle' }).getByRole('spinbutton', { name: '%' }).fill('15');
    await btn(page, 'Cancel').first().click();
  });

  test('New loan product (Nano): type → name → full configuration form; cancel @smoke', async ({ page }) => {
    await open(page, ROUTES.products);
    await btn(page, 'Loan products').click();
    await btn(page, 'New loan product').click();
    await page.getByRole('combobox', { name: 'Loan product type' }).selectOption('nano');
    await page.getByRole('textbox', { name: /^Loan name/ }).fill(uniq('auto-nano'));
    await btn(page, 'Continue').click();
    await expect(page.getByRole('heading', { name: 'New Nano loan product' })).toBeVisible();
    for (const h of ['Identity', 'Tenors & repayment', 'Fee model', 'Loyalty discount streaks', 'Amount & pricing', 'Decisioning', 'Collections & constraints']) {
      await expect(page.getByRole('heading', { name: h, exact: true })).toBeVisible();
    }
    await page.getByRole('checkbox', { name: 'Automatic disbursement' }).check();
    await btn(page, 'Cancel').first().click();
  });

  test('Loan purpose: create → edit → delete (self-cleaning) @creates', async ({ page }) => {
    const name = uniq('Mortgage');
    await open(page, ROUTES.loanPurposes);
    await btn(page, 'New purpose').click();
    await page.getByRole('textbox', { name: 'Purpose', exact: true }).fill(name);
    await btn(page, 'Create purpose').click();
    await expect(row(page, name)).toBeVisible();
    await row(page, name).getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('textbox', { name: 'Purpose', exact: true }).fill(`${name}s`);
    await btn(page, /^Save/).click();
    await row(page, `${name}s`).getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: /^Delete( purpose)?$/ }).last().click();
    await expect(page.getByRole('row').filter({ hasText: `${name}s` })).toHaveCount(0);
  });

  test('Loan variant: create with rates, DTI and tenor @creates', async ({ page }) => {
    const code = uniq('loan-auto').replace(/\s/g, '-');
    await open(page, ROUTES.loanVariants);
    await btn(page, 'Add variant').click();
    await page.getByRole('textbox', { name: 'Variant code' }).fill(code);
    await page.getByRole('spinbutton', { name: /^Rate below defining tenor/ }).fill('2.5');
    await page.getByRole('spinbutton', { name: /^Rate at defining tenor/ }).fill('5');
    await page.getByRole('spinbutton', { name: /^Rate above defining tenor/ }).fill('5.5');
    await page.getByRole('spinbutton', { name: /^Management fee/ }).fill('1');
    await page.getByRole('spinbutton', { name: 'Standard DTI ceiling' }).fill('0.33');
    await page.getByRole('spinbutton', { name: /^Defining tenor/ }).fill('12');
    await page.getByRole('spinbutton', { name: /^Tenor cap/ }).fill('24');
    await page.getByRole('checkbox', { name: 'Top-up allowed' }).check();
    await btn(page, 'Create variant').click();
    await expect(page.getByText(code).first()).toBeVisible();
  });

  test('Loan pre-eligibility: create @creates', async ({ page }) => {
    const name = uniq('Public sector Auto');
    await open(page, ROUTES.preEligibility);
    await btn(page, 'New pre-eligibility').click();
    await page.getByRole('textbox', { name: /^Name/ }).fill(name);
    await page.getByRole('spinbutton', { name: /^Maximum age/ }).fill('65');
    await page.getByRole('spinbutton', { name: /^Minimum service/ }).fill('3');
    await page.getByRole('spinbutton', { name: /^Maximum service/ }).fill('420');
    await page.getByRole('textbox', { name: /^Minimum net salary/ }).fill('500000');
    await page.getByRole('spinbutton', { name: /^MDA collection gate/ }).fill('0.65');
    await btn(page, 'Create pre-eligibility').click();
    await expect(page.getByText(name).first()).toBeVisible();
  });

  test('Investment penalty ladder: create (new positions only) @creates', async ({ page }) => {
    const name = uniq('Reap early exit');
    await open(page, ROUTES.penaltyLadders);
    await btn(page, 'New ladder').click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill(name);
    await btn(page, 'Review & create').click();
    await btn(page, /^Submit/).click();
    await expect(page.getByText(name).first()).toBeVisible();
  });

  test('Document setup: create → edit → delete (self-cleaning) @creates', async ({ page }) => {
    const name = uniq('qa-doc');
    await open(page, ROUTES.documentSetup);
    await btn(page, 'New document').click();
    await page.getByRole('textbox', { name: 'Document', exact: true }).fill(name);
    await btn(page, 'Create document').click();
    await expect(row(page, name)).toBeVisible();
    await row(page, name).getByRole('button', { name: 'Edit' }).click();
    await page.getByRole('textbox', { name: 'Document', exact: true }).fill(`${name}-edited`);
    await btn(page, /^Save/).click();
    await row(page, `${name}-edited`).getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: /^Delete( document)?$/ }).last().click();
    await expect(page.getByRole('row').filter({ hasText: `${name}-edited` })).toHaveCount(0);
  });

  test('configuration pages load: WHT, rate & fee tables, approval threshold, corridors @smoke', async ({ page }) => {
    for (const r of [ROUTES.investmentTax, ROUTES.rateFees, ROUTES.approvalThreshold, ROUTES.corridors]) {
      await open(page, r);
      await expect(page.getByRole('heading').nth(1)).toBeVisible();
    }
  });
});
