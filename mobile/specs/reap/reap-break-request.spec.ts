import { expect } from '@wdio/globals';
import { D, daysBetween, formatNaira, toKobo } from '../../../shared/calc/money';
import * as reap from '../../../shared/calc/reap';
import { Tag, title } from '../../../shared/support/tags';
import { planName, reasons } from '../../../shared/data/factories';
import { QaHooks } from '../../../shared/api/qa-hooks';
import { freshCustomer, openTab, requireHooks } from '../../helpers/session';
import { links, openDeepLink } from '../../helpers/deeplink';
import {
  QaAdminHooks, REAP_RATES, SeededReapPlan, escapeRe, reapPlanOnSchedule, reapSeedExtra, startForMaturityIn, today,
} from '../../helpers/investment-fixtures';
import { WalletScreen } from '../../screens/common/WalletScreens';
import { BreakReason, ReapBreakScreen, ReapPlanScreen } from '../../screens/reap/ReapScreens';

/**
 * REAP — request early break (REAP_Customer_App_Spec §7, §8, §9, §10; Clarity E6, E7, X7).
 * Customer cannot self-break: every break goes to admin review. Principal is never reduced;
 * all accrued interest is forfeited (E6 default).
 */
describe('REAP › Break request', () => {
  const WALLET = 1_000_000;
  let hooks: QaHooks;
  let admin: QaAdminHooks | undefined;
  let customerId: string;
  let name: string;
  let seeded: SeededReapPlan;
  let investmentId: string;

  const plan = new ReapPlanScreen();
  const brk = new ReapBreakScreen();

  async function seedAndOpen(p: SeededReapPlan, extra: Record<string, unknown> = {}) {
    seeded = p;
    name = planName('Break');
    ({ investmentId } = await hooks.seedInvestment({
      customerId, product: 'REAP', state: 'ACTIVE', principal: reap.principal(p.contributions).toNumber(), ratePct: REAP_RATES[p.tenorMonths],
      fundedDaysAgo: daysBetween(p.start, today()), extra: reapSeedExtra(p, { name, ...extra }),
    }));
    await openDeepLink(links.reapPlan(investmentId));
    await plan.waitForShown();
  }

  const standardPlan = () => reapPlanOnSchedule({ startedDaysAgo: 75, tenorMonths: 6, target: 600_000, frequency: 'MONTHLY', contributionAmount: 100_000 });

  async function walkToSummary(reason: BreakReason = 'emergency') {
    await plan.requestBreak();
    await brk.waitForShown();
    await brk.continueWithBreak();
    await brk.reason(reason);
    await brk.continue();
  }

  async function submitBreak() {
    await walkToSummary();
    await brk.tickAck();
    await brk.submit();
    await expect(await brk.submittedText()).toMatch(/sent to our team/i);
  }

  beforeEach(async function () {
    requireHooks(this);
    ({ hooks, customerId } = await freshCustomer({ tier: 2, walletBalance: WALLET }));
    await hooks.setProductConfig({ product: 'REAP', patch: { ratesByTenorMonths: REAP_RATES } });
  });

  afterEach(async () => {
    await hooks?.resetClock().catch(() => undefined);
    await admin?.dispose();
    admin = undefined;
    await hooks?.dispose();
  });

  it(title('Step 1 warning explains forfeiture; "Keep saving" is the primary CTA and returns to the plan', Tag.crit, Tag.open('E6'), Tag.spec('REAP§8.1'), Tag.spec('REAP§11')), async () => {
    await seedAndOpen(standardPlan());
    await plan.requestBreak();
    await brk.waitForShown();
    await expect(await brk.warningText()).toMatch(/principal only.*interest.*forfeited/i);
    await expect(await brk.primaryCtaText()).toMatch(/keep saving/i);
    await expect(await brk.secondaryCtaText()).toMatch(/continue/i);
    await brk.keepSaving();
    await plan.waitForShown();
    await expect(await plan.bannerShown()).toBe(false);
    await expect(await plan.addContributionEnabled()).toBe(true);
  });

  it(title('Step 2 reason capture: managed reason list, Continue gated on a selection, note optional', Tag.med, Tag.spec('REAP§8.2')), async () => {
    await seedAndOpen(standardPlan());
    await plan.requestBreak();
    await brk.continueWithBreak();
    await expect(await brk.continueEnabled()).toBe(false);
    const ids: BreakReason[] = ['emergency', 'changeOfPlans', 'financialDifficulty', 'other'];
    expect(ids.length).toBe(reasons.breakRequest.length);
    await brk.reason('changeOfPlans');
    await expect(await brk.continueEnabled()).toBe(true);
    await brk.enterReasonNote('Relocating for work');
    await expect(await brk.continueEnabled()).toBe(true);
  });

  it(title('Step 2 "Other" requires a note', Tag.low, Tag.spec('REAP§8.2')), async () => {
    await seedAndOpen(standardPlan());
    await plan.requestBreak();
    await brk.continueWithBreak();
    await brk.reason('other');
    await expect(await brk.continueEnabled()).toBe(false);
    await brk.enterReasonNote('Medical bills');
    await expect(await brk.continueEnabled()).toBe(true);
  });

  it(title('Step 3 financial summary: principal returned and interest forfeited match oracle breakOutcome; net = principal', Tag.crit, Tag.open('E6'), Tag.open('E7'), Tag.spec('REAP§7'), Tag.spec('REAP§8.3')), async () => {
    await seedAndOpen(standardPlan());
    const expected = reap.breakOutcome(seeded.contributions, REAP_RATES[6], today());
    await walkToSummary();
    await expect(await brk.summaryPlanName()).toBe(name);
    await expect((await brk.summaryLine('principal')).toFixed(2)).toBe(expected.principalReturned.toFixed(2));
    await expect((await brk.summaryLine('interestForfeited')).toFixed(2)).toBe(expected.interestForfeited.toFixed(2));
    await expect((await brk.summaryLine('net')).toFixed(2)).toBe(expected.principalReturned.toFixed(2));
    expect(expected.interestForfeited.gt(0)).toBe(true);
  });

  it(title('Step 3 acknowledgement checkbox is mandatory before submit', Tag.crit, Tag.spec('REAP§8.3')), async () => {
    await seedAndOpen(standardPlan());
    await walkToSummary();
    await expect(await brk.acknowledged()).toBe(false);
    await expect(await brk.submitEnabled()).toBe(false);
    await brk.tickAck();
    await expect(await brk.submitEnabled()).toBe(true);
  });

  it(title('Step 4 submit: confirmation, plan enters Under review with actions disabled, notification sent', Tag.crit, Tag.smoke, Tag.open('E7'), Tag.spec('REAP§8.4'), Tag.spec('REAP§9')), async () => {
    await seedAndOpen(standardPlan());
    await submitBreak();
    await brk.backToPlan();
    await plan.waitForShown();
    await expect(await plan.banner()).toMatch(/under review/i);
    await expect(await plan.addContributionEnabled()).toBe(false);
    await expect(await plan.adjustEnabled()).toBe(false);
    await expect(await plan.breakEnabled()).toBe(false);
    const notes = await hooks.latestNotifications(customerId, 3);
    expect(notes.map((n) => n.body).join('|')).toMatch(new RegExp(`break request for ${escapeRe(name)} has been submitted`, 'i'));
  });

  it(title('while under review autosave is suspended (no scheduled debit lands)', Tag.high, Tag.open('E7'), Tag.spec('REAP§8.4')), async () => {
    const p = reapPlanOnSchedule({ startedDaysAgo: 10, tenorMonths: 3, target: 300_000, frequency: 'DAILY', contributionAmount: 2_000 });
    await seedAndOpen(p, { autosave: { enabled: true } });
    await submitBreak();
    await hooks.advanceClock({ customerId, days: 2 });
    await openDeepLink(links.reapPlan(investmentId));
    await plan.waitForShown();
    await expect((await plan.balance()).toFixed(2)).toBe(reap.principal(p.contributions).toFixed(2));
  });

  it(title('admin approves: principal (only) returned to wallet, plan Broken, approval notification', Tag.crit, Tag.open('E6'), Tag.open('E7'), Tag.spec('REAP§8.5'), Tag.spec('REAP§9')), async () => {
    await seedAndOpen(standardPlan());
    const expected = reap.breakOutcome(seeded.contributions, REAP_RATES[6], today());
    await submitBreak();
    admin = await QaAdminHooks.create();
    await admin.decideReapBreak(investmentId, 'APPROVE');
    const notes = await hooks.latestNotifications(customerId, 3);
    expect(notes.map((n) => n.body).join('|')).toMatch(new RegExp(`approved.*${escapeRe(formatNaira(expected.principalReturned, { kobo: false }))} returned to your wallet`, 'i'));
    await openDeepLink(links.reapPlan(investmentId));
    await plan.waitForShown();
    await expect(await plan.stateLabel()).toMatch(/broken|closed/i);
    await openTab('wallet');
    await expect((await new WalletScreen().balance()).toFixed(2)).toBe(toKobo(D(WALLET).plus(expected.principalReturned)).toFixed(2));
  });

  it(title('admin declines: plan resumes Active with actions re-enabled and decline reason notified', Tag.high, Tag.spec('REAP§8.5'), Tag.spec('REAP§9')), async () => {
    await seedAndOpen(standardPlan());
    await submitBreak();
    admin = await QaAdminHooks.create();
    const reason = 'Policy violation QA';
    await admin.decideReapBreak(investmentId, 'DECLINE', reason);
    const notes = await hooks.latestNotifications(customerId, 3);
    expect(notes.map((n) => n.body).join('|')).toMatch(new RegExp(`declined.*reason: ${escapeRe(reason)}.*plan continues`, 'i'));
    await openDeepLink(links.reapPlan(investmentId));
    await plan.waitForShown();
    await expect(await plan.bannerShown()).toBe(false);
    await expect(await plan.addContributionEnabled()).toBe(true);
    await expect((await plan.balance()).toFixed(2)).toBe(reap.principal(seeded.contributions).toFixed(2));
  });

  it(title('break on maturity day shows extra "matures today — full interest if you wait" warning, not blocking', Tag.high, Tag.open('X7'), Tag.spec('REAP§10')), async () => {
    const p = reapPlanOnSchedule({ startedDaysAgo: daysBetween(startForMaturityIn(0, 3), today()), tenorMonths: 3, target: 300_000, frequency: 'MONTHLY', contributionAmount: 100_000 });
    await seedAndOpen(p);
    await plan.requestBreak();
    await brk.waitForShown();
    await expect(await brk.maturityDayWarningShown()).toBe(true);
    await expect(await brk.maturityDayWarning()).toMatch(/matures today.*full interest/i);
    await brk.continueWithBreak();
    await expect(await brk.continueEnabled()).toBe(false); // now on reason step — flow continues
  });
});
