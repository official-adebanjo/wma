import { expect } from '@wdio/globals';
import { env } from '../../../shared/config/env';
import { identity } from '../../../shared/data/factories';
import { QaHooks } from '../../../shared/api/qa-hooks';
import { Tag, title } from '../../../shared/support/tags';
import { requireHooks, loginAs } from '../../helpers/session';
import {
  AccountBlockedScreen, CreatePinScreen, LoginScreen, OtpScreen, SignupScreen, WelcomeScreen,
  backgroundApp, isLoggedIn, relaunchApp,
} from '../../screens/common/AuthScreens';
import { KycHubScreen } from '../../screens/kyc/KycScreens';
import { TabBar } from '../../screens/common/HomeScreens';

/**
 * Onboarding (Tier 1) + authentication.
 * KYC Spec V4 §2 Tier 1: BVN (name + DOB match), full name per BVN/NIMC, email + phone verified by OTP.
 * QA Strategy §7 Authentication = CRIT; §17 OTP handling, session management, unauthorised access.
 */
describe('Auth › Onboarding to Tier 1', () => {
  let hooks: QaHooks;
  const welcome = new WelcomeScreen();
  const signup = new SignupScreen();
  const otp = new OtpScreen();
  const pin = new CreatePinScreen();

  beforeEach(async function () {
    requireHooks(this);
    hooks = await QaHooks.create();
    await relaunchApp();
    await welcome.waitForShown();
    await welcome.tapCreateAccount();
    await signup.waitForShown();
  });

  afterEach(async () => {
    await hooks?.dispose();
  });

  const uniquePhone = () => `080${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

  it(title('happy path: BVN match → phone OTP → email OTP → PIN → lands on home as Tier 1', Tag.crit, Tag.smoke, Tag.spec('KYC§2-Tier1')), async () => {
    await hooks.stubProvider({ provider: 'NIBSS', outcome: 'MATCH' });
    await signup.fillName('Ada', 'Okafor');
    await signup.fillPhone(uniquePhone());
    await signup.fillEmail(`qa+${Date.now()}@example.com`);
    await signup.fillDob('1990-05-14');
    await signup.fillBvn(identity.validBvn);
    await signup.continue();
    await otp.waitForShown();
    await otp.enter(env.testOtp);
    await otp.submit();
    await otp.waitForShown(); // email OTP
    await otp.enter(env.testOtp);
    await otp.submit();
    await pin.waitForShown();
    await pin.enterPin('2580');
    await pin.confirmPin('2580');
    await pin.submit();
    await new TabBar().waitForShown(30_000);
    await new TabBar().open('profile');
    await expect(await new KycHubScreen().currentTier()).toMatch(/tier 1/i);
  });

  for (const [label, value] of [['10 digits', identity.tooShort], ['contains a letter', identity.withLetters]] as const) {
    it(title(`BVN ${label} is rejected client-side`, Tag.high, Tag.spec('KYC§4')), async () => {
      await signup.fillBvn(value);
      await expect(await signup.continueEnabled()).toBe(false);
      await expect(await signup.fieldError('bvn')).toMatch(/11 digits/i);
    });
  }

  it(title('BVN name/DOB mismatch blocks onboarding with clear guidance', Tag.crit, Tag.spec('KYC§2-Tier1')), async () => {
    await hooks.stubProvider({ provider: 'NIBSS', outcome: 'NAME_DOB_MISMATCH' });
    await signup.fillName('Wrong', 'Person');
    await signup.fillPhone(uniquePhone());
    await signup.fillEmail(`qa+${Date.now()}@example.com`);
    await signup.fillDob('1990-05-14');
    await signup.fillBvn(identity.mismatchedBvn);
    await signup.continue();
    await expect(await signup.fieldError('bvn')).toMatch(/match/i);
    await expect(await otp.isShown()).toBe(false);
  });

  it(title('identity provider timeout surfaces a retryable error, not a crash', Tag.high, Tag.spec('KYC§3')), async () => {
    await hooks.stubProvider({ provider: 'NIBSS', outcome: 'TIMEOUT' });
    await signup.fillName('Ada', 'Okafor');
    await signup.fillPhone(uniquePhone());
    await signup.fillEmail(`qa+${Date.now()}@example.com`);
    await signup.fillDob('1990-05-14');
    await signup.fillBvn(identity.validBvn);
    await signup.continue();
    await expect(await signup.fieldError('bvn')).toMatch(/try again/i);
  });

  it(title('wrong OTP is rejected; resend is throttled', Tag.crit, Tag.spec('QAStrategy§17')), async () => {
    await hooks.stubProvider({ provider: 'NIBSS', outcome: 'MATCH' });
    await signup.fillName('Ada', 'Okafor');
    await signup.fillPhone(uniquePhone());
    await signup.fillEmail(`qa+${Date.now()}@example.com`);
    await signup.fillDob('1990-05-14');
    await signup.fillBvn(identity.validBvn);
    await signup.continue();
    await otp.waitForShown();
    await otp.enter('000000');
    await otp.submit();
    await expect(await otp.errorText()).toMatch(/invalid|incorrect/i);
    await expect(await otp.resendEnabled()).toBe(false); // countdown running
  });

  it(title('PIN confirmation mismatch and weak PINs are rejected', Tag.high, Tag.spec('QAStrategy§17')), async () => {
    await hooks.stubProvider({ provider: 'NIBSS', outcome: 'MATCH' });
    await signup.fillName('Ada', 'Okafor');
    await signup.fillPhone(uniquePhone());
    await signup.fillEmail(`qa+${Date.now()}@example.com`);
    await signup.fillDob('1990-05-14');
    await signup.fillBvn(identity.validBvn);
    await signup.continue();
    for (let i = 0; i < 2; i++) { await otp.waitForShown(); await otp.enter(env.testOtp); await otp.submit(); }
    await pin.waitForShown();
    await pin.enterPin('2580');
    await pin.confirmPin('2581');
    await pin.submit();
    await expect(await pin.errorText()).toMatch(/match/i);
    await pin.enterPin('1111');
    await pin.confirmPin('1111');
    await pin.submit();
    await expect(await pin.errorText()).toMatch(/weak|sequential|repeated/i);
  });
});

describe('Auth › Login and session', () => {
  let hooks: QaHooks;
  let creds: { phone: string; pin: string; customerId: string };
  const login = new LoginScreen();

  beforeEach(async function () {
    requireHooks(this);
    hooks = await QaHooks.create();
    const c = await hooks.seedCustomer({ tier: 2, walletBalance: 10_000 });
    creds = { phone: c.phone, pin: c.pin, customerId: c.customerId };
    await relaunchApp();
    const welcome = new WelcomeScreen();
    if (await welcome.isShown()) await welcome.tapLogin();
    await login.waitForShown();
  });

  afterEach(async () => {
    await hooks?.dispose();
  });

  it(title('valid credentials log in', Tag.crit, Tag.smoke, Tag.spec('QAStrategy§14')), async () => {
    await login.login(creds.phone, creds.pin);
    await expect(await isLoggedIn()).toBe(true);
  });

  it(title('wrong PIN shows generic error (no account enumeration)', Tag.crit, Tag.spec('QAStrategy§17')), async () => {
    await login.login(creds.phone, creds.pin === '0000' ? '1111' : '0000');
    const err = await login.errorText();
    await expect(err).toMatch(/incorrect|invalid/i);
    await expect(err).not.toMatch(/not registered|no account/i);
  });

  it(title('account locks after repeated wrong PINs', Tag.crit, Tag.spec('QAStrategy§17')), async () => {
    for (let i = 0; i < 5; i++) await login.login(creds.phone, '9999');
    await expect(await login.errorText()).toMatch(/locked|too many/i);
    await login.login(creds.phone, creds.pin);
    await expect(await isLoggedIn()).toBe(false);
  });

  it(title('session survives short backgrounding but requires re-auth after relaunch', Tag.high, Tag.spec('QAStrategy§19')), async () => {
    await loginAs(creds);
    await backgroundApp(5);
    await expect(await isLoggedIn()).toBe(true);
    await relaunchApp();
    await expect(await login.isShown() || await new WelcomeScreen().isShown()).toBe(true);
  });

  it(title('account frozen by Compliance blocks login with support message', Tag.crit, Tag.spec('AdminPRD:Screening')), async () => {
    await hooks.setAccountRestriction({ customerId: creds.customerId, restriction: 'FROZEN' });
    await login.login(creds.phone, creds.pin);
    const blocked = new AccountBlockedScreen();
    await blocked.waitForShown();
    await expect(await blocked.message()).toMatch(/under review.*contact support/i);
  });
});
