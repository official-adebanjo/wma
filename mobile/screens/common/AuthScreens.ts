import { BaseScreen, byId, driver } from '../BaseScreen';

export class WelcomeScreen extends BaseScreen {
  protected readonly root = 'auth.welcome.screen';
  tapLogin() { return this.tap('auth.welcome.login'); }
  tapCreateAccount() { return this.tap('auth.welcome.signup'); }
}

export class LoginScreen extends BaseScreen {
  protected readonly root = 'auth.login.screen';
  enterPhone(phone: string) { return this.type('auth.login.phone.input', phone); }
  enterPin(pin: string) { return this.type('auth.login.pin.input', pin); }
  submit() { return this.tap('auth.login.submit'); }
  errorText() { return this.text('auth.login.error'); }
  async login(phone: string, pin: string) {
    await this.waitForShown();
    await this.enterPhone(phone);
    await this.enterPin(pin);
    await this.submit();
  }
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
  const id = driver.isAndroid ? process.env.APP_PACKAGE ?? 'com.rosabon.unified' : process.env.APP_BUNDLE_ID ?? 'com.rosabon.unified';
  await driver.terminateApp(id);
  await driver.activateApp(id);
}

export async function backgroundApp(seconds: number): Promise<void> {
  await driver.background(seconds);
}
