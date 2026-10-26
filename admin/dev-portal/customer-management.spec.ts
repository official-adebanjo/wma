import { test, expect } from '@playwright/test';
import { destructive, firstRowButton, home, nav } from './support';

/** Recorded on the dev Admin Portal — Customer Management (Directory, Customer 360, Review Queues, Auto Grants, Screening, Account Controls). */
test.describe('Dev portal › Customer Management', () => {
  test.beforeEach(async ({ page }) => {
    await home(page);
  });

  test('Customer 360: every tab renders and PII reveal/hide is audited @smoke', async ({ page }) => {
    await test.step('open customer from directory', async () => {
      await page.getByRole('row', { name: /Ugo Anayo 278855/ }).getByRole('button').click();
    });
    await test.step('Personal info: reveal and hide masked values', async () => {
      await page.getByRole('tab', { name: 'Personal info' }).click();
      await page.getByRole('button', { name: 'Reveal' }).first().click();
      await page.getByRole('button', { name: 'Hide' }).click();
      await expect(page.getByRole('button', { name: 'Reveal' }).first()).toBeVisible();
    });
    await test.step('remaining tabs', async () => {
      await page.getByRole('tab', { name: 'KYC & Documents' }).click();
      await page.getByRole('tab', { name: 'Products' }).click();
      await expect(page.getByText(/Loans \(\d+\)/)).toBeVisible();
      await expect(page.getByText(/Investment positions \(\d+\)/)).toBeVisible();
      for (const tab of ['Transactions', 'Screening', 'Support']) {
        await page.getByRole('tab', { name: tab }).click();
        await expect(page.getByRole('tab', { name: tab })).toHaveAttribute('aria-selected', 'true');
      }
    });
    await test.step('Audit tab records the PII view', async () => {
      await page.getByRole('tab', { name: 'Audit' }).click();
      await expect(page.getByText(/pii-view/).first()).toBeVisible();
    });
    await page.getByRole('button', { name: 'Back to directory' }).click();
  });

  test('Customer 360: edit full name goes to approval, not applied directly @creates', async ({ page }) => {
    await page.getByRole('row', { name: /Ugo Anayo 278855/ }).getByRole('button').click();
    await page.getByRole('tab', { name: 'Personal info' }).click();
    await page.locator('div').filter({ hasText: /^Full name.*Edit$/ }).getByRole('button').click();
    await page.getByLabel('Full name').fill('Ugo Anayo Princewill');
    await page.getByRole('button', { name: 'Submit for approval' }).click();
    await expect(page.getByRole('button', { name: 'Submit for approval' })).toBeHidden();
  });

  test('Directory search by name @smoke', async ({ page }) => {
    const search = page.getByPlaceholder('Search...');
    await search.fill('adebanjo');
    await search.press('Enter');
    await expect(page.getByRole('row').filter({ hasText: /adebanjo/i }).first()).toBeVisible();
  });

  test('Review Queues: open a submission document and cancel @smoke', async ({ page }) => {
    await nav(page, 'Review Queues');
    await firstRowButton(page).click();
    await page.getByRole('button', { name: 'Open document' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
  });

  test('Auto Grants, Screening and Account Controls tabs load @smoke', async ({ page }) => {
    for (const tab of ['Auto Grants', 'Screening', 'Account Controls', 'Directory']) {
      await nav(page, tab);
      await expect(page.getByRole('main')).toBeVisible();
    }
  });

  test('Screening: escalate a hit @destructive', async ({ page }) => {
    destructive();
    await nav(page, 'Screening');
    await page.getByRole('button', { name: 'Escalate' }).first().click();
  });

  test('Account Controls: freeze wallet / full freeze @destructive', async ({ page }) => {
    destructive();
    await nav(page, 'Account Controls');
    await page.getByRole('button', { name: 'Freeze wallet' }).nth(2).click();
    await page.getByRole('button', { name: 'Freeze full' }).nth(2).click();
    await page.getByRole('button', { name: 'Close' }).nth(2).click();
  });
});
