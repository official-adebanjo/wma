import { test, expect } from '@playwright/test';
import { addEvidence, clickStates, exportCsv, firstRowButton, home, nav } from './support';

/** Recorded on the dev Admin Portal — Investment Management portfolio + create / withdraw / top-up on behalf. */
test.describe('Dev portal › Investment Management', () => {
  test.beforeEach(async ({ page }) => {
    await home(page);
    await nav(page, 'Investment Management', { group: 'Investment Management' });
  });

  test('portfolio state rail: every state filters the table @smoke', async ({ page }) => {
    await clickStates(page, ['Active', 'Maturing', 'Pending funding', 'Under review', 'Unlocked', 'Matured', 'Rolled over', 'Closed', 'All']);
  });

  test('closed plan detail: view details and return @smoke', async ({ page }) => {
    await page.getByRole('button', { name: 'Closed', exact: true }).click();
    await firstRowButton(page).click();
    await page.getByRole('button', { name: 'View details' }).first().click();
    await page.getByText('Close', { exact: true }).click();
    await page.getByRole('button', { name: 'Back to investments' }).click();
  });

  test('filter by product REAP and open the booking timeline @smoke', async ({ page }) => {
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await page.getByRole('main').locator('svg').first().click();
    await page.getByRole('option', { name: 'Savings REAP' }).click();
    await firstRowButton(page).click();
    await page.locator('li').filter({ hasText: /^Booked/ }).getByRole('button').first().click();
    await page.getByText('Close', { exact: true }).click();
    await page.getByRole('button', { name: 'Back to investments' }).click();
  });

  test('sort by status and export CSV @smoke', async ({ page }) => {
    await page.getByRole('cell', { name: 'Status↕' }).click();
    await exportCsv(page);
  });

  test('investment audit trail opens in the audit log @smoke', async ({ page }) => {
    await page.goto('/#/reporting/audit?tab=investments');
    await page.getByRole('tab', { name: 'Portal activity' }).click();
    await firstRowButton(page).click();
    await page.getByText('Close', { exact: true }).click();
  });

  test('create RWIN on behalf → withdraw part → top up → withdraw own top-up request @creates', async ({ page }) => {
    await test.step('create investment on behalf (validation, then success)', async () => {
      await page.getByRole('button', { name: 'Create investment on behalf' }).click();
      await page.getByPlaceholder('Search by name, customer id,').fill('rfs19');
      await page.getByRole('button', { name: /USMAN AHMADU 240435/ }).click();
      await page.locator('label').filter({ hasText: /rwin-2\.0/i }).click();
      await page.getByPlaceholder('e.g. Rolling reserve').fill('Adebanjo Test');
      await page.getByLabel('Target amount₦The goal this').fill('20000');
      await page.getByLabel('Tenor (days)*Select a tenor60').selectOption('60');
      await page.getByLabel('Initial deposit₦₦10,000 to ₦').fill('10000');
      await page.getByLabel('Auto-rollover at maturity').check();
      await page.getByLabel('Auto-rollover at maturity').uncheck();
      await page.getByLabel('Tenor (days)*Select a tenor60').selectOption('90');
      await page.getByText('Auto-debit the monthly').click();
      await page.getByText('Customer acknowledges the 1-').click();
      await page.getByRole('button', { name: /Show schedule/ }).click();
      await page.getByRole('button', { name: /Hide schedule/ }).click();
      await addEvidence(page, 'EMAIL', 'rfs19@yopmail.com');
      await page.getByText('Customer accepted the product').click();
      await page.getByText('Flag prominently in the audit').click();
      await page.getByRole('button', { name: 'Create investment', exact: true }).click();
      // Reason for acting on behalf is mandatory
      await expect(page.getByPlaceholder('Why the customer cannot self-')).toBeVisible();
      await page.getByPlaceholder('Why the customer cannot self-').fill('The customer have requested for it.');
      await page.getByRole('button', { name: 'Create investment', exact: true }).click();
      await page.getByRole('link', { name: 'View investment' }).click();
      await page.getByRole('button', { name: 'Refresh' }).click();
    });

    await test.step('withdraw part of the balance on behalf (waiver + compliance ref)', async () => {
      await page.getByRole('button', { name: 'Withdraw on behalf' }).click();
      await page.getByLabel('Part of the balanceAt least ₦').check();
      await page.getByLabel('Amount₦').fill('30000');
      await page.getByPlaceholder('Reference — ticket number,').fill("We're aware of this, thanks");
      await page.getByRole('button', { name: 'Add' }).click();
      await page.getByPlaceholder('Why the customer cannot self-').fill('We received the request to test this today.');
      await page.getByLabel('Waive the early-exit').check();
      await page.getByPlaceholder('CMP-2026-').fill('CMP-2026-18');
      await page.getByText('Flag this withdrawal').click();
      await page.getByRole('button', { name: 'Raise withdrawal' }).click();
      await page.getByLabel('Close', { exact: true }).click();
    });

    await test.step('top up on behalf: evidence required, then raised', async () => {
      await page.getByRole('button', { name: 'Top up on behalf' }).click();
      await page.getByLabel('Amount₦Debited directly from').fill('40000');
      await page.getByPlaceholder('Why the customer cannot self-').fill('Testing purpose');
      await page.getByText('Flag this top-up prominently').click();
      await page.getByRole('button', { name: 'Raise top-up' }).click();
      await expect(page.getByRole('button', { name: 'Raise top-up' })).toBeVisible(); // blocked without evidence
      await addEvidence(page, 'SUPPORT_TICKET', '1234567890');
      await page.getByRole('button', { name: 'Raise top-up' }).click();
      await page.getByRole('button', { name: 'Done' }).click();
    });

    await test.step('approval queue: proposer withdraws the top-up request', async () => {
      await nav(page, 'Approval queue');
      await page.getByRole('row').filter({ hasText: 'Top-up' }).first().getByRole('button').click();
      await page.getByRole('button', { name: 'Withdraw request' }).click();
      await page.getByText('Close').click();
    });
  });
});
