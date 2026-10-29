import { expect } from '@wdio/globals';
import { Tag, title } from '../../../shared/support/tags';
import { Persona, hasPersona, loginAs, personaCreds } from '../../helpers/session';
import { LoginScreen, WelcomeScreen, acceptSystemPermission, isLoggedIn, resetApp } from '../../screens/common/AuthScreens';
import { byId, driver } from '../../screens/BaseScreen';

/**
 * Sign-in with the static dev persona accounts from .env (CUSTOMER_T1/T2/T3_*).
 * Needs no QA hooks, so this is the first suite that runs against a real dev build.
 * Sign-in is email + password or phone + passcode/PIN — each method runs when its .env pair is set.
 */
const PERSONAS: Persona[] = ['T1', 'T2', 'T3'];

describe('Auth › Persona sign-in (static dev accounts)', () => {
  beforeEach(async () => {
    await resetApp();
  });

  // Stops at the passcode screen — never submits a code, so it can't use up sign-in attempts.
  it(title('a local-format phone number (080…) is accepted at sign-in', Tag.high, Tag.spec('QAStrategy§14')), async function () {
    const p = PERSONAS.find((x) => hasPersona(x, 'phone'));
    if (!p) this.skip();
    const local = process.env[`CUSTOMER_${p}_PHONE`]!.replace(/^\+?234/, '0');
    const welcome = new WelcomeScreen();
    const login = new LoginScreen();
    await driver.waitUntil(async () => { await acceptSystemPermission(); return welcome.isShown(); }, { timeout: 45_000 });
    await welcome.tapLogin();
    await login.enterIdentifier(local);
    await login.continue();
    // Dev build 2026-10-29: Continue silently does nothing for 080… (only +234… works).
    await expect(await byId('auth.login.pin.screen').waitForDisplayed({ timeout: 15_000 }).then(() => true, () => false)).toBe(true);
  });

  for (const p of PERSONAS) {
    it(title(`${p} customer signs in with email + password`, Tag.crit, Tag.smoke, Tag.spec('QAStrategy§14')), async function () {
      if (!hasPersona(p, 'email')) this.skip();
      await loginAs(personaCreds(p, 'email'));
      await expect(await isLoggedIn()).toBe(true);
    });

    it(title(`${p} customer signs in with phone + passcode/PIN`, Tag.crit, Tag.spec('QAStrategy§14')), async function () {
      if (!hasPersona(p, 'phone')) this.skip();
      await loginAs(personaCreds(p, 'phone'));
      await expect(await isLoggedIn()).toBe(true);
    });
  }
});
