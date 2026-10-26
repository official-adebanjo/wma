import { QaHooks } from '../../shared/api/qa-hooks';
import { required } from '../../shared/config/env';
import { LoginScreen, WelcomeScreen, isLoggedIn } from '../screens/common/AuthScreens';
import { TabBar, Tab } from '../screens/common/HomeScreens';

export type Persona = 'T1' | 'T2' | 'T3' | 'CORPORATE';

/** Static persona accounts from .env (used when QA hooks are unavailable). */
export function personaCreds(p: Persona): { phone: string; pin: string } {
  return { phone: required(`CUSTOMER_${p}_PHONE`), pin: required(`CUSTOMER_${p}_PIN`) };
}

export async function loginAs(creds: { phone: string; pin: string }): Promise<void> {
  if (await isLoggedIn()) return;
  const welcome = new WelcomeScreen();
  if (await welcome.isShown()) await welcome.tapLogin();
  await new LoginScreen().login(creds.phone, creds.pin);
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
export async function freshCustomer(opts: Parameters<QaHooks['seedCustomer']>[0]): Promise<{ hooks: QaHooks; customerId: string; phone: string; pin: string }> {
  const hooks = await QaHooks.create();
  const c = await hooks.seedCustomer(opts);
  await loginAs({ phone: c.phone, pin: c.pin });
  return { hooks, customerId: c.customerId, phone: c.phone, pin: c.pin };
}
