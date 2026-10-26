import { expect } from '@wdio/globals';
import { D, addMonths, daysBetween, formatNaira, toKobo } from '../../../shared/calc/money';
import { assertLinesReconcile } from '../../../shared/calc/wht';
import * as reap from '../../../shared/calc/reap';
import { productConfig } from '../../../shared/config/env';
import { Tag, title } from '../../../shared/support/tags';
import { planName } from '../../../shared/data/factories';
import { QaHooks } from '../../../shared/api/qa-hooks';
import { freshCustomer, openTab, requireHooks } from '../../helpers/session';
import { links, openDeepLink } from '../../helpers/deeplink';
import {
  REAP_RATES, SeededReapPlan, daysAgo, escapeRe, paceCopy, reapPlanOnSchedule, reapProjectedShortfall, reapSeedExtra, startForMaturityIn, today,
} from '../../helpers/investment-fixtures';
import { FundWalletScreen, WalletScreen } from '../../screens/common/WalletScreens';
import { ReapAddContributionScreen, ReapAdjustScreen, ReapBreakScreen, ReapPlanScreen, ReapScheduleScreen } from '../../screens/reap/ReapScreens';

/**
 * REAP — on-plan view, plan states, ad-hoc contribution, adjust plan, autosave, notifications, "cannot do"
 * (REAP_Customer_App_Spec §5–§7, §9–§12; Clarity E3–E6, E9, E13, X1, X5).
 */
