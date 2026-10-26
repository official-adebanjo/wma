import { expect } from '@wdio/globals';
import { D, formatNaira, toKobo } from '../../../shared/calc/money';
import { assertLinesReconcile } from '../../../shared/calc/wht';
import * as rtn from '../../../shared/calc/rtn';
import { canBookInvestment } from '../../../shared/calc/tier';
import { productConfig } from '../../../shared/config/env';
import { Tag, title } from '../../../shared/support/tags';
import { QaHooks } from '../../../shared/api/qa-hooks';
import { freshCustomer, openTab, requireHooks } from '../../helpers/session';
import {
  QaAdminHooks, RTN_MATRIX, RTN_MATRIX_BUMPED, bandIndex, escapeRe, rtnConfigPatch, today,
} from '../../helpers/investment-fixtures';
import { GrowHomeScreen } from '../../screens/common/HomeScreens';
import { FundWalletScreen, WalletScreen } from '../../screens/common/WalletScreens';
import {
  CorporateDocsScreen, RtnAccountType, RtnBookingScreen, RtnLandingScreen, RtnPayout, RtnPlacementScreen, RtnSource, RtnTiming,
} from '../../screens/rtn/RtnScreens';

/**
 * RTN — landing + booking flow incl. wallet funding (RTN_Customer_App_Spec §1, §3, §4, §9; Calculator Spec §2, §3.3;
 * Clarity T1–T3, T8, T12, T13, X1, X4). Rate matrix is seeded so the oracle (lookupRate) and app agree.
 * Risk: Investment returns / limits / gating = CRIT (QA Strategy §7). Class A (§8).
 *
 * @open:CALC-TIER — Calculator Spec §2 says all investments need Tier 2; RTN spec §1 allows individual RTN at Tier 1.
 * These tests follow the RTN spec (shared/calc/tier.canBookInvestment).
 */
