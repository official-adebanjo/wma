import { expect } from '@wdio/globals';
import Decimal from 'decimal.js';
import { loanSchedule } from '../../../shared/calc/loans';
import { parseNaira } from '../../../shared/calc/money';
import { Tag, title } from '../../../shared/support/tags';
import { pushTestPdf } from '../../helpers/files';
import { hasPersona, loginAs, openTab, personaCreds } from '../../helpers/session';
import { byId, driver } from '../../screens/BaseScreen';
import { resetApp } from '../../screens/common/AuthScreens';
import { BorrowHomeScreen } from '../../screens/common/HomeScreens';
import { LoanApplication, borrowState, readAmount, readValue } from '../../screens/common/JourneyScreens';

/**
 * Borrowing journeys on the live dev build.
 *  - Tier 1: the short-term loan screens open (Nano and Payday crashed on 2026-11-02).
 *  - Tier 3: whichever stage its loan is at — a new application's quote, an offer, or an active loan —
 *    is checked against the "Monthly equal" / "Monthly reducing" rules (shared/calc/loans.ts).
 * A customer can hold one loan at a time, so the Tier 3 stage changes as loans move on.
 * The application is only submitted with MOBILE_ALLOW_LOAN_APPLY=1 (it creates a real application).
 */
const allowApply = process.env.MOBILE_ALLOW_LOAN_APPLY === '1';

describe('Journeys › Borrowing', () => {
  const borrow = new BorrowHomeScreen();
  const apply = new LoanApplication();

  describe('Tier 1 customer — short-term loans', () => {
    before(async function () {
      if (!hasPersona('T1')) this.skip();
      await resetApp();
      await loginAs(personaCreds('T1', 'email'));
    });

    for (const product of ['nano', 'payday'] as const) {
      it(title(`${product === 'nano' ? 'Nano' : 'Payday'} loan application opens without crashing`, Tag.crit, Tag.spec('LoanSpec')), async function () {
        await openTab('borrow');
        if ((await borrowState()) !== 'products') this.skip();
        if (!(await borrow.tileShown(product))) this.skip();
        await borrow.openTile(product);
        const r = await apply.openedOrCrash().catch(async () =>
          ((await byId('grow.tierGate').isDisplayed().catch(() => false)) ? 'gated' as const : Promise.reject(new Error('Loan amount screen did not open'))));
        if (r === 'gated') this.skip(); // not offered at this tier
        if (!r.opened) {
          // The red error screen leaves a blank app behind — start clean for the next check.
          await resetApp();
          await loginAs(personaCreds('T1', 'email'));
        } else {
          await apply.goBack().catch(() => undefined);
        }
        await expect(r.opened ? 'opened' : `crashed: ${r.error}`).toBe('opened');
      });
    }
  });

  describe('Tier 3 customer — Personal loan', () => {
    before(async function () {
      if (!hasPersona('T3')) this.skip();
      await resetApp();
      await loginAs(personaCreds('T3', 'email'));
      await openTab('borrow');
    });

    // A check that stops part-way (e.g. on the review screen) must not leave the next one without the tab bar.
    afterEach(async () => {
      for (let i = 0; i < 5 && !(await byId('home.tabbar').isDisplayed().catch(() => false)); i++) {
        await driver.back();
        await driver.pause(1000);
      }
    });

    it(title('Personal loan quote: the schedule follows the interest rule and adds up to the total', Tag.crit, Tag.spec('LoanSpec§4.2')), async function () {
      if ((await borrowState()) !== 'products') this.skip(); // a loan is already in progress
      await borrow.tileShown('personal');
      await borrow.openTile('personal');
      await expect((await apply.openedOrCrash()).opened).toBe(true);
      await apply.choose('₦100,000', '3 months');
      if (await byId('loan.docs.screen').waitForDisplayed({ timeout: 10_000 }).then(() => true, () => false)) {
        await apply.uploadAll(await pushTestPdf());
        await apply.submitDocuments();
      }
      const ratePct = new Decimal((await apply.interestRateText()).match(/([\d.]+)%/)![1]);
      const total = await apply.totalRepayable();
      const lines = await apply.schedule();
      await apply.closeSheet();
      const expectedA = loanSchedule(100_000, ratePct, 3, 'A').map((r) => r.totalDue);
      const expectedB = loanSchedule(100_000, ratePct, 3, 'B').map((r) => r.totalDue);
      const near = (a: Decimal[], b: Decimal[]) => a.length === b.length && a.every((x, i) => x.minus(b[i]).abs().lte(1)); // naira rounding
      const amounts = lines.map((l) => l.amount);
      const sum = amounts.reduce((a, b) => a.plus(b), new Decimal(0));

      if (allowApply) await apply.submit();
      else await apply.goBack().catch(() => undefined);

      await expect(near(amounts, expectedA) || near(amounts, expectedB)).toBe(true);
      await expect(sum.toFixed(2)).toBe(total.toFixed(2)); // the schedule must add up to "Total Repayable"
    });

    it(title('Loan offer shows the same terms as the application', Tag.crit, Tag.spec('LoanSpec§4.2')), async function () {
      await openTab('borrow');
      if ((await borrowState()) !== 'offer') this.skip(); // only while an approved offer awaits acceptance
      const amount = await readAmount('Pre-Approved Amount');
      const tenor = await readValue('Tenor'); // "180 days" on older builds, "9 months" since 4 November
      const n = Number(tenor.match(/\d+/)![0]);
      const months = /month/i.test(tenor) ? n : Math.max(1, Math.round(n / 30));
      const ratePct = new Decimal((await driver.$('//android.widget.TextView[starts-with(@text,"Interest Fee")]').getText()).match(/([\d.]+)%/)![1]);
      const repay = await readAmount('Repayment Amount');
      const totals = (['A', 'B'] as const).map((m) => loanSchedule(amount, ratePct, months, m).reduce((a, r) => a.plus(r.totalDue), new Decimal(0)));
      const ok = totals.some((t) => t.minus(repay).abs().lte(months));
      await expect(ok ? 'matches' : `offer asks ₦${repay.toFixed(2)}; Monthly equal ₦${totals[0].toFixed(2)}, Monthly reducing ₦${totals[1].toFixed(2)}`).toBe('matches');
    });

    it(title('Active loan: next payment countdown is within a month', Tag.high, Tag.spec('LoanSpec§4.2')), async function () {
      await openTab('borrow');
      if ((await borrowState()) !== 'active') this.skip(); // only while a monthly loan is being repaid
      const text = await byId('loan.dashboard.nextDue').getText(); // "Next payment due in 90 days"
      const outstanding = parseNaira(await driver.$('//android.widget.TextView[@text="TOTAL OUTSTANDING"]/following-sibling::android.widget.TextView[1]').getText());
      await expect(outstanding.gt(0)).toBe(true);
      await expect(Number(text.match(/(\d+)/)![1])).toBeLessThanOrEqual(31); // monthly repayments
    });
  });
});
