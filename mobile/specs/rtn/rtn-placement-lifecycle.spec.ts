import { expect } from '@wdio/globals';
import Decimal from 'decimal.js';
import { D, addDays, formatNaira, toKobo } from '../../../shared/calc/money';
import { assertLinesReconcile } from '../../../shared/calc/wht';
import * as rtn from '../../../shared/calc/rtn';
import { productConfig } from '../../../shared/config/env';
import { Tag, title } from '../../../shared/support/tags';
import { QaHooks } from '../../../shared/api/qa-hooks';
import { freshCustomer, openTab, requireHooks } from '../../helpers/session';
import { links, openDeepLink } from '../../helpers/deeplink';
import { RTN_LADDER, RTN_MATRIX, RTN_MATRIX_BUMPED, daysAgo, escapeRe, rtnConfigPatch, today } from '../../helpers/investment-fixtures';
import { GrowHomeScreen } from '../../screens/common/HomeScreens';
import { WalletScreen } from '../../screens/common/WalletScreens';
import { RtnForceLiquidateScreen, RtnLandingScreen, RtnPlacementScreen, RtnRolloverScreen } from '../../screens/rtn/RtnScreens';

/**
 * RTN — on-placement view, maturity / rollover, force-liquidation, auto-rollover toggle, top-up, "cannot do"
 * (RTN_Customer_App_Spec §5–§7, §8, §9, §11; Clarity T4–T7, T10, T11, T14, X1, X7).
 */
