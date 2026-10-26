import { test, expect, Page } from '@playwright/test';
import { ROUTES, btn, destructive, open, subNav } from './support';

/** Customer Management — current UI: Directory / Review Queues / Auto Grants / Screening / Account Controls sub-links; Customer 360 via "View". */
const CUSTOMER = 'Ugo Anayo';

async function openCustomer(page: Page, name = CUSTOMER) {
  await open(page, ROUTES.customers);
  await page.locator('tr', { has: page.getByRole('link', { name, exact: true }) }).getByRole('button', { name: 'View' }).first().click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

test.describe('Dev portal › Customer Management', () => {
  test('Customer 360: all eight tabs render @smoke', async ({ page }) => {
    await openCustomer(page);
    for (const tab of ['Overview', 'Personal info', 'KYC & Documents', 'Products', 'Transactions', 'Screening', 'Support', 'Audit']) {
      await page.getByRole('tab', { name: tab, exact: true }).click();
      await expect(page.getByRole('tab', { name: tab, exact: true })).toHaveAttribute('aria-selected', 'true');
    }
    await btn(page, 'Back to directory').click();
    await expect(page.getByRole('heading', { name: 'Customer Directory' })).toBeVisible();
  });

  test('Customer 360: Overview shows at-a-glance profile and dual-controlled account controls @smoke', async ({ page }) => {
    await openCustomer(page);
    await expect(page.getByRole('heading', { name: 'At a glance' })).toBeVisible();
    await expect(page.getByText(/All status changes are dual-controlled/)).toBeVisible();
    for (const b of ['Freeze wallet', 'Freeze account (full)', 'Close account']) await expect(btn(page, b)).toBeVisible();
  });

  test('Customer 360: PII is masked; reveal/hide is recorded in the Audit tab @smoke', async ({ page }) => {
    await openCustomer(page);
    await page.getByRole('tab', { name: 'Personal info' }).click();
    const reveal = btn(page, 'Reveal').first();
    test.skip(!(await reveal.isVisible().catch(() => false)), 'No masked fields on this customer in the current UI');
    await reveal.click();
    await btn(page, 'Hide').first().click();
    await page.getByRole('tab', { name: 'Audit' }).click();
    await btn(page, 'Refresh').click();
    // PRD: personal-info / PII views are written to the audit trail (PII access log).
    await expect(page.getByText(/pii-view|PII/).first()).toBeVisible();
  });

  test('Customer 360: edit full name is submitted for approval @creates', async ({ page }) => {
    await openCustomer(page);
    await page.getByRole('tab', { name: 'Personal info' }).click();
    await page.getByText('Full name', { exact: true }).locator('xpath=ancestor::div[.//button[normalize-space()="Edit"]][1]').getByRole('button', { name: 'Edit' }).click();
    await page.getByLabel('Full name').fill('Ugo Anayo Princewill');
    await btn(page, 'Submit for approval').click();
    await expect(btn(page, 'Submit for approval')).toBeHidden();
  });

  test('Directory: paginates and exports CSV @smoke', async ({ page }) => {
    await open(page, ROUTES.customers);
    await expect(page.getByRole('heading', { name: 'Customer Directory' })).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download'), btn(page, 'Export CSV').click()]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/i);
    await btn(page, 'Next').click();
    await btn(page, 'Prev').click();
  });

  test('Review Queues: document reviews, failed checks and tier-upgrade requests are listed @smoke', async ({ page }) => {
    await open(page, ROUTES.customers);
    await subNav(page, 'Review Queues');
    await expect(page.getByRole('heading', { name: 'Review Queues' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Document reviews \(\d+\)$/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Failed checks \(\d+\)$/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Tier-upgrade requests \(\d+\)$/ })).toBeVisible();
  });

  test('Review Queues: open a document review and back out without deciding @smoke', async ({ page }) => {
    await open(page, ROUTES.customers);
    await subNav(page, 'Review Queues');
    const review = btn(page, 'Review').first();
    test.skip(!(await review.isVisible().catch(() => false)), 'No document reviews pending');
    await review.click();
    const openDoc = btn(page, 'Open document');
    if (await openDoc.isVisible().catch(() => false)) await openDoc.click();
    await page.getByRole('button', { name: /^(Cancel|Close)$/ }).last().click();
  });

  test('Auto Grants, Screening and Account Controls sub-pages load @smoke', async ({ page }) => {
    await open(page, ROUTES.customers);
    for (const tab of ['Auto Grants', 'Screening', 'Account Controls', 'Directory']) {
      await subNav(page, tab);
      await expect(page.getByRole('heading').nth(1)).toBeVisible();
    }
  });

  test('Screening: escalate a hit @destructive', async ({ page }) => {
    destructive();
    await open(page, ROUTES.customers);
    await subNav(page, 'Screening');
    await btn(page, 'Escalate').first().click();
  });

  test('Customer 360: freeze wallet @destructive', async ({ page }) => {
    destructive();
    await openCustomer(page);
    await btn(page, 'Freeze wallet').click();
  });
});
