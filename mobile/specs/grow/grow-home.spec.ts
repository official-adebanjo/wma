import { expect } from '@wdio/globals';
import { formatNaira } from '../../../shared/calc/money';
import * as rtn from '../../../shared/calc/rtn';
import { canBookInvestment } from '../../../shared/calc/tier';
import { Tag, title } from '../../../shared/support/tags';
import { QaHooks } from '../../../shared/api/qa-hooks';
import { freshCustomer, openTab, requireHooks } from '../../helpers/session';
import { REAP_RATES, RTN_MATRIX, escapeRe, rtnConfigPatch } from '../../helpers/investment-fixtures';
import { GrowHomeScreen, SearchScreen } from '../../screens/common/HomeScreens';
import { ReapLandingScreen } from '../../screens/reap/ReapScreens';
import { RtnLandingScreen } from '../../screens/rtn/RtnScreens';
import { RwinLandingScreen } from '../../screens/rwin/RwinScreens';

type Product = 'reap' | 'rwin' | 'rtn';
const PRODUCTS: Product[] = ['reap', 'rwin', 'rtn'];

/** Grow-home elements not (yet) on the shared GrowHomeScreen: search entry, tile one-liner and tier-gate messaging. */
class GrowHome extends GrowHomeScreen {
  tileShown(p: Product) { return this.exists(`grow.home.tile.${p}`); }
  tileOneLiner(p: Product) { return this.text(`grow.home.tile.${p}.oneLiner`); }
  tileGateShown(p: Product) { return this.exists(`grow.home.tile.${p}.gate`, 1_500); }
  tileGateText(p: Product) { return this.text(`grow.home.tile.${p}.gate`); }
  bannerText() { return this.text('grow.home.banner'); }
  openSearch() { return this.tap('grow.home.search'); }
}

/**
 * Grow tab — product tiles (REAP / RWIN 2.0 / RTN), discovery banner, search entry and tier gating
 * (REAP §2, RWIN 2.0 §2, RTN §1–§2; Calculator Spec §2; Account Tiering & KYC Spec V4 §1).
 *
 * @open:CALC-TIER — Calculator Spec §2 gates every investment at Tier 2; RTN spec §1 allows individual RTN at Tier 1.
 */
