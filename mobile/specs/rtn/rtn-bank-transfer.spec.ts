import { expect } from '@wdio/globals';
import { D, addDays, formatNaira, toKobo } from '../../../shared/calc/money';
import * as rtn from '../../../shared/calc/rtn';
import { productConfig } from '../../../shared/config/env';
import { Tag, title } from '../../../shared/support/tags';
import { QaHooks } from '../../../shared/api/qa-hooks';
import { freshCustomer, openTab, requireHooks } from '../../helpers/session';
import { links, openDeepLink } from '../../helpers/deeplink';
import { RTN_MATRIX, escapeRe, rtnConfigPatch, today } from '../../helpers/investment-fixtures';
import { GrowHomeScreen } from '../../screens/common/HomeScreens';
import { WalletScreen } from '../../screens/common/WalletScreens';
import { RtnBookingScreen, RtnLandingScreen, RtnPlacementScreen } from '../../screens/rtn/RtnScreens';

/**
 * RTN — bank-transfer funding: Underfunded → Active / Cancelled, partial / excess / late transfers
 * (RTN_Customer_App_Spec §4 Step 8b, §6, §8, §9; Clarity T3, T8). Expected outcomes from oracle bankTransferOutcome.
 */
describe('RTN › Bank transfer funding', () => {
  const cfg = productConfig.rtn;
  const HOLD_DAYS = Math.ceil(cfg.underfundedHoldHours / 24);
  const AMOUNT = 3_000_000;
  const TENOR = 90;
  const RATE = rtn.lookupRate(RTN_MATRIX, AMOUNT, TENOR);
  let hooks: QaHooks;
  let customerId: string;

  const placement = new RtnPlacementScreen();
  const wallet = new WalletScreen();

  async function seedUnderfunded(amount = AMOUNT) {
    const r = await hooks.seedInvestment({
      customerId, product: 'RTN', state: 'UNDERFUNDED', principal: amount, ratePct: rtn.lookupRate(RTN_MATRIX, amount, TENOR),
      fundedDaysAgo: 0, extra: { tenorDays: TENOR, timing: 'AT_MATURITY', source: 'BANK_TRANSFER' },
    });
    return r;
  }

  async function openPlacement(id: string) {
    await openDeepLink(links.rtnPlacement(id));
    await placement.waitForShown();
  }

  async function walletBalance() {
    await openTab('wallet');
    return wallet.balance();
  }

  beforeEach(async function () {
    requireHooks(this);
    ({ hooks, customerId } = await freshCustomer({ tier: 2, walletBalance: 0 }));
    await hooks.setProductConfig({ product: 'RTN', patch: rtnConfigPatch(RTN_MATRIX, { underfundedHoldHours: cfg.underfundedHoldHours }) });
  });

  afterEach(async () => {
    await hooks?.resetClock().catch(() => undefined);
    await hooks?.dispose();
  });

  it(title('booking with Bank transfer creates an Underfunded placement with instructions, unique reference and 24h countdown', Tag.crit, Tag.smoke, Tag.open('T8'), Tag.spec('RTN§4.8b'), Tag.spec('RTN§8')), async () => {
    const grow = new GrowHomeScreen();
    const landing = new RtnLandingScreen();
    const booking = new RtnBookingScreen();
    await openTab('grow');
    await grow.openTile('rtn');
    await landing.startPlacement();
    await booking.waitForShown();
    if (await booking.accountTypeStepShown()) {
      await booking.accountType('individual');
      await booking.continue();
    }
    await booking.enterAmount(AMOUNT);
    await booking.continue();
    await booking.tenorCard(TENOR).select();
    await booking.continue();
    await booking.timing('maturity');
    await booking.continue();
    await booking.source('bankTransfer');
    await booking.continue();
    await booking.continue(); // payout: wallet default
    await expect(await booking.reviewValue('source')).toMatch(/bank transfer/i);
    await booking.createPlacement();
    const t = booking.transfer();
    await expect(await t.shown()).toBe(true);
    await expect(await t.bankName()).toBeTruthy();
    await expect(await t.accountNumber()).toMatch(/^\d{10}$/);
    await expect(await t.accountName()).toMatch(/rosabon/i);
    const reference = await t.reference();
    expect(reference.length).toBeGreaterThan(5);
    await expect((await t.amount()).toFixed(2)).toBe(D(AMOUNT).toFixed(2));
    await expect(await t.countdown()).toMatch(new RegExp(`within ${cfg.underfundedHoldHours} hours|${cfg.underfundedHoldHours - 1}:\\d{2}`, 'i'));
    await t.done();
    await placement.waitForShown();
    await expect(await placement.stateLabel()).toMatch(/underfunded|pending transfer/i);
    await expect(await placement.transfer().reference()).toBe(reference);
    const notes = await hooks.latestNotifications(customerId, 3);
    expect(notes.map((n) => n.body).join('|')).toMatch(
      new RegExp(`pending transfer.*Send ${escapeRe(formatNaira(AMOUNT, { kobo: false }))}.*${escapeRe(reference)}.*within ${cfg.underfundedHoldHours} hours`, 'i'),
    );
  });

  it(title('every Underfunded placement gets its own unique transfer reference', Tag.high, Tag.spec('RTN§4.8b')), async () => {
    const a = await seedUnderfunded();
    const b = await seedUnderfunded();
    expect(a.reference).not.toBe(b.reference);
    await openPlacement(a.investmentId);
    await expect(await placement.transfer().reference()).toBe(a.reference);
    await openPlacement(b.investmentId);
    await expect(await placement.transfer().reference()).toBe(b.reference);
  });

  it(title('exact transfer activates the placement; tenor starts at activation', Tag.crit, Tag.open('T3'), Tag.spec('RTN§4.8b'), Tag.spec('RTN§6'), Tag.spec('RTN§8')), async () => {
    const { investmentId, reference } = await seedUnderfunded();
    const outcome = rtn.bankTransferOutcome(AMOUNT, AMOUNT, true);
    expect(outcome.state).toBe('ACTIVE');
    await hooks.simulateInboundTransfer({ reference, amount: AMOUNT, customerId });
    await openPlacement(investmentId);
    await expect(await placement.stateLabel()).toMatch(/active/i);
    await expect((await placement.placedAmount()).toFixed(2)).toBe(D(AMOUNT).toFixed(2));
    await expect(await placement.rate()).toContain(`${RATE}%`);
    const maturity = addDays(today(), TENOR);
    await expect(await placement.maturityDate()).toContain(String(maturity.getUTCDate()));
    await expect(await placement.countdown()).toContain(String(TENOR));
    const notes = await hooks.latestNotifications(customerId, 3);
    expect(notes.map((n) => n.body).join('|')).toMatch(new RegExp(`activated.*${escapeRe(formatNaira(AMOUNT, { kobo: false }))} is now earning ${RATE}%`, 'i'));
    await expect((await walletBalance()).toFixed(2)).toBe('0.00');
  });

  it(title('partial transfer keeps the placement Underfunded with a "₦X of ₦Y" message', Tag.crit, Tag.open('T8'), Tag.spec('RTN§9')), async () => {
    const { investmentId, reference } = await seedUnderfunded();
    const received = 1_200_000;
    const outcome = rtn.bankTransferOutcome(AMOUNT, received, true);
    if (outcome.state !== 'UNDERFUNDED') throw new Error(`oracle expected UNDERFUNDED, got ${outcome.state}`);
    await hooks.simulateInboundTransfer({ reference, amount: received, customerId });
    await openPlacement(investmentId);
    await expect(await placement.stateLabel()).toMatch(/underfunded|pending/i);
    const msg = await placement.transfer().received();
    expect(msg).toContain(formatNaira(outcome.received, { kobo: false }));
    expect(msg).toContain(formatNaira(AMOUNT, { kobo: false }));
    const notes = await hooks.latestNotifications(customerId, 3);
    expect(notes.map((n) => n.body).join('|')).toMatch(
      new RegExp(`Partial transfer received \\(${escapeRe(formatNaira(received, { kobo: false }))} of ${escapeRe(formatNaira(AMOUNT, { kobo: false }))}`, 'i'),
    );
  });

  it(title('partial then remainder within the window activates the placement', Tag.high, Tag.open('T8'), Tag.spec('RTN§9')), async () => {
    const { investmentId, reference } = await seedUnderfunded();
    const first = 1_000_000;
    const outcome = rtn.bankTransferOutcome(AMOUNT, AMOUNT, true);
    expect(outcome.state).toBe('ACTIVE');
    await hooks.simulateInboundTransfer({ reference, amount: first, customerId });
    await hooks.simulateInboundTransfer({ reference, amount: AMOUNT - first, customerId });
    await openPlacement(investmentId);
    await expect(await placement.stateLabel()).toMatch(/active/i);
  });

  it(title('excess transfer activates at the intended amount and credits the excess to wallet', Tag.crit, Tag.spec('RTN§9')), async () => {
    const { investmentId, reference } = await seedUnderfunded();
    const sent = 3_250_000.5;
    const outcome = rtn.bankTransferOutcome(AMOUNT, sent, true);
    if (outcome.state !== 'ACTIVE') throw new Error(`oracle expected ACTIVE, got ${outcome.state}`);
    await hooks.simulateInboundTransfer({ reference, amount: sent, customerId });
    await openPlacement(investmentId);
    await expect(await placement.stateLabel()).toMatch(/active/i);
    await expect((await placement.placedAmount()).toFixed(2)).toBe(D(AMOUNT).toFixed(2));
    await expect((await walletBalance()).toFixed(2)).toBe(toKobo(outcome.excessToWallet).toFixed(2));
    const notes = await hooks.latestNotifications(customerId, 3);
    expect(notes.map((n) => n.body).join('|')).toMatch(new RegExp(`Excess ${escapeRe(formatNaira(outcome.excessToWallet))} credited to wallet`, 'i'));
  });

  it(title(`no transfer within ${productConfig.rtn.underfundedHoldHours}h → Cancelled with expiry notification`, Tag.crit, Tag.open('T8'), Tag.spec('RTN§6'), Tag.spec('RTN§8')), async () => {
    const { investmentId } = await seedUnderfunded();
    await hooks.advanceClock({ customerId, days: HOLD_DAYS });
    await openPlacement(investmentId);
    await expect(await placement.stateLabel()).toMatch(/cancelled/i);
    const notes = await hooks.latestNotifications(customerId, 3);
    expect(notes.map((n) => n.body).join('|')).toMatch(/cancelled.*transfer window expired/i);
  });

  it(title('partial funds received before expiry are refunded to wallet when the window lapses', Tag.crit, Tag.open('T8'), Tag.spec('RTN§6')), async () => {
    const { investmentId, reference } = await seedUnderfunded();
    const received = 700_000;
    await hooks.simulateInboundTransfer({ reference, amount: received, customerId });
    await hooks.advanceClock({ customerId, days: HOLD_DAYS });
    const outcome = rtn.bankTransferOutcome(AMOUNT, received, false);
    if (outcome.state !== 'CANCELLED') throw new Error(`oracle expected CANCELLED, got ${outcome.state}`);
    await openPlacement(investmentId);
    await expect(await placement.stateLabel()).toMatch(/cancelled/i);
    await expect((await walletBalance()).toFixed(2)).toBe(outcome.refundToWallet.toFixed(2));
  });

  it(title('transfer arriving after the window expired is credited to wallet; placement stays Cancelled', Tag.crit, Tag.open('T8'), Tag.spec('RTN§9')), async () => {
    const { investmentId, reference } = await seedUnderfunded();
    await hooks.advanceClock({ customerId, days: HOLD_DAYS });
    await hooks.simulateInboundTransfer({ reference, amount: AMOUNT, customerId, late: true });
    const outcome = rtn.bankTransferOutcome(AMOUNT, AMOUNT, false);
    if (outcome.state !== 'CANCELLED') throw new Error(`oracle expected CANCELLED, got ${outcome.state}`);
    await openPlacement(investmentId);
    await expect(await placement.stateLabel()).toMatch(/cancelled/i);
    await expect((await walletBalance()).toFixed(2)).toBe(outcome.refundToWallet.toFixed(2));
    const notes = await hooks.latestNotifications(customerId, 3);
    expect(notes.map((n) => n.body).join('|')).toMatch(
      new RegExp(`had expired.*${escapeRe(formatNaira(AMOUNT, { kobo: false }))} transfer arrived after the window.*credited to wallet`, 'i'),
    );
  });
});
