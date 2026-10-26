import { expect } from '@wdio/globals';
import { D, formatNaira, toKobo } from '../../../shared/calc/money';
import * as reap from '../../../shared/calc/reap';
import { canBookInvestment } from '../../../shared/calc/tier';
import { productConfig } from '../../../shared/config/env';
import { Tag, title } from '../../../shared/support/tags';
import { planName } from '../../../shared/data/factories';
import { QaHooks } from '../../../shared/api/qa-hooks';
import { freshCustomer, openTab, requireHooks } from '../../helpers/session';
import { REAP_RATES, escapeRe, reapPlanOnSchedule, reapSeedExtra, reapTenorCardProjectedTotal, today } from '../../helpers/investment-fixtures';
import { GrowHomeScreen } from '../../screens/common/HomeScreens';
import { FundWalletScreen, WalletScreen } from '../../screens/common/WalletScreens';
import { ReapBookingScreen, ReapFrequency, ReapLandingScreen, ReapPlanScreen } from '../../screens/reap/ReapScreens';

/**
 * REAP — landing + booking flow (REAP_Customer_App_Spec §2–§4; Calculator Spec §2, §3.1; Clarity E1–E5, E11, E12, X4).
 * Risk: Investment returns / limits / KYC gating = CRIT (QA Strategy §7). Class A (§8).
 */
