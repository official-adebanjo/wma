import { test, expect, Page } from '@playwright/test';
import Decimal from 'decimal.js';
import * as loans from '../../shared/calc/loans';
import { D, formatNaira, parseNaira } from '../../shared/calc/money';
import { ROUTES, btn, closeModal, open } from './support';

/**
 * Loan interest engine — Model A vs Model B, against the live dev Admin Portal.
 * Source: LOAN PRODUCT SPECIFICATIONS.docx §4.2–§4.4 (Personal) — Product confirmed the same two
 * models apply to Public Sector loans.
 *
 *   Model A = "Monthly equal"    → admin "Repayment schedule: Monthly equal instalments"  → loan SCHEDULE MONTHLY_EQUAL
 *   Model B = "Monthly reducing" → admin "Repayment schedule: Monthly declining balance"  → loan SCHEDULE MONTHLY_DECLINING
 *   Nano / Payday are prorated daily (§2.2, §3.2)       → admin "Repayment schedule: Daily direct"
 *
 * Rate reading: the spec states the rate per MONTH (e.g. 2% monthly). The loan detail shows "INTEREST RATE x%";
 * expected values below treat x as the monthly rate, and failure messages also show the p.a. reading.
 */
const SCHEDULE_TO_MODEL: Record<string, loans.InterestModel> = { MONTHLY_EQUAL: 'A', MONTHLY_DECLINING: 'B' };
const MODEL_OPTION = { A: 'Monthly equal instalments', B: 'Monthly declining balance' } as const;

async function newLoanProductForm(page: Page, type: 'personal' | 'public-sector' | 'nano' | 'payday') {
  await open(page, ROUTES.products);
  await btn(page, 'Loan products').click();
  await btn(page, 'New loan product').click();
  await page.getByRole('combobox', { name: 'Loan product type' }).selectOption(type);
  await page.getByRole('textbox', { name: /^Loan name/ }).fill('model check');
  await btn(page, 'Continue').click();
  const schedule = page.getByRole('combobox', { name: 'Repayment schedule' });
  await expect.poll(() => schedule.locator('option').count(), { timeout: 15_000 }).toBeGreaterThan(1);
  return schedule;
}

interface LoanFacts {
  id: string;
  product: string;
  amount: Decimal;
  disbursed: Decimal;
  months: number;
  ratePct: Decimal;
  managementFee: Decimal;
  schedule: string;
}

async function loanFacts(page: Page, id: string): Promise<LoanFacts> {
  await open(page, `#/loan-management/applications/${id}`);
  await expect(page.getByText(`Application #${id}`)).toBeVisible();
  const body = await page.locator('body').innerText();
  const field = (label: string) => {
    const m = body.match(new RegExp(`\\n${label}\\n([^\\n]+)`));
    if (!m) throw new Error(`Field ${label} not found on loan #${id}`);
    return m[1].trim();
  };
  const money = (label: string) => (/\d/.test(field(label)) ? parseNaira(field(label)) : D(0)); // "—" = not set yet
  const durationText = field('DURATION');
  const rateText = field('INTEREST RATE');
  return {
    id,
    product: field('PRODUCT'),
    amount: money('AMOUNT'),
    disbursed: money('DISBURSED'),
    months: /month/i.test(durationText) ? parseInt(durationText, 10) : NaN,
    ratePct: /\d/.test(rateText) ? D(rateText.replace('%', '')) : D(0),
    managementFee: money('MANAGEMENT FEE'),
    schedule: field('SCHEDULE'),
  };
}

