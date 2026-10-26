import { test, expect } from '@playwright/test';
import { ROUTES, btn, clickStates, closeModal, destructive, exportCsv, open, stateButton } from './support';

/** Investment operations — approval queue, on-behalf request lists, alerts, carry-across, audit log, tax. */
test.describe('Dev portal › Investment operations', () => {
  test('Approval queue: state filters, scope toggle, action filter and export @smoke', async ({ page }) => {
    await open(page, ROUTES.approvalQueue);
    await clickStates(page, ['All', 'Pending approval', 'Approved', 'Rejected', 'Returned', 'Withdrawn']);
    await btn(page, 'Raised by me').click();
    await btn(page, 'All approvals').click();
    for (const a of ['Withdrawals', 'Top-ups', 'Book on behalf', 'Break requests', 'Admin unlock', 'Rollovers', 'All action types']) {
      await page.getByRole('combobox', { name: 'Action:' }).selectOption({ label: a });
    }
    await exportCsv(page);
  });

  test('Approval queue: inspect a pending item shows proposed changes @smoke', async ({ page }) => {
    await open(page, ROUTES.approvalQueue);
    await stateButton(page, 'All').click();
    const inspect = btn(page, 'Inspect').first();
    test.skip(!(await inspect.isVisible().catch(() => false)), 'Approval queue is empty');
    await inspect.click();
    await expect(page.getByRole('heading', { name: /TARGET STATE & PROPOSED CHANGES/i })).toBeVisible();
    await closeModal(page);
  });

  test('On-behalf requests: states, request detail with evidence, export @smoke', async ({ page }) => {
    await open(page, ROUTES.requests);
    await clickStates(page, ['All', 'Pending approval', 'Approved', 'Rejected', 'All']);
    await exportCsv(page);
    const view = btn(page, 'View').first();
    test.skip(!(await view.isVisible().catch(() => false)), 'No on-behalf requests');
    await view.click();
    await expect(page.getByRole('heading', { name: /^Request IRQ/ })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Evidence \(\d+\)$/ })).toBeVisible();
    await btn(page, 'Back to requests').click();
  });

  test('Break requests: states and export @smoke', async ({ page }) => {
    await open(page, ROUTES.breakRequests);
    await clickStates(page, ['All', 'Pending', 'Approved', 'Declined', 'Auto-closed']);
    await exportCsv(page);
  });

  for (const [name, route] of [
    ['On-behalf withdrawals', ROUTES.withdrawals], ['On-behalf top-ups', ROUTES.topUps],
    ['On-behalf rollovers', ROUTES.rollovers], ['Unlock requests', ROUTES.unlocks],
  ] as const) {
    test(`${name} list loads @smoke`, async ({ page }) => {
      await open(page, route);
      await expect(page.getByRole('heading', { name, exact: true }).last()).toBeVisible();
    });
  }

  test('System alerts: states, export and "View plan" navigation @smoke', async ({ page }) => {
    await open(page, ROUTES.systemAlerts);
    await clickStates(page, ['All', 'Open', 'Acknowledged', 'Resolved', 'All']);
    await exportCsv(page);
    const viewPlan = btn(page, 'View plan').first();
    test.skip(!(await viewPlan.isVisible().catch(() => false)), 'No alerts');
    await viewPlan.click();
    await expect(btn(page, 'Back to investments')).toBeVisible();
  });

  test('System alerts: acknowledge and resolve @destructive', async ({ page }) => {
    destructive();
    await open(page, ROUTES.systemAlerts);
    await btn(page, 'Acknowledge').first().click();
    await btn(page, 'Resolve').first().click();
  });

  test('Auto-rollover carry-across: dialog lists products, needs a reason, cancels @smoke', async ({ page }) => {
    await open(page, ROUTES.autoRollover);
    await clickStates(page, ['All', 'Pending', 'Applied', 'Rejected']);
    await btn(page, 'Carry a default across').click();
    await expect(page.getByRole('heading', { name: 'Carry the auto-rollover default across' })).toBeVisible();
    const product = page.getByRole('combobox', { name: 'Product' });
    await expect.poll(() => product.locator('option').count(), { timeout: 15_000 }).toBeGreaterThan(1);
    await product.selectOption({ index: 1 });
    await page.getByRole('textbox', { name: /^Reason/ }).fill('test test test');
    await btn(page, 'Cancel').click();
  });

  test('Statutory tax carry-across: states and export @smoke', async ({ page }) => {
    await open(page, ROUTES.statutoryTax);
    await clickStates(page, ['All', 'Pending', 'Applied', 'Rejected', 'Returned', 'Withdrawn']);
    await exportCsv(page);
  });

  test('Audit log: both tabs, quick views and module filter work @smoke', async ({ page }) => {
    await open(page, ROUTES.auditLog);
    await expect(page.getByRole('heading', { name: 'Audit log viewer' })).toBeVisible();
    for (const b of ['Flagged Only', 'Money Movements', 'All Events']) await btn(page, b).click();
    await page.getByRole('combobox', { name: 'Module filter' }).selectOption({ label: 'Investments' });
    await btn(page, 'Filter').click();
    await page.getByRole('combobox', { name: 'Module filter' }).selectOption({ label: 'All modules' });
    await page.getByRole('tab', { name: 'Investments' }).click();
    await expect(page.getByRole('tab', { name: 'Investments' })).toHaveAttribute('aria-selected', 'true');
  });

  test('Audit log: portal actions are recorded (append-only log is populated) and exportable @crit', async ({ page }) => {
    // Admin PRD: every action generates an audit entry; retention permanent. This suite itself performs
    // submit-for-approval and on-behalf actions, so the trailing-7-day log must not be empty.
    await open(page, ROUTES.auditLog);
    await expect(page.getByText('No system actions have been recorded yet.')).toBeHidden();
    await exportCsv(page);
  });

  test('Investment tax (WHT): rates in force listed; add-rate dialog cancels @smoke', async ({ page }) => {
    await open(page, ROUTES.investmentTax);
    await expect(page.getByRole('heading', { name: 'Rates in force' })).toBeVisible();
    await btn(page, 'Add rate').click();
    const rate = page.getByRole('spinbutton', { name: /^Rate/ }).or(page.getByRole('textbox', { name: /^Rate/ })).first();
    await rate.fill('7');
    await btn(page, 'Cancel').last().click();
  });
});
