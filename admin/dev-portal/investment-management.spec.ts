import { test, expect, Page } from '@playwright/test';
import { ROUTES, addEvidence, btn, closeModal, open, stateButton } from './support';

/** Investment Management — current UI: status dropdown, "View" per row, detail page with Admin actions. */
const STATUSES = ['Active', 'Pending funding', 'Under review', 'Unlocked', 'Matured', 'Rolled over', 'Closed', 'Liquidated', 'Cancelled', 'Draft'];

async function openFirstInvestment(page: Page, status?: string) {
  await open(page, ROUTES.investments);
  if (status) {
    await page.getByRole('combobox', { name: 'Status filter' }).selectOption(status);
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  }
  const view = btn(page, 'View').first();
  await view.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
  test.skip(!(await view.isVisible().catch(() => false)), `No investments in status ${status}`);
  await view.click();
  await expect(btn(page, 'Back to investments')).toBeVisible();
}

test.describe('Dev portal › Investment Management', () => {
  test('status filter: every status can be applied @smoke', async ({ page }) => {
    await open(page, ROUTES.investments);
    const filter = page.getByRole('combobox', { name: 'Status filter' });
    for (const s of STATUSES) {
      await filter.selectOption(s);
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
      await expect(filter).toHaveValue(/.+/);
    }
  });

  test('filter-by parameter and page size controls work @smoke', async ({ page }) => {
    await open(page, ROUTES.investments);
    for (const p of ['Product', 'User ID', 'Customer Email', 'Booking Date', 'Flagged', 'Status']) {
      await page.getByRole('combobox', { name: 'Filter by parameter' }).selectOption(p);
    }
    const next = btn(page, 'Next');
    if (await next.isEnabled().catch(() => false)) {
      await next.click();
      await btn(page, 'Previous').click();
    }
    await page.getByRole('combobox', { name: 'Show:' }).selectOption('50 per page');
  });

  test('search by customer name narrows the list @smoke', async ({ page }) => {
    await open(page, ROUTES.investments);
    await page.getByRole('textbox', { name: 'Search', exact: true }).fill('USMAN');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('link', { name: /USMAN AHMADU/ }).first()).toBeVisible();
  });

  test('plan detail: summary sections, audit trail and admin actions are shown @smoke', async ({ page }) => {
    await openFirstInvestment(page);
    // RTN is a one-off lump sum: no contribution plan and no top-up. RWIN and REAP have both.
    const lumpSum = await page.getByText(/\(RTN\)/).first().isVisible();
    for (const h of ['Summary', 'Customer', ...(lumpSum ? [] : ['Contribution plan']), 'Exit rules', 'What can happen next', 'Admin actions']) {
      await expect(page.getByRole('heading', { name: h, exact: true })).toBeVisible();
    }
    await expect(page.getByRole('heading', { name: /^Audit trail/ })).toBeVisible();
    for (const a of ['Withdraw on behalf', ...(lumpSum ? [] : ['Top up on behalf'])]) await expect(btn(page, a)).toBeVisible();
  });

  test('plan detail: audit trail filters and "Open in audit log" deep link @smoke', async ({ page }) => {
    await openFirstInvestment(page);
    await page.getByRole('combobox', { name: 'Module' }).selectOption({ label: 'Investment' });
    await page.getByRole('checkbox', { name: 'Flagged only' }).check();
    await page.getByRole('checkbox', { name: 'Flagged only' }).uncheck();
    await page.getByRole('link', { name: 'Open in audit log' }).click();
    await expect(page).toHaveURL(/#\/reporting\/audit/);
    await expect(page.getByRole('heading', { name: 'Audit log viewer' })).toBeVisible();
  });

  test('closed plan: audit entry "View details" opens and closes @smoke', async ({ page }) => {
    await openFirstInvestment(page, 'Closed');
    const details = btn(page, 'View details').first();
    test.skip(!(await details.isVisible().catch(() => false)), 'No audit entries on this plan');
    await details.click();
    await closeModal(page);
    await btn(page, 'Back to investments').click();
  });

  test('create RWIN on behalf: evidence and reason are mandatory, then booked @creates', async ({ page }) => {
    await open(page, ROUTES.investments);
    await btn(page, 'Create investment on behalf').click();
    await page.getByRole('textbox', { name: 'Customer', exact: true }).fill('rfs19');
    await page.getByRole('button').filter({ hasText: /USMAN AHMADU/ }).first().click();
    await page.getByRole('radio', { name: /RWIN 2\.0/ }).check();
    await page.getByRole('textbox', { name: 'Plan name' }).fill('Adebanjo Test');
    await page.getByRole('textbox', { name: /^Target amount/ }).fill('20000');
    const tenor = page.getByRole('combobox', { name: 'Tenor (days)' });
    await tenor.selectOption({ index: 1 });
    await page.getByRole('textbox', { name: /^Initial deposit/ }).fill('10000');
    await page.getByRole('checkbox', { name: 'Auto-rollover at maturity' }).check();
    await page.getByRole('checkbox', { name: 'Auto-rollover at maturity' }).uncheck();
    // NOTE: current UI asks for a 1-day minimum holding acknowledgement; RWIN 2.0 spec says 30 days (absolute).
    await page.getByRole('checkbox', { name: /minimum holding period/ }).check();
    await page.getByRole('radio', { name: /^Customer wallet/ }).check();
    await page.getByRole('checkbox', { name: 'Customer accepted the product terms' }).check();
    await page.getByRole('checkbox', { name: 'Flag prominently in the audit trail' }).check();

    await btn(page, 'Create investment').click();
    await expect(btn(page, 'Create investment')).toBeVisible(); // blocked: no evidence / reason

    await addEvidence(page, 'EMAIL', 'rfs19@yopmail.com');
    await page.getByRole('textbox', { name: 'Reason for acting on behalf' }).fill('The customer has requested it.');
    await btn(page, 'Create investment').click();
    await expect(page.getByRole('link', { name: 'View investment' }).or(page.getByText(/submitted|pending approval|created/i).first())).toBeVisible();
  });

  test('withdraw on behalf (part of balance) raises a request with evidence @creates', async ({ page }) => {
    await openFirstInvestment(page, 'Active');
    await btn(page, 'Withdraw on behalf').click();
    await expect(page.getByRole('heading', { name: /Withdraw on the customer.s behalf/ })).toBeVisible();
    await page.getByRole('radio', { name: /^Part of the balance/ }).check();
    const amount = page.getByRole('textbox', { name: /^Amount/ });
    if (await amount.isVisible().catch(() => false)) await amount.fill('30000');
    await addEvidence(page, 'EMAIL', "We're aware of this, thanks");
    await page.getByRole('textbox', { name: 'Reason for acting on behalf' }).fill('We received the request to test this today.');
    await page.getByRole('checkbox', { name: /^Flag this withdrawal prominently/ }).check();
    await btn(page, 'Raise withdrawal').click();
    await expect(btn(page, 'Raise withdrawal')).toBeHidden();
  });

  test('top up on behalf: evidence required, then raised; proposer withdraws it from the approval queue @creates', async ({ page }) => {
    await openFirstInvestment(page, 'Active');
    await btn(page, 'Top up on behalf').click();
    await page.getByRole('textbox', { name: /^Amount/ }).fill('40000');
    await page.getByRole('textbox', { name: 'Reason for acting on behalf' }).fill('Testing purpose');
    await page.getByRole('checkbox', { name: /^Flag this top-up prominently/ }).check();
    await btn(page, 'Raise top-up').click();
    await expect(btn(page, 'Raise top-up')).toBeVisible(); // blocked without evidence
    await addEvidence(page, 'SUPPORT_TICKET', '1234567890');
    await btn(page, 'Raise top-up').click();
    const done = btn(page, 'Done');
    if (await done.isVisible().catch(() => false)) await done.click();

    await open(page, ROUTES.approvalQueue);
    await btn(page, 'Raised by me').click();
    await page.getByRole('combobox', { name: 'Action:' }).selectOption({ label: 'Top-ups' });
    await stateButton(page, 'Pending approval').click();
    await btn(page, 'Inspect').first().click();
    await expect(page.getByRole('heading', { name: /Top-up on behalf review/ })).toBeVisible();
    await btn(page, 'Withdraw request').click();
  });
});
