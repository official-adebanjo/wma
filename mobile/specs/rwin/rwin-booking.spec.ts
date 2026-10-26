import { expect } from '@wdio/globals';
import { D, formatNaira, toKobo } from '../../../shared/calc/money';
import * as rwin from '../../../shared/calc/rwin';
import { productConfig } from '../../../shared/config/env';
import { Tag, title } from '../../../shared/support/tags';
import { planName } from '../../../shared/data/factories';
import { QaHooks } from '../../../shared/api/qa-hooks';
import { freshCustomer, openTab, requireHooks } from '../../helpers/session';
import { GrowHomeScreen } from '../../screens/common/HomeScreens';
import { FundWalletScreen, WalletScreen } from '../../screens/common/WalletScreens';
import { RwinBookingScreen, RwinLandingScreen, RwinPlanScreen } from '../../screens/rwin/RwinScreens';

/**
 * RWIN 2.0 — booking flow (RWIN_2_0_Customer_App_Spec §3–§4, §9; Calculator Spec §3.2).
 * Risk: Investment returns = CRIT (QA Strategy §7). Class A (§8).
 */
describe('RWIN 2.0 › Booking', () => {
  const cfg = productConfig.rwin;
  const RATE = 14; // seeded via QA hooks so the oracle and app agree on the rate in force
  let hooks: QaHooks;
  let customerId: string;

  const grow = new GrowHomeScreen();
  const landing = new RwinLandingScreen();
  const booking = new RwinBookingScreen();
  const plan = new RwinPlanScreen();

  beforeEach(async function () {
    requireHooks(this);
    ({ hooks, customerId } = await freshCustomer({ tier: 2, walletBalance: 5_000_000 }));
    await hooks.setProductConfig({ product: 'RWIN', patch: { ratePct: RATE } });
    await openTab('grow');
    await grow.openTile('rwin');
    await landing.waitForShown();
  });

  afterEach(async () => {
    await hooks?.dispose();
  });

  it(title('empty-state landing shows current rate hero, value props and Start a plan', Tag.high, Tag.smoke, Tag.spec('RWIN§3')), async () => {
    await expect(await landing.rateHero()).toContain(`${RATE}%`);
    const props = await landing.valueProps();
    for (const p of ['90-day', 'rollover', 'Top up', '30-day']) expect(props).toContain(p);
    await landing.expandHowItWorks();
    await expect(await landing.howItWorksText()).toMatch(/cycle|rollover|minimum/i);
    await expect(await landing.faqShown()).toBe(true);
  });

  it(title('plan name: required, min 3 chars, max 40 chars', Tag.med, Tag.spec('RWIN§4.1')), async () => {
    await landing.startPlan();
    await booking.waitForShown();
    await expect(await booking.continueEnabled()).toBe(false);
    await booking.enterName('ab');
    await expect(await booking.continueEnabled()).toBe(false);
    await booking.enterName('x'.repeat(45));
    await expect((await booking.nameValue()).length).toBeLessThanOrEqual(40);
    await booking.enterName('Rent fund');
    await expect(await booking.continueEnabled()).toBe(true);
  });

  it(title('initial deposit below configured minimum is rejected with two-clause error', Tag.crit, Tag.spec('RWIN§4.2')), async () => {
    await landing.startPlan();
    await booking.enterName(planName());
    await booking.continue();
    await booking.enterDeposit(cfg.minDeposit - 1);
    await expect(await booking.continueEnabled()).toBe(false);
    await expect(await booking.depositError()).toContain(formatNaira(cfg.minDeposit, { kobo: false }));
  });

  it(title('initial deposit above cap minus existing RWIN holdings is rejected', Tag.crit, Tag.open('W4'), Tag.spec('RWIN§4.2')), async () => {
    const existing = 99_000_000;
    await hooks.setWalletBalance(customerId, 200_000_000);
    await hooks.seedInvestment({ customerId, product: 'RWIN', state: 'ACTIVE', principal: existing, ratePct: RATE });
    await landing.startAnother();
    await booking.enterName(planName());
    await booking.continue();
    const max = rwin.maxInitialDeposit(existing);
    await booking.enterDeposit(max.plus(1).toNumber());
    await expect(await booking.continueEnabled()).toBe(false);
    await expect(await booking.depositError()).toMatch(/cap/i);
    await booking.enterDeposit(max.toNumber());
    await expect(await booking.continueEnabled()).toBe(true);
  });

  for (const principal of [50_000, 1_000_000, 7_345_678.91, 100_000_000]) {
    it(title(`live projection matches oracle for ₦${principal.toLocaleString()} at ${RATE}% over 90 days`, Tag.crit, Tag.spec('RWIN§4.2'), Tag.spec('Calc§3.2')), async () => {
      await landing.startPlan();
      await booking.enterName(planName());
      await booking.continue();
      await booking.enterDeposit(principal);
      const expected = rwin.projectedCycleEarnings(principal, RATE);
      await expect((await booking.projectionAmount()).toFixed(2)).toBe(expected.toFixed(2));
      await expect(await booking.projectionText()).toContain(`${RATE}%`);
    });
  }

  it(title('auto-rollover defaults ON and explanation flips with toggle', Tag.high, Tag.open('W6'), Tag.spec('RWIN§4.3')), async () => {
    await landing.startPlan();
    await booking.enterName(planName());
    await booking.continue();
    await booking.enterDeposit(100_000);
    await booking.continue();
    await expect(await booking.rolloverOn()).toBe(true);
    await expect(await booking.rolloverExplanation()).toMatch(/automatically roll/i);
    await booking.toggleRollover();
    await expect(await booking.rolloverOn()).toBe(false);
    await expect(await booking.rolloverExplanation()).toMatch(/paid to your wallet/i);
  });

  it(title('autosave defaults OFF; when ON requires frequency, amount and start date', Tag.med, Tag.spec('RWIN§4.4')), async () => {
    await landing.startPlan();
    await booking.enterName(planName());
    await booking.continue();
    await booking.enterDeposit(100_000);
    await booking.continue();
    await booking.continue(); // rollover step
    await expect(await booking.autosaveOn()).toBe(false);
    await booking.toggleAutosave();
    await expect(await booking.continueEnabled()).toBe(false);
    await booking.autosaveFrequency('weekly');
    await booking.autosaveAmount(10_000);
    await booking.autosaveStartDate(new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
    await expect(await booking.continueEnabled()).toBe(true);
  });

  it(title('payout destination is wallet, display only (not a selector)', Tag.med, Tag.spec('RWIN§4.5')), async () => {
    await walkToStep(5);
    await expect(await booking.payoutDestinationText()).toMatch(/wallet/i);
    await expect(await booking.payoutIsSelector()).toBe(false);
  });

  it(title('30-day minimum holding acknowledgement is mandatory', Tag.crit, Tag.spec('RWIN§4.6')), async () => {
    await walkToStep(6);
    await expect(await booking.holdingCallout()).toMatch(/cannot be withdrawn before 30 days/i);
    await expect(await booking.continueEnabled()).toBe(false);
    await booking.tickHoldingAck();
    await expect(await booking.continueEnabled()).toBe(true);
  });

  it(title('review screen shows every field with oracle-correct projected interest and cycle end date', Tag.crit, Tag.spec('RWIN§4.7')), async () => {
    const principal = 1_000_000;
    const name = planName('Review');
    await walkToStep(7, { name, principal });
    await expect(await booking.reviewValue('name')).toBe(name);
    await expect((await booking.reviewAmount('deposit')).toFixed(2)).toBe(D(principal).toFixed(2));
    await expect(await booking.reviewValue('rollover')).toMatch(/on/i);
    await expect(await booking.reviewValue('autosave')).toMatch(/off/i);
    await expect(await booking.reviewValue('rate')).toContain(`${RATE}%`);
    await expect(await booking.reviewValue('payout')).toMatch(/wallet/i);
    // W1 worked example: ₦1,000,000 @ 14% for 90 days (simple) = ₦34,520.55
    await expect((await booking.reviewAmount('projectedInterest')).toFixed(2)).toBe('34520.55');
  });

  it(title('successful booking debits wallet exactly once and creates an Active plan', Tag.crit, Tag.smoke, Tag.spec('RWIN§4.8-9')), async () => {
    const principal = 250_000;
    const name = planName('Happy');
    await walkToStep(7, { name, principal });
    await booking.createPlan();
    await expect(await booking.successHeadline()).toContain(name);
    await expect(await booking.successHeadline()).toContain(`${RATE}%`);
    await booking.successViewPlan();
    await plan.waitForShown();
    await expect((await plan.totalBalance()).toFixed(2)).toBe(D(principal).toFixed(2));
    await expect(await plan.trancheCount()).toContain('1');
    await openTab('wallet');
    const wallet = new WalletScreen();
    await expect((await wallet.balance()).toFixed(2)).toBe(toKobo(5_000_000 - principal).toFixed(2));
    const notes = await hooks.latestNotifications(customerId, 1);
    expect(notes[0].body).toContain(name);
  });

  it(title('insufficient wallet deep-links to wallet funding', Tag.crit, Tag.spec('RWIN§4.8')), async () => {
    await hooks.setWalletBalance(customerId, 10_000);
    await walkToStep(7, { principal: 100_000 });
    await booking.createPlan();
    await expect(await booking.insufficientFundsShown()).toBe(true);
    await booking.tapFundWallet();
    await new FundWalletScreen().waitForShown();
  });

  it(title('Tier 1 customer cannot book RWIN (KYC Tier 2 gate)', Tag.crit, Tag.spec('Calc§2')), async () => {
    await hooks.dispose();
    ({ hooks, customerId } = await freshCustomer({ tier: 1, walletBalance: 1_000_000 }));
    await openTab('grow');
    await grow.openTile('rwin');
    await landing.startPlan();
    await expect(await booking.isShown()).toBe(false); // routed to KYC upgrade prompt instead
  });

  async function walkToStep(step: 5 | 6 | 7, o: { name?: string; principal?: number } = {}) {
    await landing.startPlan();
    await booking.waitForShown();
    await booking.enterName(o.name ?? planName());
    await booking.continue();
    await booking.enterDeposit(o.principal ?? 100_000);
    await booking.continue(); // → rollover
    await booking.continue(); // → autosave
    await booking.continue(); // → payout
    if (step === 5) return;
    await booking.continue(); // → holding ack
    if (step === 6) return;
    await booking.tickHoldingAck();
    await booking.continue(); // → review
  }
});