describe('Grow › Home', () => {
  let hooks: QaHooks;
  let customerId: string;

  const grow = new GrowHome();
  const landings = { reap: new ReapLandingScreen(), rwin: new RwinLandingScreen(), rtn: new RtnLandingScreen() };

  async function start(tier: 1 | 2 | 3 = 2) {
    ({ hooks, customerId } = await freshCustomer({ tier, walletBalance: 1_000_000 }));
    await hooks.setProductConfig({ product: 'REAP', patch: { ratesByTenorMonths: REAP_RATES } });
    await hooks.setProductConfig({ product: 'RTN', patch: rtnConfigPatch(RTN_MATRIX) });
  }

  async function showGrow() {
    await openTab('grow');
    await grow.waitForShown();
  }

  async function seed(product: 'REAP' | 'RWIN' | 'RTN', principal: number, state = 'ACTIVE') {
    const extra: Record<string, unknown> =
      product === 'REAP' ? { tenorMonths: 6, target: principal * 2, frequency: 'MONTHLY', contributionAmount: 10_000 }
        : product === 'RTN' ? { tenorDays: 90, timing: 'AT_MATURITY' } : {};
    const ratePct = product === 'RTN' ? rtn.lookupRate(RTN_MATRIX, principal, 90) : product === 'REAP' ? REAP_RATES[6] : 14;
    await hooks.seedInvestment({ customerId, product, state, principal, ratePct, fundedDaysAgo: 10, extra });
  }

  beforeEach(async function () {
    requireHooks(this);
  });

  afterEach(async () => {
    await hooks?.dispose();
  });

  it(title('new customer sees REAP, RWIN and RTN tiles each with a one-liner and a "New" badge', Tag.high, Tag.smoke, Tag.spec('REAP§2'), Tag.spec('RWIN§2'), Tag.spec('RTN§2')), async () => {
    await start();
    await showGrow();
    for (const p of PRODUCTS) {
      await expect(await grow.tileShown(p)).toBe(true);
      await expect(await grow.tileOneLiner(p)).toBeTruthy();
      await expect(await grow.tileHasNewBadge(p)).toBe(true);
    }
  });

  it(title('REAP tile with plans shows "3 active plans · ₦850,000 total" and drops the New badge', Tag.high, Tag.smoke, Tag.spec('REAP§2')), async () => {
    await start();
    for (const amt of [300_000, 250_000, 300_000]) await seed('REAP', amt);
    await showGrow();
    const metric = await grow.tileMetric('reap');
    expect(metric).toMatch(/3 active plans/i);
    expect(metric).toContain(formatNaira(850_000, { kobo: false }));
    await expect(await grow.tileHasNewBadge('reap')).toBe(false);
    await expect(await grow.tileHasNewBadge('rwin')).toBe(true);
    await expect(await grow.tileHasNewBadge('rtn')).toBe(true);
  });

  it(title('RWIN tile with plans shows plan count + total and drops the New badge', Tag.med, Tag.spec('RWIN§2')), async () => {
    await start();
    await seed('RWIN', 500_000);
    await seed('RWIN', 150_000);
    await showGrow();
    const metric = await grow.tileMetric('rwin');
    expect(metric).toMatch(/2 active plans/i);
    expect(metric).toContain(formatNaira(650_000, { kobo: false }));
    await expect(await grow.tileHasNewBadge('rwin')).toBe(false);
  });

  it(title('RTN tile with a placement shows count + total and drops the New badge', Tag.med, Tag.spec('RTN§2')), async () => {
    await start();
    await seed('RTN', 2_500_000);
    await showGrow();
    const metric = await grow.tileMetric('rtn');
    expect(metric).toMatch(/1 active (placement|plan)/i);
    expect(metric).toContain(formatNaira(2_500_000, { kobo: false }));
    await expect(await grow.tileHasNewBadge('rtn')).toBe(false);
  });

  it(title('tile metric counts only active plans (broken / closed excluded from count and total)', Tag.med, Tag.spec('REAP§2')), async () => {
    await start();
    await seed('REAP', 200_000);
    await seed('REAP', 400_000, 'BROKEN');
    await showGrow();
    const metric = await grow.tileMetric('reap');
    expect(metric).toMatch(/1 active plan/i);
    expect(metric).toContain(formatNaira(200_000, { kobo: false }));
    expect(metric).not.toContain(formatNaira(600_000, { kobo: false }));
  });

  for (const p of PRODUCTS) {
    it(title(`tapping the ${p.toUpperCase()} tile opens the ${p.toUpperCase()} landing`, Tag.med, Tag.spec(`${p.toUpperCase()}§2`)), async () => {
      await start();
      await showGrow();
      await grow.openTile(p);
      await landings[p].waitForShown();
    });
  }

  it(title('discovery banner surfaces a product and deep-links to its landing', Tag.low, Tag.spec('REAP§2'), Tag.spec('RTN§2')), async () => {
    await start();
    await hooks.setProductConfig({ product: 'GROW', patch: { discoveryBanner: { active: true, product: 'REAP', segment: 'ALL', title: 'Start a plan for December' } } });
    await showGrow();
    await expect(await grow.bannerShown()).toBe(true);
    await expect(await grow.bannerText()).toMatch(/plan/i);
    await grow.tapBanner();
    await landings.reap.waitForShown();
  });

  const searches: Array<{ query: string; product: Product }> = [
    { query: 'REAP', product: 'reap' },
    { query: 'RWIN', product: 'rwin' },
    { query: 'Treasury', product: 'rtn' },
  ];
  for (const s of searches) {
    it(title(`search "${s.query}" from Grow home finds ${s.product.toUpperCase()}`, Tag.low, Tag.spec(`${s.product.toUpperCase()}§2`)), async () => {
      await start();
      await showGrow();
      await grow.openSearch();
      const search = new SearchScreen();
      await search.waitForShown();
      await search.query(s.query);
      await search.openResult(0);
      await landings[s.product].waitForShown();
    });
  }

  it(title('Tier 1: REAP and RWIN tiles carry Tier 2 upgrade messaging; individual RTN is not gated', Tag.crit, Tag.open('CALC-TIER'), Tag.spec('Calc§2'), Tag.spec('RTN§1')), async () => {
    await start(1);
    await showGrow();
    for (const p of PRODUCTS) {
      const gated = !canBookInvestment(1, p.toUpperCase() as 'REAP' | 'RWIN' | 'RTN');
      await expect(await grow.tileGateShown(p)).toBe(gated);
      if (gated) await expect(await grow.tileGateText(p)).toMatch(/tier 2|upgrade|verify/i);
    }
  });

  it(title('Tier 1: tapping a gated product still opens its landing for browsing, but starting routes to KYC upgrade', Tag.crit, Tag.spec('Calc§2'), Tag.spec('KYC§1')), async () => {
    await start(1);
    await showGrow();
    await grow.openTile('reap');
    await landings.reap.waitForShown();
    await landings.reap.startPlan();
    await expect(await landings.reap.kycUpgradePromptShown()).toBe(true);
    await expect(await landings.reap.kycUpgradePromptText()).toMatch(new RegExp(`${escapeRe('Tier 2')}|upgrade`, 'i'));
  });

  for (const tier of [2, 3] as const) {
    it(title(`Tier ${tier}: no gate messaging on any Grow tile`, Tag.crit, Tag.spec('Calc§2')), async () => {
      await start(tier);
      await showGrow();
      for (const p of PRODUCTS) {
        expect(canBookInvestment(tier, p.toUpperCase() as 'REAP' | 'RWIN' | 'RTN')).toBe(true);
        await expect(await grow.tileGateShown(p)).toBe(false);
      }
    });
  }
});