describe('REAP › Booking', () => {
  const cfg = productConfig.reap;
  const WALLET = 5_000_000;
  let hooks: QaHooks;
  let customerId: string;

  const grow = new GrowHomeScreen();
  const landing = new ReapLandingScreen();
  const booking = new ReapBookingScreen();
  const plan = new ReapPlanScreen();

  beforeEach(async function () {
    requireHooks(this);
    ({ hooks, customerId } = await freshCustomer({ tier: 2, walletBalance: WALLET }));
    await hooks.setProductConfig({ product: 'REAP', patch: { ratesByTenorMonths: REAP_RATES, tenorsMonths: cfg.tenorsMonths, minTarget: cfg.minTarget } });
    await openTab('grow');
    await grow.openTile('reap');
    await landing.waitForShown();
  });

  afterEach(async () => {
    await hooks?.dispose();
  });

  describe('Landing', () => {
    it(title('empty-state landing shows value props, Start a plan, how-it-works and a rate per tenor', Tag.high, Tag.open('E2'), Tag.spec('REAP§3')), async () => {
      await expect(await landing.valueProps()).toMatch(/target|interest|contribut/i);
      await landing.expandHowItWorks();
      await expect(await landing.howItWorksText()).toMatch(/target|contribute|interest/i);
      for (const t of cfg.tenorsMonths) {
        await expect(await landing.rateTableRate(t)).toContain(`${REAP_RATES[t]}%`);
      }
      await expect(await landing.faqShown()).toBe(true);
      await expect(await landing.planCardShown(0)).toBe(false);
    });

    it(title('with-plans landing lists each plan with target, balance, oracle progress % and Start another plan', Tag.high, Tag.open('E3'), Tag.spec('REAP§3')), async () => {
      const p = reapPlanOnSchedule({ startedDaysAgo: 65, tenorMonths: 6, target: 600_000, frequency: 'MONTHLY', contributionAmount: 100_000 });
      const balance = reap.principal(p.contributions);
      const name = planName('Landing');
      await hooks.seedInvestment({ customerId, product: 'REAP', state: 'ACTIVE', principal: balance.toNumber(), ratePct: REAP_RATES[6], fundedDaysAgo: 65, extra: reapSeedExtra(p, { name }) });
      await openTab('grow');
      await grow.openTile('reap');
      await landing.waitForShown();
      const card = landing.planCard(0);
      await expect(await card.name()).toBe(name);
      await expect((await card.target()).toFixed(2)).toBe(D(600_000).toFixed(2));
      await expect((await card.balance()).toFixed(2)).toBe(balance.toFixed(2));
      await expect(await card.progress()).toContain(`${reap.progressPct(balance, 600_000).toString()}%`);
      await expect(await card.timeRemaining()).toMatch(/day|month/i);
      await expect(await landing.startAnotherShown()).toBe(true);
    });

    it(title('plan-count cap reached replaces Start another plan with cap message', Tag.med, Tag.open('E12'), Tag.spec('REAP§3')), async () => {
      await hooks.setProductConfig({ product: 'REAP', patch: { maxPlansPerCustomer: 1 } });
      const p = reapPlanOnSchedule({ startedDaysAgo: 10, tenorMonths: 3, target: 90_000, frequency: 'MONTHLY', contributionAmount: 30_000 });
      await hooks.seedInvestment({ customerId, product: 'REAP', state: 'ACTIVE', principal: 30_000, ratePct: REAP_RATES[3], fundedDaysAgo: 10, extra: reapSeedExtra(p) });
      await openTab('grow');
      await grow.openTile('reap');
      await landing.waitForShown();
      await expect(await landing.startAnotherShown()).toBe(false);
      await expect(await landing.planCapMessage()).toMatch(/maximum|limit|cap/i);
    });
  });

  describe('Step 1 — Name your plan', () => {
    it(title('name: required, min 3 chars, max 40 chars, Continue gated', Tag.med, Tag.spec('REAP§4.1')), async () => {
      await landing.startPlan();
      await booking.waitForShown();
      await expect(await booking.continueEnabled()).toBe(false);
      await booking.enterName('ab');
      await expect(await booking.continueEnabled()).toBe(false);
      await booking.enterName('x'.repeat(45));
      await expect((await booking.nameValue()).length).toBeLessThanOrEqual(40);
      await booking.enterName('Vacation');
      await expect(await booking.continueEnabled()).toBe(true);
    });

    it(title('duplicate plan names are allowed', Tag.low, Tag.spec('REAP§4.1')), async () => {
      const p = reapPlanOnSchedule({ startedDaysAgo: 5, tenorMonths: 3, target: 90_000, frequency: 'MONTHLY', contributionAmount: 30_000 });
      await hooks.seedInvestment({ customerId, product: 'REAP', state: 'ACTIVE', principal: 30_000, ratePct: REAP_RATES[3], fundedDaysAgo: 5, extra: reapSeedExtra(p, { name: 'Vacation' }) });
      await openTab('grow');
      await grow.openTile('reap');
      await landing.startAnother();
      await booking.waitForShown();
      await booking.enterName('Vacation');
      await expect(await booking.continueEnabled()).toBe(true);
    });
  });

  describe('Step 2 — Set your target', () => {
    it(title('target below configured minimum is rejected with a two-clause error naming the minimum', Tag.crit, Tag.spec('REAP§4.2')), async () => {
      await walkTo(2);
      await booking.enterTarget(cfg.minTarget - 1);
      await expect(await booking.continueEnabled()).toBe(false);
      await expect(await booking.targetError()).toContain(formatNaira(cfg.minTarget, { kobo: false }));
      await booking.enterTarget(cfg.minTarget);
      await expect(await booking.continueEnabled()).toBe(true);
    });

    it(title('target above wallet capacity / tier limit is rejected', Tag.crit, Tag.open('E12'), Tag.spec('REAP§4.2')), async () => {
      await walkTo(2);
      await booking.enterTarget(1_000_000_000_000);
      await expect(await booking.continueEnabled()).toBe(false);
      await expect(await booking.targetError()).toMatch(/limit|maximum|capacity/i);
    });

    it(title('empty target keeps Continue disabled', Tag.med, Tag.spec('REAP§4.2')), async () => {
      await walkTo(2);
      await expect(await booking.continueEnabled()).toBe(false);
    });

    for (const chip of [100_000, 500_000, 1_000_000, 5_000_000, 10_000_000]) {
      it(title(`quick chip ${formatNaira(chip, { kobo: false })} fills the target input`, Tag.low, Tag.spec('REAP§4.2')), async () => {
        await walkTo(2);
        await booking.tapTargetChip(chip);
        await expect((await booking.targetValue()).toFixed(2)).toBe(D(chip).toFixed(2));
      });
    }
  });

  describe('Step 3 — Choose your tenor', () => {
    const TARGET = 1_200_000;

    for (const tenor of productConfig.reap.tenorsMonths) {
      it(title(`${tenor}-month card shows its rate and the oracle projected total if target met`, Tag.crit, Tag.open('E2'), Tag.open('E5'), Tag.open('X4'), Tag.spec('REAP§4.3')), async () => {
        await walkTo(3, { target: TARGET });
        const card = booking.tenorCard(tenor);
        await expect(await card.shown()).toBe(true);
        await expect(await card.length()).toContain(String(tenor));
        await expect(await card.rate()).toContain(`${REAP_RATES[tenor]}%`);
        const expected = reapTenorCardProjectedTotal(TARGET, tenor, REAP_RATES[tenor]);
        await expect((await card.projectedTotal()).toFixed(2)).toBe(expected.toFixed(2));
      });
    }

    it(title('tenor selection is single-select and Continue requires a selection', Tag.med, Tag.spec('REAP§4.3')), async () => {
      await walkTo(3);
      await expect(await booking.continueEnabled()).toBe(false);
      await booking.tenorCard(6).select();
      await expect(await booking.tenorCard(6).selected()).toBe(true);
      await booking.tenorCard(12).select();
      await expect(await booking.tenorCard(12).selected()).toBe(true);
      await expect(await booking.tenorCard(6).selected()).toBe(false);
      await expect(await booking.continueEnabled()).toBe(true);
    });
  });

  describe('Step 4 — Contribution rhythm', () => {
    for (const f of ['daily', 'weekly', 'monthly'] as const) {
      it(title(`${f}: shows contribution amount and autosave toggle defaulting ON`, Tag.high, Tag.spec('REAP§4.4')), async () => {
        await walkTo(4);
        await booking.frequency(f);
        await expect(await booking.contributionInputShown()).toBe(true);
        await expect(await booking.autosaveShown()).toBe(true);
        await expect(await booking.autosaveOn()).toBe(true);
      });
    }

    it(title('On-demand hides amount and autosave and explains autosave does not apply', Tag.high, Tag.spec('REAP§4.4'), Tag.spec('REAP§11')), async () => {
      await walkTo(4);
      await booking.frequency('monthly');
      await expect(await booking.autosaveShown()).toBe(true);
      await booking.frequency('onDemand');
      await expect(await booking.contributionInputShown()).toBe(false);
      await expect(await booking.autosaveShown()).toBe(false);
      await expect(await booking.onDemandWarning()).toMatch(/autosave/i);
      await expect(await booking.continueEnabled()).toBe(true);
    });

    it(title('Continue disabled with no frequency, and with a scheduled frequency but no amount', Tag.med, Tag.spec('REAP§4.4')), async () => {
      await walkTo(4);
      await expect(await booking.continueEnabled()).toBe(false);
      await booking.frequency('weekly');
      await expect(await booking.continueEnabled()).toBe(false);
      await booking.enterContribution(10_000);
      await expect(await booking.continueEnabled()).toBe(true);
    });

    const paceCases: Array<{ amount: number; expect: 'ahead' | 'behind' | 'onSchedule' }> = [
      { amount: 100_000, expect: 'ahead' },
      { amount: 50_000, expect: 'onSchedule' },
      { amount: 25_000, expect: 'behind' },
    ];
    for (const c of paceCases) {
      it(title(`live pace calculator (monthly ${formatNaira(c.amount, { kobo: false })} toward ₦600,000 in 12 months) → ${c.expect}`, Tag.high, Tag.open('E5'), Tag.spec('REAP§4.4'), Tag.spec('REAP§11')), async () => {
        const target = 600_000;
        const tenor = 12;
        await walkTo(4, { target, tenor });
        await booking.frequency('monthly');
        await booking.enterContribution(c.amount);
        const months = reap.periodsToTarget(target, c.amount);
        await expect(await booking.paceMonths()).toContain(String(months));
        const pace = await booking.paceText();
        if (c.expect === 'ahead') await expect(pace).toMatch(/ahead/i);
        if (c.expect === 'behind') await expect(pace).toMatch(/behind/i);
        if (c.expect === 'onSchedule') await expect(pace).not.toMatch(/ahead|behind/i);
      });
    }

    it(title('pace calculator updates in real time as amount and frequency change', Tag.med, Tag.open('E5'), Tag.spec('REAP§4.4')), async () => {
      await walkTo(4, { target: 600_000, tenor: 12 });
      await booking.frequency('monthly');
      await booking.enterContribution(100_000);
      const first = await booking.paceText();
      await booking.enterContribution(20_000);
      const second = await booking.paceText();
      expect(second).not.toBe(first);
      await booking.frequency('weekly');
      expect(await booking.paceText()).not.toBe(second);
    });
  });

  describe('Step 5 — Payout destination', () => {
    it(title('payout destination is wallet, display only (not a selector)', Tag.med, Tag.spec('REAP§4.5'), Tag.spec('REAP§12')), async () => {
      await walkTo(5);
      await expect(await booking.payoutDestinationText()).toMatch(/wallet/i);
      await expect(await booking.payoutIsSelector()).toBe(false);
    });
  });

  describe('Step 6 — Review and confirm', () => {
    it(title('review shows every field with oracle projected interest, maturity date and forfeiture reminder', Tag.crit, Tag.open('E1'), Tag.open('X4'), Tag.spec('REAP§4.6')), async () => {
      const name = planName('Review');
      const o = { name, target: 600_000, tenor: 6, frequency: 'monthly' as const, amount: 100_000 };
      await walkTo(6, o);
      await expect(await booking.reviewValue('name')).toBe(name);
      await expect((await booking.reviewAmount('target')).toFixed(2)).toBe(D(o.target).toFixed(2));
      await expect(await booking.reviewValue('tenor')).toContain('6');
      await expect(await booking.reviewValue('rate')).toContain(`${REAP_RATES[6]}%`);
      await expect(await booking.reviewValue('frequency')).toMatch(/monthly/i);
      await expect((await booking.reviewAmount('contribution')).toFixed(2)).toBe(D(o.amount).toFixed(2));
      await expect(await booking.reviewValue('autosave')).toMatch(/on/i);
      const maturity = reap.maturityDate(today(), 6);
      await expect(await booking.reviewValue('maturityDate')).toContain(String(maturity.getUTCFullYear()));
      await expect(await booking.reviewValue('maturityDate')).toContain(String(maturity.getUTCDate()));
      const projected = reap.projectedInterest(today(), 6, 'MONTHLY', o.amount, REAP_RATES[6]);
      await expect((await booking.reviewAmount('projectedInterest')).toFixed(2)).toBe(projected.toFixed(2));
      await expect(await booking.forfeitureReminder()).toMatch(/miss your target.*interest.*forfeited/i);
    });

    it(title('On-demand review shows no contribution amount and autosave not applicable', Tag.med, Tag.spec('REAP§4.6')), async () => {
      await walkTo(6, { frequency: 'onDemand' });
      await expect(await booking.reviewValue('frequency')).toMatch(/on.?demand/i);
      await expect(await booking.reviewValue('autosave')).toMatch(/off|not applicable|n\/a/i);
    });

    it(title('Edit returns to the relevant step', Tag.low, Tag.spec('REAP§4.6')), async () => {
      await walkTo(6);
      await booking.edit('target');
      await expect(await booking.currentStep()).toMatch(/target/i);
    });
  });

  describe('Step 7–8 — Funding and confirmation', () => {
    it(title('plan created: first autosave contribution debited from wallet, success screen and notification', Tag.crit, Tag.smoke, Tag.open('E11'), Tag.spec('REAP§4.7-8'), Tag.spec('REAP§9')), async () => {
      const name = planName('Happy');
      const amount = 50_000;
      await walkTo(6, { name, target: 300_000, tenor: 6, frequency: 'monthly', amount });
      await booking.createPlan();
      await expect(await booking.successHeadline()).toMatch(new RegExp(`${escapeRe(name)}.*active`, 'i'));
      await expect(await booking.successStat('target')).toContain(formatNaira(300_000, { kobo: false }));
      await expect(await booking.successStat('schedule')).toMatch(/monthly/i);
      await booking.successViewPlan();
      await plan.waitForShown();
      await expect((await plan.target()).toFixed(2)).toBe('300000.00');
      await expect((await plan.balance()).toFixed(2)).toBe(D(amount).toFixed(2));
      await openTab('wallet');
      await expect((await new WalletScreen().balance()).toFixed(2)).toBe(toKobo(WALLET - amount).toFixed(2));
      const notes = await hooks.latestNotifications(customerId, 3);
      expect(notes.map((n) => n.body).join('|')).toMatch(new RegExp(`${escapeRe(name)} plan is active`, 'i'));
    });

    it(title('On-demand plan with no opening contribution creates without a wallet debit', Tag.high, Tag.open('E11'), Tag.spec('REAP§4.7')), async () => {
      await walkTo(6, { frequency: 'onDemand' });
      await booking.createPlan();
      await expect(await booking.successHeadline()).toMatch(/active/i);
      await openTab('wallet');
      await expect((await new WalletScreen().balance()).toFixed(2)).toBe(toKobo(WALLET).toFixed(2));
    });

    it(title('insufficient wallet for first contribution deep-links to wallet funding', Tag.crit, Tag.spec('REAP§4.7')), async () => {
      await hooks.setWalletBalance(customerId, 1_000);
      await walkTo(6, { frequency: 'daily', amount: 5_000 });
      await booking.createPlan();
      await expect(await booking.insufficientFundsShown()).toBe(true);
      await expect(await booking.insufficientFundsText()).toMatch(/fund your wallet/i);
      await booking.tapFundWallet();
      await new FundWalletScreen().waitForShown();
    });

    it(title('success "Start another plan" restarts booking at Step 1', Tag.low, Tag.spec('REAP§4.8')), async () => {
      await walkTo(6, { frequency: 'onDemand' });
      await booking.createPlan();
      await booking.successStartAnother();
      await booking.waitForShown();
      await expect(await booking.continueEnabled()).toBe(false);
    });
  });

  describe('Tier gating', () => {
    it(title('Tier 1 customer cannot book REAP — routed to KYC upgrade (Tier 2 gate)', Tag.crit, Tag.spec('Calc§2')), async () => {
      expect(canBookInvestment(1, 'REAP')).toBe(false);
      await hooks.dispose();
      ({ hooks, customerId } = await freshCustomer({ tier: 1, walletBalance: 1_000_000 }));
      await openTab('grow');
      await grow.openTile('reap');
      await landing.waitForShown();
      await landing.startPlan();
      await expect(await booking.isShown()).toBe(false);
      await expect(await landing.kycUpgradePromptShown()).toBe(true);
      await expect(await landing.kycUpgradePromptText()).toMatch(/tier 2|upgrade|verify/i);
    });

    it(title('Tier 3 customer can book REAP', Tag.med, Tag.spec('Calc§2')), async () => {
      expect(canBookInvestment(3, 'REAP')).toBe(true);
      await hooks.dispose();
      ({ hooks, customerId } = await freshCustomer({ tier: 3, walletBalance: 1_000_000 }));
      await openTab('grow');
      await grow.openTile('reap');
      await landing.startPlan();
      await booking.waitForShown();
    });
  });

  type WalkOpts = { name?: string; target?: number; tenor?: number; frequency?: ReapFrequency; amount?: number };

  async function walkTo(step: 2 | 3 | 4 | 5 | 6, o: WalkOpts = {}) {
    await landing.startPlan();
    await booking.waitForShown();
    await booking.enterName(o.name ?? planName());
    await booking.continue(); // → target
    if (step === 2) return;
    await booking.enterTarget(o.target ?? 300_000);
    await booking.continue(); // → tenor
    if (step === 3) return;
    await booking.tenorCard(o.tenor ?? 6).select();
    await booking.continue(); // → rhythm
    if (step === 4) return;
    const f = o.frequency ?? 'monthly';
    await booking.frequency(f);
    if (f !== 'onDemand') await booking.enterContribution(o.amount ?? 50_000);
    await booking.continue(); // → payout
    if (step === 5) return;
    await booking.continue(); // → review
  }
});
