import { expect } from '@wdio/globals';
import Decimal from 'decimal.js';
import { LOAN_BOUNDS } from '../../../shared/calc/loans';
import { parseNaira } from '../../../shared/calc/money';
import { Tag, title } from '../../../shared/support/tags';
import { hasPersona, loginAs, openTab, personaCreds } from '../../helpers/session';
import { resetApp } from '../../screens/common/AuthScreens';
import { BorrowHomeScreen, GrowHomeScreen, LoanTile, TabBar } from '../../screens/common/HomeScreens';
import { borrowState } from '../../screens/common/JourneyScreens';
import { WalletScreen } from '../../screens/common/WalletScreens';

/**
 * Home, Grow and Borrow tabs on the live dev build, signed in as the Tier 3 persona.
 * Read-only: nothing is booked, applied for or moved. Selectors: mobile/screens/live-ids.ts.
 */
describe('Navigation › Home, Grow and Borrow tabs (Tier 3 persona)', () => {
  const home = new WalletScreen();
  const grow = new GrowHomeScreen();
  const borrow = new BorrowHomeScreen();

  before(async function () {
    if (!hasPersona('T3', 'email')) this.skip();
    await resetApp();
    await loginAs(personaCreds('T3', 'email'));
  });

  describe('Home', () => {
    before(async () => { await openTab('home'); await home.waitForShown(); });

    it(title('greets the signed-in customer by name', Tag.high, Tag.smoke), async () => {
      await expect(await home.greeting()).toMatch(/^Good (morning|afternoon|evening)/);
      await expect((await home.customerName()).length).toBeGreaterThan(2);
    });

    it(title('total balance is a naira amount', Tag.crit, Tag.smoke), async () => {
      const bal = await home.balance();
      await expect(bal.gte(0)).toBe(true);
      await expect(bal.decimalPlaces()).toBeLessThanOrEqual(2);
    });

    it(title('earned-from-investments line is a naira amount', Tag.med), async () => {
      await expect(await home.earnedText()).toMatch(/^\+?₦[\d,]+\.\d{2} earned from investments$/);
    });

    it(title('quick actions Send, Fund, Bills and Invest are offered', Tag.high), async () => {
      for (const a of ['transfer', 'fund', 'bills', 'invest'] as const) {
        await expect(await home.quickActionShown(a)).toBe(true);
      }
    });

    it(title('Tier 3 customer has no identity steps left', Tag.high, Tag.spec('KYCV4§1'), Tag.open('TIER-PROGRESS')), async () => {
      // Live 2026-10-29: the T3 persona shows "2/3 … 1 key identity steps left". Either the persona
      // isn't really Tier 3 in this environment, or the progress card doesn't follow the tier.
      const p = await home.kycProgress();
      if (p) await expect(p.done).toBe(p.total);
    });
  });

  describe('Grow', () => {
    before(async () => { await openTab('grow'); await grow.waitForShown(); });

    it(title('lists RWIN, REAP and RTN with a per-annum rate', Tag.high, Tag.smoke, Tag.spec('CalculatorSpec')), async () => {
      for (const p of ['rwin', 'reap', 'rtn'] as const) {
        await expect(await grow.tileShown(p)).toBe(true);
        const rate = (await grow.tileMetric(p)).match(/^([\d.]+)% p\.a\.$/);
        await expect(rate).not.toBeNull();
        await expect(Number(rate![1])).toBeGreaterThan(0);
      }
    });

    it(title('total working capital equals the sum of active plans', Tag.crit, Tag.spec('CalculatorSpec')), async function () {
      const total = await grow.totalCapital();
      const count = await grow.activePlanCount();
      const plans = await grow.activePlansAtEnd();
      // Identical rows can't be told apart across scroll positions — only judge a complete list.
      if (plans.length !== count) this.skip();
      const sum = plans.reduce((s, p) => s.plus(p.amount), new Decimal(0));
      await expect(sum.toFixed(2)).toBe(total.toFixed(2));
    });

    it(title('each active plan shows a positive amount, product code and payout countdown', Tag.med), async () => {
      const count = await grow.activePlanCount();
      const plans = await grow.activePlansAtEnd();
      if (count > 0) await expect(plans.length).toBeGreaterThan(0);
      for (const p of plans) {
        await expect(p.amount.gt(0)).toBe(true);
        await expect(p.productCode).toMatch(/^(RWIN|REAP|RTN)/);
        if (p.nextPayoutDays !== null) await expect(p.nextPayoutDays).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('Borrow', () => {
    before(async function () {
      await openTab('borrow');
      await borrow.waitForShown();
      // While the persona holds a loan (one at a time), Borrow shows that loan instead of the products.
      if ((await borrowState()) !== 'products') this.skip();
    });

    it(title('offers Nano, Payday, Personal and Public Sector loans', Tag.high, Tag.smoke, Tag.spec('LoanSpec')), async () => {
      for (const t of ['payday', 'nano', 'personal', 'publicSector'] as LoanTile[]) {
        await expect(await borrow.tileShown(t)).toBe(true);
      }
    });

    it(title('groups loans into Fast Cash and Long-term', Tag.low), async () => {
      await openTab('home');
      await openTab('borrow');
      await expect(await borrow.groupShown('fastCash')).toBe(true);
      await expect(await borrow.tileShown('personal')).toBe(true);
      await expect(await borrow.groupShown('longTerm')).toBe(true);
    });

    it(title('recommended offer stays within the product limits', Tag.crit, Tag.spec('LoanSpec')), async function () {
      await openTab('home');
      await openTab('borrow');
      if (!(await borrow.recommendedShown())) this.skip();
      // e.g. "Get ₦5,000,000 instantly" / "Adebanjo Payday • 30 days • No paperwork"
      const amount = parseNaira((await borrow.recommendedTitle()).match(/₦[\d,.]+/)![0]);
      const sub = await borrow.recommendedSubtitle();
      const type = /payday/i.test(sub) ? 'PAYDAY' : /nano/i.test(sub) ? 'NANO' : /personal|public/i.test(sub) ? 'PERSONAL' : null;
      if (!type) this.skip();
      await expect(amount.toNumber()).toBeLessThanOrEqual(LOAN_BOUNDS[type!].maxAmount);
      const days = sub.match(/(\d+)\s*days/i);
      if (days && 'maxDays' in LOAN_BOUNDS[type!]) {
        await expect(Number(days[1])).toBeLessThanOrEqual((LOAN_BOUNDS[type!] as { maxDays: number }).maxDays);
      }
    });
  });

  it(title('bottom tabs switch between Home, Grow and Borrow', Tag.high, Tag.smoke), async () => {
    await new TabBar().waitForShown();
    await openTab('grow');
    await grow.waitForShown();
    await openTab('borrow');
    await borrow.waitForShown();
    await openTab('home');
    await home.waitForShown();
  });
});
