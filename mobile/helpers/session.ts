import { driver } from '@wdio/globals';
import { QaHooks } from '../../shared/api/qa-hooks';
import { required } from '../../shared/config/env';
import { Credentials, LoginScreen, SignInMethod, WelcomeScreen, acceptSystemPermission, isLoggedIn } from '../screens/common/AuthScreens';
import { TabBar, Tab } from '../screens/common/HomeScreens';
import { byId } from '../screens/BaseScreen';

export type Persona = 'T1' | 'T2' | 'T3' | 'CORPORATE';

/**
 * Static persona accounts from .env (used when QA hooks are unavailable).
 * Sign-in is email + password or phone + PIN; without `method`, email is used when
 * CUSTOMER_<p>_EMAIL is set, otherwise phone.
 */
export function personaCreds(p: Persona, method?: SignInMethod): Credentials {
  const m = method ?? (process.env[`CUSTOMER_${p}_EMAIL`] ? 'email' : 'phone');
  return m === 'email'
    ? { email: required(`CUSTOMER_${p}_EMAIL`), password: required(`CUSTOMER_${p}_PASSWORD`) }
    : { phone: required(`CUSTOMER_${p}_PHONE`), pin: required(`CUSTOMER_${p}_PIN`) };
}

/** True when the persona has credentials for that sign-in method in .env. */
export function hasPersona(p: Persona, method: SignInMethod = 'email'): boolean {
  return method === 'email'
    ? !!(process.env[`CUSTOMER_${p}_EMAIL`] && process.env[`CUSTOMER_${p}_PASSWORD`])
    : !!(process.env[`CUSTOMER_${p}_PHONE`] && process.env[`CUSTOMER_${p}_PIN`]);
}

export async function loginAs(creds: Credentials): Promise<void> {
  const welcome = new WelcomeScreen();
  const login = new LoginScreen();
  // Wait out the splash screen: the app opens on Welcome, Sign-in, or Home (session kept).
  await driver.waitUntil(async () => {
    await acceptSystemPermission();
    return (await isLoggedIn()) || (await welcome.isShown()) || (await login.isShown());
  }, {
    timeout: 45_000, timeoutMsg: 'App showed neither Welcome, Sign-in nor Home within 45s',
  });
  if (await isLoggedIn()) return;
  if (await welcome.isShown()) await welcome.tapLogin();
  await login.login(creds);
  // Home, or the app's rejection ("Incorrect passcode. 3 attempt(s) left.") — fail fast with its message.
  const errorEl = byId('auth.login.error');
  await driver.waitUntil(async () => (await isLoggedIn()) || (await errorEl.isDisplayed().catch(() => false)), {
    timeout: 30_000, timeoutMsg: 'Neither Home nor a sign-in error appeared within 30s of Login',
  });
  if (!(await isLoggedIn())) {
    const who = 'email' in creds ? creds.email : creds.phone;
    throw new Error(`Sign-in rejected for ${who}: "${(await errorEl.getText()).trim()}"`);
  }
  await new TabBar().waitForShown(30_000);
}

export async function openTab(tab: Tab): Promise<void> {
  await new TabBar().open(tab);
}

/**
 * Mocha helper: skip the current test (with a reason in the report) when the QA seeding /
 * clock hooks aren't configured. Use for time-travel and state-seeding scenarios.
 */
export function requireHooks(ctx: Mocha.Context): void {
  if (!QaHooks.isConfigured()) {
    ctx.skip();
  }
}

/**
 * Seed a fresh customer (preferred — keeps tests independent) and log in.
 * Returns the customerId + hooks client for further seeding / clock control.
 */
export async function freshCustomer(
  opts: Parameters<QaHooks['seedCustomer']>[0],
  method: SignInMethod = 'email',
): Promise<{ hooks: QaHooks; customerId: string; email: string; password: string; phone: string; pin: string }> {
  const hooks = await QaHooks.create();
  const c = await hooks.seedCustomer(opts);
  await loginAs(method === 'email' ? { email: c.email, password: c.password } : { phone: c.phone, pin: c.pin });
  return { hooks, customerId: c.customerId, email: c.email, password: c.password, phone: c.phone, pin: c.pin };
}