/** Loans on the repayments page that have at least one repayment recorded: [{ id }]. */
async function loansWithRepayments(page: Page): Promise<string[]> {
  await open(page, ROUTES.loanRepayments);
  const rows = page.locator('tr').filter({ has: page.getByRole('button', { name: 'Repayments', exact: true }) });
  const ids: string[] = [];
  for (let i = 0; i < (await rows.count()); i++) {
    const cells = await rows.nth(i).getByRole('cell').allInnerTexts();
    const repaid = cells[3]?.trim() ?? '—';
    const id = cells.find((c) => /^#\d+$/.test(c.trim()))?.trim().slice(1);
    if (id && repaid !== '—') ids.push(id);
  }
  return ids;
}

async function repaymentAmounts(page: Page, id: string): Promise<Decimal[]> {
  await open(page, ROUTES.loanRepayments);
  await page.locator('tr', { has: page.getByRole('cell', { name: `#${id}`, exact: true }) }).getByRole('button', { name: 'Repayments' }).click();
  await expect(page.getByRole('heading', { name: new RegExp(`Loan #${id}$`) })).toBeVisible();
  await expect(page.getByText(/repayments?, ₦[\d,.]+ in total\.|No repayments recorded/)).toBeVisible({ timeout: 15_000 });
  // Drawer text: "Repayments — NAME · Loan #id" … one "date<TAB>amount<TAB>channel" line per repayment … "N repayments, ₦X in total."
  const body = await page.locator('body').innerText();
  const start = body.indexOf(`Loan #${id}`);
  const end = body.indexOf('in total.', start);
  const amounts = body
    .slice(start, end > 0 ? end : undefined)
    .split('\n')
    .filter((l) => /\d{4}, \d{1,2}:\d{2}/.test(l) && l.includes('₦'))
    .map((l) => parseNaira(l.split('\t').find((c) => c.includes('₦'))!))
    .reverse(); // drawer lists newest first → oldest first = instalment 1, 2, 3 …
  await closeModal(page);
  return amounts;
}

test.describe('Dev portal › Loan interest engine — Model A (monthly equal) vs Model B (monthly reducing)', () => {
  for (const type of ['personal', 'public-sector'] as const) {
    test(`${type}: product form offers Model A and Model B; default is Model A; both selectable @smoke`, async ({ page }) => {
      const schedule = await newLoanProductForm(page, type);
      const options = await schedule.locator('option').allInnerTexts();
      expect(options).toEqual(expect.arrayContaining([MODEL_OPTION.A, MODEL_OPTION.B]));
      await expect(schedule.locator('option:checked')).toHaveText(MODEL_OPTION.A);
      for (const m of ['B', 'A'] as const) {
        await schedule.selectOption({ label: MODEL_OPTION[m] });
        await expect(schedule.locator('option:checked')).toHaveText(MODEL_OPTION[m]);
      }
      await btn(page, 'Cancel').first().click();
    });
  }

  for (const type of ['nano', 'payday'] as const) {
    test(`${type}: product form defaults to Daily direct (prorated daily interest, LoanSpec §${type === 'nano' ? '2.2' : '3.2'}) @smoke`, async ({ page }) => {
      const schedule = await newLoanProductForm(page, type);
      await expect(schedule.locator('option:checked')).toHaveText('Daily direct');
      await btn(page, 'Cancel').first().click();
    });
  }

  test('live Personal / Public Sector loans carry Model A or Model B as their schedule @smoke', async ({ page }) => {
    await open(page, ROUTES.loanApplications);
    await page.getByRole('combobox', { name: 'Show:' }).selectOption('50 per page');
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await expect(btn(page, 'View').first()).toBeVisible({ timeout: 15_000 });
    const rows = page.locator('tr').filter({ hasText: /Personal|Public Sector|public-sector/i });
    const ids = (await rows.evaluateAll((trs) => trs.map((tr) => tr.querySelectorAll('td')[1]?.textContent?.trim() ?? ''))).filter((s) => /^\d+$/.test(s)).slice(0, 6);
    test.skip(ids.length === 0, 'No Personal / Public Sector loans in the first page of applications');
    for (const id of ids) {
      const f = await loanFacts(page, id);
      expect.soft(Object.keys(SCHEDULE_TO_MODEL), `loan #${id} (${f.product}) schedule "${f.schedule}"`).toContain(f.schedule);
    }
  });

  test('posted repayments match the configured model\'s instalments (LoanSpec §4.2–§4.3) @crit', async ({ page }, info) => {
    const ids = await loansWithRepayments(page);
    let checked = 0;
    let compared = 0;
    for (const id of ids.slice(0, 5)) {
      const f = await loanFacts(page, id);
      const model = SCHEDULE_TO_MODEL[f.schedule];
      if (!model || !Number.isFinite(f.months)) continue;
      checked++;
      const expected = loans.loanSchedule(f.amount, f.ratePct, f.months, model);
      const ifAnnual = loans.loanSchedule(f.amount, loans.monthlyFromAnnual(f.ratePct), f.months, model);
      const paid = await repaymentAmounts(page, id);
      info.annotations.push({
        type: 'compared',
        description: `#${id} ${f.product} Model ${model}: paid [${paid.map((p) => formatNaira(p)).join(', ')}] vs expected instalment 1 ${formatNaira(expected[0].totalDue)}`,
      });
      paid.forEach((amt, i) => {
        if (i >= expected.length) return;
        compared++;
        expect.soft(
          amt.toFixed(2),
          `Loan #${id} ${f.product} · Model ${model} (${loans.MODEL_LABEL[model]}) · ${formatNaira(f.amount)} @ ${f.ratePct}% × ${f.months}m — ` +
            `instalment ${i + 1}: expected ${formatNaira(expected[i].totalDue)} with ${f.ratePct}%/month ` +
            `(${formatNaira(ifAnnual[i].totalDue)} if ${f.ratePct}% p.a.)`,
        ).toBe(expected[i].totalDue.toFixed(2));
      });
    }
    test.skip(checked === 0, 'No Model A/B loan with posted repayments yet');
    expect(compared, 'at least one posted repayment was compared').toBeGreaterThan(0);
  });

  test('disbursed amount = amount − stated management fee (no undisclosed deductions) @crit', async ({ page }) => {
    const ids = await loansWithRepayments(page);
    test.skip(ids.length === 0, 'No disbursed loans with repayments');
    for (const id of ids.slice(0, 5)) {
      const f = await loanFacts(page, id);
      expect.soft(
        f.disbursed.toFixed(2),
        `Loan #${id} ${f.product}: amount ${formatNaira(f.amount)}, management fee ${formatNaira(f.managementFee)}, disbursed ${formatNaira(f.disbursed)}`,
      ).toBe(f.amount.minus(f.managementFee).toFixed(2));
    }
  });
});