describe('RTN › Booking', () => {
  const cfg = productConfig.rtn;
  const WHT = productConfig.whtRatePct;
  const WALLET = 100_000_000;
  let hooks: QaHooks;
  let admin: QaAdminHooks | undefined;
  let customerId: string;

  const grow = new GrowHomeScreen();
  const landing = new RtnLandingScreen();
  const booking = new RtnBookingScreen();
  const placement = new RtnPlacementScreen();

  async function login(o: { tier: 1 | 2 | 3; accountType?: 'INDIVIDUAL' | 'CORPORATE'; walletBalance?: number }) {
    ({ hooks, customerId } = await freshCustomer({ tier: o.tier, walletBalance: o.walletBalance ?? WALLET, accountType: o.accountType }));
    await hooks.setProductConfig({
      product: 'RTN',
      patch: rtnConfigPatch(RTN_MATRIX, { minIndividual: cfg.minIndividual, minCorporate: cfg.minCorporate, tenorsDays: cfg.tenorsDays, underfundedHoldHours: cfg.underfundedHoldHours }),
    });
    await openTab('grow');
    await grow.openTile('rtn');
    await landing.waitForShown();
  }

  beforeEach(async function () {
    requireHooks(this);
    await login({ tier: 2 });
  });

  afterEach(async () => {
    await admin?.dispose();
    admin = undefined;
    await hooks?.dispose();
  });

  describe('Landing', () => {
    it(title('empty-state landing shows the seeded rate matrix preview, value props and Start a placement', Tag.high, Tag.open('T1'), Tag.spec('RTN§3')), async () => {
      await expect(await landing.matrixShown()).toBe(true);
      for (let b = 0; b < RTN_MATRIX.bands.length; b++) {
        for (const t of RTN_MATRIX.tenorsDays) {
          await expect(await landing.matrixCell(b, t)).toContain(`${rtn.lookupRate(RTN_MATRIX, RTN_MATRIX.bands[b].min, t)}%`);
        }
      }
      const props = await landing.valueProps();
      for (const p of [/locked/i, /upfront/i, /amount|tenor/i, /corporate/i]) expect(props).toMatch(p);
      await expect(await landing.placementCardShown(0)).toBe(false);
    });

    it(title('with-placements landing lists each placement with id, amount, tenor, rate, maturity and timing', Tag.high, Tag.spec('RTN§3')), async () => {
      const amount = 2_000_000;
      const rate = rtn.lookupRate(RTN_MATRIX, amount, 90);
      await hooks.seedInvestment({ customerId, product: 'RTN', state: 'ACTIVE', principal: amount, ratePct: rate, fundedDaysAgo: 10, extra: { tenorDays: 90, timing: 'AT_MATURITY' } });
      await openTab('grow');
      await grow.openTile('rtn');
      await landing.waitForShown();
      const card = landing.placementCard(0);
      await expect(await card.id()).toMatch(/PLC-/);
      await expect((await card.amount()).toFixed(2)).toBe(D(amount).toFixed(2));
      await expect(await card.tenor()).toContain('90');
      await expect(await card.rate()).toContain(`${rate}%`);
      await expect(await card.maturityDate()).toBeTruthy();
      await expect(await card.timing()).toMatch(/maturity/i);
    });

    it(title('corporate profile sees a corporate-specific note on landing', Tag.low, Tag.spec('RTN§3')), async () => {
      await hooks.dispose();
      await login({ tier: 2, accountType: 'CORPORATE' });
      await expect(await landing.corporateNoteShown()).toBe(true);
    });
  });

  describe('Step 1 — Account type and gating', () => {
    it(title('individual Tier 1 customer can book RTN', Tag.crit, Tag.open('CALC-TIER'), Tag.spec('RTN§1'), Tag.spec('RTN§4.1')), async () => {
      expect(canBookInvestment(1, 'RTN', 'INDIVIDUAL')).toBe(true);
      await hooks.dispose();
      await login({ tier: 1, walletBalance: 5_000_000 });
      await landing.startPlacement();
      await booking.waitForShown();
      if (await booking.accountTypeStepShown()) {
        await booking.accountType('individual');
        await booking.continue();
      }
      await booking.enterAmount(cfg.minIndividual);
      await expect(await booking.continueEnabled()).toBe(true);
    });

    it(title('corporate Tier 1 customer cannot book corporate RTN (Tier 2+)', Tag.crit, Tag.spec('RTN§1'), Tag.spec('RTN§4.1')), async () => {
      expect(canBookInvestment(1, 'RTN', 'CORPORATE')).toBe(false);
      await hooks.dispose();
      await login({ tier: 1, accountType: 'CORPORATE' });
      await landing.startPlacement();
      if (await booking.isShown()) {
        await booking.accountType('corporate');
        await expect(await booking.accountTypeError()).toMatch(/tier 2|upgrade/i);
        await expect(await booking.continueEnabled()).toBe(false);
      } else {
        await expect(await landing.kycUpgradePromptShown()).toBe(true);
      }
    });

    it(title('corporate Tier 2 without verified docs is blocked at Step 1 and routed to document upload', Tag.crit, Tag.spec('RTN§4.1'), Tag.spec('RTN§9')), async () => {
      await hooks.dispose();
      await login({ tier: 2, accountType: 'CORPORATE' });
      admin = await QaAdminHooks.create();
      await admin.setCorporateDocs(customerId, 'NONE');
      await landing.startPlacement();
      await booking.waitForShown();
      await booking.accountType('corporate');
      await expect(await booking.corporateDocsBlockShown()).toBe(true);
      await expect(await booking.corporateDocsBlockText()).toMatch(/requires verified corporate documentation/i);
      await expect(await booking.continueEnabled()).toBe(false);
      await booking.uploadCorporateDocs();
      await new CorporateDocsScreen().waitForShown();
    });

    it(title('corporate Tier 2 with pending (not yet verified) docs is still blocked', Tag.high, Tag.spec('RTN§4.1')), async () => {
      await hooks.dispose();
      await login({ tier: 2, accountType: 'CORPORATE' });
      admin = await QaAdminHooks.create();
      await admin.setCorporateDocs(customerId, 'PENDING');
      await landing.startPlacement();
      await booking.accountType('corporate');
      await expect(await booking.corporateDocsBlockShown()).toBe(true);
      await expect(await booking.continueEnabled()).toBe(false);
    });

    it(title('corporate Tier 2 with verified docs proceeds and the corporate minimum applies', Tag.crit, Tag.open('T12'), Tag.spec('RTN§4.1-2')), async () => {
      await hooks.dispose();
      await login({ tier: 2, accountType: 'CORPORATE' });
      admin = await QaAdminHooks.create();
      await admin.setCorporateDocs(customerId, 'VERIFIED');
      await landing.startPlacement();
      await booking.accountType('corporate');
      await booking.continue();
      await booking.enterAmount(cfg.minCorporate - 0.01);
      await expect(await booking.continueEnabled()).toBe(false);
      await expect(await booking.amountError()).toContain(formatNaira(cfg.minCorporate, { kobo: false }));
      await booking.enterAmount(cfg.minCorporate);
      await expect(await booking.continueEnabled()).toBe(true);
    });
  });

  describe('Step 2 — Amount', () => {
    it(title('individual minimum enforced with a two-clause error naming the minimum', Tag.crit, Tag.open('T12'), Tag.spec('RTN§4.2')), async () => {
      await walkTo(2);
      await booking.enterAmount(cfg.minIndividual - 0.01);
      await expect(await booking.continueEnabled()).toBe(false);
      await expect(await booking.amountError()).toContain(formatNaira(cfg.minIndividual, { kobo: false }));
      await booking.enterAmount(cfg.minIndividual);
      await expect(await booking.continueEnabled()).toBe(true);
    });

    it(title('amount above the maximum (tier limit) is rejected', Tag.crit, Tag.open('T12'), Tag.spec('RTN§4.2')), async () => {
      await walkTo(2);
      await booking.enterAmount(1_000_000_000_000);
      await expect(await booking.continueEnabled()).toBe(false);
      await expect(await booking.amountError()).toMatch(/maximum|limit/i);
    });

    for (const amount of [1_000_000, 7_500_000, 25_000_000, 75_000_000]) {
      it(title(`live matrix preview highlights the band for ${formatNaira(amount, { kobo: false })} only`, Tag.high, Tag.open('T1'), Tag.spec('RTN§4.2')), async () => {
        await walkTo(2);
        await booking.enterAmount(amount);
        const band = bandIndex(RTN_MATRIX, amount);
        for (let b = 0; b < RTN_MATRIX.bands.length; b++) {
          await expect(await booking.matrixBandHighlighted(b)).toBe(b === band);
        }
        await expect(await booking.matrixCell(band, 90)).toContain(`${rtn.lookupRate(RTN_MATRIX, amount, 90)}%`);
      });
    }

    it(title('amount chips: individual sees ₦1M–₦100M; tapping a chip fills the input', Tag.low, Tag.open('T12'), Tag.spec('RTN§4.2')), async () => {
      await walkTo(2);
      for (const chip of [1_000_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000, 100_000_000]) {
        await expect(await booking.amountChipShown(chip)).toBe(true);
      }
      await booking.tapAmountChip(25_000_000);
      await expect((await booking.amountValue()).toFixed(2)).toBe('25000000.00');
    });
  });

  describe('Step 3 — Tenor', () => {
    const AMOUNT = 7_500_000;
    for (const tenor of productConfig.rtn.tenorsDays) {
      it(title(`${tenor}-day card: rate from matrix (lookupRate) and projected total = amount + net interest`, Tag.crit, Tag.open('T1'), Tag.open('T2'), Tag.open('X4'), Tag.spec('RTN§4.3'), Tag.spec('Calc§3.3')), async () => {
        await walkTo(3, { amount: AMOUNT });
        const card = booking.tenorCard(tenor);
        await expect(await card.shown()).toBe(true);
        const rate = rtn.lookupRate(RTN_MATRIX, AMOUNT, tenor);
        await expect(await card.rate()).toContain(`${rate}%`);
        const expected = D(AMOUNT).plus(rtn.interest(AMOUNT, rate, tenor).net);
        await expect((await card.projectedTotal()).toFixed(2)).toBe(expected.toFixed(2));
      });
    }

    // Band edges — whole-amount rate, lower-inclusive bands (T1 default).
    for (const amount of [1_000_000, 4_999_999.99, 5_000_000, 9_999_999.99, 10_000_000, 49_999_999.99, 50_000_000]) {
      it(title(`band edge ${formatNaira(amount)} prices at band ${bandIndex(RTN_MATRIX, amount)} (lower-inclusive)`, Tag.crit, Tag.open('T1'), Tag.spec('RTN§4.3')), async () => {
        await walkTo(3, { amount });
        const rate = rtn.lookupRate(RTN_MATRIX, amount, 90);
        await expect(await booking.tenorCard(90).rate()).toContain(`${rate}%`);
        const expected = D(amount).plus(rtn.interest(amount, rate, 90).net);
        await expect((await booking.tenorCard(90).projectedTotal()).toFixed(2)).toBe(toKobo(expected).toFixed(2));
      });
    }

    it(title('tenor is single-select and Continue requires a selection', Tag.med, Tag.spec('RTN§4.3')), async () => {
      await walkTo(3);
      await expect(await booking.continueEnabled()).toBe(false);
      await booking.tenorCard(60).select();
      await booking.tenorCard(180).select();
      await expect(await booking.tenorCard(180).selected()).toBe(true);
      await expect(await booking.tenorCard(60).selected()).toBe(false);
      await expect(await booking.continueEnabled()).toBe(true);
    });
  });

  describe('Step 4 — Interest timing', () => {
    it(title('Upfront: explains net interest paid to wallet now, principal at maturity, and the WHT note', Tag.crit, Tag.open('X1'), Tag.open('T2'), Tag.spec('RTN§4.4')), async () => {
      const amount = 5_000_000;
      await walkTo(4, { amount, tenor: 180 });
      await booking.timing('upfront');
      const rate = rtn.lookupRate(RTN_MATRIX, amount, 180);
      const proj = rtn.bookingProjection(amount, rate, 180, 'UPFRONT', today());
      const text = await booking.timingExplanation();
      expect(text).toMatch(/immediately/i);
      expect(text).toContain(formatNaira(proj.paidAtBooking));
      expect(text).toContain(formatNaira(amount, { kobo: false }));
      await expect(await booking.whtNote()).toMatch(new RegExp(`${WHT}% WHT`, 'i'));
    });

    it(title('At maturity: explains principal + interest paid together at maturity, and the WHT note', Tag.crit, Tag.open('X1'), Tag.open('X4'), Tag.spec('RTN§4.4')), async () => {
      const amount = 5_000_000;
      await walkTo(4, { amount, tenor: 180 });
      await booking.timing('maturity');
      const rate = rtn.lookupRate(RTN_MATRIX, amount, 180);
      const i = rtn.interest(amount, rate, 180);
      const text = await booking.timingExplanation();
      expect(text).toMatch(/together at maturity/i);
      expect(text).toContain(formatNaira(amount, { kobo: false }));
      // X4: whether the explanation leads with gross or net is open — accept either oracle figure.
      expect([formatNaira(i.gross), formatNaira(i.net)].some((v) => text.includes(v))).toBe(true);
      await expect(await booking.whtNote()).toMatch(new RegExp(`${WHT}% WHT`, 'i'));
    });
  });

  describe('Step 5–6 — Source of funds and payout destination', () => {
    it(title('source of funds offers Wallet and Bank transfer; bank transfer explains the hold window', Tag.med, Tag.open('T8'), Tag.spec('RTN§4.5')), async () => {
      await walkTo(5);
      await booking.source('bankTransfer');
      await expect(await booking.sourceSelected('bankTransfer')).toBe(true);
      await expect(await booking.sourceExplanation()).toMatch(new RegExp(`${cfg.underfundedHoldHours} hours`, 'i'));
      await booking.source('wallet');
      await expect(await booking.sourceSelected('wallet')).toBe(true);
      await expect(await booking.sourceSelected('bankTransfer')).toBe(false);
    });

    it(title('payout defaults to wallet; bank option hidden without a linked bank account', Tag.med, Tag.open('T13'), Tag.spec('RTN§4.6')), async () => {
      await walkTo(6);
      await expect(await booking.payoutSelected('wallet')).toBe(true);
      await expect(await booking.payoutOptionShown('bank')).toBe(false);
    });

    it(title('payout to a linked bank account can be selected and shows on review', Tag.med, Tag.open('T13'), Tag.spec('RTN§4.6')), async () => {
      admin = await QaAdminHooks.create();
      await admin.linkBankAccount(customerId);
      await walkTo(7, { payout: 'bank' });
      await expect(await booking.reviewValue('payout')).toMatch(/bank|0123/i);
    });
  });

  describe('Step 7 — Review and confirm', () => {
    for (const timing of ['maturity', 'upfront'] as const) {
      it(title(`review (${timing}): every field, gross / WHT / net from oracle, maturity date and rate-lock notice`, Tag.crit, Tag.open('X1'), Tag.open('T3'), Tag.spec('RTN§4.7')), async () => {
        const amount = 12_345_678.9;
        const tenor = 120;
        await walkTo(7, { amount, tenor, timing });
        const rate = rtn.lookupRate(RTN_MATRIX, amount, tenor);
        const proj = rtn.bookingProjection(amount, rate, tenor, timing === 'upfront' ? 'UPFRONT' : 'AT_MATURITY', today());
        await expect(await booking.reviewValue('accountType')).toMatch(/individual/i);
        await expect((await booking.reviewAmount('amount')).toFixed(2)).toBe(D(amount).toFixed(2));
        await expect(await booking.reviewValue('tenor')).toContain(String(tenor));
        await expect(await booking.reviewValue('rate')).toContain(`${rate}%`);
        const gross = await booking.reviewAmount('grossInterest');
        const wht = await booking.reviewAmount('wht');
        const net = await booking.reviewAmount('netInterest');
        expect(gross.toFixed(2)).toBe(proj.gross.toFixed(2));
        expect(wht.toFixed(2)).toBe(proj.wht.toFixed(2));
        expect(net.toFixed(2)).toBe(proj.net.toFixed(2));
        assertLinesReconcile({ gross, wht, net });
        await expect(await booking.reviewValue('timing')).toMatch(timing === 'upfront' ? /upfront/i : /maturity/i);
        await expect(await booking.reviewValue('source')).toMatch(/wallet/i);
        await expect(await booking.reviewValue('payout')).toMatch(/wallet/i);
        await expect(await booking.reviewValue('maturityDate')).toContain(String(proj.maturityDate.getUTCDate()));
        await expect(await booking.rateLockNotice()).toMatch(/locked at booking/i);
      });
    }

    it(title('rate matrix changes mid-booking: review shows the new rate with a "Rate has changed" message', Tag.crit, Tag.spec('RTN§9')), async () => {
      const amount = 7_500_000;
      const tenor = 90;
      await walkTo(4, { amount, tenor });
      const oldRate = rtn.lookupRate(RTN_MATRIX, amount, tenor);
      await hooks.setProductConfig({ product: 'RTN', patch: rtnConfigPatch(RTN_MATRIX_BUMPED) });
      const newRate = rtn.lookupRate(RTN_MATRIX_BUMPED, amount, tenor);
      expect(newRate).not.toBe(oldRate);
      await booking.timing('maturity');
      await booking.continue();
      await booking.source('wallet');
      await booking.continue();
      await booking.continue(); // payout (wallet default)
      await expect(await booking.rateChangedShown()).toBe(true);
      await expect(await booking.rateChangedMessage()).toMatch(new RegExp(`rate has changed to ${newRate}%`, 'i'));
      await expect(await booking.reviewValue('rate')).toContain(`${newRate}%`);
      await expect((await booking.reviewAmount('netInterest')).toFixed(2)).toBe(rtn.interest(amount, newRate, tenor).net.toFixed(2));
    });
  });

  describe('Step 8a / 9 — Wallet funding and confirmation', () => {
    it(title('wallet-funded at-maturity placement: wallet debited once, Active placement, success + notification', Tag.crit, Tag.smoke, Tag.spec('RTN§4.8a'), Tag.spec('RTN§4.9'), Tag.spec('RTN§8')), async () => {
      const amount = 2_000_000;
      const tenor = 90;
      const rate = rtn.lookupRate(RTN_MATRIX, amount, tenor);
      await walkTo(7, { amount, tenor, timing: 'maturity' });
      await booking.createPlacement();
      await expect(await booking.successHeadline()).toMatch(/active|created/i);
      await expect(await booking.successCountdown()).toContain(String(tenor));
      await expect(await booking.successUpfrontPaidShown()).toBe(false);
      await booking.successViewPlacement();
      await placement.waitForShown();
      await expect((await placement.placedAmount()).toFixed(2)).toBe(D(amount).toFixed(2));
      await expect(await placement.rate()).toContain(`${rate}%`);
      await expect((await placement.netInterest()).toFixed(2)).toBe(rtn.interest(amount, rate, tenor).net.toFixed(2));
      await openTab('wallet');
      await expect((await new WalletScreen().balance()).toFixed(2)).toBe(toKobo(WALLET - amount).toFixed(2));
      const notes = await hooks.latestNotifications(customerId, 3);
      expect(notes.map((n) => n.body).join('|')).toMatch(new RegExp(`PLC-\\S+ is active.*${escapeRe(formatNaira(amount, { kobo: false }))} at ${rate}%`, 'i'));
    });

    it(title('wallet-funded upfront placement: net upfront interest paid to wallet immediately and confirmed on success', Tag.crit, Tag.open('X1'), Tag.open('T2'), Tag.spec('RTN§4.9'), Tag.spec('RTN§8')), async () => {
      const amount = 5_000_000;
      const tenor = 365;
      const rate = rtn.lookupRate(RTN_MATRIX, amount, tenor);
      const proj = rtn.bookingProjection(amount, rate, tenor, 'UPFRONT', today());
      await walkTo(7, { amount, tenor, timing: 'upfront' });
      await booking.createPlacement();
      await expect(await booking.successUpfrontPaidShown()).toBe(true);
      await expect((await booking.successUpfrontPaid()).toFixed(2)).toBe(proj.paidAtBooking.toFixed(2));
      await openTab('wallet');
      await expect((await new WalletScreen().balance()).toFixed(2)).toBe(toKobo(D(WALLET).minus(amount).plus(proj.paidAtBooking)).toFixed(2));
      const notes = await hooks.latestNotifications(customerId, 3);
      expect(notes.map((n) => n.body).join('|')).toMatch(new RegExp(`upfront interest of ${escapeRe(formatNaira(proj.paidAtBooking))}.*net of WHT`, 'i'));
    });

    it(title('insufficient wallet: two-clause error, deep-link to funding, booking values preserved on return', Tag.crit, Tag.spec('RTN§4.8a'), Tag.spec('RTN§9')), async () => {
      await hooks.setWalletBalance(customerId, 500_000);
      const amount = 1_500_000;
      await walkTo(7, { amount, tenor: 60 });
      await booking.createPlacement();
      await expect(await booking.insufficientFundsShown()).toBe(true);
      await expect(await booking.insufficientFundsText()).toMatch(/not enough in your wallet.*fund your wallet/i);
      await booking.tapFundWallet();
      const fund = new FundWalletScreen();
      await fund.waitForShown();
      await fund.goBack();
      await booking.waitForShown();
      await expect((await booking.reviewAmount('amount')).toFixed(2)).toBe(D(amount).toFixed(2));
      await expect(await booking.reviewValue('tenor')).toContain('60');
    });
  });

  type WalkOpts = { accountType?: RtnAccountType; amount?: number; tenor?: number; timing?: RtnTiming; source?: RtnSource; payout?: RtnPayout };

  async function walkTo(step: 2 | 3 | 4 | 5 | 6 | 7, o: WalkOpts = {}) {
    await landing.startPlacement();
    await booking.waitForShown();
    if (await booking.accountTypeStepShown()) {
      await booking.accountType(o.accountType ?? 'individual');
      await booking.continue(); // → amount
    }
    if (step === 2) return;
    await booking.enterAmount(o.amount ?? 2_000_000);
    await booking.continue(); // → tenor
    if (step === 3) return;
    await booking.tenorCard(o.tenor ?? 90).select();
    await booking.continue(); // → timing
    if (step === 4) return;
    await booking.timing(o.timing ?? 'maturity');
    await booking.continue(); // → source
    if (step === 5) return;
    await booking.source(o.source ?? 'wallet');
    await booking.continue(); // → payout
    if (step === 6) return;
    if (o.payout) await booking.payout(o.payout);
    await booking.continue(); // → review
  }
});
