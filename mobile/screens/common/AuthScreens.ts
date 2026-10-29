import { $ } from '@wdio/globals';
import { BaseScreen, byId, driver } from '../BaseScreen';

export class WelcomeScreen extends BaseScreen {
  protected readonly root = 'auth.welcome.screen';
  /** The link ignores taps while Welcome is still animating in, so retry until Sign-in shows. */
  async tapLogin() {
    for (let i = 0; i < 4; i++) {
      await this.tap('auth.welcome.login');
      if (await byId('auth.login.screen').waitForDisplayed({ timeout: 5_000 }).then(() => true, () => false)) return;
    }
    throw new Error('Sign-in screen did not open from Welcome after 4 taps');
  }
  tapCreateAccount() { return this.tap('auth.welcome.signup'); }
}

/** Sign-in accepts either email + password or phone + passcode/PIN. */
export type Credentials = { email: string; password: string } | { phone: string; pin: string };
export type SignInMethod = 'email' | 'phone';
export const methodOf = (c: Credentials): SignInMethod => ('email' in c ? 'email' : 'phone');

/**
 * Sign-in only accepts +234 format — a local "08…" number makes Continue silently do nothing
 * (dev build 2026-10-29). Normalise so tests can keep numbers as written in .env.
 */
export function toIntlPhone(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('234')) return `+${digits}`;
  if (digits.startsWith('0')) return `+234${digits.slice(1)}`;
  return `+234${digits}`;
}

/**
 * Two steps in the live app: one "Email/Phone Number" field → Continue, then the secret
 * screen (password for email; passcode/PIN for phone) → Login.
 */
export class LoginScreen extends BaseScreen {
  protected readonly root = 'auth.login.screen';
  enterIdentifier(emailOrPhone: string) { return this.type('auth.login.identifier.input', emailOrPhone); }
  continue() { return this.tap('auth.login.continue'); }
  enterPassword(password: string) { return this.type('auth.login.password.input', password); }
  enterPin(pin: string) { return this.type('auth.login.pin.input', pin); }
  submit() { return this.tap('auth.login.submit'); }
  errorText() { return this.text('auth.login.error'); }
  async login(creds: Credentials) {
    await this.waitForShown();
    await this.enterIdentifier('email' in creds ? creds.email : toIntlPhone(creds.phone));
    await this.continue();
    if ('email' in creds) {
      await byId('auth.login.password.screen').waitForDisplayed({ timeout: 20_000 });
      await this.enterPassword(creds.password);
      await this.submit();
      return;
    }
    await byId('auth.login.pin.screen').waitForDisplayed({ timeout: 20_000 });
    await this.enterPin(creds.pin);
    // The 6th digit auto-submits. Only press Continue if nothing happened — a second submit
    // of a wrong code would burn another attempt.
    const settled = await driver.waitUntil(
      async () => (await isLoggedIn()) || (await byId('auth.login.error').isDisplayed().catch(() => false)),
      { timeout: 6_000 },
    ).then(() => true, () => false);
    if (!settled && (await byId('auth.login.pin.screen').isDisplayed().catch(() => false))) {
      await this.tap('auth.login.pin.submit');
    }
  }
  /** Retry the secret on the same screen (after a wrong attempt). */
  async retryPassword(password: string) {
    await this.enterPassword(password);
    await this.submit();
  }
  tapForgotPassword() { return this.tap('auth.login.forgotPassword'); }
  tapForgotPin() { return this.tap('auth.login.forgotPin'); }
}

export class OtpScreen extends BaseScreen {
  protected readonly root = 'auth.otp.screen';
  enter(otp: string) { return this.type('auth.otp.input', otp); }
  submit() { return this.tap('auth.otp.submit'); }
  resend() { return this.tap('auth.otp.resend'); }
  resendEnabled() { return this.isEnabled('auth.otp.resend'); }
  errorText() { return this.text('auth.otp.error'); }
}

export class SignupScreen extends BaseScreen {
  protected readonly root = 'auth.signup.screen';
  fillName(first: string, last: string) {
    return this.type('auth.signup.firstName.input', first).then(() => this.type('auth.signup.lastName.input', last));
  }
  fillPhone(phone: string) { return this.type('auth.signup.phone.input', phone); }
  fillEmail(email: string) { return this.type('auth.signup.email.input', email); }
  fillDob(isoDate: string) { return this.type('auth.signup.dob.input', isoDate); }
  fillBvn(bvn: string) { return this.type('auth.signup.bvn.input', bvn); }
  continue() { return this.tap('auth.signup.continue'); }
  continueEnabled() { return this.isEnabled('auth.signup.continue'); }
  fieldError(field: 'firstName' | 'lastName' | 'phone' | 'email' | 'dob' | 'bvn') { return this.text(`auth.signup.${field}.input.error`); }
}

export class CreatePinScreen extends BaseScreen {
  protected readonly root = 'auth.pin.create.screen';
  enterPin(pin: string) { return this.type('auth.pin.create.input', pin); }
  confirmPin(pin: string) { return this.type('auth.pin.confirm.input', pin); }
  submit() { return this.tap('auth.pin.create.submit'); }
  errorText() { return this.text('auth.pin.create.error'); }
}

export class AccountBlockedScreen extends BaseScreen {
  protected readonly root = 'auth.blocked.screen';
  message() { return this.text('auth.blocked.message'); }
}

export async function isLoggedIn(): Promise<boolean> {
  return byId('home.tabbar').isDisplayed().catch(() => false);
}

export async function relaunchApp(): Promise<void> {
  const id = driver.isAndroid ? process.env.APP_PACKAGE ?? 'com.optisoft.rosabon' : process.env.APP_BUNDLE_ID ?? 'com.optisoft.rosabon';
  await driver.terminateApp(id);
  await driver.activateApp(id);
}

/** Android: wipe app data (signed-out, first-launch state) without reinstalling. */
export async function resetApp(): Promise<void> {
  const id = process.env.APP_PACKAGE ?? 'com.optisoft.rosabon';
  await driver.terminateApp(id);
  await driver.execute('mobile: clearApp', { appId: id });
  // Clearing data also revokes runtime permissions (autoGrantPermissions only applies at install).
  await driver.execute('mobile: changePermissions', { permissions: 'all', appPackage: id, action: 'grant' }).catch(() => undefined);
  await driver.activateApp(id);
}

/**
 * Android: clear a system runtime-permission prompt (e.g. "Allow Rosabon to send you notifications?").
 * Taps on the prompt are ignored while the app holds an overlay (SYSTEM_ALERT_WINDOW), so grant via
 * the package manager instead — Android then dismisses the prompt itself.
 */
export async function acceptSystemPermission(): Promise<boolean> {
  if (!driver.isAndroid) return false;
  const allow = $('android=new UiSelector().resourceIdMatches(".*:id/permission_allow(_foreground_only)?_button")');
  if (!(await allow.isDisplayed().catch(() => false))) return false;
  const appPackage = process.env.APP_PACKAGE ?? 'com.optisoft.rosabon';
  await driver.execute('mobile: changePermissions', { permissions: 'all', appPackage, action: 'grant' });
  return true;
}

export async function backgroundApp(seconds: number): Promise<void> {
  await driver.background(seconds);
}
