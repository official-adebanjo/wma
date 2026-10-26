import { driver, expect } from '@wdio/globals';
import { QaHooks } from '../../../shared/api/qa-hooks';
import { Tag, title } from '../../../shared/support/tags';
import { freshCustomer, openTab, requireHooks } from '../../helpers/session';
import { backgroundApp, isLoggedIn } from '../../screens/common/AuthScreens';
import { Feedback } from '../../screens/common/HomeScreens';
import { TransferScreen, WalletScreen } from '../../screens/common/WalletScreens';

/**
 * Mobile resilience — QA Strategy §19 (network conditions, stability, background/foreground)
 * and §20.3 (network interruption mid-transaction). Android-only where the network toggle
 * requires it (LambdaTest supports network throttling profiles on real devices via lt:options.network).
 */
describe('Resilience › Network and app lifecycle', () => {
  let hooks: QaHooks;
  let customerId: string;
  let pin: string;
  const wallet = new WalletScreen();

  beforeEach(async function () {
    requireHooks(this);
    ({ hooks, customerId, pin } = await freshCustomer({ tier: 2, walletBalance: 50_000 }));
  });

  afterEach(async () => {
    if (driver.isAndroid) await setOnline(true).catch(() => undefined);
    await hooks?.dispose();
  });

  it(title('offline: app shows an offline state instead of stale balances or a crash', Tag.high, Tag.spec('QAStrategy§19')), async function () {
    if (!driver.isAndroid) this.skip();
    await setOnline(false);
    await openTab('wallet');
    await expect(await new Feedback().bannerShown('error') || await new Feedback().bannerShown('warning')).toBe(true);
    await setOnline(true);
    await wallet.waitForShown();
    await expect((await wallet.balance()).toFixed(2)).toBe('50000.00');
  });

  it(title('connection drop mid-transfer never loses or duplicates money', Tag.crit, Tag.spec('QAStrategy§20.3')), async function () {
    if (!driver.isAndroid) this.skip();
    await openTab('wallet');
    await wallet.tapTransfer();
    const transfer = new TransferScreen();
    await transfer.enterAccount('0123456789');
    await transfer.pickBank('Test Bank');
    await transfer.enterAmount(10_000);
    await transfer.continue();
    await transfer.confirmWithPin(pin).catch(() => undefined);
    await setOnline(false);
    await driver.pause(3_000);
    await setOnline(true);
    await hooks.advanceClock({ customerId, days: 0 });
    await openTab('wallet');
    const balance = (await wallet.balance()).toNumber();
    // Either the transfer completed exactly once or not at all — never twice, never "lost".
    expect([40_000, 50_000]).toContain(balance);
  });

  it(title('backgrounding during a flow resumes on the same step', Tag.med, Tag.spec('QAStrategy§19')), async () => {
    await openTab('wallet');
    await wallet.tapTransfer();
    const transfer = new TransferScreen();
    await transfer.waitForShown();
    await backgroundApp(10);
    await expect(await transfer.isShown()).toBe(true);
  });

  it(title('long background forces re-authentication (session timeout)', Tag.crit, Tag.spec('QAStrategy§17')), async () => {
    await backgroundApp(Number(process.env.SESSION_TIMEOUT_SECONDS ?? 300) + 5);
    await expect(await isLoggedIn()).toBe(false);
  });
});

/** UiAutomator2 connectivity toggle (Android only). */
async function setOnline(online: boolean): Promise<void> {
  await driver.execute('mobile: setConnectivity', { wifi: online, data: online });
}
