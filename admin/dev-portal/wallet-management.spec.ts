import { test, expect } from '@playwright/test';
import { destructive, home, nav, uniq } from './support';

/** Recorded on the dev Admin Portal — Wallet Management (live board, providers, routing, config, ledger). */
test.describe('Dev portal › Wallet Management', () => {
  test.beforeEach(async ({ page }) => {
    await home(page);
    await nav(page, 'Wallet Management');
  });

  test('sub-pages load: Settlement, Manual Ledger, Incidents, Live Board @smoke', async ({ page }) => {
    for (const link of ['Settlement', 'Manual Ledger', 'Incidents', 'Live Board']) {
      await nav(page, link);
      await expect(page.getByRole('main')).toBeVisible();
    }
  });

  test('Manual ledger: credit, debit and reversal dialogs open and close @smoke', async ({ page }) => {
    await nav(page, 'Manual Ledger');
    for (const action of ['Manual credit', 'Manual debit', 'Reversal']) {
      await page.getByRole('button', { name: action }).click();
      await page.getByLabel('Close').click();
    }
  });

  test('Payment providers: add provider is submitted for approval @creates', async ({ page }) => {
    await nav(page, 'Payment Providers');
    await page.getByRole('button', { name: 'Add provider' }).click();
    await page.getByLabel('Provider name').fill(uniq('QA Provider'));
    await page.getByLabel('Primary contact').fill('adebanjo.adeniji@concept-nova.com');
    await page.getByLabel('Bank transfer in').check();
    await page.getByLabel('Bank transfer out').check();
    await page.getByLabel('Settlement account').fill('1234567890');
    await page.getByRole('button', { name: 'Submit for approval' }).click();
    await expect(page.getByLabel('Provider name')).toBeHidden();
  });

  test('Routing policy: edit rule submits for approval; override dialog cancels @creates', async ({ page }) => {
    await nav(page, 'Routing Policy');
    await page.getByRole('button', { name: 'Edit rule' }).first().click();
    await page.getByRole('button', { name: 'Submit for approval' }).click();
    await page.getByRole('button', { name: 'Manual override' }).first().click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('button', { name: 'View override history' }).click();
    await page.getByText('Close').click();
  });

  test('Wallet config: submit for approval @creates', async ({ page }) => {
    await nav(page, 'Wallet Config');
    await page.getByRole('button', { name: 'Submit for approval' }).click();
  });

  test('Live board: release / reject / reconcile / query / manual complete @destructive', async ({ page }) => {
    destructive();
    await page.getByRole('button', { name: 'Release' }).nth(1).click();
    await page.getByLabel('Reason (required)').fill('release sent to app');
    await page.getByRole('button', { name: 'Release transaction' }).click();
    await page.getByRole('button', { name: 'Reject' }).click();
    await page.getByLabel('Reason (required)').fill('release sent to app');
    await page.getByRole('button', { name: 'Reject transaction' }).click();
    await page.getByRole('button', { name: 'Force reconcile' }).nth(1).click();
    await page.getByRole('button', { name: 'Query provider' }).nth(1).click();
    await page.getByRole('button', { name: 'Manual complete' }).nth(1).click();
  });

  test('Providers: mark status, edit, retire; routing manual override @destructive', async ({ page }) => {
    destructive();
    await nav(page, 'Payment Providers');
    await page.getByRole('button', { name: 'Mark status' }).nth(1).click();
    await page.getByRole('button', { name: 'Apply now' }).click();
    await page.getByRole('button', { name: 'Edit' }).nth(1).click();
    await page.getByRole('button', { name: 'Submit for approval' }).click();
    await page.getByRole('button', { name: 'Retire' }).nth(3).click();
    await page.getByRole('button', { name: 'Retire' }).nth(3).click();
    await nav(page, 'Routing Policy');
    await page.getByRole('button', { name: 'Revert override' }).click();
    await page.getByRole('button', { name: 'Manual override' }).nth(2).click();
    await page.getByLabel('Reason (required)').fill('requested for test');
    await page.getByRole('button', { name: 'Override now' }).click();
  });
});
