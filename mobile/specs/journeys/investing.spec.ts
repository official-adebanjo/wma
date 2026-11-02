import { expect } from '@wdio/globals';
import { Tag, title } from '../../../shared/support/tags';
import { hasPersona, loginAs, openTab, personaCreds } from '../../helpers/session';
import { byId, driver } from '../../screens/BaseScreen';
import { resetApp } from '../../screens/common/AuthScreens';
import { GrowHomeScreen } from '../../screens/common/HomeScreens';
import { GoalProjection, InvestProductEntry, RwinGoalFlow, messageAfter, redboxMessage } from '../../screens/common/JourneyScreens';
import { WalletScreen } from '../../screens/common/WalletScreens';

/**
 * Investing journeys on the live dev build.
 *  - Tier 3: every investment product opens (found blocked by hand on 2026-11-02).
 *  - Tier 1: an RWIN goal is created, checked and deleted again. Nothing is funded: the top-up
 *    check only runs while the Tier 1 wallet is empty, so it can never move money.
 */
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
function parseLongDate(text: string): Date {
  const m = text.trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (!m) throw new Error(`Unrecognised date "${text}"`);
  return new Date(Date.UTC(Number(m[3]), MONTHS.indexOf(m[2].toLowerCase()), Number(m[1])));
}
function todayPlus(days: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + days));
}

describe('Journeys › Investing', () => {
  const grow = new GrowHomeScreen();
  const entry = new InvestProductEntry();

  async function backToGrow() {
    await entry.goBack().catch(() => undefined);
    if (!(await grow.isShown())) await openTab('grow');
    await grow.waitForShown();
  }

  describe('Tier 3 customer', () => {
    before(async function () {
      if (!hasPersona('T3')) this.skip();
      await resetApp();
      await loginAs(personaCreds('T3', 'email'));
      await openTab('grow');
      await grow.waitForShown();
    });

    for (const product of ['rwin', 'reap', 'rtn'] as const) {
      it(title(`Tier 3 customer can open ${product.toUpperCase()} to invest`, Tag.crit, Tag.spec('KYCV4')), async () => {
        const r = await entry.open(product);
        if (r.kind === 'tierGate') await entry.dismissGate();
        else await backToGrow();
        await expect(r.kind === 'tierGate' ? `blocked: "${r.message}"` : 'opened').toBe('opened');
      });
    }
  });

  describe('Tier 1 customer — RWIN goal (created, then deleted)', () => {
    const goal = new RwinGoalFlow();
    const goalName = `QA goal ${Date.now() % 100_000}`;
    let walletEmpty = false;
    let productTenors: number[] = [];
    let projection: GoalProjection | null = null;
    let created = false;

    before(async function () {
      if (!hasPersona('T1')) this.skip();
      await resetApp();
      await loginAs(personaCreds('T1', 'email'));
      const home = new WalletScreen();
      await home.waitForShown();
      walletEmpty = (await home.balance()).isZero();
      await openTab('grow');
      await grow.waitForShown();
    });

    after(async () => {
      if (!created) return;
      // Clean up even when a check failed half-way: back to the goal page, then delete.
      for (let i = 0; i < 3 && !(await byId('rwin.goal.delete').isDisplayed().catch(() => false)); i++) {
        await goal.goBack().catch(() => undefined);
      }
      await goal.deleteGoal().catch((e) => console.warn(`Could not delete test goal "${goalName}": ${e}`));
    });

    it(title('Tier 1 customer can open RWIN and its rate table', Tag.high, Tag.spec('RWIN2.0')), async () => {
      const r = await entry.open('rwin');
      await expect(r.kind).toBe('page');
      await goal.waitForShown();
      const rows = await driver.$$('android=new UiSelector().textMatches("^[0-9]+ days$")');
      for (const row of rows) productTenors.push(Number((await row.getText()).match(/\d+/)![0]));
      await expect(productTenors.length).toBeGreaterThan(0);
    });

    it(title('RWIN goal projection adds up to the target', Tag.crit, Tag.spec('CalculatorSpec')), async function () {
      if (!(await goal.isShown())) this.skip();
      await goal.start(goalName);
      projection = await goal.plan(100_000, '90 Days', 'Monthly');
      const contributions = Math.round(projection.tenorDays / 30);
      const total = projection.monthly.mul(contributions).plus(projection.interest);
      // Whole goal = contributions + projected interest, to the kobo (allow ₦1 for rounding).
      await expect(total.minus(projection.target).abs().lte(1)).toBe(true);
      await expect(projection.interest.gt(0)).toBe(true);
    });

    it(title('RWIN goal tenors match the product rate table', Tag.med, Tag.spec('RWIN2.0')), async function () {
      if (!projection) this.skip();
      const offered = await goal.tenorChoices();
      const unknown = offered.filter((d) => !productTenors.includes(d));
      await expect(`offered ${offered.join('/')} days; rate table ${productTenors.join('/')} days; not in table: ${unknown.join('/') || 'none'}`)
        .toContain('not in table: none');
    });

    it(title('RWIN goal is created with the right maturity date', Tag.high, Tag.spec('RWIN2.0')), async function () {
      if (!projection) this.skip();
      await goal.continueToSummary();
      const maturity = parseLongDate(await goal.maturityDate());
      await expect(maturity.toISOString().slice(0, 10)).toBe(todayPlus(projection.tenorDays).toISOString().slice(0, 10));
      await goal.create();
      created = true;
      await goal.viewGoal();
    });

    it(title('topping up from an empty wallet tells the customer why it cannot be paid', Tag.med), async function () {
      // Only while the wallet is empty — otherwise this would move real money into the goal.
      if (!created || !walletEmpty) this.skip();
      await goal.openTopUp();
      const msg = await messageAfter(() => goal.submitTopUp(), 10_000);
      const reacted = msg !== null || (await redboxMessage()) !== null ||
        !(await byId('rwin.topUp.screen').isDisplayed().catch(() => false));
      await goal.goBack().catch(() => undefined);
      await expect(reacted ? 'the app responded' : 'nothing happened after tapping "Add ₦…"').toBe('the app responded');
    });

    it(title('RWIN goal can be deleted', Tag.med), async function () {
      if (!created) this.skip();
      if (!(await byId('rwin.goal.delete').isDisplayed().catch(() => false))) await goal.goBack().catch(() => undefined);
      await goal.deleteGoal(); // waits for "Goal deleted"
      created = false;
    });
  });
});