describe('REAP › Plan lifecycle', () => {
  const cfg = productConfig.reap;
  const WALLET = 2_000_000;
  let hooks: QaHooks;
  let customerId: string;

  const plan = new ReapPlanScreen();
  const contribute = new ReapAddContributionScreen();
  const adjust = new ReapAdjustScreen();

  async function openSeededPlan(p: SeededReapPlan, o: { state?: string; name?: string; extra?: Record<string, unknown> } = {}) {
    const balance = reap.principal(p.contributions);
    const { investmentId } = await hooks.seedInvestment({
      customerId, product: 'REAP', state: o.state ?? 'ACTIVE', principal: balance.toNumber(), ratePct: REAP_RATES[p.tenorMonths],
      fundedDaysAgo: daysBetween(p.start, today()), extra: reapSeedExtra(p, { name: o.name ?? planName('Lifecycle'), ...o.extra }),
    });
    await openDeepLink(links.reapPlan(investmentId));
    await plan.waitForShown();
    return investmentId;
  }

  /** Plan with an explicit balance (single lump on the start date) — for pace/state scenarios. */
  function planWithBalance(o: { start: Date; tenorMonths: number; target: number; balance: number; frequency?: reap.Frequency; amount?: number }): SeededReapPlan {
    return {
      start: o.start, tenorMonths: o.tenorMonths, target: o.target, frequency: o.frequency ?? 'MONTHLY',
      contributionAmount: o.amount ?? 50_000, contributions: o.balance > 0 ? [{ amount: o.balance, on: o.start }] : [],
    };
  }

  beforeEach(async function () {
    requireHooks(this);
    ({ hooks, customerId } = await freshCustomer({ tier: 2, walletBalance: WALLET }));
    await hooks.setProductConfig({ product: 'REAP', patch: { ratesByTenorMonths: REAP_RATES, autosaveRetryAttempts: cfg.autosaveRetryAttempts } });
  });

  afterEach(async () => {
    await hooks?.resetClock().catch(() => undefined);
    await hooks?.dispose();
  });

  describe('On-plan view', () => {
    it(title('hero "₦X of ₦Y", progress %, accrued interest and key details match the oracle', Tag.crit, Tag.smoke, Tag.open('E1'), Tag.open('E3'), Tag.spec('REAP§5')), async () => {
      const p = reapPlanOnSchedule({ startedDaysAgo: 70, tenorMonths: 6, target: 600_000, frequency: 'MONTHLY', contributionAmount: 100_000 });
      const name = planName('Hero');
      await openSeededPlan(p, { name });
      const balance = reap.principal(p.contributions);
      const maturity = reap.maturityDate(p.start, 6);
      await expect(await plan.name()).toBe(name);
      await expect((await plan.balance()).toFixed(2)).toBe(balance.toFixed(2));
      await expect((await plan.target()).toFixed(2)).toBe('600000.00');
      await expect(await plan.progressPct()).toContain(`${reap.progressPct(balance, 600_000).toString()}%`);
      await expect((await plan.accruedInterest()).toFixed(2)).toBe(reap.accruedInterest(p.contributions, REAP_RATES[6], today()).toFixed(2));
      await expect(await plan.detail('rate')).toContain(`${REAP_RATES[6]}%`);
      await expect(await plan.detail('frequency')).toMatch(/monthly/i);
      await expect((await plan.contributionAmount()).toFixed(2)).toBe('100000.00');
      await expect(await plan.detail('maturityDate')).toContain(String(maturity.getUTCFullYear()));
      await expect(await plan.detail('daysRemaining')).toContain(String(daysBetween(today(), maturity)));
      await expect(await plan.tenorProgress()).toBeTruthy();
    });

    const paceCases: Array<{ status: reap.PaceStatus; offsetContributions: number }> = [
      { status: 'ON_TRACK', offsetContributions: 0 },
      { status: 'AHEAD', offsetContributions: 2.5 },
      { status: 'BEHIND', offsetContributions: -2.5 },
    ];
    for (const c of paceCases) {
      it(title(`pace status ${c.status} shown with the right copy (oracle paceStatus)`, Tag.high, Tag.open('E5'), Tag.spec('REAP§5'), Tag.spec('REAP§11')), async () => {
        const target = 1_200_000;
        const amount = 50_000;
        const start = daysAgo(90);
        const maturity = reap.maturityDate(start, 12);
        const expectedNow = D(target).mul(daysBetween(start, today())).div(daysBetween(start, maturity));
        const balance = toKobo(expectedNow.plus(D(amount).mul(c.offsetContributions))).toNumber();
        const status = reap.paceStatus({ start, maturity, asOf: today(), target, balance, contributionAmount: amount });
        expect(status).toBe(c.status);
        await openSeededPlan(planWithBalance({ start, tenorMonths: 12, target, balance, amount }));
        await expect(await plan.paceStatus()).toMatch(paceCopy[status]);
        if (status === 'BEHIND') await expect(await plan.paceSub()).toMatch(/increase your contribution|catch up/i);
      });
    }

    it(title('recent activity shows the last 5 contributions with date, amount and running balance', Tag.med, Tag.spec('REAP§5')), async () => {
      const p = reapPlanOnSchedule({ startedDaysAgo: 45, tenorMonths: 6, target: 500_000, frequency: 'WEEKLY', contributionAmount: 10_000 });
      await openSeededPlan(p);
      const total = reap.principal(p.contributions);
      expect(p.contributions.length).toBeGreaterThan(5);
      for (let i = 0; i < 5; i++) await expect(await plan.activityShown(i)).toBe(true);
      await expect(await plan.activityShown(5)).toBe(false);
      await expect((await plan.activity(0).amount()).toFixed(2)).toBe('10000.00');
      await expect((await plan.activity(0).runningBalance()).toFixed(2)).toBe(total.toFixed(2));
      await expect((await plan.activity(1).runningBalance()).toFixed(2)).toBe(total.minus(10_000).toFixed(2));
    });

    it(title('View schedule lists past contributions, projected future contributions, maturity date and projected total', Tag.med, Tag.open('E5'), Tag.spec('REAP§7')), async () => {
      const p = reapPlanOnSchedule({ startedDaysAgo: 65, tenorMonths: 6, target: 600_000, frequency: 'MONTHLY', contributionAmount: 100_000 });
      await openSeededPlan(p);
      await plan.viewSchedule();
      const schedule = new ReapScheduleScreen();
      await schedule.waitForShown();
      const maturity = reap.maturityDate(p.start, 6);
      const future = reap.scheduleDates(p.start, maturity, 'MONTHLY').filter((d) => d > today());
      for (let i = 0; i < p.contributions.length; i++) await expect(await schedule.pastShown(i)).toBe(true);
      await expect(await schedule.pastShown(p.contributions.length)).toBe(false);
      await expect(await schedule.projectedShown(future.length - 1)).toBe(true);
      await expect((await schedule.projected(0).amount()).toFixed(2)).toBe('100000.00');
      await expect(await schedule.maturityDate()).toContain(String(maturity.getUTCFullYear()));
      const projectedTotal = reap.principal(p.contributions).plus(D(100_000).mul(future.length));
      await expect((await schedule.projectedTotal()).toFixed(2)).toBe(projectedTotal.toFixed(2));
    });
  });

  describe('Plan states', () => {
    it(title('Autosave paused: amber banner; resuming from the plan view clears it', Tag.med, Tag.spec('REAP§6'), Tag.spec('REAP§7')), async () => {
      const p = reapPlanOnSchedule({ startedDaysAgo: 20, tenorMonths: 6, target: 600_000, frequency: 'WEEKLY', contributionAmount: 25_000 });
      await openSeededPlan(p, { extra: { autosave: { enabled: true, paused: true } } });
      await expect(await plan.banner()).toMatch(/autosave is paused/i);
      await plan.toggleAutosave();
      await expect(await plan.autosaveToggleOn()).toBe(true);
      await expect(await plan.bannerShown()).toBe(false);
    });

    it(title('Autosave failed (empty wallet): banner + notification + deep-link to wallet funding', Tag.high, Tag.open('E9'), Tag.spec('REAP§6'), Tag.spec('REAP§9')), async () => {
      const name = planName('Failed');
      const p = reapPlanOnSchedule({ startedDaysAgo: 3, tenorMonths: 3, target: 300_000, frequency: 'DAILY', contributionAmount: 5_000 });
      const id = await openSeededPlan(p, { name, extra: { autosave: { enabled: true } } });
      await hooks.setWalletBalance(customerId, 0);
      await hooks.advanceClock({ customerId, days: 1 });
      await openDeepLink(links.reapPlan(id));
      await plan.waitForShown();
      await expect(await plan.banner()).toMatch(/didn't go through.*wallet was empty/i);
      const notes = await hooks.latestNotifications(customerId, 3);
      expect(notes.map((n) => n.body).join('|')).toMatch(new RegExp(`${escapeRe(name)} contribution didn't go through`, 'i'));
      await plan.bannerFundWallet();
      await new FundWalletScreen().waitForShown();
    });

    it(title(`autosave retries ${productConfig.reap.autosaveRetryAttempts} times (notifying each attempt) then auto-pauses`, Tag.high, Tag.open('X5'), Tag.open('E9'), Tag.spec('REAP§10')), async () => {
      const p = reapPlanOnSchedule({ startedDaysAgo: 3, tenorMonths: 3, target: 300_000, frequency: 'DAILY', contributionAmount: 5_000 });
      const id = await openSeededPlan(p, { extra: { autosave: { enabled: true } } });
      await hooks.setWalletBalance(customerId, 0);
      await hooks.advanceClock({ customerId, days: cfg.autosaveRetryAttempts });
      const notes = await hooks.latestNotifications(customerId, cfg.autosaveRetryAttempts + 3);
      expect(notes.filter((n) => /didn't go through/i.test(n.body)).length).toBeGreaterThanOrEqual(cfg.autosaveRetryAttempts);
      await openDeepLink(links.reapPlan(id));
      await plan.waitForShown();
      await expect(await plan.autosaveToggleOn()).toBe(false);
      await expect(await plan.banner()).toMatch(/paused/i);
    });

    for (const daysLeft of productConfig.reap.behindScheduleNoticeDays) {
      it(title(`behind-schedule notification at the ${daysLeft}-day mark names days left and target`, Tag.med, Tag.open('E13'), Tag.open('E5'), Tag.spec('REAP§9')), async () => {
        const name = planName('Behind');
        const target = 600_000;
        const start = startForMaturityIn(daysLeft + 1, 6);
        await openSeededPlan(planWithBalance({ start, tenorMonths: 6, target, balance: 50_000 }), { name });
        await hooks.advanceClock({ customerId, days: 1 });
        const notes = await hooks.latestNotifications(customerId, 3);
        expect(notes.map((n) => n.body).join('|')).toMatch(new RegExp(`behind on ${escapeRe(name)}.*${daysLeft} days left.*${escapeRe(formatNaira(target, { kobo: false }))}`, 'i'));
      });
    }

    it(title('Approaching maturity: "30 days to maturity" countdown + notification with balance vs target', Tag.high, Tag.open('E13'), Tag.spec('REAP§6'), Tag.spec('REAP§9')), async () => {
      const name = planName('Soon');
      const start = startForMaturityIn(cfg.approachingMaturityDays + 1, 6);
      const id = await openSeededPlan(planWithBalance({ start, tenorMonths: 6, target: 600_000, balance: 450_000 }), { name });
      await hooks.advanceClock({ customerId, days: 1 });
      await openDeepLink(links.reapPlan(id));
      await plan.waitForShown();
      await expect(await plan.countdown()).toMatch(new RegExp(`${cfg.approachingMaturityDays} days to maturity`, 'i'));
      const notes = await hooks.latestNotifications(customerId, 3);
      expect(notes.map((n) => n.body).join('|')).toMatch(
        new RegExp(`${escapeRe(name)} matures in 30 days.*${escapeRe(formatNaira(450_000, { kobo: false }))} of ${escapeRe(formatNaira(600_000, { kobo: false }))}`, 'i'),
      );
    });

    it(title('Matured — target hit: celebration, principal + interest net of WHT paid (oracle maturityOutcome)', Tag.crit, Tag.open('E3'), Tag.open('X1'), Tag.spec('REAP§6'), Tag.spec('REAP§9')), async () => {
      const name = planName('Hit');
      const start = startForMaturityIn(1, 3);
      const contributions = [0, 1, 2].map((m) => ({ amount: 100_000, on: addMonths(start, m) }));
      const p: SeededReapPlan = { start, tenorMonths: 3, target: 300_000, frequency: 'MONTHLY', contributionAmount: 100_000, contributions };
      const id = await openSeededPlan(p, { name });
      const outcome = reap.maturityOutcome(contributions, 300_000, REAP_RATES[3], reap.maturityDate(start, 3));
      expect(outcome.targetMet).toBe(true);
      await hooks.advanceClock({ customerId, days: 1 });
      await openDeepLink(links.reapPlan(id));
      await plan.waitForShown();
      await expect(await plan.outcomeHeadline()).toMatch(/you did it/i);
      const gross = await plan.outcomeLine('grossInterest');
      const wht = await plan.outcomeLine('wht');
      const net = await plan.outcomeLine('netInterest');
      assertLinesReconcile({ gross, wht, net });
      expect(net.toFixed(2)).toBe(outcome.netInterest.toFixed(2));
      expect((await plan.outcomeLine('payout')).toFixed(2)).toBe(outcome.payout.toFixed(2));
      const notes = await hooks.latestNotifications(customerId, 3);
      expect(notes.map((n) => n.body).join('|')).toMatch(new RegExp(`hit your target.*${escapeRe(formatNaira(outcome.payout))}`, 'i'));
    });

    it(title('Matured — target missed: principal only returned, all interest forfeited (oracle)', Tag.crit, Tag.open('E3'), Tag.open('E6'), Tag.spec('REAP§6'), Tag.spec('REAP§9')), async () => {
      const name = planName('Missed');
      const start = startForMaturityIn(1, 3);
      const contributions = [0, 1, 2].map((m) => ({ amount: 100_000, on: addMonths(start, m) }));
      const p: SeededReapPlan = { start, tenorMonths: 3, target: 400_000, frequency: 'MONTHLY', contributionAmount: 100_000, contributions };
      const id = await openSeededPlan(p, { name });
      const outcome = reap.maturityOutcome(contributions, 400_000, REAP_RATES[3], reap.maturityDate(start, 3));
      expect(outcome.targetMet).toBe(false);
      await hooks.advanceClock({ customerId, days: 1 });
      await openDeepLink(links.reapPlan(id));
      await plan.waitForShown();
      await expect(await plan.outcomeBody()).toMatch(/target.*not met|didn't reach/i);
      await expect((await plan.outcomeLine('principal')).toFixed(2)).toBe(outcome.principal.toFixed(2));
      await expect((await plan.outcomeLine('interestForfeited')).toFixed(2)).toBe(outcome.forfeitedInterest.toFixed(2));
      await expect((await plan.outcomeLine('payout')).toFixed(2)).toBe(outcome.principal.toFixed(2));
      await expect(await plan.outcomeSuggestion()).toMatch(/next plan|start a new|try again/i);
      const notes = await hooks.latestNotifications(customerId, 3);
      expect(notes.map((n) => n.body).join('|')).toMatch(new RegExp(`principal of ${escapeRe(formatNaira(outcome.principal, { kobo: false }))}.*returned`, 'i'));
      await openTab('wallet');
      await expect((await new WalletScreen().balance()).toFixed(2)).toBe(toKobo(D(WALLET).plus(outcome.payout)).toFixed(2));
    });

    it(title('Broken: plan closed, principal returned, interest forfeited, no actions, history accessible', Tag.high, Tag.open('E6'), Tag.spec('REAP§6')), async () => {
      const p = reapPlanOnSchedule({ startedDaysAgo: 40, tenorMonths: 6, target: 600_000, frequency: 'MONTHLY', contributionAmount: 100_000 });
      await openSeededPlan(p, { state: 'BROKEN' });
      await expect(await plan.stateLabel()).toMatch(/broken|closed/i);
      await expect((await plan.outcomeLine('principal')).toFixed(2)).toBe(reap.principal(p.contributions).toFixed(2));
      await expect(await plan.breakActionExists()).toBe(false);
      await expect(await plan.activityShown(0)).toBe(true);
    });

    it(title('Under review: banner shown and every transactional action disabled with tooltip', Tag.crit, Tag.open('E7'), Tag.spec('REAP§6'), Tag.spec('REAP§10')), async () => {
      const p = reapPlanOnSchedule({ startedDaysAgo: 40, tenorMonths: 6, target: 600_000, frequency: 'MONTHLY', contributionAmount: 100_000 });
      await openSeededPlan(p, { state: 'UNDER_REVIEW' });
      await expect(await plan.banner()).toMatch(/under review by our team/i);
      await expect(await plan.addContributionEnabled()).toBe(false);
      await expect(await plan.adjustEnabled()).toBe(false);
      await expect(await plan.breakEnabled()).toBe(false);
      for (const a of ['addContribution', 'adjust', 'break'] as const) {
        await expect(await plan.disabledActionTooltip(a)).toMatch(/unavailable while your plan is under review/i);
      }
    });
  });

  describe('Add contribution (ad-hoc)', () => {
    it(title('ad-hoc contribution: confirm shows amount + remaining to target; success updates balance, debits wallet, notifies', Tag.crit, Tag.smoke, Tag.spec('REAP§7'), Tag.spec('REAP§9')), async () => {
      const name = planName('Adhoc');
      const p = reapPlanOnSchedule({ startedDaysAgo: 40, tenorMonths: 6, target: 600_000, frequency: 'MONTHLY', contributionAmount: 100_000 });
      await openSeededPlan(p, { name });
      const balance = reap.principal(p.contributions);
      const amount = 25_000;
      await plan.addContribution();
      await contribute.waitForShown();
      await contribute.enterAmount(amount);
      await contribute.continue();
      await expect((await contribute.confirmAmount()).toFixed(2)).toBe(D(amount).toFixed(2));
      await expect((await contribute.confirmRemaining()).toFixed(2)).toBe(D(600_000).minus(balance).minus(amount).toFixed(2));
      await expect(await contribute.confirmProjection()).toBeTruthy();
      await contribute.confirm();
      await expect(await contribute.successText()).toMatch(/added/i);
      await expect((await contribute.successBalance()).toFixed(2)).toBe(balance.plus(amount).toFixed(2));
      const notes = await hooks.latestNotifications(customerId, 1);
      expect(notes[0].body).toMatch(new RegExp(`Contribution of ${escapeRe(formatNaira(amount, { kobo: false }))}.*added to ${escapeRe(name)}`, 'i'));
      await openTab('wallet');
      await expect((await new WalletScreen().balance()).toFixed(2)).toBe(toKobo(WALLET - amount).toFixed(2));
    });

    it(title('empty wallet: two-clause error, deep-link to funding, amount preserved on return', Tag.crit, Tag.spec('REAP§10')), async () => {
      await hooks.setWalletBalance(customerId, 0);
      const p = reapPlanOnSchedule({ startedDaysAgo: 40, tenorMonths: 6, target: 600_000, frequency: 'MONTHLY', contributionAmount: 100_000 });
      await openSeededPlan(p);
      await plan.addContribution();
      await contribute.enterAmount(20_000);
      await expect(await contribute.amountError()).toMatch(/not enough in your wallet.*fund your wallet/i);
      await expect(await contribute.continueEnabled()).toBe(false);
      await contribute.fundWallet();
      await new FundWalletScreen().waitForShown();
      await hooks.setWalletBalance(customerId, 100_000);
      await new FundWalletScreen().goBack();
      await contribute.waitForShown();
      await expect((await contribute.amountValue()).toFixed(2)).toBe('20000.00');
    });

    it(title('amount above wallet balance (max = wallet balance) is rejected', Tag.crit, Tag.spec('REAP§7')), async () => {
      await hooks.setWalletBalance(customerId, 10_000);
      const p = reapPlanOnSchedule({ startedDaysAgo: 40, tenorMonths: 6, target: 600_000, frequency: 'MONTHLY', contributionAmount: 100_000 });
      await openSeededPlan(p);
      await plan.addContribution();
      await contribute.enterAmount(10_000.01);
      await expect(await contribute.continueEnabled()).toBe(false);
      await contribute.enterAmount(10_000);
      await expect(await contribute.continueEnabled()).toBe(true);
    });

    it(title('contribution well past target shows a non-blocking soft warning', Tag.high, Tag.open('E4'), Tag.spec('REAP§10')), async () => {
      await openSeededPlan(planWithBalance({ start: daysAgo(60), tenorMonths: 6, target: 300_000, balance: 290_000 }));
      await plan.addContribution();
      await contribute.enterAmount(200_000);
      await expect(await contribute.exceedTargetWarningShown()).toBe(true);
      await expect(await contribute.exceedTargetWarning()).toContain(formatNaira(300_000, { kobo: false }));
      await expect(await contribute.continueEnabled()).toBe(true);
      await contribute.continue();
      await contribute.confirm();
      await expect((await contribute.successBalance()).toFixed(2)).toBe('490000.00');
    });
  });

  describe('Adjust plan', () => {
    it(title('tenor and target cannot be changed; frequency, amount and autosave can', Tag.crit, Tag.spec('REAP§7'), Tag.spec('REAP§12')), async () => {
      const p = reapPlanOnSchedule({ startedDaysAgo: 20, tenorMonths: 6, target: 600_000, frequency: 'MONTHLY', contributionAmount: 100_000 });
      await openSeededPlan(p);
      await plan.adjustPlan();
      await adjust.waitForShown();
      await expect(await adjust.tenorEditable()).toBe(false);
      await expect(await adjust.targetEditable()).toBe(false);
      await adjust.frequency('weekly');
      await adjust.enterAmount(30_000);
      await adjust.save();
      await plan.waitForShown();
      await expect(await plan.detail('frequency')).toMatch(/weekly/i);
      await expect((await plan.contributionAmount()).toFixed(2)).toBe('30000.00');
      await expect((await plan.target()).toFixed(2)).toBe('600000.00');
    });

    it(title('new pace that will miss target shows non-blocking "₦X short" warning (oracle) and still saves', Tag.high, Tag.open('E5'), Tag.spec('REAP§10')), async () => {
      const start = daysAgo(30);
      const target = 1_200_000;
      await openSeededPlan(planWithBalance({ start, tenorMonths: 12, target, balance: 100_000, amount: 100_000 }));
      await plan.adjustPlan();
      await adjust.frequency('monthly');
      await adjust.enterAmount(10_000);
      const shortfall = reapProjectedShortfall({ balance: 100_000, target, maturity: reap.maturityDate(start, 12), frequency: 'MONTHLY', amount: 10_000 });
      expect(shortfall.gt(0)).toBe(true);
      await expect(await adjust.shortfallWarningShown()).toBe(true);
      await expect(await adjust.shortfallWarning()).toContain(formatNaira(shortfall, { kobo: false }));
      await expect(await adjust.saveEnabled()).toBe(true);
      await adjust.save();
      await plan.waitForShown();
      await expect((await plan.contributionAmount()).toFixed(2)).toBe('10000.00');
    });

    it(title('pause / resume autosave from the plan view is instant', Tag.med, Tag.spec('REAP§7')), async () => {
      const p = reapPlanOnSchedule({ startedDaysAgo: 20, tenorMonths: 6, target: 600_000, frequency: 'WEEKLY', contributionAmount: 25_000 });
      await openSeededPlan(p, { extra: { autosave: { enabled: true } } });
      await expect(await plan.autosaveToggleOn()).toBe(true);
      await plan.toggleAutosave();
      await expect(await plan.autosaveToggleOn()).toBe(false);
      await expect(await plan.detail('autosave')).toMatch(/paused|off/i);
      await plan.toggleAutosave();
      await expect(await plan.autosaveToggleOn()).toBe(true);
    });
  });

  describe('Notifications', () => {
    it(title('scheduled contribution: "₦X added to [plan]. New balance: ₦Y"', Tag.med, Tag.spec('REAP§9')), async () => {
      const name = planName('Sched');
      const p = reapPlanOnSchedule({ startedDaysAgo: 6, tenorMonths: 3, target: 300_000, frequency: 'WEEKLY', contributionAmount: 20_000 });
      await openSeededPlan(p, { name, extra: { autosave: { enabled: true } } });
      await hooks.advanceClock({ customerId, days: 1 });
      const newBalance = reap.principal(p.contributions).plus(20_000);
      const notes = await hooks.latestNotifications(customerId, 3);
      expect(notes.map((n) => n.body).join('|')).toMatch(
        new RegExp(`${escapeRe(formatNaira(20_000, { kobo: false }))} added to ${escapeRe(name)}.*New balance: ${escapeRe(formatNaira(newBalance, { kobo: false }))}`, 'i'),
      );
    });

    it(title('daily-frequency plans receive one daily digest, not one push per contribution', Tag.low, Tag.open('E13'), Tag.spec('REAP§9')), async () => {
      const p = reapPlanOnSchedule({ startedDaysAgo: 2, tenorMonths: 3, target: 300_000, frequency: 'DAILY', contributionAmount: 5_000 });
      await openSeededPlan(p, { extra: { autosave: { enabled: true } } });
      await hooks.advanceClock({ customerId, days: 1 });
      const notes = await hooks.latestNotifications(customerId, 10);
      expect(notes.filter((n) => n.channel === 'PUSH' && /added to/i.test(n.body)).length).toBeLessThanOrEqual(1);
    });
  });

  describe('What the customer cannot do', () => {
    it(title('no UI to self-break, waive forfeiture, unlock, or change target / tenor / name / payout', Tag.crit, Tag.spec('REAP§12')), async () => {
      const p = reapPlanOnSchedule({ startedDaysAgo: 20, tenorMonths: 6, target: 600_000, frequency: 'MONTHLY', contributionAmount: 100_000 });
      await openSeededPlan(p);
      for (const id of ['editTarget', 'editTenor', 'editName', 'payoutSelector', 'waiveForfeiture', 'unlock', 'selfBreak'] as const) {
        await expect(await plan.forbiddenControlShown(id)).toBe(false);
      }
      // "Request break" exists but only opens the request flow — it never closes the plan directly.
      await plan.requestBreak();
      await new ReapBreakScreen().waitForShown();
    });
  });
});
