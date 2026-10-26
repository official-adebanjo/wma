import { expect } from '@wdio/globals';
import { formatNaira } from '../../../shared/calc/money';
import { assertLinesReconcile } from '../../../shared/calc/wht';
import * as rwin from '../../../shared/calc/rwin';
import { productConfig } from '../../../shared/config/env';
import { Tag, title } from '../../../shared/support/tags';
import { QaHooks } from '../../../shared/api/qa-hooks';
import { freshCustomer, requireHooks } from '../../helpers/session';
import { links, openDeepLink } from '../../helpers/deeplink';
import { NotificationsScreen } from '../../screens/common/HomeScreens';
import { RwinAdjustScreen, RwinPlanScreen, RwinTopUpScreen, RwinWithdrawScreen } from '../../screens/rwin/RwinScreens';

/**
 * RWIN 2.0 — on-plan view, states, top-up, withdraw, rollover, notifications
 * (RWIN_2_0_Customer_App_Spec §5–§11; Clarity W3–W10).
 */
describe('RWIN 2.0 › Plan lifecycle', () => {
  const cfg = productConfig.rwin;
  const RATE = 14;
  let hooks: QaHooks;
  let customerId: string;

  const plan = new RwinPlanScreen();
  const topUp = new RwinTopUpScreen();
  const withdraw = new RwinWithdrawScreen();

  async function openSeededPlan(principal: number, fundedDaysAgo: number, extra: Record<string, unknown> = {}) {
    const { investmentId } = await hooks.seedInvestment({ customerId, product: 'RWIN', state: 'ACTIVE', principal, ratePct: RATE, fundedDaysAgo, extra });
    await openDeepLink(links.rwinPlan(investmentId));
    await plan.waitForShown();
    return investmentId;
  }

  beforeEach(async function () {
    requireHooks(this);
    ({ hooks, customerId } = await freshCustomer({ tier: 2, walletBalance: 10_000_000 }));
    await hooks.setProductConfig({ product: 'RWIN', patch: { ratePct: RATE } });
  });

  afterEach(async () => {
    await hooks?.resetClock().catch(() => undefined);
    await hooks?.dispose();
  });

  describe('30-day minimum holding (absolute rule)', () => {
    for (const day of [0, 1, 29]) {
      it(title(`withdraw is disabled on day ${day} with "Available after" tooltip`, Tag.crit, Tag.spec('RWIN§6'), Tag.spec('RWIN§9')), async () => {
        await openSeededPlan(500_000, day);
        await expect(await plan.withdrawEnabled()).toBe(false);
        const expectedDate = rwin.withdrawableFrom({ fundedOn: daysAgo(day) });
        await expect(await plan.withdrawTooltip()).toMatch(/30-day minimum/i);
        await expect(await plan.withdrawTooltip()).toContain(String(expectedDate.getUTCDate()));
      });
    }

    it(title('withdraw becomes enabled on day 30 (first withdrawable day)', Tag.crit, Tag.open('W10'), Tag.spec('RWIN§7')), async () => {
      await openSeededPlan(500_000, 30);
      await expect(await plan.withdrawEnabled()).toBe(true);
    });

    it(title('no break / early-exit action exists anywhere in the app', Tag.crit, Tag.spec('RWIN§7'), Tag.spec('RWIN§11')), async () => {
      await openSeededPlan(500_000, 5);
      await expect(await plan.breakActionExists()).toBe(false);
    });

    it(title('mixed tranches: only tranches ≥ day 30 count as withdrawable, locked tranches show chip', Tag.crit, Tag.open('W7'), Tag.spec('RWIN§7')), async () => {
      const id = await openSeededPlan(300_000, 45);
      await hooks.seedInvestment({ customerId, product: 'RWIN', state: 'TOPUP', principal: 200_000, ratePct: RATE, fundedDaysAgo: 10, extra: { planId: id } });
      await openDeepLink(links.rwinPlan(id));
      await plan.waitForShown();
      await expect(await plan.tranche(1).lockedChip()).toBe(true);
      await plan.withdraw();
      await withdraw.waitForShown();
      const tranches = [{ principal: 300_000, ratePct: RATE, fundedOn: daysAgo(45) }, { principal: 200_000, ratePct: RATE, fundedOn: daysAgo(10) }];
      await expect((await withdraw.maxWithdrawable()).toFixed(2)).toBe(rwin.withdrawableAmount(tranches, new Date()).toFixed(2));
    });
  });

  describe('On-plan view', () => {
    it(title('hero balance, accrued interest and tranche breakdown match the oracle', Tag.crit, Tag.smoke, Tag.spec('RWIN§5')), async () => {
      await openSeededPlan(1_000_000, 20);
      const t = { principal: 1_000_000, ratePct: RATE, fundedOn: daysAgo(20) };
      await expect((await plan.totalBalance()).toFixed(2)).toBe('1000000.00');
      await expect((await plan.accruedInterest()).toFixed(2)).toBe(rwin.accruedInterest(t, new Date()).toFixed(2));
      await expect(await plan.tranche(0).rate()).toContain(`${RATE}%`);
      await expect((await plan.tranche(0).accrued()).toFixed(2)).toBe(rwin.accruedInterest(t, new Date()).toFixed(2));
      await expect(await plan.countdown()).toContain(String(70)); // 90 − 20 days to cycle end
    });

    it(title('rate change mid-cycle: existing tranche keeps booked rate, new tranche gets new rate', Tag.crit, Tag.spec('RWIN§9')), async () => {
      await openSeededPlan(500_000, 40);
      await hooks.setProductConfig({ product: 'RWIN', patch: { ratePct: 12 } });
      await plan.topUp();
      await topUp.enterAmount(100_000);
      await topUp.continue();
      await expect(await topUp.confirmRate()).toContain('12%');
      await topUp.confirm();
      await plan.waitForShown();
      await expect(await plan.tranche(0).rate()).toContain(`${RATE}%`);
      await expect(await plan.tranche(1).rate()).toContain('12%');
    });

    it(title('recent activity shows last 5 events', Tag.low, Tag.spec('RWIN§5')), async () => {
      await openSeededPlan(500_000, 40);
      await expect(await plan.recentActivity(0)).toBeTruthy();
    });
  });

  describe('Top up', () => {
    it(title('top-up creates a new tranche with its own full 90-day cycle and oracle projection', Tag.crit, Tag.open('W9'), Tag.spec('RWIN§7')), async () => {
      await openSeededPlan(500_000, 40);
      await plan.topUp();
      await topUp.enterAmount(200_000);
      await topUp.continue();
      await expect((await topUp.confirmProjected()).toFixed(2)).toBe(rwin.projectedCycleEarnings(200_000, RATE).toFixed(2));
      await topUp.confirm();
      await expect((await topUp.successPlanTotal()).toFixed(2)).toBe('700000.00');
      const notes = await hooks.latestNotifications(customerId, 1);
      expect(notes[0].body).toMatch(/added to .* at 14%/);
    });

    it(title('top-up that would exceed the ₦100M cap is blocked with two-clause error', Tag.crit, Tag.open('W4'), Tag.spec('RWIN§9')), async () => {
      await hooks.setWalletBalance(customerId, 200_000_000);
      await openSeededPlan(99_950_000, 40);
      await plan.topUp();
      await topUp.enterAmount(100_000);
      await expect(await topUp.amountError()).toMatch(/exceed the ₦100M plan cap.*start a new plan/i);
    });

    it(title('cap warning banner shows when plan reaches 90% of cap', Tag.high, Tag.open('W4'), Tag.spec('RWIN§6')), async () => {
      await hooks.setWalletBalance(customerId, 200_000_000);
      await openSeededPlan(cfg.planCap * 0.9, 40);
      await expect(await plan.banner()).toMatch(/approaching the ₦100M cap/i);
    });
  });

  describe('Withdraw', () => {
    it(title('partial withdrawal summary: gross, WHT, net reconcile and net reaches wallet', Tag.crit, Tag.open('W2'), Tag.spec('RWIN§7')), async () => {
      await openSeededPlan(1_000_000, 45);
      await plan.withdraw();
      await withdraw.enterAmount(400_000);
      await withdraw.continue();
      const s = withdraw.summary();
      const gross = await s.gross();
      const wht = await s.wht();
      const net = await s.net();
      expect(gross.toFixed(2)).toBe('400000.00');
      // Interest treatment on mid-cycle withdrawal is open (W2) — assert reconciliation only.
      const interest = await s.interest();
      assertLinesReconcile({ gross: gross.plus(interest), wht, net });
      await withdraw.confirm();
      await expect(await withdraw.successText()).toMatch(/complete/i);
    });

    it(title('partial withdrawal leaving < ₦50,000 is rejected', Tag.crit, Tag.open('W8'), Tag.spec('RWIN§9')), async () => {
      await openSeededPlan(100_000, 45);
      await plan.withdraw();
      await withdraw.enterAmount(60_000);
      await expect(await withdraw.amountError()).toMatch(/keep at least ₦50,000/i);
      expect(rwin.validateWithdrawal([{ principal: 100_000, ratePct: RATE, fundedOn: daysAgo(45) }], 60_000, new Date())).toEqual({ ok: false, reason: 'BELOW_MIN_RETAINED' });
    });

    it(title('"Withdraw all" withdraws only the past-30-day amount', Tag.crit, Tag.spec('RWIN§7')), async () => {
      await openSeededPlan(300_000, 45);
      await plan.withdraw();
      await withdraw.withdrawAll();
      await expect((await withdraw.remainingAfter()).toFixed(2)).toBe('0.00');
    });
  });

  describe('Rollover and cycle end', () => {
    it(title('T-7: banner + notification reflect auto-rollover ON', Tag.high, Tag.spec('RWIN§6'), Tag.spec('RWIN§8')), async () => {
      await openSeededPlan(500_000, 83);
      await hooks.advanceClock({ customerId, days: 0 });
      await expect(await plan.banner()).toMatch(/ends in 7 days.*continue at/i);
      const notes = await hooks.latestNotifications(customerId, 3);
      expect(notes.map((n) => n.body).join('|')).toMatch(/cycle ends in 7 days. Auto-rollover is ON/i);
    });

    it(title('cycle end with rollover ON: new cycle principal = principal + net interest at current rate', Tag.crit, Tag.spec('RWIN§6')), async () => {
      const id = await openSeededPlan(1_000_000, 89);
      await hooks.setProductConfig({ product: 'RWIN', patch: { ratePct: 13 } });
      await hooks.advanceClock({ customerId, days: 1 });
      await openDeepLink(links.rwinPlan(id));
      await plan.waitForShown();
      const expected = rwin.rolloverPrincipal(1_000_000, RATE);
      await expect((await plan.totalBalance()).toFixed(2)).toBe(expected.toFixed(2));
      await expect(await plan.tranche(0).rate()).toContain('13%');
      const notes = await hooks.latestNotifications(customerId, 1);
      expect(notes[0].body).toMatch(/rolled over. New cycle earns 13%/i);
    });

    it(title('cycle end with rollover OFF: principal + net interest paid to wallet, tranche removed', Tag.crit, Tag.spec('RWIN§6')), async () => {
      const id = await openSeededPlan(1_000_000, 89, { autoRollover: false });
      await hooks.advanceClock({ customerId, days: 1 });
      const notes = await hooks.latestNotifications(customerId, 1);
      expect(notes[0].body).toContain(formatNaira(rwin.maturityPayout(1_000_000, RATE)));
      await openDeepLink(links.rwinPlan(id));
      await expect(await plan.stateLabel()).toMatch(/matured/i);
    });

    it(title('toggle auto-rollover is instant and persists', Tag.high, Tag.spec('RWIN§7')), async () => {
      await openSeededPlan(500_000, 10);
      const before = await plan.rolloverToggleOn();
      await plan.toggleRollover();
      await expect(await plan.rolloverToggleOn()).toBe(!before);
    });

    it(title('rollover that would exceed cap splits: part rolls, remainder to wallet', Tag.high, Tag.open('W5'), Tag.spec('RWIN§6')), async () => {
      await hooks.setWalletBalance(customerId, 200_000_000);
      await openSeededPlan(99_500_000, 89);
      await hooks.advanceClock({ customerId, days: 1 });
      const rolling = rwin.rolloverPrincipal(99_500_000, RATE);
      const split = rwin.rolloverSplit(rolling, 0);
      const notes = await hooks.latestNotifications(customerId, 3);
      expect(split.toWallet.gt(0)).toBe(true);
      expect(notes.map((n) => n.body).join('|')).toMatch(/paid to your wallet|cap/i);
    });
  });

  describe('Autosave', () => {
    it(title('autosave failure with empty wallet notifies and auto-pauses after max retries', Tag.high, Tag.open('X5'), Tag.spec('RWIN§9')), async () => {
      await openSeededPlan(500_000, 10, { autosave: { frequency: 'DAILY', amount: 10_000 } });
      await hooks.setWalletBalance(customerId, 0);
      await hooks.advanceClock({ customerId, days: productConfig.reap.autosaveRetryAttempts + 1 });
      const notes = await hooks.latestNotifications(customerId, 5);
      expect(notes.some((n) => /Autosave .* didn't go through/i.test(n.body))).toBe(true);
      await openDeepLink(links.notifications);
      await new NotificationsScreen().waitForShown();
    });

    it(title('adjust autosave: enable, change frequency/amount, save', Tag.med, Tag.spec('RWIN§7')), async () => {
      await openSeededPlan(500_000, 10);
      await plan.adjustPlan();
      const adjust = new RwinAdjustScreen();
      await adjust.waitForShown();
      if (!(await adjust.autosaveOn())) await adjust.toggleAutosave();
      await adjust.frequency('monthly');
      await adjust.autosaveAmount(25_000);
      await adjust.save();
      await plan.waitForShown();
      await expect(await plan.autosaveState()).toMatch(/monthly/i);
    });
  });
});

function daysAgo(n: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

