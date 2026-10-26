import { expect } from '@wdio/globals';
import { D } from '../../../shared/calc/money';
import * as loans from '../../../shared/calc/loans';
import { Tag, title } from '../../../shared/support/tags';
import { reasons } from '../../../shared/data/factories';
import { QaHooks } from '../../../shared/api/qa-hooks';
import { freshCustomer, requireHooks } from '../../helpers/session';
import {
  NANO_TERMS, NanoIneligibleReason, moneyRe, notificationText, optionSlug, openBorrowTile, seedNanoEligibility, seedNanoTerms, walletBalance,
} from '../../helpers/loans';
import { LoanDeclineScreen, LoanKycGateScreen } from '../../screens/loans/BorrowCommon';
import { NanoBookingScreen, NanoDecisionScreen, NanoLandingScreen } from '../../screens/loans/NanoScreens';

/**
 * Nano — landing pre-check, booking flow, auto-decisioning (Nano_Customer_App_Spec §3, §4, §9, §10, §11).
 * Risk: eligibility gating, loan calculation, disbursement = CRIT.
 */
describe('Nano › Application', () => {
  const MIN = 5_000;
  const MAX = 50_000;
  const WALLET = 3_000;
  let hooks: QaHooks;
  let customerId: string;

  const landing = new NanoLandingScreen();
  const booking = new NanoBookingScreen();
  const decision = new NanoDecisionScreen();
  const decline = new LoanDeclineScreen('nano');

  beforeEach(async function () {
    requireHooks(this);
    ({ hooks, customerId } = await freshCustomer({ tier: 2, walletBalance: WALLET }));
    await seedNanoTerms(hooks);
    await seedNanoEligibility(hooks, customerId, { eligible: true, min: MIN, max: MAX, dailyRatePct: NANO_TERMS.dailyRatePct });
    await hooks.stubProvider({ provider: 'BUREAU', outcome: 'CLEAN', customerId });
  });

  afterEach(async () => {
    await hooks?.dispose();
  });

  async function openLanding() {
    await openBorrowTile('nano');
    await landing.waitForShown();
  }

  /** Walks to the consent step with the given amount + tenor (purpose skipped). */
  async function walkToConsent(amount: number, tenorDays = 30) {
    await openLanding();
    await landing.apply();
    await booking.waitForShown();
    await booking.enterAmount(amount);
    await booking.continue();
    await booking.enterTenorDays(tenorDays);
    await booking.continue();
    await booking.skipPurpose();
  }

  /** Opens the booking flow and moves to the tenor step with `amount` entered. */
  async function toTenorStep(amount: number) {
    await openLanding();
    await landing.apply();
    await booking.waitForShown();
    await booking.enterAmount(amount);
    await booking.continue();
  }

  async function submitApplication(amount: number, tenorDays = 30) {
    await walkToConsent(amount, tenorDays);
    await booking.tickConsent();
    await booking.submit();
  }

  describe('Landing & pre-check (§3, §10)', () => {
    it(title('pre-check eligibility badge shows eligible amount range and rate before applying', Tag.crit, Tag.smoke, Tag.spec('Nano§3'), Tag.spec('Nano§10')), async () => {
      await openLanding();
      await expect(await landing.eligibilityBadgeShown()).toBe(true);
      await expect((await landing.eligibleMin()).toFixed(2)).toBe(D(MIN).toFixed(2));
      await expect((await landing.eligibleMax()).toFixed(2)).toBe(D(MAX).toFixed(2));
      // Daily rate (LoanSpec §2.2) — "0.3%" or "0.30%" (per day).
      await expect(await landing.eligibilityRate()).toMatch(new RegExp(`${D(NANO_TERMS.dailyRatePct).toFixed(2).replace('.', '\\.')}?%`));
      await expect(await landing.valueProps()).toMatch(/seconds/i);
      await expect(await landing.valueProps()).toMatch(/wallet/i);
      await expect(await landing.valueProps()).toMatch(/loyalty/i);
      await expect(await landing.applyEnabled()).toBe(true);
    });

    const notEligible: Array<{ reason: NanoIneligibleReason; copy: RegExp; resolution: RegExp | null }> = [
      { reason: 'KYC_INCOMPLETE', copy: /KYC/i, resolution: /complete.*KYC|upgrade/i },
      { reason: 'INSUFFICIENT_HISTORY', copy: /repayment history/i, resolution: null },
      { reason: 'DTI_TOO_HIGH', copy: /debt|DTI|income/i, resolution: /repay.*outstanding/i },
      { reason: 'BUREAU_ISSUE', copy: /bureau|credit report/i, resolution: null },
    ];
    for (const n of notEligible) {
      it(title(`not eligible (${n.reason}): Apply disabled, reason explained${n.resolution ? ' with resolution action' : ''}`, Tag.crit, Tag.spec('Nano§3')), async () => {
        await seedNanoEligibility(hooks, customerId, { eligible: false, reason: n.reason });
        await openLanding();
        await expect(await landing.notEligibleShown()).toBe(true);
        await expect(await landing.notEligibleReason()).toMatch(n.copy);
        await expect(await landing.applyEnabled()).toBe(false);
        if (n.resolution) {
          await expect(await landing.resolveActionShown()).toBe(true);
          await expect(`${await landing.notEligibleGuidance()} ${await landing.resolveActionLabel()}`).toMatch(n.resolution);
        }
      });
    }

    it(title('KYC resolution action leaves the Nano landing for the KYC upgrade flow', Tag.high, Tag.spec('Nano§3')), async () => {
      await seedNanoEligibility(hooks, customerId, { eligible: false, reason: 'KYC_INCOMPLETE' });
      await openLanding();
      await landing.resolveAction();
      await expect(await landing.isShown()).toBe(false);
      await expect(await new LoanKycGateScreen().isShown()).toBe(true);
    });
  });

  describe('Booking steps (§4)', () => {
    it(title('amount is bounded to ₦5,000–₦50,000 (below min / above max rejected)', Tag.crit, Tag.spec('Nano§4'), Tag.spec('LoanSpec§2.1')), async () => {
      // Oracle: product bounds (LOAN_BOUNDS.NANO) — the seeded eligible range equals them.
      expect(loans.checkBounds('NANO', MIN - 1, 14, 1)).toEqual({ ok: false, reason: 'AMOUNT_BELOW_MIN' });
      expect(loans.checkBounds('NANO', MAX + 1, 14, 1)).toEqual({ ok: false, reason: 'AMOUNT_ABOVE_MAX' });
      expect(loans.checkBounds('NANO', MIN, 14, 1)).toEqual({ ok: true });
      expect(loans.checkBounds('NANO', MAX, 14, 1)).toEqual({ ok: true });
      await openLanding();
      await landing.apply();
      await booking.waitForShown();
      await expect(await booking.amountRange()).toMatch(moneyRe(MIN));
      await expect(await booking.amountRange()).toMatch(moneyRe(MAX));
      await booking.enterAmount(MIN - 1);
      await expect(await booking.continueEnabled()).toBe(false);
      await expect(await booking.amountError()).toMatch(moneyRe(MIN));
      await booking.enterAmount(MAX + 1);
      // Auto-bounded: either clamped to max or rejected with the max shown.
      const v = await booking.amountValue().catch(() => D(MAX + 1));
      if (v.eq(MAX)) await expect(await booking.continueEnabled()).toBe(true);
      else {
        await expect(await booking.continueEnabled()).toBe(false);
        await expect(await booking.amountError()).toMatch(moneyRe(MAX));
      }
      await booking.enterAmount(MAX);
      await expect(await booking.continueEnabled()).toBe(true);
    });

    it(title('chip picker only offers amounts inside the eligible range', Tag.high, Tag.spec('Nano§4'), Tag.spec('Nano§10')), async () => {
      await openLanding();
      await landing.apply();
      await booking.waitForShown();
      await expect(await booking.chipShown(MAX)).toBe(true);
      await expect(await booking.chipShown(MAX * 2)).toBe(false);
      await booking.tapChip(MAX);
      await expect((await booking.amountValue()).toFixed(2)).toBe(D(MAX).toFixed(2));
    });

    for (const amount of [MIN, 20_000, MAX]) {
      it(title(`flexible tenor: live quote shows prorated interest + total for 1/3/7/14/30 days on ₦${amount.toLocaleString()}`, Tag.crit, Tag.spec('Nano§4'), Tag.spec('LoanSpec§2.2')), async () => {
        await toTenorStep(amount);
        await expect(await booking.tenorDaysRange()).toMatch(/1.*30 days/i);
        for (const days of NANO_TERMS.representativeDays) {
          await booking.enterTenorDays(days);
          const quote = booking.tenorQuote();
          await expect(await quote.shown()).toBe(true);
          await expect(await quote.days()).toContain(String(days));
          const { interest, totalRepayable } = loans.proratedInterest(amount, NANO_TERMS.dailyRatePct, days);
          await expect((await quote.interest()).toFixed(2)).toBe(interest.toFixed(2));
          await expect((await quote.total()).toFixed(2)).toBe(totalRepayable.toFixed(2));
        }
      });
    }

    it(title('worked example: ₦20,000 @ 0.30%/day → 3d ₦180, 7d ₦420, 14d ₦840, 30d ₦1,800', Tag.crit, Tag.spec('LoanSpec§2.3')), async () => {
      const worked: Array<[number, number]> = [[3, 180], [7, 420], [14, 840], [30, 1_800]];
      // Guard: the seeded rate is the spec's worked-example rate and the oracle reproduces the document.
      expect(NANO_TERMS.dailyRatePct).toBe(0.3);
      for (const [days, interest] of worked) {
        expect(loans.proratedInterest(20_000, 0.3, days).interest.toFixed(2)).toBe(D(interest).toFixed(2));
      }
      await toTenorStep(20_000);
      for (const [days, interest] of worked) {
        await booking.enterTenorDays(days);
        await expect((await booking.tenorQuote().interest()).toFixed(2)).toBe(D(interest).toFixed(2));
        await expect((await booking.tenorQuote().total()).toFixed(2)).toBe(D(20_000 + interest).toFixed(2));
      }
    });

    for (const days of [0, NANO_TERMS.maxDays + 1]) {
      it(title(`tenor of ${days} days is rejected (allowed 1–30 days)`, Tag.crit, Tag.spec('Nano§4'), Tag.spec('LoanSpec§2.1')), async () => {
        const expected = loans.checkBounds('NANO', 20_000, days, 1);
        expect(expected.ok).toBe(false);
        await toTenorStep(20_000);
        await booking.enterTenorDays(days);
        await expect(await booking.continueEnabled()).toBe(false);
        await expect(await booking.tenorDaysError()).toMatch(expected.ok === false && expected.reason === 'TENOR_ABOVE_MAX' ? /30 days/i : /1 day/i);
      });
    }

    for (const days of [NANO_TERMS.minDays, NANO_TERMS.maxDays]) {
      it(title(`tenor boundary ${days} day(s) is accepted`, Tag.high, Tag.spec('LoanSpec§2.1')), async () => {
        expect(loans.checkBounds('NANO', 20_000, days, 1)).toEqual({ ok: true });
        await toTenorStep(20_000);
        await booking.enterTenorDays(days);
        await expect(await booking.continueEnabled()).toBe(true);
      });
    }

    it(title('purpose is optional and offers the predefined categories', Tag.low, Tag.spec('Nano§4')), async () => {
      await toTenorStep(10_000);
      await booking.enterTenorDays(14);
      await booking.continue();
      for (const p of reasons.nanoPurpose) await expect(await booking.purposeOptionShown(optionSlug(p))).toBe(true);
      await expect(await booking.continueEnabled()).toBe(true); // nothing picked, still allowed
    });

    it(title('consent (bureau check, wallet debit mandate, terms) is required to submit', Tag.crit, Tag.spec('Nano§4')), async () => {
      await walkToConsent(10_000);
      await expect(await booking.consentText()).toMatch(/bureau/i);
      await expect(await booking.consentText()).toMatch(/debit/i);
      await expect(await booking.consentText()).toMatch(/terms/i);
      await expect(await booking.consentTicked()).toBe(false);
      await expect(await booking.submitEnabled()).toBe(false);
      await booking.tickConsent();
      await expect(await booking.submitEnabled()).toBe(true);
    });
  });

  describe('Auto-decisioning (§4 steps 5–6)', () => {
    it(title('approved: instant wallet credit of exactly the loan amount and approval details match the oracle', Tag.crit, Tag.smoke, Tag.spec('Nano§4'), Tag.spec('Nano§8'), Tag.spec('LoanSpec§2.2')), async () => {
      const amount = 20_000;
      const before = await walletBalance();
      await submitApplication(amount, 30);
      await decision.waitForShown();
      await expect(await decision.loadingText()).toMatch(/Checking your eligibility/i);
      await expect(await decision.approvedShown()).toBe(true);
      await expect(await decision.approvedHeadline()).toMatch(/Nano loan is approved/i);
      const a = decision.approved();
      const { totalRepayable } = loans.proratedInterest(amount, NANO_TERMS.dailyRatePct, 30);
      await expect((await a.amount()).toFixed(2)).toBe(D(amount).toFixed(2));
      await expect(await a.tenor()).toContain('30');
      await expect((await a.total()).toFixed(2)).toBe(totalRepayable.toFixed(2));
      await expect(await a.destination()).toMatch(/wallet/i);
      await expect(await a.dueDate()).toBeTruthy();
      const after = await walletBalance();
      await expect(after.minus(before).toFixed(2)).toBe(D(amount).toFixed(2));
      await expect(await notificationText(hooks, customerId, 3)).toMatch(new RegExp(`Nano loan of ${moneyRe(amount).source} is approved.*in your wallet`, 'i'));
    });

    const declines: Array<{ outcome: string; reason: RegExp; guidance: RegExp }> = [
      { outcome: 'DTI_TOO_HIGH', reason: /DTI too high/i, guidance: /repay|outstanding|notify/i },
      { outcome: 'INSUFFICIENT_HISTORY', reason: /Insufficient repayment history/i, guidance: /notify|eligible again/i },
      { outcome: 'BUREAU_FLAG', reason: /Bureau flag/i, guidance: /notify|contact/i },
    ];
    for (const d of declines) {
      it(title(`declined (${d.outcome}): managed-vocab reason, guidance and re-apply wait period; no wallet credit`, Tag.crit, Tag.spec('Nano§4'), Tag.spec('Nano§8')), async () => {
        await hooks.stubProvider({ provider: 'BUREAU', outcome: d.outcome, customerId });
        const before = await walletBalance();
        await submitApplication(10_000);
        await decline.waitForShown();
        await expect(await decline.headline()).toMatch(/couldn't be approved this time/i);
        await expect(await decline.reason()).toMatch(d.reason);
        await expect(await decline.guidance()).toMatch(d.guidance);
        await expect(await decline.reapplyWait()).toMatch(new RegExp(`${NANO_TERMS.reapplyWaitHours} hours|24 hours|tomorrow`, 'i'));
        await expect(await decline.overrideActionExists()).toBe(false); // §11: no self-service override
        await expect((await walletBalance()).toFixed(2)).toBe(before.toFixed(2));
        await expect(await notificationText(hooks, customerId, 3)).toMatch(/Nano application wasn't approved this time — reason:/i);
      });
    }

    it(title('re-apply is blocked during the wait period and unlocked after it', Tag.crit, Tag.spec('Nano§4'), Tag.spec('Nano§11')), async () => {
      await hooks.stubProvider({ provider: 'BUREAU', outcome: 'DTI_TOO_HIGH', customerId });
      await submitApplication(10_000);
      await decline.waitForShown();
      await decline.done();
      await openLanding();
      await expect(await landing.applyEnabled()).toBe(false);
      await expect(await landing.constraint()).toMatch(/try again|re-apply|wait/i);
      try {
        await hooks.advanceClock({ customerId, days: Math.ceil(NANO_TERMS.reapplyWaitHours / 24) });
        await openLanding();
        await expect(await landing.applyEnabled()).toBe(true);
      } finally {
        await hooks.resetClock().catch(() => undefined);
      }
    });

    it(title('bureau timeout: pending state, then notified when the decision is ready', Tag.high, Tag.spec('Nano§4'), Tag.spec('Nano§9')), async () => {
      await hooks.stubProvider({ provider: 'BUREAU', outcome: 'TIMEOUT', customerId });
      await submitApplication(10_000);
      await decision.waitForShown();
      await expect(await decision.pendingShown()).toBe(true);
      await expect(await decision.pendingMessage()).toMatch(/Taking a bit longer than usual.*notify you/i);
      await hooks.stubProvider({ provider: 'BUREAU', outcome: 'CLEAN', customerId });
      try {
        await hooks.advanceClock({ customerId, days: 0 });
        await expect(await notificationText(hooks, customerId, 3)).toMatch(/Nano (loan|application)/i);
      } finally {
        await hooks.resetClock().catch(() => undefined);
      }
    });
  });

  describe('Tier (LoanSpec §2.1)', () => {
    it(title('Tier 1 customer can take a Nano loan (minimum tier = Tier 1)', Tag.crit, Tag.spec('LoanSpec§2.1'), Tag.spec('KYC§1')), async () => {
      expect(loans.checkBounds('NANO', 10_000, 7, 1)).toEqual({ ok: true });
      await hooks.dispose();
      ({ hooks, customerId } = await freshCustomer({ tier: 1, walletBalance: WALLET }));
      await seedNanoTerms(hooks);
      await seedNanoEligibility(hooks, customerId, { eligible: true, min: MIN, max: MAX, dailyRatePct: NANO_TERMS.dailyRatePct });
      await hooks.stubProvider({ provider: 'BUREAU', outcome: 'CLEAN', customerId });
      const before = await walletBalance();
      await submitApplication(10_000, 7);
      await decision.waitForShown();
      await expect(await decision.approvedShown()).toBe(true);
      const { totalRepayable } = loans.proratedInterest(10_000, NANO_TERMS.dailyRatePct, 7);
      await expect((await decision.approved().total()).toFixed(2)).toBe(totalRepayable.toFixed(2));
      await expect((await walletBalance()).minus(before).toFixed(2)).toBe(D(10_000).toFixed(2));
    });
  });

  describe('Blocking rules (§3, §9, §11)', () => {
    it(title('one active Nano at a time: landing shows active loan card and blocks a new application', Tag.crit, Tag.spec('Nano§3'), Tag.spec('Nano§9')), async () => {
      await hooks.seedLoan({ customerId, product: 'NANO', state: 'ACTIVE', amount: 20_000, extra: { tenorDays: 30, dailyRatePct: NANO_TERMS.dailyRatePct } });
      await openLanding();
      await expect(await landing.activeLoanShown()).toBe(true);
      await expect(await landing.constraint()).toMatch(/one active Nano.*Repay it to (unlock your next one|apply for a new one)/i);
      await expect(await landing.applyShown()).toBe(false);
    });

    it(title('previously written-off Nano blocks application with contact-us message', Tag.crit, Tag.spec('Nano§6'), Tag.spec('Nano§9')), async () => {
      await hooks.seedLoan({ customerId, product: 'NANO', state: 'WRITTEN_OFF', amount: 20_000 });
      await openLanding();
      await expect(await landing.constraint()).toMatch(/(written-off|written off).*contact us/i);
      if (await landing.applyShown()) await expect(await landing.applyEnabled()).toBe(false);
    });
  });
});