describe('RTN › Placement lifecycle', () => {
  const cfg = productConfig.rtn;
  const AMOUNT = 2_000_000;
  const TENOR = 90;
  const RATE = rtn.lookupRate(RTN_MATRIX, AMOUNT, TENOR);
  /** Auto-release threshold high enough that force-liquidation is instant (T7 default: instant below threshold). */
  const INSTANT = { liquidationAutoReleaseThreshold: 1_000_000_000_000 };
  let hooks: QaHooks;
  let customerId: string;

  const placement = new RtnPlacementScreen();
  const liquidate = new RtnForceLiquidateScreen();
  const wallet = new WalletScreen();

  type Timing = rtn.InterestTiming;

  async function seedPlacement(o: { amount?: number; tenor?: number; fundedDaysAgo: number; timing?: Timing; autoRollover?: boolean; state?: string }) {
    const amount = o.amount ?? AMOUNT;
    const tenor = o.tenor ?? TENOR;
    const { investmentId } = await hooks.seedInvestment({
      customerId, product: 'RTN', state: o.state ?? 'ACTIVE', principal: amount, ratePct: rtn.lookupRate(RTN_MATRIX, amount, tenor),
      fundedDaysAgo: o.fundedDaysAgo,
      extra: { tenorDays: tenor, timing: o.timing ?? 'AT_MATURITY', autoRollover: o.autoRollover ?? false, source: 'WALLET', payout: 'WALLET', penaltyLadder: RTN_LADDER },
    });
    return investmentId;
  }

  async function open(id: string) {
    await openDeepLink(links.rtnPlacement(id));
    await placement.waitForShown();
  }

  async function walletBalance(): Promise<Decimal> {
    await openTab('wallet');
    return wallet.balance();
  }

  function liquidation(fundedDaysAgo: number, timing: Timing = 'AT_MATURITY', amount = AMOUNT, tenor = TENOR) {
    return rtn.forceLiquidation({
      amount, ratePct: rtn.lookupRate(RTN_MATRIX, amount, tenor), tenorDays: tenor, activatedOn: daysAgo(fundedDaysAgo), asOf: today(), timing, ladder: RTN_LADDER,
    });
  }

  beforeEach(async function () {
    requireHooks(this);
    ({ hooks, customerId } = await freshCustomer({ tier: 2, walletBalance: 0 }));
    await hooks.setProductConfig({ product: 'RTN', patch: rtnConfigPatch(RTN_MATRIX, { ...INSTANT, allowsTopUp: false }) });
  });

  afterEach(async () => {
    await hooks?.resetClock().catch(() => undefined);
    await hooks?.dispose();
  });

  describe('On-placement view', () => {
    it(title('header, hero (amount, rate, maturity, net interest) and details match the oracle', Tag.crit, Tag.smoke, Tag.open('X4'), Tag.spec('RTN§5')), async () => {
      const id = await seedPlacement({ fundedDaysAgo: 20 });
      await open(id);
      const proj = rtn.bookingProjection(AMOUNT, RATE, TENOR, 'AT_MATURITY', daysAgo(20));
      await expect(await placement.placementId()).toMatch(/PLC-/);
      await expect(await placement.countdown()).toContain(String(TENOR - 20));
      await expect((await placement.placedAmount()).toFixed(2)).toBe(D(AMOUNT).toFixed(2));
      await expect(await placement.rate()).toContain(`${RATE}%`);
      await expect(await placement.maturityDate()).toContain(String(proj.maturityDate.getUTCDate()));
      await expect((await placement.netInterest()).toFixed(2)).toBe(proj.net.toFixed(2));
      await expect(await placement.detail('tenor')).toContain(String(TENOR));
      await expect(await placement.detail('timing')).toMatch(/maturity/i);
      await expect(await placement.detail('source')).toMatch(/wallet/i);
      await expect(await placement.detail('payout')).toMatch(/wallet/i);
      await expect(await placement.detail('autoRollover')).toMatch(/off/i);
      await expect(await placement.upfrontPaidShown()).toBe(false);
      await expect(await placement.rolloverEnabled()).toBe(false);
      await expect(await placement.forceLiquidateEnabled()).toBe(true);
    });

    it(title('upfront placement shows "Interest of ₦X paid on [booking date]" with oracle net interest', Tag.crit, Tag.open('X1'), Tag.spec('RTN§5')), async () => {
      const id = await seedPlacement({ fundedDaysAgo: 15, timing: 'UPFRONT' });
      await open(id);
      const proj = rtn.bookingProjection(AMOUNT, RATE, TENOR, 'UPFRONT', daysAgo(15));
      await expect(await placement.detail('timing')).toMatch(/upfront/i);
      await expect(await placement.detail('upfrontPaid')).toMatch(/interest of .* paid on/i);
      await expect((await placement.upfrontPaidAmount()).toFixed(2)).toBe(proj.paidAtBooking.toFixed(2));
    });
  });

  describe('Approaching maturity (T-7)', () => {
    for (const autoRollover of [true, false]) {
      it(title(`T-7 banner + notification reflect auto-rollover ${autoRollover ? 'ON' : 'OFF'}`, Tag.high, Tag.open('T14'), Tag.spec('RTN§6'), Tag.spec('RTN§8')), async () => {
        const id = await seedPlacement({ fundedDaysAgo: TENOR - cfg.maturityNoticeDays - 1, autoRollover });
        await hooks.advanceClock({ customerId, days: 1 });
        await open(id);
        const banner = await placement.banner();
        expect(banner).toMatch(new RegExp(`matures in ${cfg.maturityNoticeDays} days`, 'i'));
        expect(banner).toMatch(autoRollover ? /roll into a new placement/i : /wallet|bank/i);
        const notes = await hooks.latestNotifications(customerId, 3);
        expect(notes.map((n) => n.body).join('|')).toMatch(new RegExp(`matures in ${cfg.maturityNoticeDays} days.*Auto-rollover is ${autoRollover ? 'ON' : 'OFF'}`, 'i'));
      });
    }
  });

  describe('Maturity', () => {
    it(title('auto-rollover ON: new placement at then-current rate for principal + net interest; old one historical', Tag.crit, Tag.open('T10'), Tag.open('X1'), Tag.spec('RTN§6'), Tag.spec('RTN§8')), async () => {
      const id = await seedPlacement({ fundedDaysAgo: TENOR - 1, autoRollover: true });
      await hooks.setProductConfig({ product: 'RTN', patch: rtnConfigPatch(RTN_MATRIX_BUMPED, INSTANT) });
      await hooks.advanceClock({ customerId, days: 1 });
      const newAmount = rtn.rolloverAmount(AMOUNT, RATE, TENOR, 'AT_MATURITY');
      const newRate = rtn.lookupRate(RTN_MATRIX_BUMPED, newAmount, TENOR);
      const notes = await hooks.latestNotifications(customerId, 3);
      expect(notes.map((n) => n.body).join('|')).toMatch(new RegExp(`PLC-\\S+ rolled over to PLC-\\S+ at ${newRate}% for ${TENOR}`, 'i'));
      await open(id);
      await expect(await placement.stateLabel()).toMatch(/rolled|complete/i);
      await expect(await placement.linkedPlacementId()).toMatch(/PLC-/);
      await openTab('grow');
      await new GrowHomeScreen().openTile('rtn');
      const landing = new RtnLandingScreen();
      await landing.waitForShown();
      const statuses = [await landing.placementCard(0).status(), await landing.placementCard(1).status()];
      const live = statuses.findIndex((s) => /active/i.test(s));
      expect(live).toBeGreaterThanOrEqual(0);
      expect(statuses[1 - live]).toMatch(/rolled|complete|closed/i);
      await expect((await landing.placementCard(live).amount()).toFixed(2)).toBe(newAmount.toFixed(2));
      await expect(await landing.placementCard(live).rate()).toContain(`${newRate}%`);
      await expect((await walletBalance()).toFixed(2)).toBe('0.00');
    });

    it(title('auto-rollover OFF (at maturity): principal + net interest paid out, placement Closed', Tag.crit, Tag.open('X1'), Tag.spec('RTN§6'), Tag.spec('RTN§8')), async () => {
      const id = await seedPlacement({ fundedDaysAgo: TENOR - 1 });
      await hooks.advanceClock({ customerId, days: 1 });
      const proj = rtn.bookingProjection(AMOUNT, RATE, TENOR, 'AT_MATURITY', daysAgo(TENOR));
      await expect((await walletBalance()).toFixed(2)).toBe(toKobo(proj.paidAtMaturity).toFixed(2));
      const notes = await hooks.latestNotifications(customerId, 3);
      expect(notes.map((n) => n.body).join('|')).toMatch(new RegExp(`matured\\. ${escapeRe(formatNaira(proj.paidAtMaturity))} \\(net of WHT\\) paid`, 'i'));
      await open(id);
      await expect(await placement.stateLabel()).toMatch(/closed|matured/i);
    });

    it(title('auto-rollover OFF (upfront): only principal paid at maturity (interest already paid)', Tag.crit, Tag.open('T2'), Tag.spec('RTN§4.4'), Tag.spec('RTN§6')), async () => {
      await seedPlacement({ fundedDaysAgo: TENOR - 1, timing: 'UPFRONT' });
      await hooks.advanceClock({ customerId, days: 1 });
      const proj = rtn.bookingProjection(AMOUNT, RATE, TENOR, 'UPFRONT', daysAgo(TENOR));
      expect(proj.paidAtMaturity.toFixed(2)).toBe(D(AMOUNT).toFixed(2));
      await expect((await walletBalance()).toFixed(2)).toBe(proj.paidAtMaturity.toFixed(2));
    });

    it(title('manual Rollover is disabled before maturity and enabled at/after maturity', Tag.high, Tag.spec('RTN§5'), Tag.spec('RTN§6')), async () => {
      const active = await seedPlacement({ fundedDaysAgo: 30 });
      await open(active);
      await expect(await placement.rolloverEnabled()).toBe(false);
      await expect(await placement.disabledActionTooltip('rollover')).toMatch(/maturity/i);
      const matured = await seedPlacement({ fundedDaysAgo: TENOR, state: 'MATURED' });
      await open(matured);
      await expect(await placement.rolloverEnabled()).toBe(true);
    });

    it(title('manual rollover defaults to same tenor at current rate and creates a new placement', Tag.high, Tag.open('T10'), Tag.spec('RTN§7')), async () => {
      const matured = await seedPlacement({ fundedDaysAgo: TENOR, state: 'MATURED' });
      await hooks.setProductConfig({ product: 'RTN', patch: rtnConfigPatch(RTN_MATRIX_BUMPED, INSTANT) });
      await open(matured);
      await placement.rollover();
      const roll = new RtnRolloverScreen();
      await roll.waitForShown();
      const newAmount = rtn.rolloverAmount(AMOUNT, RATE, TENOR, 'AT_MATURITY');
      const newRate = rtn.lookupRate(RTN_MATRIX_BUMPED, newAmount, TENOR);
      await expect((await roll.rolloverAmount()).toFixed(2)).toBe(newAmount.toFixed(2));
      await expect(await roll.tenorSelected(TENOR)).toBe(true);
      await expect(await roll.rate()).toContain(`${newRate}%`);
      await expect((await roll.netInterest()).toFixed(2)).toBe(rtn.interest(newAmount, newRate, TENOR).net.toFixed(2));
      await roll.confirm();
      await expect(await roll.successNewId()).toMatch(/PLC-/);
    });

    it(title('toggle auto-rollover is instant and persists', Tag.med, Tag.spec('RTN§7')), async () => {
      const id = await seedPlacement({ fundedDaysAgo: 10 });
      await open(id);
      const before = await placement.autoRolloverOn();
      await placement.toggleAutoRollover();
      await expect(await placement.autoRolloverOn()).toBe(!before);
      await open(id);
      await expect(await placement.autoRolloverOn()).toBe(!before);
    });
  });

  describe('Force liquidate', () => {
    it(title('Screen 1 warning: dynamic penalty preview from ladder; "Keep placement" is primary and returns', Tag.crit, Tag.open('T5'), Tag.spec('RTN§7'), Tag.spec('RTN§10')), async () => {
      const id = await seedPlacement({ fundedDaysAgo: 30 });
      await open(id);
      await placement.forceLiquidate();
      await liquidate.waitForShown();
      await expect(await liquidate.warningText()).toMatch(/penalty/i);
      await expect((await liquidate.penaltyPreview()).toFixed(2)).toBe(liquidation(30).penalty.toFixed(2));
      await expect(await liquidate.primaryCtaText()).toMatch(/keep placement/i);
      await expect(await liquidate.secondaryCtaText()).toMatch(/continue/i);
      await liquidate.keepPlacement();
      await placement.waitForShown();
      await expect(await placement.stateLabel()).toMatch(/active/i);
    });

    for (const elapsed of [5, 30, 50, 80]) {
      it(title(`penalty preview on day ${elapsed}/${TENOR} matches the ladder band (oracle penaltyFor)`, Tag.crit, Tag.open('T5'), Tag.open('X6'), Tag.spec('RTN§7')), async () => {
        const id = await seedPlacement({ fundedDaysAgo: elapsed });
        await open(id);
        await placement.forceLiquidate();
        await expect((await liquidate.penaltyPreview()).toFixed(2)).toBe(liquidation(elapsed).penalty.toFixed(2));
      });
    }

    it(title('Screen 2 (at maturity timing): amount + accrued − penalty − WHT = net; success credits wallet', Tag.crit, Tag.open('T5'), Tag.open('T6'), Tag.open('T7'), Tag.open('X1'), Tag.spec('RTN§7'), Tag.spec('RTN§8')), async () => {
      const elapsed = 45;
      const id = await seedPlacement({ fundedDaysAgo: elapsed });
      const exp = liquidation(elapsed);
      await open(id);
      await placement.forceLiquidate();
      await liquidate.continue();
      const principal = await liquidate.line('principal');
      const accrued = await liquidate.line('accrued');
      const penalty = await liquidate.line('penalty');
      const wht = await liquidate.line('wht');
      const net = await liquidate.line('net');
      expect(principal.toFixed(2)).toBe(exp.principal.toFixed(2));
      expect(accrued.toFixed(2)).toBe(exp.accruedInterest.toFixed(2));
      expect(penalty.toFixed(2)).toBe(exp.penalty.toFixed(2));
      expect(wht.toFixed(2)).toBe(exp.wht.toFixed(2));
      expect(net.toFixed(2)).toBe(exp.netToWallet.toFixed(2));
      // X3 invariant on the interest portion: (accrued − penalty) − WHT = net − principal
      assertLinesReconcile({ gross: accrued, penalty, wht, net: net.minus(principal) });
      await liquidate.confirm();
      await expect(await liquidate.successText()).toMatch(/wallet/i);
      await expect((await liquidate.successAmount()).toFixed(2)).toBe(exp.netToWallet.toFixed(2));
      const notes = await hooks.latestNotifications(customerId, 3);
      expect(notes.map((n) => n.body).join('|')).toMatch(new RegExp(`force-liquidated\\. ${escapeRe(formatNaira(exp.netToWallet))} \\(net of penalty and WHT\\)`, 'i'));
      await expect((await walletBalance()).toFixed(2)).toBe(exp.netToWallet.toFixed(2));
      await open(id);
      await expect(await placement.stateLabel()).toMatch(/force.?liquidated|closed/i);
    });

    it(title('upfront placement: unearned upfront interest is recovered from principal (oracle)', Tag.crit, Tag.open('T4'), Tag.open('T5'), Tag.open('T6'), Tag.spec('RTN§7')), async () => {
      const elapsed = 40;
      const id = await seedPlacement({ fundedDaysAgo: elapsed, timing: 'UPFRONT' });
      const exp = liquidation(elapsed, 'UPFRONT');
      expect(exp.upfrontRecovery.gt(0)).toBe(true);
      await open(id);
      await placement.forceLiquidate();
      await expect((await liquidate.upfrontRecoveryPreview()).toFixed(2)).toBe(exp.upfrontRecovery.toFixed(2));
      await liquidate.continue();
      await expect(await liquidate.lineShown('upfrontRecovery')).toBe(true);
      await expect((await liquidate.line('upfrontRecovery')).toFixed(2)).toBe(exp.upfrontRecovery.toFixed(2));
      await expect((await liquidate.line('penalty')).toFixed(2)).toBe(exp.penalty.toFixed(2));
      await expect((await liquidate.line('net')).toFixed(2)).toBe(exp.netToWallet.toFixed(2));
      expect(exp.netToWallet.toFixed(2)).toBe(D(AMOUNT).minus(exp.upfrontRecovery).toFixed(2));
    });

    it(title('force liquidation above the auto-release threshold goes to Under review with actions disabled', Tag.high, Tag.open('T7'), Tag.spec('RTN§6')), async () => {
      await hooks.setProductConfig({ product: 'RTN', patch: rtnConfigPatch(RTN_MATRIX, { liquidationAutoReleaseThreshold: 0 }) });
      const id = await seedPlacement({ fundedDaysAgo: 30 });
      await open(id);
      await placement.forceLiquidate();
      await liquidate.continue();
      await liquidate.confirm();
      await open(id);
      await expect(await placement.stateLabel()).toMatch(/under review/i);
      await expect(await placement.forceLiquidateEnabled()).toBe(false);
      await expect((await walletBalance()).toFixed(2)).toBe('0.00');
    });

    it(title('force liquidate on maturity day shows extra "matures today" warning but is not blocked', Tag.high, Tag.open('X7'), Tag.spec('RTN§9')), async () => {
      const id = await seedPlacement({ fundedDaysAgo: TENOR });
      await open(id);
      await placement.forceLiquidate();
      await expect(await liquidate.sameDayWarningShown()).toBe(true);
      await expect(await liquidate.sameDayWarning()).toMatch(/matures today.*full interest/i);
      await liquidate.continue();
      await expect((await liquidate.line('net')).toFixed(2)).toBe(liquidation(TENOR).netToWallet.toFixed(2));
    });
  });

  describe('Config-driven and restricted actions', () => {
    it(title('Top up is hidden when top-up is disabled in config', Tag.med, Tag.open('T11'), Tag.spec('RTN§7')), async () => {
      const id = await seedPlacement({ fundedDaysAgo: 10 });
      await open(id);
      await expect(await placement.topUpShown()).toBe(false);
    });

    it(title('Under review: transactional actions disabled', Tag.high, Tag.spec('RTN§6')), async () => {
      const id = await seedPlacement({ fundedDaysAgo: 10, state: 'UNDER_REVIEW' });
      await open(id);
      await expect(await placement.stateLabel()).toMatch(/under review/i);
      await expect(await placement.forceLiquidateEnabled()).toBe(false);
      await expect(await placement.rolloverEnabled()).toBe(false);
      await expect(await placement.autoRolloverEnabled()).toBe(false);
    });

    it(title('no UI to change rate, tenor, interest timing or payout, or to waive penalty / expiry', Tag.crit, Tag.spec('RTN§11')), async () => {
      const id = await seedPlacement({ fundedDaysAgo: 10 });
      await open(id);
      for (const c of ['editRate', 'editTenor', 'editTiming', 'editPayout', 'waivePenalty', 'waiveExpiry'] as const) {
        await expect(await placement.forbiddenControlShown(c)).toBe(false);
      }
    });

    it(title('rate is locked: a matrix change after booking does not alter the placement', Tag.crit, Tag.spec('RTN§4.7'), Tag.spec('RTN§11')), async () => {
      const id = await seedPlacement({ fundedDaysAgo: 10 });
      await hooks.setProductConfig({ product: 'RTN', patch: rtnConfigPatch(RTN_MATRIX_BUMPED, INSTANT) });
      await open(id);
      await expect(await placement.rate()).toContain(`${RATE}%`);
      const proj = rtn.bookingProjection(AMOUNT, RATE, TENOR, 'AT_MATURITY', addDays(today(), -10));
      await expect((await placement.netInterest()).toFixed(2)).toBe(proj.net.toFixed(2));
    });
  });
});
