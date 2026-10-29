/**
 * Contract test ID → selector in the live dev build, for screens the app has not yet tagged with
 * the contract IDs (docs/SELECTOR-CONTRACT.md). Probed on Android, build v1.1.55 (apps/rosabon-dev.apk).
 * React Native maps `testID` → Android resource-id, so IDs the app already has use `rid:`.
 *
 *   rid:<id>      exact resource-id (RN testID)
 *   ~<label>      accessibility id (content-desc)
 *   text:<text>   exact visible text
 *   android=...   raw UiAutomator selector
 *
 * Remove an entry once the app ships the contract ID for it.
 */
export const LIVE_IDS: Record<string, string> = {
  // Welcome
  'auth.welcome.screen': 'rid:onboarding-login',
  'auth.welcome.login': 'rid:onboarding-login',
  'auth.welcome.signup': '~Create account',

  // Sign-in: one "Email/Phone Number" field → Continue → password (email) or passcode/PIN (phone) → Login
  'auth.login.screen': 'text:Welcome back',
  'auth.login.identifier.input': 'rid:form-text-input',
  'auth.login.continue': '~Continue',
  'auth.login.password.screen': 'text:Enter your password',
  'auth.login.password.input': 'rid:form-text-input',
  'auth.login.submit': '~Login',
  'auth.login.forgotPassword': 'rid:login-forgot-password',
  // Phone route: "Enter your passcode" — 6-digit field that auto-submits on the 6th digit; button reads "Continue"
  'auth.login.pin.screen': 'rid:passcode-screen',
  'auth.login.pin.input': 'rid:otp-input',
  'auth.login.pin.submit': '~Continue',
  'auth.login.forgotPin': '~Forgot Passcode?',
  'auth.login.switchAccount': '~Switch Account',
  'auth.login.biometric': '~Login via Fingerprint',
  // Inline error under the field, e.g. "Incorrect passcode. 3 attempt(s) left."
  'auth.login.error': 'android=new UiSelector().textMatches("(?i).*(incorrect|invalid|locked|attempt).*")',

  // Home + bottom tabs
  'home.tabbar': 'rid:bottom-tab-bar',
  'home.tabbar.home': 'rid:bottom-tab-home',
  'home.tabbar.grow': 'rid:bottom-tab-investment',
  'home.tabbar.borrow': 'rid:bottom-tab-loan',
  'home.tabbar.profile': 'rid:bottom-tab-settings',
  'common.header.back': 'rid:phosphor-react-native-arrow-left-undefined',
};

/** WebdriverIO selector for a LIVE_IDS value (Android). */
export function liveSelector(value: string): string {
  if (value.startsWith('rid:')) return `android=new UiSelector().resourceId("${value.slice(4)}")`;
  if (value.startsWith('text:')) return `android=new UiSelector().text("${value.slice(5).replace(/"/g, '\\"')}")`;
  return value; // '~label' or 'android=...'
}
