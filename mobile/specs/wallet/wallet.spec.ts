import { expect } from '@wdio/globals';
import * as tier from '../../../shared/calc/tier';
import { tierLimits } from '../../../shared/config/env';
import { QaHooks } from '../../../shared/api/qa-hooks';
import { Tag, title } from '../../../shared/support/tags';
import { freshCustomer, openTab, requireHooks } from '../../helpers/session';
import { FundWalletScreen, TransactionHistoryScreen, TransferScreen, WalletScreen } from '../../screens/common/WalletScreens';

/**
 * RFS Wallet — QA Strategy §20 (highest-risk area, always Class A).
 * Integrity principles: transactions never disappear, balances always accurate, every
 * transaction traceable, failures safely recoverable. Limits per KYC Spec V4 §1.
 */
describe('Wallet', () => {
  let hooks: QaHooks;
  let customerId: string;
  let pin: string;
  const wallet = new WalletScreen();
  const transfer = new TransferScreen();
  const history = new TransactionHistoryScreen();

  afterEach(async () => {
    await hooks?.dispose();
  });

  describe('Balance and funding', () => {
    beforeEach(async function () {
      requireHooks(this);
      ({ hooks, customerId, pin } = await freshCustomer({ tier: 2, walletBalance: 125_000.5 }));
      await openTab('wallet');
      await wallet.waitForShown();
    });

    it(title('balance shown to the kobo', Tag.crit, Tag.smoke, Tag.spec('QAStrategy§20.1')), async () => {
      await expect((await wallet.balance()).toFixed(2)).toBe('125000.50');
    });

    it(title('fund wallet shows a dedicated virtual account in the customer\'s name', Tag.high, Tag.spec('QAStrategy§20.1')), async () => {
      await wallet.tapFund();
      const fund = new FundWalletScreen();
      await fund.waitForShown();
      await expect(await fund.virtualAccountNumber()).toMatch(/^\d{10}$/);
      await expect(await fund.virtualAccountName()).toBeTruthy();
    });

    it(title('inbound transfer credits balance once and appears once in history with a reference', Tag.crit, Tag.spec('QAStrategy§20.2')), async () => {
      const ref = `QA-${Date.now()}`;
      await hooks.simulateInboundTransfer({ reference: ref, amount: 40_000, customerId });
      await wallet.goBack().catch(() => undefined);
      await openTab('wallet');
      await expect((await wallet.balance()).toFixed(2)).toBe('165000.50');
      await wallet.tapHistory();
      await history.waitForShown();
      await expect((await history.rowAmount(0)).toFixed(2)).toBe('40000.00');
      await history.openRow(0);
      await expect(await history.detailReference()).toBeTruthy();
      const notes = await hooks.latestNotifications(customerId, 1);
      expect(notes[0].body).toMatch(/₦40,000/);
    });
  });

  describe('Transfers and tier limits', () => {
    for (const t of [1, 2] as const) {
      it(title(`Tier ${t}: transfer above the single/daily limit is blocked inline`, Tag.crit, Tag.spec('KYC§1')), async function () {
        requireHooks(this);
        ({ hooks, customerId, pin } = await freshCustomer({ tier: t, walletBalance: 30_000_000 }));
        await openTab('wallet');
        await wallet.tapTransfer();
        await transfer.waitForShown();
        await transfer.enterAccount('0123456789');
        await transfer.pickBank('Test Bank');
        const limit = Math.min(tierLimits[t].singleTransfer, tierLimits[t].dailyTransfer);
        await transfer.enterAmount(limit + 1);
        expect(tier.checkTransfer(t, limit + 1).ok).toBe(false);
        await expect(await transfer.continueEnabled()).toBe(false);
        await expect(await transfer.amountError()).toMatch(/limit/i);
        await transfer.enterAmount(limit);
        await expect(await transfer.continueEnabled()).toBe(true);
      });
    }

    it(title('cumulative daily limit is enforced across multiple transfers', Tag.crit, Tag.spec('KYC§1')), async function () {
      requireHooks(this);
      ({ hooks, customerId, pin } = await freshCustomer({ tier: 1, walletBalance: 100_000 }));
      await openTab('wallet');
      await wallet.tapTransfer();
      await transfer.enterAccount('0123456789');
      await transfer.pickBank('Test Bank');
      await transfer.enterAmount(15_000);
      await transfer.continue();
      await transfer.confirmWithPin(pin);
      await expect(await transfer.resultStatus()).toMatch(/success|processing/i);
      await openTab('wallet');
      await wallet.tapTransfer();
      await transfer.enterAccount('0123456789');
      await transfer.pickBank('Test Bank');
      await transfer.enterAmount(6_000); // 15k + 6k > ₦20k daily
      await expect(await transfer.amountError()).toMatch(/daily limit/i);
    });

    it(title('insufficient balance blocks transfer without debiting', Tag.crit, Tag.spec('QAStrategy§20.3')), async function () {
      requireHooks(this);
      ({ hooks, customerId, pin } = await freshCustomer({ tier: 2, walletBalance: 5_000 }));
      await openTab('wallet');
      await wallet.tapTransfer();
      await transfer.enterAccount('0123456789');
      await transfer.pickBank('Test Bank');
      await transfer.enterAmount(5_001);
      await expect(await transfer.amountError()).toMatch(/insufficient|not enough/i);
      await openTab('wallet');
      await expect((await wallet.balance()).toFixed(2)).toBe('5000.00');
    });

    it(title('double-tapping Confirm submits exactly one debit', Tag.crit, Tag.spec('QAStrategy§20.3')), async function () {
      requireHooks(this);
      ({ hooks, customerId, pin } = await freshCustomer({ tier: 2, walletBalance: 50_000 }));
      await openTab('wallet');
      await wallet.tapTransfer();
      await transfer.enterAccount('0123456789');
      await transfer.pickBank('Test Bank');
      await transfer.enterAmount(10_000);
      await transfer.continue();
      await transfer.doubleTapConfirm();
      await openTab('wallet');
      await expect((await wallet.balance()).toFixed(2)).toBe('40000.00');
      await wallet.tapHistory();
      await history.filter('debit');
      await expect((await history.rowAmount(0)).toFixed(2)).toBe('10000.00');
      await expect(await history.rowDescription(1).catch(() => '')).not.toMatch(/10,000/);
    });

    it(title('beneficiary name resolves before confirmation', Tag.high, Tag.spec('QAStrategy§20.1')), async function () {
      requireHooks(this);
      ({ hooks, customerId, pin } = await freshCustomer({ tier: 2, walletBalance: 50_000 }));
      await openTab('wallet');
      await wallet.tapTransfer();
      await transfer.enterAccount('0123456789');
      await transfer.pickBank('Test Bank');
      await expect(await transfer.resolvedName()).toBeTruthy();
    });

    it(title('provider failure after debit is reversed and shown as Failed/Reversed in history', Tag.crit, Tag.spec('QAStrategy§20.3')), async function () {
      requireHooks(this);
      ({ hooks, customerId, pin } = await freshCustomer({ tier: 2, walletBalance: 50_000 }));
      await hooks.stubProvider({ provider: 'NIBSS', outcome: 'TRANSFER_FAILED_AFTER_DEBIT', customerId });
      await openTab('wallet');
      await wallet.tapTransfer();
      await transfer.enterAccount('0123456789');
      await transfer.pickBank('Test Bank');
      await transfer.enterAmount(10_000);
      await transfer.continue();
      await transfer.confirmWithPin(pin);
      await hooks.advanceClock({ customerId, days: 0 });
      await openTab('wallet');
      await expect((await wallet.balance()).toFixed(2)).toBe('50000.00');
      await wallet.tapHistory();
      await expect(await history.rowStatus(0)).toMatch(/reversed|failed/i);
    });
  });
});
