import { expect } from '@wdio/globals';
import { Tag, title } from '../../../shared/support/tags';
import { hasPersona, loginAs, openTab, personaCreds } from '../../helpers/session';
import { byId, driver } from '../../screens/BaseScreen';
import { WelcomeScreen, isLoggedIn, resetApp } from '../../screens/common/AuthScreens';
import { FundWalletCard, SendMoneyScreen, SettingsScreen } from '../../screens/common/JourneyScreens';
import { WalletScreen } from '../../screens/common/WalletScreens';

/**
 * Account journeys on the live dev build, signed in as Tier 1 — a customer who has never sent money.
 * Nothing is sent or paid: the card check stops once the payment page opens (or doesn't).
 */
describe('Journeys › Account (Tier 1 persona)', () => {
  const home = new WalletScreen();

  before(async function () {
    if (!hasPersona('T1')) this.skip();
    await resetApp();
    await loginAs(personaCreds('T1', 'email'));
    await home.waitForShown();
  });

  it(title('Send Money lists no recipients for a customer who has never sent money', Tag.high), async () => {
    await home.tapTransfer();
    const send = new SendMoneyScreen();
    await send.waitForShown();
    await driver.pause(2_000); // recipients load after the screen
    const count = await send.savedRecipientCount();
    await send.goBack().catch(() => undefined);
    await expect(count).toBe(0);
  });

  it(title('card funding opens the payment page', Tag.high), async () => {
    await openTab('home');
    await home.waitForShown();
    await home.tapFund();
    const fund = new FundWalletCard();
    await fund.waitForShown();
    await fund.payByCard(1_000);
    const opened = await fund.gatewayOpened();
    // Leave the payment page / card screen without paying.
    for (let i = 0; i < 3 && !(await home.isShown()); i++) {
      await driver.back();
      await driver.pause(1_000);
    }
    await expect(opened ? 'payment page opened' : 'no payment page').toBe('payment page opened');
  });

  it(title('Log out returns to the sign-in screen', Tag.high), async () => {
    if (!(await isLoggedIn())) await loginAs(personaCreds('T1', 'email'));
    await openTab('profile');
    const settings = new SettingsScreen();
    await settings.waitForShown();
    await settings.logout();
    // Some apps confirm first — accept a "Log out" button in a dialog if one appears.
    const confirm = driver.$('(//*[@content-desc="Log out"])[2] | //*[@resource-id="confirm-modal"]//*[@content-desc]');
    if (await confirm.waitForDisplayed({ timeout: 3_000 }).then(() => true, () => false)) await confirm.click();
    const signedOut = await driver.waitUntil(async () =>
      (await byId('auth.login.screen').isDisplayed().catch(() => false)) || (await new WelcomeScreen().isShown()),
    { timeout: 15_000 }).then(() => true, () => false);
    await expect(signedOut ? 'signed out' : 'still signed in').toBe('signed out');
  });
});
