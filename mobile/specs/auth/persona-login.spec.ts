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
// Accounts close to lock-out (e.g. "1 attempt(s) left") — sign-in tests for them are held back.
const HELD = (process.env.MOBILE_HOLD_PERSONAS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

describe('Auth › Persona sign-in (static dev accounts)', () => {
  beforeEach(async () => {
    await resetApp();
  });

  // Both ways of writing a Nigerian number should reach the passcode screen. These stop there and never
  // submit a code, so they can't use up sign-in attempts — which is why they only need CUSTOMER_Tn_PHONE.
  // The app takes about 20 s to move on (4 November build), so each gets 45 s; the speed is its own check.
  const phoneOf = () => PERSONAS.map((x) => process.env[`CUSTOMER_${x}_PHONE`]).find(Boolean);
  const secondsToPasscode: Record<string, number> = {};
  const formats: [string, string, (n: string) => string][] = [
    ['local', 'a local-format phone number (080…) is accepted at sign-in', (n) => n.replace(/^\+?234/, '0')],
    ['intl', 'an international-format phone number (+234…) is accepted at sign-in', (n) => n.replace(/^0/, '+234').replace(/^234/, '+234')],
  ];
  for (const [key, name, write] of formats) {
    it(title(name, Tag.high, Tag.spec('QAStrategy§14')), async function () {
      const phone = phoneOf();
      if (!phone) this.skip();
      const welcome = new WelcomeScreen();
      const login = new LoginScreen();
      await driver.waitUntil(async () => { await acceptSystemPermission(); return welcome.isShown(); }, { timeout: 45_000 });
      await welcome.tapLogin();
      await login.enterIdentifier(write(phone!));
      const started = Date.now();
      await login.continue();
      const reached = await byId('auth.login.pin.screen').waitForDisplayed({ timeout: 45_000 }).then(() => true, () => false);
      if (reached) secondsToPasscode[key] = (Date.now() - started) / 1000;
      await expect(reached ? 'passcode screen' : 'stayed on the sign-in screen for 45 s').toBe('passcode screen');
    });
  }

  it(title('phone sign-in moves on to the passcode screen within 10 seconds', Tag.med, Tag.spec('QAStrategy§14')), async function () {
    const s = secondsToPasscode.local ?? secondsToPasscode.intl;
    if (s === undefined) this.skip(); // neither format got through — reported above
    await expect(`${Math.round(s)} s`).toBe(s <= 10 ? `${Math.round(s)} s` : 'within 10 s');
  });

  for (const p of PERSONAS) {
    it(title(`${p} customer signs in with email + password`, Tag.crit, Tag.smoke, Tag.spec('QAStrategy§14')), async function () {
      if (!hasPersona(p, 'email') || HELD.includes(p)) this.skip();
      await loginAs(personaCreds(p, 'email'));
      await expect(await isLoggedIn()).toBe(true);
    });

    it(title(`${p} customer signs in with phone + passcode/PIN`, Tag.crit, Tag.spec('QAStrategy§14')), async function () {
      if (!hasPersona(p, 'phone') || HELD.includes(p)) this.skip();
      await loginAs(personaCreds(p, 'phone'));
      await expect(await isLoggedIn()).toBe(true);
    });
  }
});
